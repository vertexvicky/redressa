import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    firebaseUid: text("firebase_uid").notNull().unique(),
    email: text("email"),
    name: text("name").notNull(),
    role: text("role").notNull().default("citizen"),
    language: text("language").notNull().default("en"),
    phoneEnc: text("phone_enc"),
    isDemo: integer("is_demo").notNull().default(0),
    demoSessionId: text("demo_session_id"),
    consentVersion: integer("consent_version").notNull().default(1),
    safeWordHash: text("safe_word_hash"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_users_demo_session").on(table.demoSessionId),
    index("idx_users_role").on(table.role)
  ]
);

export const demoSessions = sqliteTable(
  "demo_sessions",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeRole: text("active_role").notNull().default("citizen"),
    scenario: text("scenario").notNull().default("pressured_withdrawal"),
    takeoverCitizen: integer("takeover_citizen").notNull().default(0),
    takeoverOfficer: integer("takeover_officer").notNull().default(0),
    primaryTicketId: text("primary_ticket_id"),
    departmentId: text("department_id"),
    officerUserId: text("officer_user_id"),
    officerId: text("officer_id"),
    reviewerUserId: text("reviewer_user_id"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_demo_sessions_owner").on(table.ownerUserId),
    index("idx_demo_sessions_expires").on(table.expiresAt)
  ]
);

export const consents = sqliteTable(
  "consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    granted: integer("granted").notNull().default(0),
    version: integer("version").notNull().default(1),
    grantedAt: integer("granted_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("uq_consents_user_type").on(table.userId, table.type),
    index("idx_consents_user").on(table.userId)
  ]
);

export const departments = sqliteTable(
  "departments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    region: text("region").notNull(),
    parentDepartmentId: text("parent_department_id"),
    escalationLevel: integer("escalation_level").notNull().default(1),
    contactEmail: text("contact_email").notNull(),
    isDemo: integer("is_demo").notNull().default(0),
    demoSessionId: text("demo_session_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_departments_demo").on(table.isDemo, table.demoSessionId),
    index("idx_departments_parent").on(table.parentDepartmentId)
  ]
);

export const officers = sqliteTable(
  "officers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    designation: text("designation").notNull(),
    isNodal: integer("is_nodal").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_officers_user").on(table.userId),
    index("idx_officers_dept").on(table.departmentId)
  ]
);

export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    citizenId: text("citizen_id")
      .notNull()
      .references(() => users.id),
    departmentId: text("department_id").references(() => departments.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    locationText: text("location_text"),
    lat: real("lat"),
    lng: real("lng"),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("draft"),
    filedAt: integer("filed_at"),
    closedAt: integer("closed_at"),
    language: text("language").notNull().default("en"),
    originalQuestion: text("original_question").notNull(),
    escalationLevel: integer("escalation_level").notNull().default(0),
    followupCount: integer("followup_count").notNull().default(0),
    optOut: integer("opt_out").notNull().default(0),
    discreetRequested: integer("discreet_requested").notNull().default(0),
    isDemo: integer("is_demo").notNull().default(0),
    demoSessionId: text("demo_session_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_tickets_citizen").on(table.citizenId),
    index("idx_tickets_dept_status").on(table.departmentId, table.status),
    index("idx_tickets_demo").on(table.isDemo, table.demoSessionId),
    index("idx_tickets_status").on(table.status)
  ]
);

export const expectationContracts = sqliteTable(
  "expectation_contracts",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    coreQuestion: text("core_question").notNull(),
    userIntent: text("user_intent").notNull(),
    desiredOutcome: text("desired_outcome").notNull(),
    jurisdictionNote: text("jurisdiction_note").notNull().default(""),
    questionAuditJson: text("question_audit_json", { mode: "json" }).$type<Record<string, unknown>>(),
    confirmedByCitizen: integer("confirmed_by_citizen").notNull().default(0),
    confirmedAt: integer("confirmed_at"),
    isCurrent: integer("is_current").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_contracts_ticket").on(table.ticketId, table.isCurrent)
  ]
);

export const contractCriteria = sqliteTable(
  "contract_criteria",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id")
      .notNull()
      .references(() => expectationContracts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    verificationMethod: text("verification_method").notNull(),
    critical: integer("critical").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_criteria_contract").on(table.contractId, table.position)]
);

export const responseRequirements = sqliteTable(
  "response_requirements",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id")
      .notNull()
      .references(() => expectationContracts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    evidenceRequired: integer("evidence_required").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_requirements_contract").on(table.contractId, table.position)]
);

export const ticketEvents = sqliteTable(
  "ticket_events",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    occurredAt: integer("occurred_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_ticket_events_ticket").on(table.ticketId, table.occurredAt)]
);

export const departmentContacts = sqliteTable(
  "department_contacts",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    officerId: text("officer_id").references(() => officers.id),
    channel: text("channel").notNull(),
    direction: text("direction").notNull(),
    loggedBy: text("logged_by").notNull(),
    notes: text("notes").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_dept_contacts_ticket").on(table.ticketId, table.occurredAt),
    index("idx_dept_contacts_officer").on(table.officerId)
  ]
);

export const departmentReplies = sqliteTable(
  "department_replies",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    officerId: text("officer_id").references(() => officers.id),
    text: text("text").notNull(),
    structuredJson: text("structured_json", { mode: "json" })
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    claimsResolved: integer("claims_resolved").notNull().default(0),
    complianceJson: text("compliance_json", { mode: "json" }).$type<Record<string, unknown>>(),
    returned: integer("returned").notNull().default(0),
    returnGapsJson: text("return_gaps_json", { mode: "json" }).$type<string[]>(),
    repliedAt: integer("replied_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_dept_replies_ticket").on(table.ticketId, table.repliedAt),
    index("idx_dept_replies_officer").on(table.officerId)
  ]
);

export const verificationCases = sqliteTable(
  "verification_cases",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    startedAt: integer("started_at").notNull(),
    status: text("status").notNull().default("open"),
    verdict: text("verdict"),
    confidence: real("confidence"),
    reasons: text("reasons", { mode: "json" }).$type<string[]>(),
    verdictJson: text("verdict_json", { mode: "json" }).$type<Record<string, unknown>>(),
    decidedAt: integer("decided_at"),
    appealStatus: text("appeal_status"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_verification_cases_ticket").on(table.ticketId, table.startedAt),
    index("idx_verification_cases_status").on(table.status)
  ]
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    verificationCaseId: text("verification_case_id").references(() => verificationCases.id),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    r2Key: text("r2_key").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    exif: text("exif", { mode: "json" }).$type<Record<string, unknown>>(),
    geo: text("geo", { mode: "json" }).$type<Record<string, unknown>>(),
    aiSummary: text("ai_summary"),
    aiSummaryJson: text("ai_summary_json", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_evidence_ticket").on(table.ticketId),
    index("idx_evidence_case").on(table.verificationCaseId),
    index("idx_evidence_sha").on(table.sha256)
  ]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    verificationCaseId: text("verification_case_id").references(() => verificationCases.id),
    kind: text("kind").notNull(),
    channel: text("channel").notNull().default("web_chat"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_conversations_ticket").on(table.ticketId, table.kind),
    index("idx_conversations_case").on(table.verificationCaseId)
  ]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sender: text("sender").notNull(),
    text: text("text").notNull(),
    language: text("language").notNull().default("en"),
    attachments: text("attachments", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
    quickReplies: text("quick_replies", { mode: "json" }).$type<
      Array<{ label: string; value: string }>
    >(),
    toolCallId: text("tool_call_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_messages_conv").on(table.conversationId, table.createdAt)]
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    verificationCaseId: text("verification_case_id").references(() => verificationCases.id),
    kind: text("kind").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    toolCalls: text("tool_calls", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
    outcome: text("outcome").notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_agent_runs_ticket").on(table.ticketId, table.createdAt),
    index("idx_agent_runs_case").on(table.verificationCaseId)
  ]
);

export const integritySignals = sqliteTable(
  "integrity_signals",
  {
    id: text("id").primaryKey(),
    verificationCaseId: text("verification_case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    present: integer("present").notNull().default(0),
    detail: text("detail").notNull(),
    weight: real("weight").notNull().default(1),
    computedAt: integer("computed_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_signals_case").on(table.verificationCaseId)]
);

export const appealItems = sqliteTable(
  "appeal_items",
  {
    id: text("id").primaryKey(),
    verificationCaseId: text("verification_case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "cascade" }),
    reasons: text("reasons", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status").notNull().default("open"),
    reviewerId: text("reviewer_id").references(() => users.id),
    correctedVerdict: text("corrected_verdict"),
    decisionNote: text("decision_note"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_appeals_case").on(table.verificationCaseId),
    index("idx_appeals_status").on(table.status)
  ]
);

export const scheduledActions = sqliteTable(
  "scheduled_actions",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    verificationCaseId: text("verification_case_id").references(() => verificationCases.id),
    actionType: text("action_type").notNull(),
    runAt: integer("run_at").notNull(),
    status: text("status").notNull().default("pending"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_scheduled_status_run").on(table.status, table.runAt),
    index("idx_scheduled_ticket").on(table.ticketId)
  ]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    diff: text("diff", { mode: "json" }).$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_audit_entity").on(table.entityType, table.entityId),
    index("idx_audit_created").on(table.createdAt)
  ]
);

export const departmentStatsDaily = sqliteTable(
  "department_stats_daily",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    claimedResolved: integer("claimed_resolved").notNull().default(0),
    verifiedResolved: integer("verified_resolved").notNull().default(0),
    unverified: integer("unverified").notNull().default(0),
    needsReview: integer("needs_review").notNull().default(0),
    reopened: integer("reopened").notNull().default(0),
    repliesReturned: integer("replies_returned").notNull().default(0),
    avgHoursToClose: real("avg_hours_to_close").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("uq_dept_stats_date").on(table.departmentId, table.date),
    index("idx_dept_stats_dept").on(table.departmentId)
  ]
);

export const userTokenUsage = sqliteTable(
  "user_token_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dayKey: text("day_key").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [uniqueIndex("uq_token_usage_user_day").on(table.userId, table.dayKey)]
);

export const processedEvents = sqliteTable("processed_events", {
  id: text("id").primaryKey(),
  processedAt: integer("processed_at").notNull()
});
