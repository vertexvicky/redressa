import { eq } from "drizzle-orm";
import { CaseMessageSchema } from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import {
  conversations,
  messages,
  tickets,
  users,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { processAgentEvent } from "../agent/orchestrator.js";
import { writeAuditLog } from "../services/audit.js";
import { sha256Hex } from "../services/crypto.js";

export const caseMessageRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

caseMessageRoutes.get("/:id/messages", async (c) => {
  const db = c.get("db");
  const caseId = c.req.param("id");

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.verificationCaseId, caseId))
    .limit(1);

  if (!conv) {
    return c.json({ messages: [] });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  return c.json({ conversationId: conv.id, messages: rows });
});

caseMessageRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const caseId = c.req.param("id");
  const body = await c.req.json();
  const parsed = CaseMessageSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid message", parsed.error.flatten());
  }

  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);
  if (!vCase) return jsonError(c, 404, "NOT_FOUND", "Verification case not found");

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, vCase.ticketId))
    .limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  let [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.verificationCaseId, caseId))
    .limit(1);

  const now = Date.now();
  if (!conv) {
    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId: ticket.id,
      verificationCaseId: caseId,
      kind: "closure",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const inputHash = await sha256Hex(parsed.data.text.trim().toLowerCase());
  const matchedSafeWord = Boolean(dbUser?.safeWordHash && dbUser.safeWordHash === inputHash);
  const isDiscreet =
    Boolean(parsed.data.discreet) ||
    matchedSafeWord ||
    parsed.data.quick_reply_value === "discreet_cant_talk" ||
    /i can't talk now/i.test(parsed.data.text);

  const isStop = /^\s*stop\s*$/i.test(parsed.data.text);

  if (isDiscreet) {
    await db
      .update(tickets)
      .set({ discreetRequested: 1, updatedAt: now })
      .where(eq(tickets.id, ticket.id));
    await writeAuditLog(db, {
      actorType: user.isDemo ? "judge" : "citizen",
      actorId: user.id,
      action: "safe_contact_discreet_activated",
      entityType: "ticket",
      entityId: ticket.id
    });
  }

  if (isStop) {
    await db
      .update(tickets)
      .set({ optOut: 1, updatedAt: now })
      .where(eq(tickets.id, ticket.id));
  }

  if (conv) {
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      sender: "citizen",
      text: parsed.data.text,
      language: parsed.data.language,
      createdAt: now,
      updatedAt: now
    });
  }

  if (isStop && conv) {
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      sender: "agent",
      text: "Understood. I've recorded your opt-out and won't send unsolicited follow-ups.",
      language: parsed.data.language,
      createdAt: now + 1,
      updatedAt: now + 1
    });
  } else {
    await processAgentEvent(db, c.env, {
      eventId: crypto.randomUUID(),
      eventType: "citizen_message",
      ticketId: ticket.id,
      verificationCaseId: caseId,
      actorId: user.id
    });
  }

  const updatedMsgs = conv
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(messages.createdAt)
    : [];

  return c.json({ messages: updatedMsgs });
});

caseMessageRoutes.get("/:id/ws", async (c) => {
  const caseId = c.req.param("id");
  const upgrade = c.req.header("upgrade");
  if (upgrade?.toLowerCase() !== "websocket") {
    return jsonError(c, 400, "UPGRADE_REQUIRED", "Expected WebSocket upgrade");
  }
  const id = c.env.CASE_ROOM.idFromName(caseId);
  const stub = c.env.CASE_ROOM.get(id);
  return stub.fetch(c.req.raw);
});
