/** Vapi API — Create Call request body */
export interface VapiCreateCallPayload {
  phoneNumberId: string;
  customer: {
    number: string;
    name?: string;
  };
  assistantId?: string;
  assistant?: VapiInlineAssistant;
  assistantOverrides?: Partial<VapiInlineAssistant>;
  maxDurationSeconds?: number;
}

/** Vapi inline assistant configuration (used instead of a pre-created assistant) */
export interface VapiInlineAssistant {
  model: {
    provider: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
  };
  voice: {
    provider: string;
    voiceId: string;
  };
  firstMessage: string;
  endCallMessage?: string;
  transcriber?: {
    provider: string;
    language?: string;
  };
  maxDurationSeconds?: number;
  silenceTimeoutSeconds?: number;
  endCallPhrases?: string[];
}

/** Vapi API — Call object returned */
export interface VapiCallResponse {
  id: string;
  status: string;
  phoneNumberId?: string;
  customer?: { number: string };
  createdAt: string;
  endedAt?: string;
  endedReason?: string;
  cost?: number;
  duration?: number;
}

/** Vapi webhook event types */
export type VapiWebhookEventType =
  | 'call.started'
  | 'call.ringing'
  | 'call.connected'
  | 'call.ended'
  | 'call.failed'
  | 'speech-update'
  | 'transcript'
  | 'function-call'
  | 'end-of-call-report';

/** Vapi webhook payload */
export interface VapiWebhookPayload {
  message: {
    type: VapiWebhookEventType;
    call?: VapiCallResponse;
    timestamp?: string;
    endedReason?: string;
    transcript?: string;
    summary?: string;
  };
}
