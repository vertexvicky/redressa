# AI Call Engine — Documentation

Welcome to the documentation for **AI Call Engine**, a standalone event-driven outbound AI phone calling service. When an external support, grievance, or ticketing application closes a customer request, the engine validates consent, deduplicates the event, queues the job, and places an automated multilingual AI phone call to inform the customer of the resolution.

## Architecture Overview

```
+----------------------+      POST /api/events/request-closed
|   External App       | -----------------------------------------+
| (CRM / Ticketing /   |                                          |
|  Grievance Portal)   | <------- Call Status / Polling ----------+
+----------------------+                                          |
                                                                  v
+-------------------------------------------------------------------------+
|                            AI Call Engine                               |
|                                                                         |
|  +-------------+    +-----------------+    +-------------------------+  |
|  | Express API | -> | Event Processor | -> | Job Queue & Retry Engine|  |
|  | Auth & Zod  |    | Consent & Dedup |    | Exponential Backoff     |  |
|  +-------------+    +-----------------+    +------------+------------+  |
|        ^                                                |               |
|        | Webhooks                                       v               |
|  +-----+-------+                           +-------------------------+  |
|  | SQLite Store|                           | Voice Provider Adapter  |  |
|  | Events/Calls|                           | (Mock / Vapi / Custom)  |  |
|  +-------------+                           +------------+------------+  |
+---------------------------------------------------------|---------------+
                                                          |
                                                          v
                                             +-------------------------+
                                             | Voice AI & Telephony    |
                                             | (Vapi + Twilio/Vonage)  |
                                             +------------+------------+
                                                          |
                                                          v
                                             +-------------------------+
                                             |  Public Phone Network   |
                                             |  (Customer Mobile/Land) |
                                             +-------------------------+
```

## Key Features

- **Automatic Call Triggering**: Accepts `REQUEST_CLOSED` webhook/API events and dispatches outbound AI voice calls with zero manual intervention.
- **Duplicate Prevention (Idempotency)**: Computes a SHA-256 idempotency key per `(requestId, event)` pair and rejects duplicate triggers with HTTP `409 Conflict`.
- **Consent & Suppression Enforcement**: Validates explicit `automatedCallAllowed` consent and `consentReference`, and blocks numbers on the suppression list.
- **Multilingual AI Conversations**: Configurable call language (`en`, `hi`, `ta`, or per-request language) passed directly to the voice AI provider.
- **Provider-Independent Adapter Layer**: Ships with a `mock` adapter for local development/testing and a `vapi` adapter for production; additional providers implement a single interface.
- **Reliable Queue & Retries**: Background call worker with configurable `MAX_RETRY_ATTEMPTS` and exponential backoff (`RETRY_DELAY_BASE_MS`).
- **Privacy-First Logging**: Masks phone numbers (`+91XXXXXX3210`) and redacts sensitive fields in logs.
- **Embeddable React Component**: Includes `@ai-call-engine/frontend` (`<AICall />`) for manual call controls and status tracking.

## Documentation Index

| Guide | Description |
|-------|-------------|
| [Installation Guide](./INSTALLATION.md) | Step-by-step setup, environment config, dev server, and demo mode |
| [API Reference](./API.md) | Full endpoint specs, auth, rate limits, payloads, and cURL examples |
| [Automatic Call Triggers](./AUTOMATIC-CALL-TRIGGERS.md) | End-to-end trigger flow with Node.js, Python, and cURL integrations |
| [Voice Providers](./PROVIDERS.md) | Vapi setup, Retell AI & Exotel evaluation, and building custom adapters |
| [Security Guide](./SECURITY.md) | Bearer auth, HMAC webhooks, consent, PII masking, and hardening checklist |
| [India Calling Compliance](./INDIA-CALLING-COMPLIANCE.md) | TRAI, DND/NCPR, DLT, KYC, and Vapi + Twilio India considerations |
| [Troubleshooting](./TROUBLESHOOTING.md) | Solutions for common setup, database, auth, provider, and Docker errors |
