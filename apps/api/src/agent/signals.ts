import { desc, eq, ne } from "drizzle-orm";
import type { IntegritySignalName } from "@redressa/shared";
import type { AppDb } from "../db/client.js";
import {
  contractCriteria,
  conversations,
  departmentContacts,
  departmentReplies,
  evidence,
  expectationContracts,
  integritySignals,
  messages,
  tickets,
  verificationCases
} from "../db/schema.js";

export interface ComputedSignal {
  name: IntegritySignalName;
  present: boolean;
  detail: string;
  weight: number;
}

const CONTACT_WINDOW_HOURS = 24;

export async function computeIntegritySignals(
  db: AppDb,
  verificationCaseId: string
): Promise<ComputedSignal[]> {
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, verificationCaseId))
    .limit(1);

  if (!vCase) {
    throw new Error(`Verification case ${verificationCaseId} not found`);
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, vCase.ticketId))
    .limit(1);

  if (!ticket) {
    throw new Error(`Ticket ${vCase.ticketId} not found`);
  }

  const [contacts, replies, ticketEvidence, ticketContracts, convos] = await Promise.all([
    db
      .select()
      .from(departmentContacts)
      .where(eq(departmentContacts.ticketId, ticket.id))
      .orderBy(desc(departmentContacts.occurredAt)),
    db
      .select()
      .from(departmentReplies)
      .where(eq(departmentReplies.ticketId, ticket.id))
      .orderBy(desc(departmentReplies.repliedAt)),
    db.select().from(evidence).where(eq(evidence.ticketId, ticket.id)),
    db
      .select()
      .from(expectationContracts)
      .where(eq(expectationContracts.ticketId, ticket.id))
      .orderBy(desc(expectationContracts.version)),
    db.select().from(conversations).where(eq(conversations.ticketId, ticket.id))
  ]);

  const allMessages: Array<{ sender: string; text: string; createdAt: number }> = [];
  for (const conv of convos) {
    const convMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id));
    allMessages.push(...convMsgs);
  }
  allMessages.sort((a, b) => a.createdAt - b.createdAt);

  const citizenMessages = allMessages.filter(
    (m) => m.sender === "citizen" || m.sender === "simulated_citizen"
  );

  const recentContact = contacts.find((c) => {
    const deltaHours = (vCase.startedAt - c.occurredAt) / (1000 * 60 * 60);
    return deltaHours >= 0 && deltaHours <= CONTACT_WINDOW_HOURS;
  });

  const withdrawalSoonAfterContact =
    vCase.trigger === "citizen_withdrawn" && Boolean(recentContact);

  const hasIndependentEvidence = ticketEvidence.length > 0;
  const noEvidenceOfFix = !hasIndependentEvidence;

  const currentContract = ticketContracts.find((c) => c.isCurrent === 1) ?? ticketContracts[0];
  let criteriaCount = 0;
  if (currentContract) {
    const criteria = await db
      .select()
      .from(contractCriteria)
      .where(eq(contractCriteria.contractId, currentContract.id));
    criteriaCount = criteria.length;
  }

  const latestReply = replies[0];
  const complianceObj = latestReply?.complianceJson as { compliant?: boolean; gaps?: string[] } | null;
  const replyNonCompliant =
    !latestReply || latestReply.returned === 1 || complianceObj?.compliant === false;

  const criteriaUnmet = criteriaCount > 0 && (!hasIndependentEvidence || replyNonCompliant);

  const withdrawText = citizenMessages
    .map((m) => m.text.toLowerCase())
    .join(" ");
  const withdrawalReasonMismatch =
    vCase.trigger === "citizen_withdrawn" &&
    /(still skip|not fixed|haven't stopped|pressure|called me|told me to close|skipping)/i.test(
      withdrawText
    );

  const suddenToneChange =
    citizenMessages.length >= 2 &&
    /(never mind|forget it|just close|drop it|withdraw)/i.test(
      citizenMessages[citizenMessages.length - 1]?.text ?? ""
    ) &&
    ticket.originalQuestion.length > 20;

  const citizenRequestedDiscretion = ticket.discreetRequested === 1;

  let closureWithoutWorkHistory = false;
  if (ticket.departmentId) {
    const deptTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.departmentId, ticket.departmentId));
    const claimedOrClosed = deptTickets.filter((t) =>
      ["verified_resolved", "unverified", "needs_review", "not_resolved", "reopened", "closed_final"].includes(
        t.status
      )
    );
    const problemClosures = claimedOrClosed.filter((t) =>
      ["unverified", "needs_review", "not_resolved", "reopened"].includes(t.status)
    );
    closureWithoutWorkHistory =
      claimedOrClosed.length >= 2 && problemClosures.length / claimedOrClosed.length >= 0.4;
  }

  const evidenceInconsistency = ticketEvidence.some((ev) => {
    const summary = ev.aiSummaryJson as { consistent?: boolean } | null;
    return summary?.consistent === false;
  });

  let proofReusedOrOld = false;
  for (const ev of ticketEvidence) {
    const dupes = await db
      .select()
      .from(evidence)
      .where(ne(evidence.ticketId, ticket.id));
    if (dupes.some((d) => d.sha256 === ev.sha256)) {
      proofReusedOrOld = true;
      break;
    }
    const exif = ev.exif as { capturedAt?: string | null } | null;
    if (exif?.capturedAt) {
      const normalized = exif.capturedAt.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
      const capturedMs = Date.parse(normalized);
      if (Number.isFinite(capturedMs) && capturedMs < ticket.createdAt - 24 * 60 * 60 * 1000) {
        proofReusedOrOld = true;
        break;
      }
    }
  }

  const voiceHesitation = false;

  const computed: ComputedSignal[] = [
    {
      name: "withdrawal_soon_after_dept_contact",
      present: withdrawalSoonAfterContact,
      detail: withdrawalSoonAfterContact
        ? `Citizen withdrawal occurred within ${CONTACT_WINDOW_HOURS}h of logged department contact`
        : "No withdrawal within 24h of logged contact",
      weight: 1.5
    },
    {
      name: "no_evidence_of_fix",
      present: noEvidenceOfFix,
      detail: noEvidenceOfFix
        ? "No verification evidence uploaded for this ticket"
        : `${ticketEvidence.length} evidence item(s) on record`,
      weight: 1.0
    },
    {
      name: "criteria_unmet",
      present: criteriaUnmet,
      detail: criteriaUnmet
        ? "One or more Expectation Contract success criteria lack compliant proof"
        : "Expectation Contract criteria have supporting record",
      weight: 1.2
    },
    {
      name: "reply_format_noncompliant",
      present: replyNonCompliant,
      detail: replyNonCompliant
        ? "Latest department reply is missing or failed Expectation Contract format check"
        : "Department reply satisfied required format fields",
      weight: 1.0
    },
    {
      name: "withdrawal_reason_mismatch",
      present: withdrawalReasonMismatch,
      detail: withdrawalReasonMismatch
        ? "Citizen messages indicate issue persists or contact prompted withdrawal"
        : "No contradiction detected in citizen messages",
      weight: 1.5
    },
    {
      name: "sudden_tone_change",
      present: suddenToneChange,
      detail: suddenToneChange
        ? "Latest citizen message abruptly requests dropping the complaint"
        : "Citizen communication tone consistent",
      weight: 0.8
    },
    {
      name: "citizen_requested_discretion",
      present: citizenRequestedDiscretion,
      detail: citizenRequestedDiscretion
        ? "Citizen invoked safe-contact discreet mode"
        : "Discreet mode not requested",
      weight: 1.2
    },
    {
      name: "closure_without_work_history",
      present: closureWithoutWorkHistory,
      detail: closureWithoutWorkHistory
        ? "Department has elevated rate of unverified or reopened closures"
        : "Department closure history within baseline",
      weight: 0.9
    },
    {
      name: "evidence_inconsistency",
      present: evidenceInconsistency,
      detail: evidenceInconsistency
        ? "Evidence analysis flagged inconsistency with claimed fix"
        : "No visual/document inconsistency detected",
      weight: 1.3
    },
    {
      name: "proof_reused_or_old",
      present: proofReusedOrOld,
      detail: proofReusedOrOld
        ? "Uploaded proof matches another ticket hash or predates ticket creation"
        : "Uploaded proof is unique and timely",
      weight: 1.4
    },
    {
      name: "voice_hesitation",
      present: voiceHesitation,
      detail: "Optional audio signal not flagged",
      weight: 0.2
    }
  ];

  const now = Date.now();
  await db
    .delete(integritySignals)
    .where(eq(integritySignals.verificationCaseId, verificationCaseId));

  if (computed.length > 0) {
    await db.insert(integritySignals).values(
      computed.map((s) => ({
        id: crypto.randomUUID(),
        verificationCaseId,
        name: s.name,
        present: s.present ? 1 : 0,
        detail: s.detail,
        weight: s.weight,
        computedAt: now,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  return computed;
}
