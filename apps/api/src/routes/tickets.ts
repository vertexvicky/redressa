import { desc, eq } from "drizzle-orm";
import { CitizenFeedbackSchema, TicketContestSchema, TicketWithdrawSchema } from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import {
  contractCriteria,
  conversations,
  departmentContacts,
  departmentReplies,
  departments,
  evidence,
  expectationContracts,
  integritySignals,
  messages,
  responseRequirements,
  ticketEvents,
  tickets,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { processAgentEvent } from "../agent/orchestrator.js";
import { writeAuditLog } from "../services/audit.js";
import { triggerAiCallNonBlocking } from "../services/aiCallEngine.js";
import { createSignedEvidenceDownloadPath } from "../services/storage.js";
import { transition } from "../services/transition.js";

export const ticketRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

ticketRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");

  let rows: Array<typeof tickets.$inferSelect>;
  if (user.isDemo && user.demoSessionId) {
    rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.demoSessionId, user.demoSessionId))
      .orderBy(desc(tickets.createdAt));
  } else if (user.role === "admin" || user.role === "reviewer") {
    rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.isDemo, 0))
      .orderBy(desc(tickets.createdAt));
  } else {
    rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.citizenId, user.id))
      .orderBy(desc(tickets.createdAt));
  }

  return c.json({ tickets: rows });
});

ticketRoutes.get("/:id", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");

  if (
    !user.isDemo &&
    user.role === "citizen" &&
    ticket.citizenId !== user.id
  ) {
    return jsonError(c, 403, "FORBIDDEN", "Access denied");
  }

  const [contracts, replies, contacts, ticketEvidence, cases, convos, dept] = await Promise.all([
    db
      .select()
      .from(expectationContracts)
      .where(eq(expectationContracts.ticketId, id))
      .orderBy(desc(expectationContracts.version)),
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
    db.select().from(conversations).where(eq(conversations.ticketId, id)),
    ticket.departmentId
      ? db.select().from(departments).where(eq(departments.id, ticket.departmentId)).limit(1)
      : Promise.resolve([])
  ]);

  const currentContract = contracts.find((ct) => ct.isCurrent === 1) ?? contracts[0] ?? null;
  const [criteria, reqs] = currentContract
    ? await Promise.all([
        db
          .select()
          .from(contractCriteria)
          .where(eq(contractCriteria.contractId, currentContract.id))
          .orderBy(contractCriteria.position),
        db
          .select()
          .from(responseRequirements)
          .where(eq(responseRequirements.contractId, currentContract.id))
          .orderBy(responseRequirements.position)
      ])
    : [[], []];

  const latestCase = cases[0] ?? null;
  const signals = latestCase
    ? await db
        .select()
        .from(integritySignals)
        .where(eq(integritySignals.verificationCaseId, latestCase.id))
    : [];

  const evidenceWithUrls = await Promise.all(
    ticketEvidence.map(async (ev) => ({
      ...ev,
      signedUrl: await createSignedEvidenceDownloadPath(ev.id, c.env)
    }))
  );

  return c.json({
    ticket,
    department: dept[0] ?? null,
    contract: currentContract
      ? {
          ...currentContract,
          criteria,
          responseRequirements: reqs
        }
      : null,
    replies,
    contacts,
    evidence: evidenceWithUrls,
    verificationCase: latestCase,
    signals,
    conversations: convos
  });
});

ticketRoutes.get("/:id/timeline", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const events = await db
    .select()
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, id))
    .orderBy(ticketEvents.occurredAt);
  return c.json({ events });
});

ticketRoutes.post("/:id/withdraw", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = TicketWithdrawSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Withdrawal reason required", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id && !user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  await transition(
    db,
    id,
    "closure_claimed",
    { type: user.isDemo ? "judge" : "citizen", id: user.id },
    `Citizen withdrawal: ${parsed.data.reason}`
  );

  const now = Date.now();
  const caseId = crypto.randomUUID();
  await db.insert(verificationCases).values({
    id: caseId,
    ticketId: id,
    trigger: "citizen_withdrawn",
    startedAt: now,
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  const convId = crypto.randomUUID();
  await db.insert(conversations).values({
    id: convId,
    ticketId: id,
    verificationCaseId: caseId,
    kind: "closure",
    channel: "web_chat",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  await db.insert(messages).values({
    id: crypto.randomUUID(),
    conversationId: convId,
    sender: "citizen",
    text: `Withdrawal reason: ${parsed.data.reason}`,
    language: ticket.language === "ta" ? "ta" : "en",
    createdAt: now,
    updatedAt: now
  });

  await processAgentEvent(db, c.env, {
    eventId: crypto.randomUUID(),
    eventType: "closure_claimed",
    ticketId: id,
    verificationCaseId: caseId,
    actorId: user.id
  });

  return c.json({ ok: true, verificationCaseId: caseId });
});

ticketRoutes.post("/:id/contest", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = TicketContestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Contest reason required", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id && !user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  const [latestCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.ticketId, id))
    .orderBy(desc(verificationCases.startedAt))
    .limit(1);

  if (["verified_resolved", "unverified", "needs_review", "not_resolved"].includes(ticket.status)) {
    await transition(
      db,
      id,
      "reopened",
      { type: user.isDemo ? "judge" : "citizen", id: user.id },
      `Citizen contested verdict: ${parsed.data.reason}`,
      { closedAt: null }
    );
  }

  await writeAuditLog(db, {
    actorType: user.isDemo ? "judge" : "citizen",
    actorId: user.id,
    action: "ticket_verdict_contested",
    entityType: "ticket",
    entityId: id,
    diff: { reason: parsed.data.reason, verificationCaseId: latestCase?.id }
  });

  if (latestCase) {
    await processAgentEvent(db, c.env, {
      eventId: crypto.randomUUID(),
      eventType: "citizen_message",
      ticketId: id,
      verificationCaseId: latestCase.id,
      actorId: user.id
    });
  }

  return c.json({ ok: true, reopened: true });
});

ticketRoutes.post("/:id/feedback", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CitizenFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid feedback payload", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  const now = Date.now();
  const note = parsed.data.reason?.trim();

  if (["filed", "assigned", "in_progress", "department_replied"].includes(ticket.status)) {
    await transition(
      db,
      id,
      "closure_claimed",
      { type: "citizen", id: user.id },
      parsed.data.satisfied ? "Citizen reviewed departmental reply" : `Citizen reviewed reply: ${note || "not satisfied"}`
    );
  }

  const [afterClaim] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (afterClaim?.status === "closure_claimed") {
    await transition(db, id, "under_verification", { type: "system", id: null }, "Recording citizen verification");
  }

  const [beforeFinal] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (parsed.data.satisfied) {
    if (beforeFinal && ["under_verification", "needs_review"].includes(beforeFinal.status)) {
      const result = await transition(
        db,
        id,
        "verified_resolved",
        { type: "citizen", id: user.id },
        note || "Citizen confirmed the officer reply is satisfactory",
        { closedAt: now }
      );
      if (result.previousStatus !== "verified_resolved" && result.previousStatus !== "closed_final") {
        let waitUntil: ((p: Promise<unknown>) => void) | undefined;
        try {
          waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
        } catch {
          waitUntil = undefined;
        }
        triggerAiCallNonBlocking(
          db,
          c.env,
          { ticketId: id, closedAt: now, closedBy: user.id },
          waitUntil
        );
      }
    }
  } else {
    if (beforeFinal?.status === "under_verification") {
      await transition(
        db,
        id,
        "not_resolved",
        { type: "citizen", id: user.id },
        note || "Citizen marked the officer reply as not satisfied"
      );
    }
    const [afterNotResolved] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (afterNotResolved && ["not_resolved", "verified_resolved", "unverified", "needs_review"].includes(afterNotResolved.status)) {
      await transition(
        db,
        id,
        "reopened",
        { type: "citizen", id: user.id },
        note || "Reopened because citizen was not satisfied with officer reply",
        { closedAt: null }
      );
    }
  }

  const verdictLabel = parsed.data.satisfied ? "verified_resolved" : "not_resolved";
  const reasonText = parsed.data.satisfied
    ? note || "Citizen confirmed reply and resolution are satisfactory."
    : note || "Citizen marked the reply as not satisfied; reopened for officer follow-up.";

  const [existingCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.ticketId, id))
    .orderBy(desc(verificationCases.startedAt))
    .limit(1);

  if (existingCase) {
    await db
      .update(verificationCases)
      .set({
        status: "decided",
        verdict: verdictLabel,
        confidence: 1,
        reasons: [reasonText],
        decidedAt: now,
        updatedAt: now
      })
      .where(eq(verificationCases.id, existingCase.id));
  } else {
    await db.insert(verificationCases).values({
      id: crypto.randomUUID(),
      ticketId: id,
      trigger: "officer_resolved",
      startedAt: now,
      status: "decided",
      verdict: verdictLabel,
      confidence: 1,
      reasons: [reasonText],
      decidedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  await writeAuditLog(db, {
    actorType: "citizen",
    actorId: user.id,
    action: parsed.data.satisfied ? "citizen_reply_satisfied" : "citizen_reply_unsatisfied",
    entityType: "ticket",
    entityId: id,
    diff: { reason: reasonText }
  });

  const [updatedTicket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return c.json({ ok: true, satisfied: parsed.data.satisfied, ticket: updatedTicket });
});
