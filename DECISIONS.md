# Architectural & Operational Decisions (`DECISIONS.md`)

## 1. Monorepo Layout
- `packages/shared`: Shared Zod schemas, ticket state machine (`ALLOWED_TICKET_TRANSITIONS`), and TypeScript enums consumed by both `apps/web` and `apps/api`.
- `apps/api`: Cloudflare Worker (Hono API + Queue consumers + Cron triggers + `CaseRoom` and `VoiceSession` Durable Objects + Drizzle D1 schema & SQL migrations + Cloud Firestore REST API for chunked evidence storage).
- `apps/web`: React + Vite + TypeScript SPA with Tailwind CSS, React Router, TanStack Query, `react-i18next` (English & Tamil), and simultaneous Silk White (light) and Obsidian (dark) themes.

## 2. Gemini Model Configuration
Model IDs are configured exclusively via environment variables in `apps/api/wrangler.jsonc` / `.env.example` (never hardcoded in application logic):
- `GEMINI_MODEL_AGENT`: `gemini-3.5-flash` (intake audit, Expectation Contract generation, reply compliance, closure verification reasoning).
- `GEMINI_MODEL_FAST`: `gemini-3.1-flash-lite` (Judge Mode simulated citizen & officer personas).
- `GEMINI_MODEL_VISION`: `gemini-3.5-flash` (evidence photo/document analysis).
- `GEMINI_MODEL_LIVE`: `gemini-3.1-flash-live` (bi-directional native audio via `VoiceSession` Durable Object).

Confirm live rate limits and exact model availability in Google AI Studio before production deployment.

## 3. D1 & Cloudflare Platform Defaults
- All primary keys are `text` UUIDs (`crypto.randomUUID()`).
- Timestamps are integer epoch milliseconds; booleans are `0/1` integers; JSON payloads are stored in `text` columns with Drizzle `{ mode: "json" }`.
- Atomic state transitions (`transition()`) execute ticket status updates, `ticket_events` inserts, and `audit_log` inserts via `db.batch([...])`.
- Queue consumption is idempotent via `processed_events` deduplication.

## 4. Auth & Security
- Firebase ID tokens are verified in `apps/api/src/auth/firebase.ts` using `jose` against Google's X.509 certificates with `Cache-Control`-aware caching (`iss`, `aud`, `exp`, and RS256 signature verified).
- Roles are stored in D1 `users` (and `demo_sessions.active_role` for `is_demo=1` judge sandboxes) so role permissions are enforced server-side.
- Citizen phone numbers are encrypted using WebCrypto AES-GCM (`ENCRYPTION_KEY`); Firestore evidence downloads are served through short-lived HMAC-SHA256 signed Worker URLs (`SIGNING_SECRET`), with chunked payloads stored via Firestore REST API using OAuth2 service-account assertions (`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`).
