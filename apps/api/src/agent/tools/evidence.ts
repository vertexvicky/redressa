import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.js";
import { conversations, evidence, messages, verificationCases } from "../../db/schema.js";
import type { Env } from "../../env.js";
import { readEvidenceBytes } from "../../services/storage.js";
import { analyzeImageOrDocumentWithVision } from "../llm.js";

export async function toolAnalyzeEvidence(
  db: AppDb,
  env: Env,
  evidenceId: string,
  question: string,
  actorUserId: string
) {
  const [ev] = await db.select().from(evidence).where(eq(evidence.id, evidenceId)).limit(1);
  if (!ev) {
    return { error: "Evidence not found" };
  }

  if (ev.aiSummary && ev.aiSummaryJson) {
    return {
      evidenceId: ev.id,
      summary: ev.aiSummary,
      analysis: ev.aiSummaryJson
    };
  }

  const stored = await readEvidenceBytes(env, ev.id);
  if (!stored) {
    return {
      evidenceId: ev.id,
      summary: ev.aiSummary ?? "Evidence object metadata recorded; binary unavailable in Firestore.",
      consistent: true
    };
  }

  const visionResult = await analyzeImageOrDocumentWithVision({
    env,
    db,
    userId: actorUserId,
    mime: ev.mime,
    bytes: stored.bytes,
    question
  });

  await db
    .update(evidence)
    .set({
      aiSummary: visionResult.summary,
      aiSummaryJson: visionResult as unknown as Record<string, unknown>,
      updatedAt: Date.now()
    })
    .where(eq(evidence.id, ev.id));

  return {
    evidenceId: ev.id,
    ...visionResult
  };
}

export async function toolCompareBeforeAfter(
  db: AppDb,
  env: Env,
  beforeId: string,
  afterId: string,
  question: string,
  actorUserId: string
) {
  const [beforeRes, afterRes] = await Promise.all([
    toolAnalyzeEvidence(db, env, beforeId, `Before state: ${question}`, actorUserId),
    toolAnalyzeEvidence(db, env, afterId, `After state: ${question}`, actorUserId)
  ]);

  const sameHash = beforeId === afterId;
  return {
    before: beforeRes,
    after: afterRes,
    comparisonNote: sameHash
      ? "Before and after evidence refer to the same artifact."
      : "Before and after artifacts analyzed against the contract question."
  };
}

export async function toolRequestProof(
  db: AppDb,
  caseId: string,
  proofType: string,
  instructions: string
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
    return { error: "Could not initialize conversation" };
  }

  const msgId = crypto.randomUUID();
  const promptText = `Proof requested (${proofType}): ${instructions}`;
  await db.insert(messages).values({
    id: msgId,
    conversationId: conv.id,
    sender: "agent",
    text: promptText,
    language: "en",
    attachments: [{ type: "proof_request", proofType, instructions }],
    quickReplies: [
      { label: "Upload proof", value: "upload_proof" },
      { label: "I can't talk now", value: "discreet_cant_talk" }
    ],
    createdAt: now,
    updatedAt: now
  });

  await db
    .update(verificationCases)
    .set({ status: "awaiting_proof", updatedAt: now })
    .where(eq(verificationCases.id, caseId));

  return {
    requested: true,
    messageId: msgId,
    proofType,
    instructions
  };
}
