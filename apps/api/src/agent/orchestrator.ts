import { desc, eq } from "drizzle-orm";
import type { VerdictPayload } from "@redressa/shared";
import type { AppDb } from "../db/client.js";
import {
  conversations,
  expectationContracts,
  messages,
  ticketEvents,
  tickets,
  verificationCases
} from "../db/schema.js";
import type { AgentEventMessage, Env } from "../env.js";
import { sha256Hex } from "../services/crypto.js";
import { transition } from "../services/transition.js";
import {
  GRACEFUL_AGENT_FALLBACK,
  callGeminiModel,
  recordAgentRun,
  scheduleAgentRetry,
  wrapUntrustedData
} from "./llm.js";
import { CLOSURE_AGENT_PROMPT } from "./prompts/catalog.js";
import { computeIntegritySignals } from "./signals.js";
import { toolGetCase } from "./tools/case.js";
import {
  assignDepartmentFromAudit,
  generateDefaultContractForTicket,
  toolCheckReplyAgainstContract,
  toolCreateExpectationContract,
  toolReturnReplyToOfficer
} from "./tools/contract.js";
import { CLOSURE_TOOL_DECLARATIONS, executeAgentTool } from "./tools/registry.js";
import { toolRequestProof } from "./tools/evidence.js";
import { toolSaveVerdict, toolSendMessage } from "./tools/verdict.js";

async function broadcastCaseRoom(
  env: Env,
  caseId: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!env.CASE_ROOM) return;
  try {
    const id = env.CASE_ROOM.idFromName(caseId);
    const stub = env.CASE_ROOM.get(id);
    await stub.fetch("https://caseroom.internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
  }
}

async function acquireCaseRoomLock(env: Env, caseId: string): Promise<boolean> {
  if (!env.CASE_ROOM) return true;
  try {
    const id = env.CASE_ROOM.idFromName(caseId);
    const stub = env.CASE_ROOM.get(id);
    const res = await stub.fetch("https://caseroom.internal/lock", { method: "POST" });
    return res.ok;
  } catch {
    return true;
  }
}

async function releaseCaseRoomLock(env: Env, caseId: string): Promise<void> {
  if (!env.CASE_ROOM) return;
  try {
    const id = env.CASE_ROOM.idFromName(caseId);
    const stub = env.CASE_ROOM.get(id);
    await stub.fetch("https://caseroom.internal/unlock", { method: "POST" });
  } catch {
  }
}

export async function runIntakeAudit(
  db: AppDb,
  env: Env,
  ticketId: string,
  actorUserId: string
) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return { error: "Ticket not found" };

  if (ticket.status === "draft") {
    await transition(db, ticketId, "intake_audit", { type: "agent", id: null }, "Intake audit started");
  }

  let [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.ticketId, ticketId))
    .limit(1);

  const now = Date.now();
  if (!conv) {
    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId,
      kind: "intake",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
  }

  const words = ticket.originalQuestion.trim().split(/\s+/).filter(Boolean);
  const qLower = ticket.originalQuestion.toLowerCase();
  const deptGuess =
    /bus|transport|stop|route/i.test(`${qLower} ${ticket.category}`)
      ? "State Transport Corporation (Division Operations)"
      : /water|pipe|drain|sewage/i.test(`${qLower} ${ticket.category}`)
        ? "Municipal Water Supply & Drainage Board"
        : /road|pothole|street|bridge|light/i.test(`${qLower} ${ticket.category}`)
          ? "Highways & Public Works Department"
          : "District Grievance Nodal Office";

  const audit = {
    is_clear: words.length >= 3,
    specificity_score: Math.min(1, Math.max(0.5, words.length / 15)),
    suggested_department: deptGuess,
    jurisdiction_note: `Routed to ${deptGuess} based on subject and location context.`,
    is_duplicate: false,
    clarifying_questions: []
  };

  if (!ticket.departmentId) {
    await assignDepartmentFromAudit(
      db,
      ticketId,
      audit.suggested_department,
      ticket.isDemo === 1,
      ticket.demoSessionId
    );
  }

  const contractPayload = await generateDefaultContractForTicket(
    db,
    env,
    ticketId,
    actorUserId,
    audit
  );

  const created = await toolCreateExpectationContract(
    db,
    ticketId,
    contractPayload,
    audit as unknown as Record<string, unknown>
  );

  if (conv) {
    const summaryText =
      ticket.language === "ta"
        ? `நான் Redressa (AI உதவியாளர்). உங்கள் கோரிக்கைக்காக ${created.criteria.length} வெற்றிக் கூறுகள் மற்றும் ${created.responseRequirements.length} துறைப் பதில் விதிகளுடன் எதிர்பார்ப்பு ஒப்பந்தம் உருவாக்கப்பட்டுள்ளது. உறுதிப்படுத்தவும் அல்லது திருத்தவும்.`
        : `I'm Redressa, an AI assistant. I audited your question and drafted an Expectation Contract with ${created.criteria.length} measurable success criteria and ${created.responseRequirements.length} required officer response fields. Review and confirm it below to file your ticket.`;

    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      sender: "agent",
      text: summaryText,
      language: ticket.language === "ta" ? "ta" : "en",
      quickReplies: [
        { label: "Confirm Contract", value: "confirm_contract" },
        { label: "Edit Contract", value: "edit_contract" }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  return { status: "contract_ready", audit, contract: created };
}

async function runDeterministicClosureStep(
  db: AppDb,
  env: Env,
  caseId: string,
  ticketId: string,
  eventType: AgentEventMessage["eventType"]
): Promise<void> {
  const caseData = await toolGetCase(db, ticketId);
  if ("error" in caseData || !caseData.verificationCase) return;

  const signals = await computeIntegritySignals(db, caseId);
  const presentSignals = signals.filter((s) => s.present);
  const lang = caseData.ticket.language === "ta" ? "ta" : "en";
  const convMessages = caseData.messages;
  const agentMsgCount = convMessages.filter((m) => m.sender === "agent").length;

  if (caseData.ticket.discreetRequested && eventType === "citizen_message") {
    await toolSendMessage(
      db,
      caseId,
      "No problem. I'll keep the case open and check later in chat only.",
      lang
    );
    return;
  }

  if (eventType === "closure_claimed" || agentMsgCount === 0) {
    const intro =
      lang === "ta"
        ? `வணக்கம், நான் Redressa, ஒரு AI உதவியாளர். "${caseData.ticket.title}" குறித்த உங்கள் புகார் முடிக்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது. இப்போது இதைப் பற்றிப் பேசலாமா?`
        : `I'm Redressa, an AI assistant. Your complaint about "${caseData.ticket.title}" was marked closed. Is it OK to talk about it now?`;

    await toolSendMessage(db, caseId, intro, lang, [
      { label: "Yes, talk now", value: "ok_to_talk" },
      { label: "I can't talk now", value: "discreet_cant_talk" }
    ]);

    await db
      .update(verificationCases)
      .set({ status: "awaiting_citizen", updatedAt: Date.now() })
      .where(eq(verificationCases.id, caseId));

    if (presentSignals.length >= 2 && caseData.verificationCase.trigger === "citizen_withdrawn") {
      const verdict = buildDeterministicVerdict(caseData, signals);
      await toolSaveVerdict(db, caseId, verdict);
    }
    return;
  }

  const citizenMsgs = convMessages.filter(
    (m) => m.sender === "citizen" || m.sender === "simulated_citizen"
  );
  const latestCitizenText = (citizenMsgs[citizenMsgs.length - 1]?.text ?? "").toLowerCase();

  if (
    eventType === "citizen_message" &&
    citizenMsgs.length === 1 &&
    /(yes|ok|talk|சரி)/i.test(latestCitizenText) &&
    caseData.evidence.length === 0
  ) {
    const outcomeQ = /bus|stop|gh/i.test(caseData.ticket.originalQuestion)
      ? "Do express buses now stop reliably at the Government Hospital stop?"
      : `Has the issue "${caseData.ticket.title}" actually been solved on the ground?`;

    await toolSendMessage(db, caseId, outcomeQ, lang, [
      { label: "Yes, it is fixed", value: "yes_fixed" },
      { label: "No, problem persists", value: "still_not_fixed" },
      { label: "I can't talk now", value: "discreet_cant_talk" }
    ]);
    await toolRequestProof(
      db,
      caseId,
      "photo_or_record",
      "Please share a quick photo, bus number & timestamp, or brief note confirming the current ground reality."
    );
    return;
  }

  const verdict = buildDeterministicVerdict(caseData, signals);
  await toolSaveVerdict(db, caseId, verdict);
}

function buildDeterministicVerdict(
  caseData: Exclude<Awaited<ReturnType<typeof toolGetCase>>, { error: string }>,
  signals: Awaited<ReturnType<typeof computeIntegritySignals>>
): VerdictPayload {
  const presentSignals = signals.filter((s) => s.present);
  const presentNames = new Set(presentSignals.map((s) => s.name));
  const citizenText = caseData.messages
    .filter((m) => m.sender === "citizen" || m.sender === "simulated_citizen")
    .map((m) => m.text.toLowerCase())
    .join(" ");

  const claimsPersists =
    /(still skip|not fixed|haven't stopped|no change|persists|still happening|never stopped)/i.test(
      citizenText
    );
  const confirmsFixed =
    !claimsPersists &&
    /(yes, it is fixed|buses now stop|confirmed fixed|halted|halting|working now|resolved now)/i.test(
      citizenText
    );

  const criteriaList = caseData.contract?.criteria ?? [];
  const hasEvidence = caseData.evidence.length > 0;
  const latestReply = caseData.replies[0];
  const replyCompliant =
    Boolean(latestReply) &&
    latestReply?.returned === 0 &&
    (latestReply?.complianceJson as { compliant?: boolean } | null)?.compliant !== false;

  let verdict: VerdictPayload["verdict"] = "unverified";
  let confidence = 0.72;
  let recommendedAction: VerdictPayload["recommended_action"] = "ask_more";
  const reasons: string[] = [];

  if (claimsPersists || (presentNames.has("evidence_inconsistency") && !confirmsFixed)) {
    verdict = "not_resolved";
    confidence = 0.89;
    recommendedAction = "reopen";
    reasons.push("Citizen report and case record indicate the underlying issue remains unresolved.");
  } else if (presentSignals.length >= 2) {
    verdict = "needs_review";
    confidence = 0.86;
    recommendedAction = "escalate";
    reasons.push(
      `Closure integrity flags triggered (${presentSignals.map((s) => s.name).join(", ")}); record lacks independent verification.`
    );
  } else if (confirmsFixed && (hasEvidence || replyCompliant)) {
    verdict = "verified_resolved";
    confidence = 0.91;
    recommendedAction = "none";
    reasons.push("Expectation Contract criteria satisfied with supporting evidence and compliant departmental record.");
  } else {
    verdict = "unverified";
    confidence = 0.65;
    recommendedAction = "ask_more";
    reasons.push("Insufficient independent evidence on record to mark the complaint verified resolved.");
  }

  return {
    verdict,
    confidence,
    criteria_results: criteriaList.map((c) => ({
      criterion_id: c.id,
      met: verdict === "verified_resolved",
      evidence_ids: caseData.evidence.map((e) => e.id),
      note:
        verdict === "verified_resolved"
          ? "Verified against record and citizen confirmation."
          : "Criterion not yet verified with independent proof."
    })),
    reasons,
    signals: signals.map((s) => ({
      name: s.name,
      present: s.present,
      detail: s.detail
    })),
    recommended_action: recommendedAction,
    citizen_summary:
      verdict === "verified_resolved"
        ? "Thank you. Based on the evidence and compliant departmental record, your ticket is verified resolved."
        : verdict === "needs_review"
          ? "Closure disputed: this ticket remains open because verification checks flagged missing proof or conflicting closure records. The department has been notified and escalated."
          : verdict === "not_resolved"
            ? "Your ticket has been reopened because the problem persists. The department has been notified with the missing contract items."
            : "This closure is marked unverified until independent proof is provided. Your ticket has not been counted as resolved."
  };
}

export async function processAgentEvent(
  db: AppDb,
  env: Env,
  event: AgentEventMessage
): Promise<void> {
  if (event.eventType === "ticket_submitted") {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, event.ticketId)).limit(1);
    if (ticket) {
      await runIntakeAudit(db, env, ticket.id, event.actorId ?? ticket.citizenId);
    }
    return;
  }

  if (event.eventType === "officer_reply" && event.replyId) {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, event.ticketId)).limit(1);
    const actorUserId = event.actorId ?? ticket?.citizenId ?? "system";
    const compliance = await toolCheckReplyAgainstContract(db, env, event.replyId, actorUserId);
    if (!compliance.compliant) {
      await toolReturnReplyToOfficer(db, event.replyId, compliance.gaps);
    }
    return;
  }

  let caseId = event.verificationCaseId;
  if (!caseId) {
    const [latestCase] = await db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.ticketId, event.ticketId))
      .orderBy(desc(verificationCases.startedAt))
      .limit(1);
    caseId = latestCase?.id;
  }
  if (!caseId) return;

  const lockAcquired = await acquireCaseRoomLock(env, caseId);
  if (!lockAcquired) {
    await scheduleAgentRetry(db, event.ticketId, caseId, "CaseRoom lock busy");
    return;
  }

  try {
    const caseData = await toolGetCase(db, event.ticketId);
    if ("error" in caseData || !caseData.verificationCase) return;

    const actorUserId = event.actorId ?? caseData.ticket.title;

    if (!env.GEMINI_API_KEY) {
      await runDeterministicClosureStep(db, env, caseId, event.ticketId, event.eventType);
      await broadcastCaseRoom(env, caseId, { type: "case_updated", caseId, ticketId: event.ticketId });
      return;
    }

    const signals = await computeIntegritySignals(db, caseId);
    const contextPrompt = `Event: ${event.eventType}
Case ID: ${caseId}
Ticket ID: ${event.ticketId}
Trigger: ${caseData.verificationCase.trigger}
Language: ${caseData.ticket.language}
Signals computed: ${JSON.stringify(signals)}
Contract: ${JSON.stringify(caseData.contract)}
Contacts: ${JSON.stringify(caseData.contacts)}
Replies: ${wrapUntrustedData("department_replies", JSON.stringify(caseData.replies))}
Evidence: ${wrapUntrustedData("evidence_summaries", JSON.stringify(caseData.evidence))}
Messages: ${wrapUntrustedData("chat_history", JSON.stringify(caseData.messages))}
Decide the next appropriate tool calls. Max 8 tool steps. If you already have enough facts to issue a verdict (or 2+ signals are present on a closure/withdrawal without proof), call save_verdict.`;

    const inputHash = await sha256Hex(contextPrompt);
    const toolLog: Array<Record<string, unknown>> = [];
    let currentPrompt = contextPrompt;
    let totalIn = 0;
    let totalOut = 0;
    const started = Date.now();
    let verdictSaved = false;

    try {
      for (let step = 0; step < 8; step += 1) {
        const res = await callGeminiModel({
          env,
          db,
          userId: actorUserId,
          model: env.GEMINI_MODEL_AGENT,
          systemPrompt: CLOSURE_AGENT_PROMPT,
          userPrompt: currentPrompt,
          tools: CLOSURE_TOOL_DECLARATIONS
        });
        totalIn += res.tokensIn;
        totalOut += res.tokensOut;

        if (res.text) {
          await broadcastCaseRoom(env, caseId, {
            type: "agent_token",
            caseId,
            text: res.text
          });
        }

        if (res.functionCalls.length === 0) {
          if (res.text && toolLog.length === 0) {
            await toolSendMessage(
              db,
              caseId,
              res.text,
              caseData.ticket.language === "ta" ? "ta" : "en"
            );
          }
          break;
        }

        const toolResults: Array<{ name: string; result: unknown }> = [];
        for (const call of res.functionCalls) {
          try {
            const output = await executeAgentTool(db, env, actorUserId, call.name, call.args);
            toolLog.push({ name: call.name, args: call.args, ok: true });
            toolResults.push({ name: call.name, result: output });
            if (call.name === "save_verdict") {
              verdictSaved = true;
            }
          } catch (toolErr) {
            toolLog.push({
              name: call.name,
              args: call.args,
              ok: false,
              error: toolErr instanceof Error ? toolErr.message : String(toolErr)
            });
            toolResults.push({
              name: call.name,
              result: { error: toolErr instanceof Error ? toolErr.message : "Tool execution failed" }
            });
          }
        }

        if (verdictSaved) break;
        currentPrompt = `${currentPrompt}\n\nTool outputs from step ${step + 1}:\n${JSON.stringify(toolResults)}\nContinue or conclude.`;
      }

      await recordAgentRun(db, {
        ticketId: event.ticketId,
        verificationCaseId: caseId,
        kind: `closure_${event.eventType}`,
        model: env.GEMINI_MODEL_AGENT,
        inputHash,
        tokensIn: totalIn,
        tokensOut: totalOut,
        latencyMs: Date.now() - started,
        toolCalls: toolLog,
        outcome: "success"
      });
    } catch (err) {
      await recordAgentRun(db, {
        ticketId: event.ticketId,
        verificationCaseId: caseId,
        kind: `closure_${event.eventType}`,
        model: env.GEMINI_MODEL_AGENT,
        inputHash,
        tokensIn: totalIn,
        tokensOut: totalOut,
        latencyMs: Date.now() - started,
        toolCalls: toolLog,
        outcome: "error_fallback",
        error: err instanceof Error ? err.message : String(err)
      });
      await toolSendMessage(db, caseId, GRACEFUL_AGENT_FALLBACK, caseData.ticket.language === "ta" ? "ta" : "en");
      await scheduleAgentRetry(db, event.ticketId, caseId, err instanceof Error ? err.message : "Agent error");
      await db.insert(ticketEvents).values({
        id: crypto.randomUUID(),
        ticketId: event.ticketId,
        actorType: "system",
        actorId: null,
        eventType: "agent_retry_scheduled",
        payload: { caseId },
        occurredAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    await broadcastCaseRoom(env, caseId, { type: "case_updated", caseId, ticketId: event.ticketId });
  } finally {
    await releaseCaseRoomLock(env, caseId);
  }
}
