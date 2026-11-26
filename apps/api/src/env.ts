export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  AGENT_EVENTS: Queue<AgentEventMessage>;
  EVIDENCE_JOBS: Queue<EvidenceJobMessage>;
  CASE_ROOM: DurableObjectNamespace;
  VOICE_SESSION: DurableObjectNamespace;
  RATE_LIMITER?: RateLimitBinding;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FRONTEND_ORIGIN: string;
  DEMO_SESSION_TTL_HOURS: string;
  CONTACT_WINDOW_START: string;
  CONTACT_WINDOW_END: string;
  GEMINI_MODEL_AGENT: string;
  GEMINI_MODEL_FAST: string;
  GEMINI_MODEL_VISION: string;
  GEMINI_MODEL_LIVE: string;
  GEMINI_API_KEY?: string;
  ENCRYPTION_KEY?: string;
  SIGNING_SECRET?: string;
  SENTRY_DSN?: string;
}

export interface AgentEventMessage {
  eventId: string;
  eventType:
    | "ticket_submitted"
    | "officer_reply"
    | "closure_claimed"
    | "citizen_message"
    | "evidence_uploaded"
    | "followup_due"
    | "escalation_due";
  ticketId: string;
  verificationCaseId?: string;
  replyId?: string;
  evidenceId?: string;
  actorId?: string;
}

export interface EvidenceJobMessage {
  evidenceId: string;
  ticketId: string;
  storageKey: string;
  mime: string;
}
