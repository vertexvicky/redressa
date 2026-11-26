export const ROLES = ["citizen", "officer", "reviewer", "admin", "judge"] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = [
  "draft",
  "intake_audit",
  "awaiting_citizen_confirmation",
  "filed",
  "assigned",
  "in_progress",
  "department_replied",
  "reply_returned",
  "closure_claimed",
  "under_verification",
  "verified_resolved",
  "unverified",
  "needs_review",
  "not_resolved",
  "reopened",
  "closed_final"
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ALLOWED_TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  draft: ["intake_audit"],
  intake_audit: ["awaiting_citizen_confirmation", "filed"],
  awaiting_citizen_confirmation: ["filed", "intake_audit"],
  filed: ["assigned", "closure_claimed"],
  assigned: ["in_progress", "department_replied", "closure_claimed"],
  in_progress: ["department_replied", "closure_claimed"],
  department_replied: ["reply_returned", "closure_claimed", "in_progress"],
  reply_returned: ["in_progress", "department_replied"],
  closure_claimed: ["under_verification"],
  under_verification: ["verified_resolved", "unverified", "needs_review", "not_resolved"],
  verified_resolved: ["closed_final", "reopened"],
  unverified: ["reopened", "under_verification", "closure_claimed"],
  needs_review: ["reopened", "verified_resolved", "unverified", "under_verification"],
  not_resolved: ["reopened"],
  reopened: ["in_progress", "assigned"],
  closed_final: []
};

export const VERIFICATION_TRIGGERS = ["officer_resolved", "citizen_withdrawn"] as const;
export type VerificationTrigger = (typeof VERIFICATION_TRIGGERS)[number];

export const VERIFICATION_STATUSES = [
  "open",
  "awaiting_citizen",
  "awaiting_proof",
  "analyzing",
  "decided"
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERDICT_TYPES = [
  "verified_resolved",
  "unverified",
  "needs_review",
  "not_resolved"
] as const;
export type VerdictType = (typeof VERDICT_TYPES)[number];

export const RECOMMENDED_ACTIONS = ["none", "reopen", "escalate", "ask_more"] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const INTEGRITY_SIGNAL_NAMES = [
  "withdrawal_soon_after_dept_contact",
  "no_evidence_of_fix",
  "criteria_unmet",
  "reply_format_noncompliant",
  "withdrawal_reason_mismatch",
  "sudden_tone_change",
  "citizen_requested_discretion",
  "closure_without_work_history",
  "evidence_inconsistency",
  "proof_reused_or_old",
  "voice_hesitation"
] as const;
export type IntegritySignalName = (typeof INTEGRITY_SIGNAL_NAMES)[number];

export const CONSENT_TYPES = [
  "chat_storage",
  "voice",
  "recording",
  "geolocation",
  "phone_contact"
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CHANNEL_TYPES = ["web_chat", "voice", "telegram", "whatsapp", "phone"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MESSAGE_SENDERS = ["citizen", "agent", "system", "simulated_citizen"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const APPEAL_STATUSES = ["open", "upheld", "corrected"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const SCHEDULED_ACTION_TYPES = [
  "followup",
  "escalation",
  "retry_agent",
  "demo_cleanup"
] as const;
export type ScheduledActionType = (typeof SCHEDULED_ACTION_TYPES)[number];

export const DEMO_SCENARIOS = [
  "genuinely_fixed",
  "fake_closure",
  "pressured_withdrawal"
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export const SEVERITY_LEVELS = ["low", "medium", "high", "urgent"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const VERIFICATION_METHODS = [
  "photo",
  "bus_number_time",
  "document",
  "third_party_confirmation",
  "officer_statement"
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
