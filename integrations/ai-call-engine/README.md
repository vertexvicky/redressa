# AI Call Engine ![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)

A standalone, event-driven AI phone calling engine that automatically places outbound AI voice calls to customers when a support request or ticket is closed, delivering clear resolution summaries in multiple languages.

## Features

- **Automatic Request-Closure Calling** — Listens for `REQUEST_CLOSED` events and triggers outbound calls with zero manual effort.
- **Idempotency & Deduplication** — SHA-256 `(requestId, event)` deduplication prevents duplicate calls (`409 Conflict`).
- **Explicit Consent & Suppression Enforcement** — Validates `automatedCallAllowed` + `consentReference` and blocks opted-out numbers.
- **Multilingual Voice Support** — Supports English (`en`), Hindi (`hi`), and Tamil (`ta`) with per-event language overrides.
- **Provider-Independent Adapter Layer** — Ships with `mock` (dev/testing) and `vapi` (production) adapters behind a unified interface.
- **Background Queue & Exponential Backoff** — Built-in worker queue with configurable `MAX_RETRY_ATTEMPTS` and `RETRY_DELAY_BASE_MS`.
- **SQLite Persistence** — Zero-dependency local persistence for events, call records, and status transitions.
- **Webhook Lifecycle Tracking** — HMAC-verified `/api/webhooks/voice` endpoint updates call states in real time.
- **Security & Privacy Built In** — Bearer token auth, Zod schema validation, rate limiting, CORS, and masked phone logging.
- **Embeddable React Component** — Includes `@ai-call-engine/frontend` (`<AICall />`) and Docker deployment files.

## Quick Start

1. **Install dependencies** from the repository root (Node.js 18+ required):
   ```bash
   npm install
   ```
2. **Create environment file**:
   ```bash
   cp .env.example .env
   ```
3. **Set a secure `API_AUTH_TOKEN`** in `.env` (leave `VOICE_PROVIDER=mock` and `DEMO_MODE=true` for local testing).
4. **Start the development server**:
   ```bash
   npm run dev
   ```
5. **Verify health**:
   ```bash
   curl http://localhost:4000/health
   ```

## Architecture

```
External App (CRM / Support Portal)
       |
       |  POST /api/events/request-closed (Bearer Auth)
       v
+-------------------------------------------------------------+
|                       AI Call Engine                        |
|                                                             |
|  Express API (Auth, Rate Limit, CORS, Zod Validation)       |
|       |                                                     |
|       v                                                     |
|  Event Processor (Consent Check + SHA-256 Deduplication)    |
|       |                                                     |
|       v                                                     |
|  Job Queue & Retry Worker  <--->  SQLite Database           |
|       |                                                     |
|       v                                                     |
|  Voice Provider Adapter (Mock / Vapi)                       |
+-------|-----------------------------------------------------+
        |                                  ^
        | Outbound Call API                | Status Webhooks
        v                                  |
Voice AI & Telephony (Vapi + Twilio) ------+
        |
        v
Public Phone Network -> Customer
```

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/health` | Service health and readiness check | None |
| `POST` | `/api/events/request-closed` | Trigger an automatic AI call on request closure | Bearer Token |
| `GET` | `/api/events/:id` | Retrieve event processing status | Bearer Token |
| `POST` | `/api/calls` | Manually initiate an outbound AI call | Bearer Token |
| `GET` | `/api/calls/:id` | Retrieve call status, duration, and metadata | Bearer Token |
| `POST` | `/api/calls/:id/end` | Terminate an active call | Bearer Token |
| `POST` | `/api/webhooks/voice` | Receive voice provider lifecycle webhooks | Provider Signature |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `API_AUTH_TOKEN` | *(required)* | Bearer token for authenticating API callers |
| `VOICE_PROVIDER` | `mock` | Voice provider adapter (`mock` or `vapi`) |
| `DEMO_MODE` | `true` | Enables local mock mode with no real phone calls |
| `VAPI_API_KEY` | — | Vapi Private API Key (when `VOICE_PROVIDER=vapi`) |
| `VAPI_PHONE_NUMBER_ID` | — | Imported Vapi phone number ID |
| `VAPI_ASSISTANT_ID` | — | Vapi assistant ID |
| `VAPI_WEBHOOK_SECRET` | — | HMAC secret for verifying Vapi webhooks |
| `DEFAULT_LANGUAGE` | `en` | Default call language (`en`, `hi`, `ta`) |
| `MAX_CALL_DURATION` | `300` | Maximum call duration in seconds |
| `MAX_RETRY_ATTEMPTS` | `3` | Maximum retry attempts on call initiation failure |
| `RETRY_DELAY_BASE_MS` | `5000` | Base delay in ms for exponential backoff retries |
| `RATE_LIMIT_MAX` | `100` | Max requests per IP per window |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `DATABASE_PATH` | `./data/ai-call-engine.sqlite` | SQLite database file path |

## Integration Example

```bash
curl -X POST http://localhost:4000/api/events/request-closed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me-to-a-secure-random-token" \
  -d '{
    "event": "REQUEST_CLOSED",
    "requestId": "REQ-2026-001",
    "customer": { "name": "Priya Patel", "phone": "+919876543210" },
    "request": {
      "title": "Broadband Connection Issue",
      "status": "CLOSED",
      "resolution": "Faulty cable replaced and connection speed restored."
    },
    "metadata": {
      "organization": "NetConnect Services",
      "closedAt": "2026-01-01T10:00:00Z",
      "language": "en"
    },
    "consent": {
      "automatedCallAllowed": true,
      "consentReference": "CONSENT-2026-001"
    }
  }'
```

See [examples/integration-example.ts](./examples/integration-example.ts) and [examples/react-integration](./examples/react-integration/README.md) for Node.js and React usage.

## Demo Mode

Run an end-to-end simulated call flow using the built-in mock adapter:

```bash
npm run demo
```

## Testing

```bash
# Run all unit and integration tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Type-check workspaces
npm run lint
```

## Docker

```bash
# Ensure .env exists at project root first
cp .env.example .env

# Build and run with Docker Compose
docker compose -f docker/docker-compose.yml up --build -d
```

## Project Structure

```
ai-call-engine/
├── packages/
│   ├── shared/          # Shared TypeScript types, Zod schemas, phone validators
│   ├── backend/         # Express API, SQLite store, queue, voice provider adapters
│   └── frontend/        # Embeddable <AICall /> React component
├── tests/
│   ├── setup.ts         # Global Vitest environment setup
│   ├── helpers.ts       # Shared test payload factories & auth headers
│   ├── unit/            # Unit tests (validation, consent, dedup, state, adapters)
│   └── integration/     # Supertest API integration tests
├── docs/                # Detailed guides, API specs, security, compliance
├── docker/              # Multi-stage Dockerfile, docker-compose.yml, .dockerignore
├── examples/            # Backend Node.js & React frontend integration examples
├── .env.example
└── package.json
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Installation Guide](./docs/INSTALLATION.md)
- [API Reference](./docs/API.md)
- [Automatic Call Triggers](./docs/AUTOMATIC-CALL-TRIGGERS.md)
- [Voice Providers](./docs/PROVIDERS.md)
- [Security Guide](./docs/SECURITY.md)
- [India Calling Compliance](./docs/INDIA-CALLING-COMPLIANCE.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

## Security Notes

- Always replace the default `API_AUTH_TOKEN` with a 32-byte random hex secret before deployment.
- Never run `VOICE_PROVIDER=mock` or `DEMO_MODE=true` in production; enable `VAPI_WEBHOOK_SECRET` for HMAC webhook verification.
- Review [Security Guide](./docs/SECURITY.md) and [India Calling Compliance](./docs/INDIA-CALLING-COMPLIANCE.md) before placing live customer calls.

## License

MIT — see [LICENSE](./LICENSE).
