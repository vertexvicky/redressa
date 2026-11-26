import { Type, type FunctionDeclaration } from "@google/genai";
import { ExpectationContractPayloadSchema, VerdictSchema } from "@redressa/shared";
import { z } from "zod";
import type { AppDb } from "../../db/client.js";
import type { Env } from "../../env.js";
import {
  toolEscalateCase,
  toolGetCase,
  toolGetDepartmentStats,
  toolNotifyOfficer,
  toolOpenAppealRecord
} from "./case.js";
import {
  toolCheckQuestionQuality,
  toolCheckReplyAgainstContract,
  toolCreateExpectationContract,
  toolReturnReplyToOfficer
} from "./contract.js";
import { toolAnalyzeEvidence, toolCompareBeforeAfter, toolRequestProof } from "./evidence.js";
import { toolScheduleFollowup } from "./schedule.js";
import { toolComputeSignals, toolSaveVerdict, toolSendMessage } from "./verdict.js";

export const CLOSURE_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_case",
    description: "Retrieve full ticket, contract, timeline, replies, chat, evidence, and signals",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ticket_id: { type: Type.STRING }
      },
      required: ["ticket_id"]
    }
  },
  {
    name: "get_department_stats",
    description: "Retrieve department closure and reopen statistics for integrity context",
    parameters: {
      type: Type.OBJECT,
      properties: {
        department_id: { type: Type.STRING }
      },
      required: ["department_id"]
    }
  },
  {
    name: "compute_signals",
    description: "Compute all 11 factual integrity signals for the verification case",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING }
      },
      required: ["case_id"]
    }
  },
  {
    name: "send_message",
    description: "Send a message to the citizen on the active verification chat channel",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING },
        text: { type: Type.STRING },
        language: { type: Type.STRING },
        quick_replies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.STRING }
            },
            required: ["label", "value"]
          }
        }
      },
      required: ["case_id", "text", "language"]
    }
  },
  {
    name: "request_proof",
    description: "Send a proof request card in the citizen chat",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING },
        proof_type: { type: Type.STRING },
        instructions: { type: Type.STRING }
      },
      required: ["case_id", "proof_type", "instructions"]
    }
  },
  {
    name: "analyze_evidence",
    description: "Inspect uploaded evidence against a specific contract verification question",
    parameters: {
      type: Type.OBJECT,
      properties: {
        evidence_id: { type: Type.STRING },
        question: { type: Type.STRING }
      },
      required: ["evidence_id", "question"]
    }
  },
  {
    name: "compare_before_after",
    description: "Compare before and after evidence artifacts against a contract question",
    parameters: {
      type: Type.OBJECT,
      properties: {
        before_id: { type: Type.STRING },
        after_id: { type: Type.STRING },
        question: { type: Type.STRING }
      },
      required: ["before_id", "after_id", "question"]
    }
  },
  {
    name: "schedule_followup",
    description: "Schedule a follow-up check within the 9am-8pm IST window",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING },
        delay_hours: { type: Type.NUMBER },
        reason: { type: Type.STRING }
      },
      required: ["case_id", "delay_hours", "reason"]
    }
  },
  {
    name: "save_verdict",
    description: "Validate and save the final closure integrity verdict",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING },
        verdict_json: { type: Type.OBJECT }
      },
      required: ["case_id", "verdict_json"]
    }
  },
  {
    name: "escalate_case",
    description: "Autonomously escalate a disputed or unresolved case",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING },
        level: { type: Type.NUMBER },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["case_id", "level", "reasons"]
    }
  },
  {
    name: "notify_officer",
    description: "Notify the department about missing proof or non-compliant closure",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ticket_id: { type: Type.STRING },
        message: { type: Type.STRING }
      },
      required: ["ticket_id", "message"]
    }
  },
  {
    name: "open_appeal_record",
    description: "Open a non-blocking audit/appeal record for the independent reviewer",
    parameters: {
      type: Type.OBJECT,
      properties: {
        case_id: { type: Type.STRING }
      },
      required: ["case_id"]
    }
  }
];

const ToolArgSchemas = {
  get_case: z.object({ ticket_id: z.string() }),
  check_question_quality: z.object({ ticket_id: z.string() }),
  create_expectation_contract: z.object({
    ticket_id: z.string(),
    contract_json: ExpectationContractPayloadSchema
  }),
  check_reply_against_contract: z.object({ reply_id: z.string() }),
  return_reply_to_officer: z.object({
    reply_id: z.string(),
    gaps: z.array(z.string()).min(1)
  }),
  get_department_stats: z.object({ department_id: z.string() }),
  send_message: z.object({
    case_id: z.string(),
    text: z.string().min(1),
    language: z.enum(["en", "ta"]).default("en"),
    quick_replies: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
  }),
  request_proof: z.object({
    case_id: z.string(),
    proof_type: z.string(),
    instructions: z.string()
  }),
  analyze_evidence: z.object({
    evidence_id: z.string(),
    question: z.string()
  }),
  compare_before_after: z.object({
    before_id: z.string(),
    after_id: z.string(),
    question: z.string()
  }),
  compute_signals: z.object({ case_id: z.string() }),
  schedule_followup: z.object({
    case_id: z.string(),
    delay_hours: z.number(),
    reason: z.string()
  }),
  save_verdict: z.object({
    case_id: z.string(),
    verdict_json: VerdictSchema
  }),
  escalate_case: z.object({
    case_id: z.string(),
    level: z.number(),
    reasons: z.array(z.string())
  }),
  notify_officer: z.object({
    ticket_id: z.string(),
    message: z.string()
  }),
  open_appeal_record: z.object({
    case_id: z.string()
  })
} as const;

export async function executeAgentTool(
  db: AppDb,
  env: Env,
  actorUserId: string,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_case": {
      const args = ToolArgSchemas.get_case.parse(rawArgs);
      return toolGetCase(db, args.ticket_id);
    }
    case "check_question_quality": {
      const args = ToolArgSchemas.check_question_quality.parse(rawArgs);
      return toolCheckQuestionQuality(db, env, args.ticket_id, actorUserId);
    }
    case "create_expectation_contract": {
      const args = ToolArgSchemas.create_expectation_contract.parse(rawArgs);
      return toolCreateExpectationContract(db, args.ticket_id, args.contract_json);
    }
    case "check_reply_against_contract": {
      const args = ToolArgSchemas.check_reply_against_contract.parse(rawArgs);
      return toolCheckReplyAgainstContract(db, env, args.reply_id, actorUserId);
    }
    case "return_reply_to_officer": {
      const args = ToolArgSchemas.return_reply_to_officer.parse(rawArgs);
      return toolReturnReplyToOfficer(db, args.reply_id, args.gaps);
    }
    case "get_department_stats": {
      const args = ToolArgSchemas.get_department_stats.parse(rawArgs);
      return toolGetDepartmentStats(db, args.department_id);
    }
    case "send_message": {
      const args = ToolArgSchemas.send_message.parse(rawArgs);
      return toolSendMessage(db, args.case_id, args.text, args.language, args.quick_replies);
    }
    case "request_proof": {
      const args = ToolArgSchemas.request_proof.parse(rawArgs);
      return toolRequestProof(db, args.case_id, args.proof_type, args.instructions);
    }
    case "analyze_evidence": {
      const args = ToolArgSchemas.analyze_evidence.parse(rawArgs);
      return toolAnalyzeEvidence(db, env, args.evidence_id, args.question, actorUserId);
    }
    case "compare_before_after": {
      const args = ToolArgSchemas.compare_before_after.parse(rawArgs);
      return toolCompareBeforeAfter(
        db,
        env,
        args.before_id,
        args.after_id,
        args.question,
        actorUserId
      );
    }
    case "compute_signals": {
      const args = ToolArgSchemas.compute_signals.parse(rawArgs);
      return toolComputeSignals(db, args.case_id);
    }
    case "schedule_followup": {
      const args = ToolArgSchemas.schedule_followup.parse(rawArgs);
      return toolScheduleFollowup(db, env, args.case_id, args.delay_hours, args.reason);
    }
    case "save_verdict": {
      const args = ToolArgSchemas.save_verdict.parse(rawArgs);
      return toolSaveVerdict(db, args.case_id, args.verdict_json, env);
    }
    case "escalate_case": {
      const args = ToolArgSchemas.escalate_case.parse(rawArgs);
      return toolEscalateCase(db, args.case_id, args.level, args.reasons);
    }
    case "notify_officer": {
      const args = ToolArgSchemas.notify_officer.parse(rawArgs);
      return toolNotifyOfficer(db, args.ticket_id, args.message);
    }
    case "open_appeal_record": {
      const args = ToolArgSchemas.open_appeal_record.parse(rawArgs);
      return toolOpenAppealRecord(db, args.case_id);
    }
    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}
