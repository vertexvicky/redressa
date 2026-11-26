import { z } from "zod";
import {
  CONSENT_TYPES,
  DEMO_SCENARIOS,
  INTEGRITY_SIGNAL_NAMES,
  RECOMMENDED_ACTIONS,
  ROLES,
  SEVERITY_LEVELS,
  VERDICT_TYPES,
  VERIFICATION_METHODS
} from "./enums.js";

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ContractCriterionInputSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(5).max(500),
  verification_method: z.enum(VERIFICATION_METHODS),
  critical: z.boolean()
});

export const ResponseRequirementInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(2).max(120),
  description: z.string().min(4).max(500),
  evidence_required: z.boolean()
});

export const QuestionAuditSchema = z.object({
  is_clear: z.boolean(),
  specificity_score: z.number().min(0).max(1),
  suggested_department: z.string().min(2).max(160),
  jurisdiction_note: z.string().max(400),
  is_duplicate: z.boolean(),
  clarifying_questions: z.array(z.string().min(4).max(240)).max(3)
});
export type QuestionAuditResult = z.infer<typeof QuestionAuditSchema>;

export const ExpectationContractPayloadSchema = z.object({
  core_question: z.string().min(5).max(2000),
  user_intent: z.string().min(5).max(500),
  desired_outcome: z.string().min(5).max(500),
  jurisdiction_note: z.string().max(500),
  urgency: z.enum(SEVERITY_LEVELS),
  criteria: z.array(ContractCriterionInputSchema).min(2).max(6),
  response_requirements: z.array(ResponseRequirementInputSchema).min(2).max(8)
});
export type ExpectationContractPayload = z.infer<typeof ExpectationContractPayloadSchema>;

export const ReplyComplianceItemSchema = z.object({
  requirement_id: z.string(),
  label: z.string(),
  met: z.boolean(),
  quoted_reference: z.string().nullable(),
  gap: z.string().nullable()
});

export const ReplyComplianceSchema = z.object({
  compliant: z.boolean(),
  items: z.array(ReplyComplianceItemSchema),
  gaps: z.array(z.string()),
  follow_up_questions: z.array(z.string()).optional(),
  summary: z.string()
});
export type ReplyComplianceResult = z.infer<typeof ReplyComplianceSchema>;

export const VerdictSchema = z.object({
  verdict: z.enum(VERDICT_TYPES),
  confidence: z.number().min(0).max(1),
  criteria_results: z.array(
    z.object({
      criterion_id: z.string(),
      met: z.boolean(),
      evidence_ids: z.array(z.string()),
      note: z.string()
    })
  ),
  reasons: z.array(z.string()).min(1).max(8),
  signals: z.array(
    z.object({
      name: z.enum(INTEGRITY_SIGNAL_NAMES),
      present: z.boolean(),
      detail: z.string()
    })
  ),
  recommended_action: z.enum(RECOMMENDED_ACTIONS),
  citizen_summary: z.string().min(5).max(1200)
});
export type VerdictPayload = z.infer<typeof VerdictSchema>;

export const IntakeSubmitSchema = z.object({
  title: z.string().min(4).max(200),
  question: z.string().min(8).max(4000),
  category: z.string().min(2).max(80).default("transport"),
  location_text: z.string().max(240).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  severity: z.enum(SEVERITY_LEVELS).default("medium"),
  language: z.enum(["en", "ta"]).default("en"),
  department_id: z.string().optional()
});

export const IntakeMessageSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(["en", "ta"]).default("en")
});

export const ContractUpdateSchema = z.object({
  user_intent: z.string().min(5).max(500).optional(),
  desired_outcome: z.string().min(5).max(500).optional(),
  criteria: z.array(ContractCriterionInputSchema).min(2).max(6).optional(),
  response_requirements: z.array(ResponseRequirementInputSchema).min(2).max(8).optional()
});

export const TicketWithdrawSchema = z.object({
  reason: z.string().min(3).max(1000)
});

export const TicketContestSchema = z.object({
  reason: z.string().min(3).max(1000)
});

export const CaseMessageSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.enum(["en", "ta"]).default("en"),
  discreet: z.boolean().optional(),
  quick_reply_value: z.string().max(120).optional()
});

export const OfficerReplySchema = z.object({
  text: z.string().min(2).max(5000),
  structured_entries: z
    .array(
      z.object({
        requirement_id: z.string(),
        label: z.string(),
        value: z.string().max(2000),
        evidence_ids: z.array(z.string()).default([])
      })
    )
    .default([]),
  evidence_ids: z.array(z.string()).default([]),
  claims_resolved: z.boolean().default(false)
});

export const CitizenFeedbackSchema = z.object({
  satisfied: z.boolean(),
  reason: z.string().max(1000).optional()
});

export const OfficerContactLogSchema = z.object({
  channel: z.enum(["phone", "in_person", "email", "sms", "whatsapp"]),
  direction: z.enum(["outbound", "inbound"]),
  notes: z.string().min(2).max(1500)
});

export const ProfilePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["citizen", "officer", "judge"]).optional(),
  user_type: z.enum(["citizen", "officer", "judge"]).optional(),
  language: z.enum(["en", "ta"]).optional(),
  phone: z.string().max(32).nullable().optional(),
  safe_word: z.string().min(2).max(60).nullable().optional()
});

export const ConsentUpdateSchema = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES),
        granted: z.boolean()
      })
    )
    .min(1)
});

export const ReviewDecideSchema = z.object({
  status: z.enum(["upheld", "corrected"]),
  corrected_verdict: z.enum(VERDICT_TYPES).optional(),
  decision_note: z.string().min(3).max(1500)
});

export const DemoSwitchRoleSchema = z.object({
  role: z.enum(["citizen", "officer", "reviewer", "judge"])
});

export const DemoScenarioSchema = z.object({
  scenario: z.enum(DEMO_SCENARIOS)
});

export const DemoTakeoverSchema = z.object({
  actor: z.enum(["citizen", "officer"]),
  enabled: z.boolean()
});

export const AdminDepartmentSchema = z.object({
  name: z.string().min(2).max(160),
  region: z.string().min(2).max(120),
  parent_department_id: z.string().nullable().optional(),
  escalation_level: z.number().int().min(1).max(5).default(1),
  contact_email: z.string().email()
});

export const AdminOfficerSchema = z.object({
  user_id: z.string().min(1),
  department_id: z.string().min(1),
  designation: z.string().min(2).max(120),
  is_nodal: z.boolean().default(false)
});

export const AdminUserRoleSchema = z.object({
  role: z.enum(ROLES)
});
