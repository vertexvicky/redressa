import crypto from 'crypto';
import {
  RequestClosedEvent, CallStatus, CallOutcome, CallRecord,
  isValidTransition, OutboundCallRequest, CallStatusUpdate,
} from '@ai-call-engine/shared';
import { maskPhone } from '@ai-call-engine/shared';
import { logger } from '../config/logger';
import { config } from '../config';
import * as callRepo from '../database/repositories/call.repository';
import * as eventRepo from '../database/repositories/event.repository';
import { EventStatus } from '@ai-call-engine/shared';
import { getVoiceProvider } from '../providers/provider.factory';

const log = logger.child({ service: 'call' });

function notifyCallbackWebhook(call: CallRecord): void {
  if (!config.callbackWebhookUrl) return;
  const body = JSON.stringify({
    callId: call.id,
    providerCallId: call.providerCallId,
    requestId: call.requestId,
    status: call.status,
    outcome: call.outcome,
    durationSeconds: call.duration,
    timestamp: new Date().toISOString(),
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.callbackWebhookSecret) {
    headers['x-ai-call-engine-signature'] = crypto
      .createHmac('sha256', config.callbackWebhookSecret)
      .update(body)
      .digest('hex');
  }
  fetch(config.callbackWebhookUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  }).catch((err: unknown) => {
    log.warn({ callId: call.id, error: err instanceof Error ? err.message : 'Callback failed' }, 'Status callback webhook failed');
  });
}

export function transitionCallStatus(callId: string, newStatus: CallStatus, extras?: {
  providerCallId?: string; duration?: number; outcome?: CallOutcome; startedAt?: string; endedAt?: string;
}): void {
  const call = callRepo.getCallById(callId);
  if (!call) throw Object.assign(new Error('Call not found'), { statusCode: 404, code: 'CALL_NOT_FOUND' });

  if (!isValidTransition(call.status, newStatus)) {
    throw Object.assign(
      new Error(`Invalid status transition: ${call.status} → ${newStatus}`),
      { statusCode: 400, code: 'INVALID_STATUS_TRANSITION' },
    );
  }

  callRepo.updateCallStatus(callId, newStatus, extras);
  log.info({ callId, from: call.status, to: newStatus }, 'Call status transitioned');

  const updated = callRepo.getCallById(callId);
  if (updated) {
    notifyCallbackWebhook(updated);
  }
}

export async function initiateCall(eventId: string, payload: RequestClosedEvent): Promise<CallRecord> {
  const provider = getVoiceProvider();

  // Create call record
  const call = callRepo.createCall({
    eventId,
    requestId: payload.requestId,
    maskedPhone: maskPhone(payload.customer.phone),
    status: CallStatus.QUEUED,
    maxRetries: config.maxRetryAttempts,
  });

  log.info({ callId: call.id, eventId, provider: provider.getProviderName() }, 'Initiating call');

  try {
    // Transition to INITIATING
    transitionCallStatus(call.id, CallStatus.INITIATING);

    const request: OutboundCallRequest = {
      to: payload.customer.phone,
      customerName: payload.customer.name,
      organizationName: payload.metadata.organization,
      requestId: payload.requestId,
      resolution: payload.request.resolution,
      language: payload.metadata.language || config.defaultLanguage,
      maxDuration: config.maxCallDuration,
    };

    const result = await provider.initiateCall(request);

    // Update with provider call ID
    transitionCallStatus(call.id, CallStatus.RINGING, {
      providerCallId: result.providerCallId,
      startedAt: new Date().toISOString(),
    });

    log.info({ callId: call.id, providerCallId: result.providerCallId }, 'Call initiated — ringing');

    // Update event status
    eventRepo.updateEventStatus(eventId, EventStatus.PROCESSING, { callId: call.id });

    return callRepo.getCallById(call.id)!;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ callId: call.id, error: message }, 'Failed to initiate call');

    try {
      transitionCallStatus(call.id, CallStatus.FAILED);
    } catch { /* already in a terminal state */ }

    eventRepo.updateEventStatus(eventId, EventStatus.FAILED, {
      failureReason: message,
      processedAt: new Date().toISOString(),
    });

    throw err;
  }
}

export function getCall(callId: string): CallRecord | null {
  return callRepo.getCallById(callId);
}

export async function endCall(callId: string): Promise<void> {
  const call = callRepo.getCallById(callId);
  if (!call) throw Object.assign(new Error('Call not found'), { statusCode: 404, code: 'CALL_NOT_FOUND' });

  const provider = getVoiceProvider();

  if (call.providerCallId) {
    await provider.endCall(call.providerCallId);
  }

  transitionCallStatus(callId, CallStatus.CANCELLED, { endedAt: new Date().toISOString() });
  log.info({ callId }, 'Call ended');
}

export function updateCallFromWebhook(update: CallStatusUpdate): void {
  const call = callRepo.getCallByProviderCallId(update.providerCallId);
  if (!call) {
    log.warn({ providerCallId: update.providerCallId }, 'Webhook for unknown call');
    return;
  }

  // Map provider status to our CallStatus
  const statusMap: Record<string, CallStatus> = {
    ringing: CallStatus.RINGING,
    'in-progress': CallStatus.IN_PROGRESS,
    answered: CallStatus.CONNECTED,
    connected: CallStatus.CONNECTED,
    completed: CallStatus.COMPLETED,
    ended: CallStatus.COMPLETED,
    failed: CallStatus.FAILED,
    busy: CallStatus.REJECTED,
    'no-answer': CallStatus.NO_ANSWER,
    cancelled: CallStatus.CANCELLED,
  };

  const newStatus = statusMap[update.status.toLowerCase()] || CallStatus.FAILED;

  try {
    transitionCallStatus(call.id, newStatus, {
      duration: update.duration,
      outcome: update.outcome as CallOutcome | undefined,
      endedAt: [CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.NO_ANSWER, CallStatus.REJECTED, CallStatus.CANCELLED].includes(newStatus)
        ? new Date().toISOString()
        : undefined,
    });
  } catch (err) {
    log.warn({ callId: call.id, currentStatus: call.status, newStatus, error: (err as Error).message }, 'Webhook status transition skipped');
  }

  // Update event if call completed or failed
  if ([CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.NO_ANSWER, CallStatus.REJECTED].includes(newStatus)) {
    const eventStatus = newStatus === CallStatus.COMPLETED ? EventStatus.COMPLETED : EventStatus.FAILED;
    eventRepo.updateEventStatus(call.eventId, eventStatus, { processedAt: new Date().toISOString() });
  }
}

export async function manualCall(params: {
  phone: string;
  customerName: string;
  organizationName: string;
  requestId: string;
  resolution: string;
  language?: string;
}): Promise<CallRecord> {
  const payload: RequestClosedEvent = {
    event: 'REQUEST_CLOSED' as any,
    requestId: params.requestId,
    customer: { name: params.customerName, phone: params.phone },
    request: { title: 'Manual Call', status: 'CLOSED', resolution: params.resolution },
    metadata: { organization: params.organizationName, closedAt: new Date().toISOString() },
    consent: { automatedCallAllowed: true, consentReference: 'MANUAL_CALL' },
  };

  // Create a lightweight event for the manual call
  const { v4: uuid } = await import('uuid');
  const eventId = uuid();

  return initiateCall(eventId, payload);
}
