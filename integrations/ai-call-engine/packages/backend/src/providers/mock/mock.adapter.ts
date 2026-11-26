import { v4 as uuid } from 'uuid';
import {
  VoiceAIProvider, OutboundCallRequest, OutboundCallResult, CallStatusUpdate,
} from '@ai-call-engine/shared';
import { maskPhone } from '@ai-call-engine/shared';
import { logger } from '../../config/logger';

const log = logger.child({ provider: 'mock' });

interface MockCall {
  id: string;
  status: string;
  startedAt: string;
  request: OutboundCallRequest;
}

/**
 * Mock Voice Provider — for local development and demonstration.
 * NO REAL PHONE CALLS ARE PLACED.
 */
export class MockAdapter implements VoiceAIProvider {
  private calls: Map<string, MockCall> = new Map();

  async initiateCall(request: OutboundCallRequest): Promise<OutboundCallResult> {
    const callId = `mock-${uuid()}`;
    const maskedPhone = maskPhone(request.to);

    log.info('═══════════════════════════════════════════════════');
    log.info(`[MOCK] Simulating call to ${maskedPhone}`);
    log.info(`[MOCK] Customer: ${request.customerName}`);
    log.info(`[MOCK] Organization: ${request.organizationName}`);
    log.info(`[MOCK] Request: ${request.requestId}`);
    log.info(`[MOCK] Language: ${request.language}`);
    log.info('[MOCK] NO REAL CALL PLACED — this is a simulation');
    log.info('═══════════════════════════════════════════════════');

    this.calls.set(callId, {
      id: callId,
      status: 'ringing',
      startedAt: new Date().toISOString(),
      request,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      providerCallId: callId,
      status: 'ringing',
      raw: { mock: true, callId },
    };
  }

  async getCallStatus(providerCallId: string): Promise<CallStatusUpdate> {
    const call = this.calls.get(providerCallId);
    if (!call) {
      return {
        providerCallId,
        status: 'failed',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      providerCallId,
      status: call.status,
      duration: call.status === 'completed' ? 10 : undefined,
      outcome: call.status === 'completed' ? 'INFORMED' : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  async endCall(providerCallId: string): Promise<void> {
    const call = this.calls.get(providerCallId);
    if (call) {
      call.status = 'ended';
      log.info(`[MOCK] Call ${providerCallId} — ended by request`);
    }
  }

  async handleWebhook(payload: unknown, _headers: Record<string, string>): Promise<CallStatusUpdate> {
    const data = payload as { providerCallId?: string; status?: string; message?: { call?: { id?: string; status?: string; duration?: number } } };
    const providerCallId = data.providerCallId || data.message?.call?.id || 'unknown';
    const status = data.status || data.message?.call?.status || 'completed';
    const duration = data.message?.call?.duration;
    return {
      providerCallId,
      status,
      duration,
      timestamp: new Date().toISOString(),
      raw: payload,
    };
  }

  validateWebhook(_payload: unknown, _signature: string, _secret: string): boolean {
    return true;
  }

  getProviderName(): string {
    return 'mock';
  }
}
