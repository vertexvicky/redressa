import { desc, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.js";
import {
  appealItems,
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
} from "../../db/schema.js";
import { writeAuditLog } from "../../services/audit.js";
import { transition } from "../../services/transition.js";

export async function toolGetCase(db: AppDb, ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    return { error: "Ticket not found" };
  }

  const [contracts, events, contacts, replies, ticketEvidence, cases, convos] = await Promise.all([
    db
      .select()
      .from(expectationContracts)
      .where(eq(expectationContracts.ticketId, ticketId))
      .orderBy(desc(expectationContracts.version)),
    db
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticketId))
      .orderBy(ticketEvents.occurredAt),
    db
      .select()
      .from(departmentContacts)
      .where(eq(departmentContacts.ticketId, ticketId))
      .orderBy(desc(departmentContacts.occurredAt)),
    db
      .select()
      .from(departmentReplies)
      .where(eq(departmentReplies.ticketId, ticketId))
      .orderBy(desc(departmentReplies.repliedAt)),
    db.select().from(evidence).where(eq(evidence.ticketId, ticketId)),
    db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.ticketId, ticketId))
      .orderBy(desc(verificationCases.startedAt)),
    db.select().from(conversations).where(eq(conversations.ticketId, ticketId))
  ]);

  const currentContract = contracts.find((c) => c.isCurrent === 1) ?? contracts[0] ?? null;
  let criteria: Array<typeof contractCriteria.$inferSelect> = [];
  let requirements: Array<typeof responseRequirements.$inferSelect> = [];
  if (currentContract) {
    [criteria, requirements] = await Promise.all([
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
    ]);
  }

  const latestCase = cases[0] ?? null;
  const signals = latestCase
    ? await db
        .select()
        .from(integritySignals)
        .where(eq(integritySignals.verificationCaseId, latestCase.id))
    : [];

  const chatMessages: Array<typeof messages.$inferSelect> = [];
  for (const conv of convos) {
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.createdAt);
    chatMessages.push(...msgs);
  }

  return {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      originalQuestion: ticket.originalQuestion,
      category: ticket.category,
      locationText: ticket.locationText,
      severity: ticket.severity,
      status: ticket.status,
      language: ticket.language,
      departmentId: ticket.departmentId,
      escalationLevel: ticket.escalationLevel,
      followupCount: ticket.followupCount,
      optOut: ticket.optOut === 1,
      discreetRequested: ticket.discreetRequested === 1
    },
    contract: currentContract
      ? {
          id: currentContract.id,
          version: currentContract.version,
          coreQuestion: currentContract.coreQuestion,
          userIntent: currentContract.userIntent,
          desiredOutcome: currentContract.desiredOutcome,
          jurisdictionNote: currentContract.jurisdictionNote,
          confirmedByCitizen: currentContract.confirmedByCitizen === 1,
          criteria,
          responseRequirements: requirements
        }
      : null,
    events,
    contacts,
    replies,
    evidence: ticketEvidence,
    verificationCase: latestCase,
    signals,
    messages: chatMessages
  };
}

export async function toolGetDepartmentStats(db: AppDb, departmentId: string) {
  const [dept] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  if (!dept) {
    return { error: "Department not found" };
  }

  const deptTickets = await db
    .select()
    .from(tickets)
    .where(eq(tickets.departmentId, departmentId));

  const verifiedResolved = deptTickets.filter((t) => t.status === "verified_resolved" || t.status === "closed_final").length;
  const unverified = deptTickets.filter((t) => t.status === "unverified").length;
  const needsReview = deptTickets.filter((t) => t.status === "needs_review").length;
  const reopened = deptTickets.filter((t) => t.status === "reopened" || t.status === "not_resolved").length;
  const claimedTotal = verifiedResolved + unverified + needsReview + reopened;

  return {
    departmentId: dept.id,
    name: dept.name,
    region: dept.region,
    claimedTotal,
    verifiedResolved,
    unverified,
    needsReview,
    reopened
  };
}

export async function toolNotifyOfficer(db: AppDb, ticketId: string, message: string) {
  const now = Date.now();
  await db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId,
    actorType: "agent",
    actorId: null,
    eventType: "department_notified",
    payload: { message },
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "agent",
    actorId: null,
    action: "notify_officer",
    entityType: "ticket",
    entityId: ticketId,
    diff: { message }
  });

  return { notified: true, ticketId, message };
}

export async function toolEscalateCase(
  db: AppDb,
  caseId: string,
  level: number,
  reasons: string[]
) {
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!vCase) {
    return { error: "Verification case not found" };
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, vCase.ticketId))
    .limit(1);

  if (!ticket) {
    return { error: "Ticket not found" };
  }

  const clampedLevel = Math.max(ticket.escalationLevel + 1, Math.min(4, level));
  const now = Date.now();

  if (["verified_resolved", "unverified", "needs_review", "not_resolved"].includes(ticket.status)) {
    await transition(
      db,
      ticket.id,
      "reopened",
      { type: "agent", id: null },
      `Autonomous escalation to level ${clampedLevel}: ${reasons.join("; ")}`,
      { escalationLevel: clampedLevel, closedAt: null }
    );
  } else {
    await db
      .update(tickets)
      .set({ escalationLevel: clampedLevel, updatedAt: now })
      .where(eq(tickets.id, ticket.id));
  }

  await db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId: ticket.id,
    actorType: "agent",
    actorId: null,
    eventType: "case_escalated",
    payload: { level: clampedLevel, reasons },
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "agent",
    actorId: null,
    action: "escalate_case",
    entityType: "verification_case",
    entityId: caseId,
    diff: { level: clampedLevel, reasons }
  });

  return { escalated: true, level: clampedLevel, ticketId: ticket.id };
}

export async function toolOpenAppealRecord(db: AppDb, caseId: string, reasons?: string[]) {
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!vCase) {
    return { error: "Verification case not found" };
  }

  const existing = await db
    .select()
    .from(appealItems)
    .where(eq(appealItems.verificationCaseId, caseId))
    .limit(1);

  if (existing[0]) {
    return { appealId: existing[0].id, alreadyOpen: true };
  }

  const now = Date.now();
  const appealId = crypto.randomUUID();
  const finalReasons =
    reasons && reasons.length > 0
      ? reasons
      : ((vCase.reasons as string[] | null) ?? ["Autonomous audit record opened for verification review."]);

  await db.insert(appealItems).values({
    id: appealId,
    verificationCaseId: caseId,
    reasons: finalReasons,
    status: "open",
    createdAt: now,
    updatedAt: now
  });

  await db
    .update(verificationCases)
    .set({ appealStatus: "open", updatedAt: now })
    .where(eq(verificationCases.id, caseId));

  await writeAuditLog(db, {
    actorType: "agent",
    actorId: null,
    action: "open_appeal_record",
    entityType: "appeal_item",
    entityId: appealId,
    diff: { verificationCaseId: caseId, reasons: finalReasons }
  });

  return { appealId, status: "open" };
}
