# API Reference

Base URL: `http://localhost:4000` (configurable via `PORT` in `.env`).

## Authentication

All `/api/*` endpoints (except `/api/webhooks/voice`, which uses provider webhook signature verification, and `/health`, which is public) require Bearer token authentication:

```http
Authorization: Bearer <API_AUTH_TOKEN>
```

Missing or invalid tokens return `401 Unauthorized`.

## Rate Limiting

API routes are rate-limited per IP address using the following environment variables:

- `RATE_LIMIT_MAX` (default: `100` requests per window)
- `RATE_LIMIT_WINDOW_MS` (default: `900000` ms / 15 minutes)

When exceeded, the server responds with `429 Too Many Requests`.

## Standard Response & Error Format

### Success Response
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error description",
    "details": []
  }
}
```

---

## Endpoints

### 1. Health Check

`GET /health` — **Public (No Auth)**

Checks service liveness and configuration state.

```bash
curl http://localhost:4000/health
```

**Response (`200 OK`):**
```json
{
  "status": "ok",
  "provider": "mock",
  "uptime": 124.5,
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

---

### 2. Trigger Automatic Call on Request Closure

`POST /api/events/request-closed` — **Requires Bearer Auth**

Receives a `REQUEST_CLOSED` event from an external application, validates schema and consent, checks deduplication and suppression rules, persists the event, and queues an outbound AI call.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `"REQUEST_CLOSED"` | Yes | Must be `"REQUEST_CLOSED"` |
| `requestId` | `string` | Yes | Unique external ticket/request ID |
| `customer.name` | `string` | Yes | Customer full name |
| `customer.phone` | `string` | Yes | E.164 phone number (e.g., `+919876543210`) |
| `request.title` | `string` | Yes | Short request title |
| `request.status` | `"CLOSED"` | Yes | Must be `"CLOSED"` |
| `request.resolution` | `string` | Yes | Resolution summary spoken to customer |
| `metadata.organization` | `string` | Yes | Organization name announced on call |
| `metadata.closedAt` | `string` | Yes | ISO-8601 timestamp |
| `metadata.language` | `"en" \| "hi" \| "ta"` | No | Preferred call language (defaults to `DEFAULT_LANGUAGE`) |
| `consent.automatedCallAllowed` | `boolean` | Yes | Must be `true` |
| `consent.consentReference` | `string` | Yes | Non-empty consent audit reference |

**Example Request:**
```bash
curl -X POST http://localhost:4000/api/events/request-closed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -d '{
    "event": "REQUEST_CLOSED",
    "requestId": "REQ-1024",
    "customer": {
      "name": "Priya Patel",
      "phone": "+919876543210"
    },
    "request": {
      "title": "Broadband Outage",
      "status": "CLOSED",
      "resolution": "Line fault cleared and connection speed restored."
    },
    "metadata": {
      "organization": "NetConnect Services",
      "closedAt": "2026-01-01T12:00:00Z",
      "language": "en"
    },
    "consent": {
      "automatedCallAllowed": true,
      "consentReference": "CONSENT-REQ-1024"
    }
  }'
```

**Success Response (`202 Accepted`):**
```json
{
  "success": true,
  "data": {
    "eventId": "evt_01J...",
    "requestId": "REQ-1024",
    "status": "QUEUED"
  }
}
```

**Error Cases:**
- `400 Bad Request` (`VALIDATION_ERROR`): Invalid phone format, `status !== "CLOSED"`, `automatedCallAllowed !== true`, or missing fields.
- `401 Unauthorized`: Missing or invalid Bearer token.
- `409 Conflict` (`DUPLICATE_EVENT`): An event for this `requestId` and `event` type was already processed.
- `422 Unprocessable Entity` / `400`: Phone number is on the suppression list.

---

### 3. Get Event Status

`GET /api/events/:id` — **Requires Bearer Auth**

Retrieves the processing status and associated call reference for a submitted event.

```bash
curl http://localhost:4000/api/events/evt_01J... \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "evt_01J...",
    "eventType": "REQUEST_CLOSED",
    "requestId": "REQ-1024",
    "status": "PROCESSED",
    "createdAt": "2026-01-01T12:00:00.000Z"
  }
}
```

**Error Cases:**
- `404 Not Found`: Event ID does not exist.

---

### 4. Initiate Manual Call

`POST /api/calls` — **Requires Bearer Auth**

Directly initiates or queues a single outbound AI call without requiring a `REQUEST_CLOSED` event wrapper.

**Request Body:**
```json
{
  "phone": "+919876543210",
  "customerName": "Priya Patel",
  "organizationName": "NetConnect Services",
  "requestId": "REQ-MANUAL-001",
  "resolution": "Your broadband connection issue has been resolved.",
  "language": "en"
}
```

```bash
curl -X POST http://localhost:4000/api/calls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -d '{
    "phone": "+919876543210",
    "customerName": "Priya Patel",
    "organizationName": "NetConnect Services",
    "requestId": "REQ-MANUAL-001",
    "resolution": "Your broadband connection issue has been resolved.",
    "language": "en"
  }'
```

**Success Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "id": "call_01J...",
    "requestId": "REQ-MANUAL-001",
    "status": "QUEUED",
    "provider": "mock",
    "createdAt": "2026-01-01T12:05:00.000Z"
  }
}
```

**Error Cases:**
- `400 Bad Request`: Invalid phone number or missing required fields.
- `401 Unauthorized`: Missing or invalid Bearer token.

---

### 5. Get Call Details

`GET /api/calls/:id` — **Requires Bearer Auth**

Fetches current state, provider call ID, duration, and timestamps for a call.

```bash
curl http://localhost:4000/api/calls/call_01J... \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "call_01J...",
    "requestId": "REQ-MANUAL-001",
    "status": "COMPLETED",
    "provider": "mock",
    "providerCallId": "mock-1704110700000",
    "durationSeconds": 42,
    "createdAt": "2026-01-01T12:05:00.000Z",
    "updatedAt": "2026-01-01T12:05:45.000Z"
  }
}
```

**Error Cases:**
- `404 Not Found`: Call ID does not exist.

---

### 6. End Active Call

`POST /api/calls/:id/end` — **Requires Bearer Auth**

Requests the voice provider to terminate an active or ringing call and transitions the call state accordingly.

```bash
curl -X POST http://localhost:4000/api/calls/call_01J.../end \
  -H "Authorization: Bearer $API_AUTH_TOKEN"
```

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": "call_01J...",
    "status": "CANCELLED"
  }
}
```

---

### 7. Voice Provider Webhook Receiver

`POST /api/webhooks/voice` — **Provider Signature Auth**

Receives asynchronous lifecycle callbacks from the configured voice provider (e.g., `call.started`, `call.ended`, `status-update`). Verified using `VAPI_WEBHOOK_SECRET` when `VOICE_PROVIDER=vapi`.

```bash
curl -X POST http://localhost:4000/api/webhooks/voice \
  -H "Content-Type: application/json" \
  -H "x-vapi-signature: <hmac-sha256-signature>" \
  -d '{
    "message": {
      "type": "call.ended",
      "call": {
        "id": "mock-call-123",
        "status": "completed",
        "duration": 30
      },
      "timestamp": "2026-01-01T12:06:00.000Z"
    }
  }'
```

**Success Response (`200 OK`):**
```json
{
  "success": true
}
```
