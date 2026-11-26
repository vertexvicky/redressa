CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen',
  language TEXT NOT NULL DEFAULT 'en',
  phone_enc TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  demo_session_id TEXT,
  consent_version INTEGER NOT NULL DEFAULT 1,
  safe_word_hash TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_demo_session ON users (demo_session_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_role TEXT NOT NULL DEFAULT 'citizen',
  scenario TEXT NOT NULL DEFAULT 'pressured_withdrawal',
  takeover_citizen INTEGER NOT NULL DEFAULT 0,
  takeover_officer INTEGER NOT NULL DEFAULT 0,
  primary_ticket_id TEXT,
  department_id TEXT,
  officer_user_id TEXT,
  officer_id TEXT,
  reviewer_user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_owner ON demo_sessions (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_expires ON demo_sessions (expires_at);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  granted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consents_user_type ON consents (user_id, type);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents (user_id);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  parent_department_id TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 1,
  contact_email TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  demo_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_demo ON departments (is_demo, demo_session_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments (parent_department_id);

CREATE TABLE IF NOT EXISTS officers (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  designation TEXT NOT NULL,
  is_nodal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_officers_user ON officers (user_id);
CREATE INDEX IF NOT EXISTS idx_officers_dept ON officers (department_id);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY NOT NULL,
  citizen_id TEXT NOT NULL REFERENCES users(id),
  department_id TEXT REFERENCES departments(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  location_text TEXT,
  lat REAL,
  lng REAL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'draft',
  filed_at INTEGER,
  closed_at INTEGER,
  language TEXT NOT NULL DEFAULT 'en',
  original_question TEXT NOT NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  followup_count INTEGER NOT NULL DEFAULT 0,
  opt_out INTEGER NOT NULL DEFAULT 0,
  discreet_requested INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  demo_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_citizen ON tickets (citizen_id);
CREATE INDEX IF NOT EXISTS idx_tickets_dept_status ON tickets (department_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_demo ON tickets (is_demo, demo_session_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);

CREATE TABLE IF NOT EXISTS expectation_contracts (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  core_question TEXT NOT NULL,
  user_intent TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  jurisdiction_note TEXT NOT NULL DEFAULT '',
  question_audit_json TEXT,
  confirmed_by_citizen INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_ticket ON expectation_contracts (ticket_id, is_current);

CREATE TABLE IF NOT EXISTS contract_criteria (
  id TEXT PRIMARY KEY NOT NULL,
  contract_id TEXT NOT NULL REFERENCES expectation_contracts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  critical INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_criteria_contract ON contract_criteria (contract_id, position);

CREATE TABLE IF NOT EXISTS response_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  contract_id TEXT NOT NULL REFERENCES expectation_contracts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_required INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_contract ON response_requirements (contract_id, position);

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events (ticket_id, occurred_at);

CREATE TABLE IF NOT EXISTS department_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  officer_id TEXT REFERENCES officers(id),
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  notes TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dept_contacts_ticket ON department_contacts (ticket_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_dept_contacts_officer ON department_contacts (officer_id);

CREATE TABLE IF NOT EXISTS department_replies (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  officer_id TEXT REFERENCES officers(id),
  text TEXT NOT NULL,
  structured_json TEXT NOT NULL,
  claims_resolved INTEGER NOT NULL DEFAULT 0,
  compliance_json TEXT,
  returned INTEGER NOT NULL DEFAULT 0,
  return_gaps_json TEXT,
  replied_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dept_replies_ticket ON department_replies (ticket_id, replied_at);
CREATE INDEX IF NOT EXISTS idx_dept_replies_officer ON department_replies (officer_id);

CREATE TABLE IF NOT EXISTS verification_cases (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  verdict TEXT,
  confidence REAL,
  reasons TEXT,
  verdict_json TEXT,
  decided_at INTEGER,
  appeal_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_cases_ticket ON verification_cases (ticket_id, started_at);
CREATE INDEX IF NOT EXISTS idx_verification_cases_status ON verification_cases (status);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  verification_case_id TEXT REFERENCES verification_cases(id),
  uploader_id TEXT NOT NULL REFERENCES users(id),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  exif TEXT,
  geo TEXT,
  ai_summary TEXT,
  ai_summary_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_ticket ON evidence (ticket_id);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence (verification_case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_sha ON evidence (sha256);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  verification_case_id TEXT REFERENCES verification_cases(id),
  kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web_chat',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_ticket ON conversations (ticket_id, kind);
CREATE INDEX IF NOT EXISTS idx_conversations_case ON conversations (verification_case_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  attachments TEXT,
  quick_replies TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  verification_case_id TEXT REFERENCES verification_cases(id),
  kind TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  tool_calls TEXT,
  outcome TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_ticket ON agent_runs (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_case ON agent_runs (verification_case_id);

CREATE TABLE IF NOT EXISTS integrity_signals (
  id TEXT PRIMARY KEY NOT NULL,
  verification_case_id TEXT NOT NULL REFERENCES verification_cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  present INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  computed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_case ON integrity_signals (verification_case_id);

CREATE TABLE IF NOT EXISTS appeal_items (
  id TEXT PRIMARY KEY NOT NULL,
  verification_case_id TEXT NOT NULL REFERENCES verification_cases(id) ON DELETE CASCADE,
  reasons TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reviewer_id TEXT REFERENCES users(id),
  corrected_verdict TEXT,
  decision_note TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appeals_case ON appeal_items (verification_case_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeal_items (status);

CREATE TABLE IF NOT EXISTS scheduled_actions (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  verification_case_id TEXT REFERENCES verification_cases(id),
  action_type TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_status_run ON scheduled_actions (status, run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_ticket ON scheduled_actions (ticket_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

CREATE TABLE IF NOT EXISTS department_stats_daily (
  id TEXT PRIMARY KEY NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  claimed_resolved INTEGER NOT NULL DEFAULT 0,
  verified_resolved INTEGER NOT NULL DEFAULT 0,
  unverified INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  reopened INTEGER NOT NULL DEFAULT 0,
  replies_returned INTEGER NOT NULL DEFAULT 0,
  avg_hours_to_close REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_stats_date ON department_stats_daily (department_id, date);
CREATE INDEX IF NOT EXISTS idx_dept_stats_dept ON department_stats_daily (department_id);

CREATE TABLE IF NOT EXISTS user_token_usage (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_token_usage_user_day ON user_token_usage (user_id, day_key);

CREATE TABLE IF NOT EXISTS processed_events (
  id TEXT PRIMARY KEY NOT NULL,
  processed_at INTEGER NOT NULL
);
