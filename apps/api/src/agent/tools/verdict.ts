import { eq } from "drizzle-orm";
import { VerdictSchema, type TicketStatus, type VerdictPayload } from "@redressa/shared";
import type { AppDb } from "../../db/client.js";
import {
  conversations,
  messages,
  ticketEvents,
  tickets,
  verificationCases
} from "../../db/schema.js";
import { writeAuditLog } from "../../services/audit.js";
import { transition } from "../../services/transition.js";
import { computeIntegritySignals } from "../signals.js";
import { toolEscalateCase, toolNotifyOfficer, toolOpenAppealRecord } from "./case.js";

export async function toolComputeSignals(db: AppDb, caseId: string) {
  const signals = await computeIntegritySignals(db, caseId);
  return {
    caseId,
    presentCount: signals.filter((s) => s.present).length,
    signals
  };
}

export async function toolSendMessage(
  db: AppDb,
  caseId: string,
  text: string,
  language: "en" | "ta",
  quickReplies?: Array<{ label: string; value: string }>
) {
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!vCase) {
    return { error: "Verification case not found" };
  }

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
      ticketId: vCase.ticketId,
      verificationCaseId: caseId,
      kind: "closure",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
  }

  if (!conv) {
    return { error: "Conversation unavailable" };
  }

  const msgId = crypto.randomUUID();
  await db.insert(messages).values({
    id: msgId,
    conversationId: conv.id,
    sender: "agent",
    text,
    language,
    quickReplies: quickReplies ?? null,
    createdAt: now,
    updatedAt: now
  });

  return {
    sent: true,
    messageId: msgId,
    conversationId: conv.id,
    text
  };
}

export async function toolSaveVerdict(
  db: AppDb,
  caseId: string,
  rawVerdict: VerdictPayload
) {
  const verdict = VerdictSchema.parse(rawVerdict);
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!vCase) {
    throw new Error("Verification case not found");
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, vCase.ticketId))
    .limit(1);

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const now = Date.now();
  await db
    .update(verificationCases)
    .set({
      status: "decided",
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      reasons: verdict.reasons,
      verdictJson: verdict as unknown as Record<string, unknown>,
      decidedAt: now,
      updatedAt: now
    })
    .where(eq(verificationCases.id, caseId));

  if (ticket.status === "closure_claimed") {
    await transition(
      db,
      ticket.id,
      "under_verification",
      { type: "agent", id: null },
      "Verification evaluation started"
    );
  }

  const targetStatus: TicketStatus = verdict.verdict;
  await transition(
    db,
    ticket.id,
    targetStatus,
    { type: "agent", id: null },
    verdict.reasons.join("; "),
    {
      closedAt: targetStatus === "verified_resolved" ? now : null
    }
  );

  await db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId: ticket.id,
    actorType: "agent",
    actorId: null,
    eventType: "verdict_saved",
    payload: verdict as unknown as Record<string, unknown>,
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "agent",
    actorId: null,
    action: "save_verdict",
    entityType: "verification_case",
    entityId: caseId,
    diff: { verdict: verdict.verdict, confidence: verdict.confidence }
  });

  await toolSendMessage(db, caseId, verdict.citizen_summary, ticket.language === "ta" ? "ta" : "en", [
    { label: "This is wrong", value: "contest_verdict" }
  ]);

  if (verdict.verdict === "needs_review" || verdict.verdict === "not_resolved") {
    await toolNotifyOfficer(
      db,
      ticket.id,
      `Closure verdict: ${verdict.verdict}. Missing/unresolved: ${verdict.reasons.join(" ")}`
    );
    await toolEscalateCase(db, caseId, Math.max(1, ticket.escalationLevel + 1), verdict.reasons);
    await toolOpenAppealRecord(db, caseId, verdict.reasons);
  } else if (verdict.verdict === "unverified") {
    await toolNotifyOfficer(
      db,
      ticket.id,
      `Closure unverified: ${verdict.reasons.join(" ")}`
    );
  }

  return {
    saved: true,
    caseId,
    verdict: verdict.verdict,
    ticketStatus: targetStatus
  };
}
