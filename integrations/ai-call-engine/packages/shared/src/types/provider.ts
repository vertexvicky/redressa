/** Configuration for a voice AI provider */
export interface VoiceProviderConfig {
  provider: string;
  apiKey: string;
  phoneNumberId?: string;
  assistantId?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

/** Request to place an outbound call */
export interface OutboundCallRequest {
  to: string;
  customerName: string;
  organizationName: string;
  requestId: string;
  resolution: string;
  language: 'en' | 'hi' | 'ta';
  customGreeting?: string;
  customClosing?: string;
  maxDuration?: number;
}

/** Result from a provider after initiating a call */
export interface OutboundCallResult {
  providerCallId: string;
  status: string;
  raw?: unknown;
}

/** Status update received from the provider (via polling or webhook) */
export interface CallStatusUpdate {
  providerCallId: string;
  status: string;
  duration?: number;
  outcome?: string;
  timestamp: string;
  raw?: unknown;
}

/** Abstract voice AI provider interface */
export interface VoiceAIProvider {
  initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult>;
  getCallStatus(providerCallId: string): Promise<CallStatusUpdate>;
  endCall(providerCallId: string): Promise<void>;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<CallStatusUpdate>;
  validateWebhook(payload: unknown, signature: string, secret: string): boolean;
  getProviderName(): string;
}
