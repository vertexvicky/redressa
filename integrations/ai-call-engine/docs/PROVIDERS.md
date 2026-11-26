# Voice Providers Guide

AI Call Engine uses a provider-independent adapter architecture so your calling logic, queue, database, and API remain decoupled from any single telephony or voice AI vendor.

## Provider Evaluation

### 1. Vapi (Selected Primary Provider)

**Why Vapi was selected:**
- Clean REST API for triggering outbound AI calls with dynamic per-call prompt variables (`customerName`, `organizationName`, `resolution`, `requestId`).
- Built-in webhook callbacks for call lifecycle events (`call.started`, `call.ended`, transcripts, duration).
- Native multilingual STT/TTS/LLM orchestration (supporting English, Hindi, Tamil, and others via Deepgram/ElevenLabs/OpenAI integrations).
- Supports Bring-Your-Own-Carrier (Twilio / Vonage) phone numbers for India and international calling.

**Setup Steps:**
1. Create an account at [vapi.ai](https://vapi.ai) and generate a Private API Key.
2. Create or configure an Assistant in the Vapi dashboard (or supply `VAPI_ASSISTANT_ID`) with system prompt placeholders for resolution summaries.
3. Import or purchase a phone number in Vapi (via Twilio or Vonage) and copy its `Phone Number ID`.
4. Configure the Assistant Server URL / Webhook URL to `https://<your-domain>/api/webhooks/voice` and set a webhook secret.

**Indian Calling Setup:**
- Vapi does not directly issue Indian `+91` numbers natively in all regions; connect a **Twilio** or **Vonage** account configured with KYC/DLT-approved Indian outbound calling (see [India Calling Compliance](./INDIA-CALLING-COMPLIANCE.md)) and import that number into Vapi as `VAPI_PHONE_NUMBER_ID`.

**Environment Configuration:**
```env
VOICE_PROVIDER=vapi
DEMO_MODE=false
VAPI_API_KEY=your_vapi_private_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
VAPI_ASSISTANT_ID=your_vapi_assistant_id
VAPI_WEBHOOK_SECRET=your_webhook_signing_secret
```

**Limitations & Unverified Items:**
- *Concurrency & Rate Limits*: Subject to your Vapi plan tier and connected Twilio/Vonage CPS (calls per second) limits.
- *Regional Latency*: Voice round-trip latency from India to US/EU-hosted LLM/TTS endpoints should be benchmarked before production rollout.
- *Webhook Payload Evolution*: Verify exact signature header and payload fields against your active Vapi API version before going live.

---

### 2. Retell AI (Evaluated Alternative)

- **Summary**: Strong conversational voice AI platform with low-latency turn-taking and outbound API support.
- **Why not primary**: Vapi's REST payload structure, dynamic assistant overrides, and Twilio/Vonage phone number import workflow aligned more directly with our single-call context injection requirements. Retell AI remains straightforward to add as a future adapter.

---

### 3. Exotel (Evaluated Indian Telephony Provider)

- **Summary**: Established Indian cloud telephony provider with native TRAI/DLT workflows, `+91` virtual numbers, and SIP/voice streaming.
- **Why not primary**: Exotel is a **telephony carrier/CPaaS**, not a turnkey conversational AI orchestration platform. Using Exotel directly requires building and hosting your own real-time media WebSocket bridge (STT -> LLM -> TTS).
- **Recommended role**: Can serve as the underlying SIP trunk / telephony layer bridged to a voice AI engine if strict local Indian media routing is required.

---

### 4. Mock Provider (Built-in for Dev & Tests)

Configured via `VOICE_PROVIDER=mock` (or `DEMO_MODE=true`). Simulates `initiateCall`, `getCallStatus`, `endCall`, and webhook verification locally with zero external network calls.

---

## Provider Interface Reference

All voice providers implement `VoiceProviderAdapter` in `packages/backend/src/providers/base.provider.ts`:

```typescript
export interface InitiateCallParams {
  to: string;
  customerName: string;
  organizationName: string;
  requestId: string;
  resolution: string;
  language: string;
}

export interface InitiateCallResult {
  providerCallId: string;
  status: string;
}

export interface CallStatusResult {
  providerCallId: string;
  status: string;
  durationSeconds?: number;
}

export interface WebhookResult {
  providerCallId: string;
  status: string;
  durationSeconds?: number;
}

export interface VoiceProviderAdapter {
  getProviderName(): string;
  initiateCall(params: InitiateCallParams): Promise<InitiateCallResult>;
  getCallStatus(providerCallId: string): Promise<CallStatusResult>;
  endCall(providerCallId: string): Promise<void>;
  validateWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, signature: string): boolean;
  handleWebhook(payload: unknown, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult>;
}
```

## How to Add a New Provider Adapter

1. **Create the adapter folder**: Add `packages/backend/src/providers/<name>/<name>.adapter.ts`.
2. **Implement `VoiceProviderAdapter`**: Map your vendor's outbound call API, status polling, call hangup, and HMAC/header webhook verification to the interface methods above.
3. **Register in the provider factory**: Update `packages/backend/src/providers/index.ts` (and `VOICE_PROVIDER` config validation) to instantiate your adapter when `VOICE_PROVIDER=<name>`.
4. **Add environment variables**: Document required keys in `.env.example` and `docs/PROVIDERS.md`.
5. **Write unit tests**: Add adapter tests under `tests/unit/` following `tests/unit/provider-adapter.test.ts`.
