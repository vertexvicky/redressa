import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import {
  VoiceAIProvider, VoiceProviderConfig, OutboundCallRequest,
  OutboundCallResult, CallStatusUpdate,
} from '@ai-call-engine/shared';
import { VapiCreateCallPayload, VapiCallResponse, VapiWebhookPayload } from './vapi.types';
import { logger } from '../../config/logger';

const VAPI_BASE_URL = 'https://api.vapi.ai';

/**
 * Vapi Voice AI Provider Adapter
 *
 * API Reference: https://docs.vapi.ai/api-reference
 *
 * Indian calling: Vapi connects to the PSTN through telephony providers
 * (Twilio, Vonage, or Vapi's own numbers). For Indian numbers:
 * - Import a Twilio phone number with Indian calling capability into Vapi
 * - Or use a Vapi-provided number if available for the IN region
 * - Ensure the Twilio account has international calling enabled for India
 *
 * IMPORTANT: Real-world calling is UNVERIFIED until tested with actual
 * Vapi credentials and a phone number with Indian calling capability.
 */
export class VapiAdapter implements VoiceAIProvider {
  private client: AxiosInstance;
  private phoneNumberId: string;
  private assistantId?: string;
  private webhookSecret: string;

  constructor(config: VoiceProviderConfig) {
    this.client = axios.create({
      baseURL: VAPI_BASE_URL,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    this.phoneNumberId = config.phoneNumberId || '';
    this.assistantId = config.assistantId;
    this.webhookSecret = config.webhookSecret || '';
  }

  async initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult> {
    const log = logger.child({ provider: 'vapi', requestId: request.requestId });

    // Build the AI assistant prompt dynamically
    const systemPrompt = this.buildAssistantPrompt(request);

    // VERIFY: Check actual Vapi API endpoint — POST /call
    const payload: VapiCreateCallPayload = {
      phoneNumberId: this.phoneNumberId,
      customer: {
        number: request.to,
        name: request.customerName,
      },
      assistant: {
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: this.getVoiceConfig(request.language),
        firstMessage: this.buildGreeting(request),
        endCallMessage: request.customClosing || 'Thank you for your time. Have a great day! Goodbye.',
        transcriber: {
          provider: 'deepgram',
          language: this.mapLanguageCode(request.language),
        },
        maxDurationSeconds: request.maxDuration || 300,
        silenceTimeoutSeconds: 15,
        endCallPhrases: ['goodbye', 'bye', 'thank you bye', 'alvida', 'nandri'],
      },
    };

    // If a pre-created assistant is configured, use it with overrides
    if (this.assistantId) {
      delete (payload as any).assistant;
      (payload as any).assistantId = this.assistantId;
      (payload as any).assistantOverrides = {
        model: { messages: [{ role: 'system', content: systemPrompt }] },
        firstMessage: this.buildGreeting(request),
      };
    }

    try {
      // VERIFY: Vapi API — POST /call
      const response = await this.client.post<VapiCallResponse>('/call', payload);
      log.info({ callId: response.data.id, status: response.data.status }, 'Vapi call initiated');

      return {
        providerCallId: response.data.id,
        status: response.data.status,
        raw: response.data,
      };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        log.error({
          status: err.response?.status,
          data: err.response?.data,
        }, 'Vapi API error');
        throw new Error(`Vapi API error: ${err.response?.data?.message || err.message}`);
      }
      throw err;
    }
  }

  async getCallStatus(providerCallId: string): Promise<CallStatusUpdate> {
    // VERIFY: Vapi API — GET /call/{id}
    const response = await this.client.get<VapiCallResponse>(`/call/${providerCallId}`);
    const call = response.data;

    return {
      providerCallId: call.id,
      status: call.status,
      duration: call.duration,
      timestamp: call.endedAt || call.createdAt,
      raw: call,
    };
  }

  async endCall(providerCallId: string): Promise<void> {
    // VERIFY: Vapi API — DELETE /call/{id} or PATCH /call/{id}
    try {
      await this.client.delete(`/call/${providerCallId}`);
      logger.info({ providerCallId }, 'Vapi call ended');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        logger.warn({ providerCallId, status: err.response?.status }, 'Vapi end-call response');
      }
    }
  }

  async handleWebhook(payload: unknown, headers: Record<string, string>): Promise<CallStatusUpdate> {
    const webhookPayload = payload as VapiWebhookPayload;
    const message = webhookPayload.message;

    if (!message || !message.type) {
      throw new Error('Invalid Vapi webhook payload');
    }

    const call = message.call;
    const providerCallId = call?.id || '';

    // Map Vapi event types to our status
    const statusMap: Record<string, string> = {
      'call.started': 'ringing',
      'call.ringing': 'ringing',
      'call.connected': 'connected',
      'call.ended': 'completed',
      'call.failed': 'failed',
    };

    return {
      providerCallId,
      status: statusMap[message.type] || 'unknown',
      duration: call?.duration,
      timestamp: message.timestamp || new Date().toISOString(),
      raw: payload,
    };
  }

  validateWebhook(payload: unknown, signature: string, secret: string): boolean {
    if (!secret || !signature) return false;

    // VERIFY: Vapi webhook signature verification method
    // Vapi uses HMAC-SHA256 with the webhook secret
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  getProviderName(): string {
    return 'vapi';
  }

  private buildAssistantPrompt(request: OutboundCallRequest): string {
    return `You are a professional AI assistant calling on behalf of ${request.organizationName}.

IDENTITY:
- You are an automated AI calling assistant.
- You must identify yourself as an AI assistant.
- You represent ${request.organizationName}.

PURPOSE:
- You are calling ${request.customerName} to inform them that their request ${request.requestId} has been closed.
- Resolution: ${request.resolution}

CONVERSATION RULES:
1. Greet the customer and confirm you are speaking with ${request.customerName}.
2. Identify yourself as an AI assistant from ${request.organizationName}.
3. Inform them that request ${request.requestId} has been resolved and closed.
4. Explain the resolution clearly: "${request.resolution}"
5. Ask whether the customer understands the resolution.
6. Ask if they need any further assistance or have questions.
7. End the call politely.

STRICT RULES:
- NEVER invent or fabricate details about the resolution.
- NEVER share internal notes or confidential information.
- NEVER make promises that ${request.organizationName} has not approved.
- If the customer disputes the resolution, acknowledge their concern and note it for escalation.
- If the customer asks for a human agent, acknowledge their request and note it for follow-up.
- If the customer asks questions you cannot answer, say you will pass the question to the team.
- Handle interruptions naturally.
- If there is prolonged silence, gently ask if the customer is still there.
- Respect any request to end the call.
- Always end politely.

LANGUAGE: Communicate in ${request.language === 'hi' ? 'Hindi' : request.language === 'ta' ? 'Tamil' : 'English'}.`;
  }

  private buildGreeting(request: OutboundCallRequest): string {
    if (request.customGreeting) return request.customGreeting;

    switch (request.language) {
      case 'hi':
        return `नमस्ते, क्या मैं ${request.customerName} जी से बात कर सकता हूँ?`;
      case 'ta':
        return `வணக்கம், நான் ${request.customerName} அவர்களிடம் பேசலாமா?`;
      default:
        return `Hello, may I speak with ${request.customerName}?`;
    }
  }

  private getVoiceConfig(language: string): { provider: string; voiceId: string } {
    // VERIFY: Available Vapi voice IDs for each language
    switch (language) {
      case 'hi':
        return { provider: '11labs', voiceId: 'hindi-female-1' };
      case 'ta':
        return { provider: '11labs', voiceId: 'tamil-female-1' };
      default:
        return { provider: '11labs', voiceId: 'rachel' };
    }
  }

  private mapLanguageCode(language: string): string {
    switch (language) {
      case 'hi': return 'hi';
      case 'ta': return 'ta';
      default: return 'en';
    }
  }
}
