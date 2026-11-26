import { and, desc, eq, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import {
  evidence,
  expectationContracts,
  contractCriteria,
  ticketEvents,
  tickets,
  verificationCases,
  withdrawalRequests
} from "../db/schema.js";
import { writeAuditLog } from "./audit.js";
import { TransitionError, transition } from "./transition.js";

export const WITHDRAWAL_COOLING_OFF_MS = 48 * 60 * 60 * 1000;

export interface WithdrawalQuestion {
  id: string;
  text: string;
}

export type WithdrawalOutcome = "resolved" | "partly_resolved" | "not_resolved" | "unclear";

export function buildWithdrawalQuestions(
  criteria: Array<{ text: string; critical: number }>,
  desiredOutcome: string | null
): WithdrawalQuestion[] {
  const ordered = [...criteria].sort((a, b) => b.critical - a.critical).slice(0, 3);
  if (ordered.length === 0) {
    return [
      {
        id: "c1",
        text: desiredOutcome
          ? `Has this actually happened on the ground: ${desiredOutcome}`
          : "Has the problem you reported actually been fixed on the ground?"
      }
    ];
  }
  return ordered.map((criterion, index) => ({
    id: `c${index + 1}`,
    text: `Has this actually happened: ${criterion.text}`
  }));
}

export function computeWithdrawalOutcome(
  questions: WithdrawalQuestion[],
  answers: Array<{ question_id: string; answer: string }> | null
): WithdrawalOutcome {
  if (!answers || answers.length === 0) return "unclear";
  const byId = new Map(answers.map((entry) => [entry.question_id, entry.answer]));
  const given = questions.map((q) => byId.get(q.id));
  if (given.some((value) => value === undefined)) return "unclear";
  if (given.every((value) => value === "yes")) return "resolved";
  if (given.some((value) => value === "no")) return "not_resolved";
  return "partly_resolved";
}

export async function finalizeWithdrawal(db: AppDb, requestId: string): Promise<void> {
  const [request] = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.id, requestId), eq(withdrawalRequests.status, "pending")))
    .limit(1);
  if (!request) return;

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, request.ticketId)).limit(1);
  const now = Date.now();
  if (!ticket) {
    await db
      .update(withdrawalRequests)
      .set({ status: "cancelled", finalizedAt: now, updatedAt: now })
      .where(eq(withdrawalRequests.id, request.id));
    return;
  }

  const citizenEvidence = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.ticketId, ticket.id), eq(evidence.uploaderId, request.citizenId)));
  const hasProof = citizenEvidence.some((item) => item.createdAt >= request.createdAt);
  const outcome =
    (request.outcome as WithdrawalOutcome | null) ??
    computeWithdrawalOutcome(request.questions, request.answers);
  const verified = outcome === "resolved" && hasProof;
  const verdict = verified ? "verified_resolved" : "unverified";
  const reasons = [
    `Applicant withdrew after a 48 hour cooling-off period. Self-reported outcome: ${outcome.replace(/_/g, " ")}.`,
    hasProof
      ? "Independent proof was provided after the withdrawal request."
      : "No independent proof was provided after the withdrawal request."
  ];

  let ticketUpdated = false;
  try {
    await transition(
      db,
      ticket.id,
      "closure_claimed",
      { type: "citizen", id: request.citizenId },
      "Applicant withdrawal took effect"
    );
    await transition(
      db,
      ticket.id,
      "under_verification",
      { type: "system", id: null },
      "Recording withdrawal outcome"
    );
    await transition(
      db,
      ticket.id,
      verdict,
      { type: "system", id: null },
      verified ? "Withdrawal with proof of resolution" : "Withdrawal without independent proof",
      verified ? { closedAt: now } : undefined
    );
    ticketUpdated = true;
  } catch (error) {
    if (!(error instanceof TransitionError)) throw error;
  }

  if (ticketUpdated) {
    await db.insert(verificationCases).values({
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      trigger: "citizen_withdrawn",
      startedAt: request.createdAt,
      status: "decided",
      verdict,
      confidence: verified ? 0.9 : 0.6,
      reasons,
      decidedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  await db
    .update(withdrawalRequests)
    .set({ status: "effective", outcome, finalizedAt: now, updatedAt: now })
    .where(eq(withdrawalRequests.id, request.id));

  await db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId: ticket.id,
    actorType: "system",
    actorId: null,
    eventType: "withdrawal_effective",
    payload: { requestId: request.id, outcome, verified },
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "system",
    actorId: null,
    action: "withdrawal_effective",
    entityType: "ticket",
    entityId: ticket.id,
    diff: { requestId: request.id, outcome, verified }
  });
}

export async function finalizeDueWithdrawals(db: AppDb, now = Date.now()): Promise<number> {
  const due = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.status, "pending"), lte(withdrawalRequests.effectiveAt, now)))
    .limit(25);
  for (const request of due) {
    await finalizeWithdrawal(db, request.id);
  }
  return due.length;
}

export async function loadLatestWithdrawal(db: AppDb, ticketId: string) {
  const [request] = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.ticketId, ticketId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(1);
  return request ?? null;
}

export async function loadContractQuestions(db: AppDb, ticketId: string) {
  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);
  if (!contract) return buildWithdrawalQuestions([], null);
  const criteria = await db
    .select()
    .from(contractCriteria)
    .where(eq(contractCriteria.contractId, contract.id))
    .orderBy(contractCriteria.position);
  return buildWithdrawalQuestions(
    criteria.map((item) => ({ text: item.text, critical: item.critical })),
    contract.desiredOutcome
  );
}
