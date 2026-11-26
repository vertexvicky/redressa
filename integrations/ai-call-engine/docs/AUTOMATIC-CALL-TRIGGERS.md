# Automatic Call Triggers

The primary integration pattern for AI Call Engine is **event-driven automatic calling**: your application emits a `REQUEST_CLOSED` event whenever an agent or automated workflow closes a customer ticket, and AI Call Engine handles consent checks, deduplication, queuing, retries, and the voice conversation.

## Trigger Flow Diagram

```
[Your App: Ticket Closed]
         |
         | 1. POST /api/events/request-closed (Bearer Token)
         v
[API Validation & Auth]
         |  - Zod schema check (status === "CLOSED", valid E.164 phone)
         |  - Consent check (automatedCallAllowed === true, consentReference)
         |  - Suppression list check
         |  - Idempotency check: SHA-256(requestId + event)
         v
[SQLite Event & Call Records Created] ---> Returns 202 Accepted { eventId }
         |
         v
[In-Memory Job Queue]
         |
         v
[Call Worker]
         |  - Transitions: QUEUED -> INITIATING -> RINGING
         |  - Calls VoiceProviderAdapter.initiateCall(...)
         v
[Voice Provider (Vapi / Mock)] ---> Places Call to Customer
         |
         |  2. POST /api/webhooks/voice (Status / Transcript / End)
         v
[Call State Updated: CONNECTED -> IN_PROGRESS -> COMPLETED]
```

## Payload Format Explained

```json
{
  "event": "REQUEST_CLOSED",
  "requestId": "REQ-2026-0042",
  "customer": {
    "name": "Priya Patel",
    "phone": "+919876543210"
  },
  "request": {
    "title": "Broadband Connection Issue",
    "status": "CLOSED",
    "resolution": "The faulty fiber drop cable was replaced and line speed is restored to 100 Mbps."
  },
  "metadata": {
    "organization": "NetConnect Services",
    "closedAt": "2026-01-15T09:30:00Z",
    "language": "en"
  },
  "consent": {
    "automatedCallAllowed": true,
    "consentReference": "CONSENT-2026-0042"
  }
}
```

- **`event`**: Must be `"REQUEST_CLOSED"`.
- **`requestId`**: Your system's unique ticket identifier. Used with `event` to compute the idempotency key.
- **`customer.name` / `customer.phone`**: Used to address the customer politely and dial in strict E.164 format (`+<country><number>`).
- **`request.status`**: Must be `"CLOSED"` so accidental open/pending updates never trigger calls.
- **`request.resolution`**: Injected into the AI voice assistant prompt so it clearly explains what was resolved.
- **`metadata.organization`**: Identifies who is calling at the start of the call.
- **`metadata.language`** *(optional)*: `"en"`, `"hi"`, or `"ta"`. Falls back to `DEFAULT_LANGUAGE`.
- **`consent`**: Required proof that the customer opted in to automated closure notifications.

---

## Integration Examples

### Node.js / TypeScript

```typescript
export async function triggerClosureCall(ticket: {
  id: string;
  customerName: string;
  customerPhone: string;
  title: string;
  resolution: string;
  consentRef: string;
}) {
  const res = await fetch(`${process.env.AI_CALL_ENGINE_URL}/api/events/request-closed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_CALL_ENGINE_TOKEN}`,
    },
    body: JSON.stringify({
      event: 'REQUEST_CLOSED',
      requestId: ticket.id,
      customer: {
        name: ticket.customerName,
        phone: ticket.customerPhone,
      },
      request: {
        title: ticket.title,
        status: 'CLOSED',
        resolution: ticket.resolution,
      },
      metadata: {
        organization: 'NetConnect Services',
        closedAt: new Date().toISOString(),
      },
      consent: {
        automatedCallAllowed: true,
        consentReference: ticket.consentRef,
      },
    }),
  });

  if (res.status === 409) {
    // Already triggered previously — safe to ignore
    return { alreadyQueued: true };
  }

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`AI Call Engine error (${res.status}): ${err.error?.message}`);
  }

  return res.json();
}
```

### Python (`requests`)

```python
import os
from datetime import datetime, timezone
import requests

AI_CALL_ENGINE_URL = os.environ.get("AI_CALL_ENGINE_URL", "http://localhost:4000")
API_TOKEN = os.environ["AI_CALL_ENGINE_TOKEN"]


def trigger_closure_call(request_id: str, name: str, phone: str, title: str, resolution: str, consent_ref: str):
    payload = {
        "event": "REQUEST_CLOSED",
        "requestId": request_id,
        "customer": {"name": name, "phone": phone},
        "request": {
            "title": title,
            "status": "CLOSED",
            "resolution": resolution,
        },
        "metadata": {
            "organization": "NetConnect Services",
            "closedAt": datetime.now(timezone.utc).isoformat(),
        },
        "consent": {
            "automatedCallAllowed": True,
            "consentReference": consent_ref,
        },
    }

    response = requests.post(
        f"{AI_CALL_ENGINE_URL}/api/events/request-closed",
        json=payload,
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        timeout=10,
    )

    if response.status_code == 409:
        return {"duplicate": True}

    response.raise_for_status()
    return response.json()
```

### cURL

```bash
curl -X POST http://localhost:4000/api/events/request-closed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -d '{
    "event": "REQUEST_CLOSED",
    "requestId": "REQ-2026-0042",
    "customer": { "name": "Priya Patel", "phone": "+919876543210" },
    "request": {
      "title": "Broadband Connection Issue",
      "status": "CLOSED",
      "resolution": "Line speed restored."
    },
    "metadata": {
      "organization": "NetConnect Services",
      "closedAt": "2026-01-15T09:30:00Z"
    },
    "consent": {
      "automatedCallAllowed": true,
      "consentReference": "CONSENT-2026-0042"
    }
  }'
```

## Response Handling

- **`202 Accepted`**: Event validated and queued. Store `data.eventId` if you want to poll `GET /api/events/:id` later.
- **`400 Bad Request`**: Fix invalid fields (e.g., non-E.164 phone number or missing consent) — do **not** blindly retry `400` responses.
- **`409 Conflict`**: Duplicate `requestId` for `REQUEST_CLOSED` — treat as idempotent success.
- **`429` / `5xx`**: Retry with backoff from your external application.

## Webhook Configuration for Call Status Updates

When running with a live voice provider (`VOICE_PROVIDER=vapi`):

1. Expose your AI Call Engine publicly over HTTPS (e.g., `https://calls.example.com`).
2. Configure the Vapi Assistant/Server URL to `https://calls.example.com/api/webhooks/voice`.
3. Set `VAPI_WEBHOOK_SECRET` in `.env` to match the secret configured in Vapi.
4. Incoming webhook events automatically update call records from `RINGING` -> `CONNECTED` -> `IN_PROGRESS` -> `COMPLETED` (or `FAILED` / `NO_ANSWER`).

## Error Handling & Retry Behavior

If the voice provider fails transiently while initiating a call, the internal worker retries automatically using exponential backoff:

$$\text{delay} = \text{RETRY\_DELAY\_BASE\_MS} \times 2^{\text{attempt} - 1}$$

- Controlled by `MAX_RETRY_ATTEMPTS` (default `3`) and `RETRY_DELAY_BASE_MS` (default `5000` ms).
- Terminal failure after exhausting retries transitions the call to `FAILED`.

## Duplicate Prevention

Every incoming event generates a deterministic SHA-256 idempotency key from `requestId` and `event` (`generateIdempotencyKey(requestId, event)`). Before queuing a call, the engine checks the database for an existing record with the same key and rejects duplicates with `409 Conflict`, preventing customers from ever receiving multiple calls for the same closed ticket.
