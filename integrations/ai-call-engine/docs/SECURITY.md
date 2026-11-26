# Security Guide

AI Call Engine handles customer phone numbers, automated outbound dialing triggers, and provider webhooks. This guide outlines the built-in security controls and production hardening steps.

## 1. API Authentication

All operational API routes (`/api/events/*`, `/api/calls/*`) require a Bearer token in the `Authorization` header:

```http
Authorization: Bearer <API_AUTH_TOKEN>
```

- Tokens are compared securely against `API_AUTH_TOKEN` from environment variables.
- Generate a cryptographically strong 256-bit token before deployment:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Rotate `API_AUTH_TOKEN` periodically and never commit `.env` files to source control.

## 2. Webhook Signature Verification (HMAC-SHA256)

Incoming provider callbacks at `POST /api/webhooks/voice` are unauthenticated by Bearer token because they originate from the voice provider. Instead, they must be verified cryptographically:

- Configure `VAPI_WEBHOOK_SECRET` with a strong shared secret.
- The provider adapter's `validateWebhook(headers, rawBody, signature)` verifies the HMAC-SHA256 signature against the raw request body using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks and spoofed call-status updates.
- In `mock` / `DEMO_MODE=true`, signature verification returns `true` for local testing—never enable `DEMO_MODE=true` or `VOICE_PROVIDER=mock` in production.

## 3. Rate Limiting

To protect against abuse, accidental trigger loops, and denial-of-service spikes:

- Configured via `RATE_LIMIT_MAX` (default: `100`) and `RATE_LIMIT_WINDOW_MS` (default: `900000` ms / 15 minutes).
- Applied per client IP address. If running behind a reverse proxy (Nginx, ALB, Cloudflare), ensure Express `trust proxy` is configured appropriately so rate limiting uses the real client IP rather than the proxy IP.

## 4. CORS Configuration

- Controlled by `CORS_ORIGIN` (default: `http://localhost:3000`).
- In production, set `CORS_ORIGIN` to the exact origin(s) of trusted web dashboards, or keep cross-origin access restricted if AI Call Engine is only called server-to-server. Avoid wildcard `*` in production environments.

## 5. Input Validation (Zod Schemas)

Every incoming request payload is strictly validated using Zod schemas (`packages/shared/src/schemas/`):

- Enforces E.164 phone formats (`+` followed by valid country and subscriber digits) and rejects malformed numbers early.
- Requires `event === "REQUEST_CLOSED"` and `request.status === "CLOSED"` for automatic triggers.
- Rejects unexpected or oversized fields and returns structured `400 VALIDATION_ERROR` responses without leaking stack traces in production.

## 6. Consent Management & Suppression

- **Explicit Opt-In Validation**: `validateConsent` requires `consent.automatedCallAllowed === true` and a non-empty, non-whitespace `consent.consentReference` before any call is queued.
- **Suppression List**: `consent.service.ts` maintains a suppression list (`addToSuppressionList`, `isPhoneSuppressed`, `removeFromSuppressionList`) to immediately block calls to numbers that have opted out or are flagged Do-Not-Call.

## 7. Data Protection & Log Redaction

- **Phone Number Masking**: Use `maskPhone()` from `@ai-call-engine/shared` before logging phone numbers (e.g., `+919876543210` becomes `+91XXXXXX3210`).
- **Log Redaction**: Authorization headers, API keys (`VAPI_API_KEY`, `API_AUTH_TOKEN`), webhook secrets, and full PII should never be printed to stdout or persisted in application logs.
- **Minimal Data Retention**: Only store operational metadata required for idempotency, state transitions, and troubleshooting—avoid storing full audio recordings or unnecessary personal data in SQLite.

## 8. Production Hardening Checklist

- [ ] Generate a unique 64-character hex `API_AUTH_TOKEN` (do not reuse dev tokens).
- [ ] Set `NODE_ENV=production` and `DEMO_MODE=false`.
- [ ] Set `VOICE_PROVIDER=vapi` (never `mock` in production) and configure `VAPI_WEBHOOK_SECRET`.
- [ ] Terminate TLS/HTTPS at a reverse proxy (Nginx, Caddy, Cloud Run, ALB) — never expose plain HTTP to the public internet.
- [ ] Restrict `CORS_ORIGIN` to explicit allowed domains (never `*`).
- [ ] Tighten `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` to match expected ticket closure volume.
- [ ] Mount `/app/data` on encrypted persistent storage with restricted filesystem permissions (`0700`).
- [ ] Run the container as a non-root user (included in `docker/Dockerfile` via `appuser`).
- [ ] Sync your application's opt-out/DND records into the suppression list before calling.
- [ ] Restrict network ingress so only your application backend and trusted webhook endpoints can reach the service.
- [ ] Set up log aggregation and alerting on `401`, `429`, and `5xx` spikes or elevated call `FAILED` rates.
- [ ] Regularly run `npm audit` and update Node.js / dependencies for security patches.
