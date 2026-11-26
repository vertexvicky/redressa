import { and, desc, eq, ne } from "drizzle-orm";
import { OfficerContactLogSchema, OfficerReplySchema } from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, requireRole, type AppVariables } from "../auth/guard.js";
import {
  aiCallEvents,
  contractCriteria,
  conversations,
  departmentContacts,
  departmentReplies,
  evidence,
  expectationContracts,
  responseRequirements,
  tickets,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { toolCheckReplyAgainstContract, toolReturnReplyToOfficer } from "../agent/tools/contract.js";
import { writeAuditLog } from "../services/audit.js";
import { createSignedEvidenceDownloadPath } from "../services/storage.js";
import { transition } from "../services/transition.js";

export const officerRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

officerRoutes.use("*", requireRole("officer", "admin"));

officerRoutes.get("/tickets", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");

  let rows: Array<typeof tickets.$inferSelect>;
  if (user.departmentId) {
    rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.departmentId, user.departmentId), ne(tickets.status, "draft")))
      .orderBy(desc(tickets.createdAt));
  } else {
    rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.isDemo, 0), ne(tickets.status, "draft")))
      .orderBy(desc(tickets.createdAt));
  }

  return c.json({ tickets: rows });
});

officerRoutes.get("/tickets/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, id))
    .orderBy(desc(expectationContracts.version))
    .limit(1);

  const [criteria, requirements, replies, contacts, ticketEvidence, cases, aiCalls] = await Promise.all([
    contract
      ? db
          .select()
          .from(contractCriteria)
          .where(eq(contractCriteria.contractId, contract.id))
          .orderBy(contractCriteria.position)
      : Promise.resolve([]),
    contract
      ? db
          .select()
          .from(responseRequirements)
          .where(eq(responseRequirements.contractId, contract.id))
          .orderBy(responseRequirements.position)
      : Promise.resolve([]),
    db
      .select()
      .from(departmentReplies)
      .where(eq(departmentReplies.ticketId, id))
      .orderBy(desc(departmentReplies.repliedAt)),
    db
      .select()
      .from(departmentContacts)
      .where(eq(departmentContacts.ticketId, id))
      .orderBy(desc(departmentContacts.occurredAt)),
    db.select().from(evidence).where(eq(evidence.ticketId, id)),
    db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.ticketId, id))
      .orderBy(desc(verificationCases.startedAt)),
    db
      .select({
        id: aiCallEvents.id,
        deliveryStatus: aiCallEvents.deliveryStatus,
        callStatus: aiCallEvents.callStatus,
        callOutcome: aiCallEvents.callOutcome,
        callDurationSeconds: aiCallEvents.callDurationSeconds,
        skipReason: aiCallEvents.skipReason,
        sentAt: aiCallEvents.sentAt,
        completedAt: aiCallEvents.completedAt
      })
      .from(aiCallEvents)
      .where(eq(aiCallEvents.ticketId, id))
      .orderBy(desc(aiCallEvents.createdAt))
      .limit(1)
  ]);

  const evidenceWithUrls = await Promise.all(
    ticketEvidence.map(async (ev) => ({
      ...ev,
      signedUrl: await createSignedEvidenceDownloadPath(ev.id, c.env)
    }))
  );

  return c.json({
    ticket,
    contract: contract
      ? {
          ...contract,
          criteria,
          responseRequirements: requirements
        }
      : null,
    replies,
    contacts,
    evidence: evidenceWithUrls,
    verificationCase: cases[0] ?? null,
    aiCall: aiCalls[0] ?? null
  });
});

officerRoutes.post("/tickets/:id/reply", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = OfficerReplySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid reply payload", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  if (ticket.status === "awaiting_citizen_confirmation") {
    await transition(db, id, "filed", { type: "officer", id: user.id }, "Filed on officer response");
    await transition(db, id, "assigned", { type: "officer", id: user.id }, "Officer opened ticket");
    await transition(db, id, "in_progress", { type: "officer", id: user.id }, "Officer started working on ticket");
  } else if (ticket.status === "filed" || ticket.status === "assigned" || ticket.status === "reopened") {
    if (ticket.status === "filed") {
      await transition(db, id, "assigned", { type: "officer", id: user.id }, "Officer opened ticket");
    }
    await transition(db, id, "in_progress", { type: "officer", id: user.id }, "Officer started working on ticket");
  } else if (ticket.status === "reply_returned" || ticket.status === "department_replied") {
    await transition(db, id, "in_progress", { type: "officer", id: user.id }, "Officer revising reply");
  } else if (["needs_review", "unverified", "not_resolved"].includes(ticket.status)) {
    if (ticket.status === "not_resolved") {
      await transition(db, id, "reopened", { type: "officer", id: user.id }, "Reopened for revised reply");
    } else {
      await transition(db, id, "reopened", { type: "officer", id: user.id }, "Reopened for revised reply");
    }
    await transition(db, id, "in_progress", { type: "officer", id: user.id }, "Officer revising reply");
  }

  const attachedIds = parsed.data.evidence_ids ?? [];
  const enrichedStructured = parsed.data.structured_entries.map((entry, idx) =>
    idx === 0 && attachedIds.length > 0
      ? { ...entry, evidence_ids: Array.from(new Set([...(entry.evidence_ids ?? []), ...attachedIds])) }
      : entry
  );
  if (enrichedStructured.length === 0 && attachedIds.length > 0) {
    enrichedStructured.push({
      requirement_id: "attachment",
      label: "Supporting Attachment",
      value: parsed.data.text,
      evidence_ids: attachedIds
    });
  }

  const now = Date.now();
  const replyId = crypto.randomUUID();
  await db.insert(departmentReplies).values({
    id: replyId,
    ticketId: id,
    officerId: user.officerId,
    text: parsed.data.text,
    structuredJson: enrichedStructured,
    claimsResolved: parsed.data.claims_resolved ? 1 : 0,
    repliedAt: now,
    createdAt: now,
    updatedAt: now
  });

  await transition(
    db,
    id,
    "department_replied",
    { type: "officer", id: user.id },
    "Department reply submitted"
  );

  const compliance = await toolCheckReplyAgainstContract(db, c.env, replyId, user.id);
  if (!compliance.compliant) {
    const combinedQuestions = Array.from(
      new Set([...(compliance.gaps ?? []), ...(compliance.follow_up_questions ?? [])])
    );
    await toolReturnReplyToOfficer(
      db,
      replyId,
      combinedQuestions.length > 0 ? combinedQuestions : ["Additional evidence or clarification required."]
    );
  }

  const [updatedTicket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  const [updatedReply] = await db
    .select()
    .from(departmentReplies)
    .where(eq(departmentReplies.id, replyId))
    .limit(1);

  return c.json({
    ok: true,
    ticket: updatedTicket,
    reply: updatedReply,
    compliance
  });
});

officerRoutes.post("/tickets/:id/contact-log", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = OfficerContactLogSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid contact log", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  const now = Date.now();
  const contactId = crypto.randomUUID();
  await db.insert(departmentContacts).values({
    id: contactId,
    ticketId: id,
    officerId: user.officerId,
    channel: parsed.data.channel,
    direction: parsed.data.direction,
    loggedBy: user.id,
    notes: parsed.data.notes,
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "officer",
    actorId: user.id,
    action: "department_contact_logged",
    entityType: "department_contact",
    entityId: contactId,
    diff: { ticketId: id, channel: parsed.data.channel, direction: parsed.data.direction }
  });

  return c.json({ ok: true, id: contactId }, 201);
});

officerRoutes.post("/tickets/:id/mark-resolved", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  if (ticket.status === "reply_returned") {
    return jsonError(
      c,
      409,
      "REPLY_RETURNED",
      "Your latest reply was returned by Redressa for missing contract requirements. Submit a compliant reply first."
    );
  }

  if (ticket.status === "filed") {
    await transition(db, id, "assigned", { type: "officer", id: user.id }, "Assigned for closure");
  }
  if (ticket.status === "assigned" || ticket.status === "reopened") {
    await transition(db, id, "in_progress", { type: "officer", id: user.id }, "Processing closure");
  }

  await transition(
    db,
    id,
    "closure_claimed",
    { type: "officer", id: user.id },
    "Officer marked ticket as resolved"
  );

  const now = Date.now();
  const caseId = crypto.randomUUID();
  await db.insert(verificationCases).values({
    id: caseId,
    ticketId: id,
    trigger: "officer_resolved",
    startedAt: now,
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  await db.insert(conversations).values({
    id: crypto.randomUUID(),
    ticketId: id,
    verificationCaseId: caseId,
    kind: "closure",
    channel: "web_chat",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  if (c.env.AGENT_EVENTS) {
    await c.env.AGENT_EVENTS.send({
      eventId: crypto.randomUUID(),
      eventType: "closure_claimed",
      ticketId: id,
      verificationCaseId: caseId,
      actorId: user.id
    });
  }

  const [updatedTicket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return c.json({ ok: true, verificationCaseId: caseId, ticket: updatedTicket });
});
