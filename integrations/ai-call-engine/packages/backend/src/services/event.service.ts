import {
  RequestClosedEvent, EventType, EventStatus, EventResponse,
} from '@ai-call-engine/shared';
import { requestClosedEventSchema } from '@ai-call-engine/shared';
import { logger } from '../config/logger';
import * as eventRepo from '../database/repositories/event.repository';
import { validateConsent, isPhoneSuppressed } from './consent.service';
import { validatePhoneForCalling, maskPhoneNumber } from './phone.service';
import { checkDuplicate, generateIdempotencyKey } from './deduplication.service';
import { callQueue } from '../queue';

export function processRequestClosedEvent(payload: RequestClosedEvent): EventResponse {
  const log = logger.child({ requestId: payload.requestId });

  // 1. Validate payload (already done by middleware, but double-check event type)
  if (payload.event !== EventType.REQUEST_CLOSED) {
    throw Object.assign(new Error('Event type must be REQUEST_CLOSED'), { statusCode: 400, code: 'INVALID_EVENT_TYPE' });
  }

  if (payload.request.status !== 'CLOSED') {
    throw Object.assign(new Error('Request status must be CLOSED'), { statusCode: 400, code: 'INVALID_REQUEST_STATUS' });
  }

  // 2. Verify consent
  const consentResult = validateConsent(payload.consent);
  if (!consentResult.valid) {
    throw Object.assign(new Error(consentResult.error!), { statusCode: 400, code: 'CONSENT_INVALID' });
  }

  // 3. Check phone suppression
  if (isPhoneSuppressed(payload.customer.phone)) {
    throw Object.assign(new Error('Customer phone is on the suppression list'), { statusCode: 403, code: 'PHONE_SUPPRESSED' });
  }

  // 4. Validate phone
  const phoneResult = validatePhoneForCalling(payload.customer.phone);
  if (!phoneResult.valid) {
    throw Object.assign(new Error(phoneResult.error!), { statusCode: 400, code: 'INVALID_PHONE' });
  }
  if (phoneResult.warnings) {
    phoneResult.warnings.forEach(w => log.warn(w));
  }

  // 5. Check for duplicate events
  const dupCheck = checkDuplicate(payload.requestId, payload.event);
  if (dupCheck.isDuplicate) {
    log.warn({ existingEventId: dupCheck.existingEventId }, 'Duplicate event detected');
    throw Object.assign(new Error('Duplicate event — this request closure has already been processed'), {
      statusCode: 409,
      code: 'DUPLICATE_EVENT',
    });
  }

  // 6. Create event record
  const idempotencyKey = generateIdempotencyKey(payload.requestId, payload.event);
  const event = eventRepo.createEvent({
    requestId: payload.requestId,
    eventType: EventType.REQUEST_CLOSED,
    status: EventStatus.VALIDATED,
    payload,
    idempotencyKey,
  });

  log.info({ eventId: event.id, maskedPhone: maskPhoneNumber(payload.customer.phone) }, 'Event created');

  // 7. Add calling task to queue
  callQueue.add({
    type: 'OUTBOUND_CALL',
    data: { eventId: event.id, payload },
    maxAttempts: 3,
  });

  eventRepo.updateEventStatus(event.id, EventStatus.QUEUED);
  log.info({ eventId: event.id }, 'Call job enqueued');

  return {
    eventId: event.id,
    requestId: payload.requestId,
    status: EventStatus.QUEUED,
    message: 'Event received and queued for processing. The AI call will be initiated automatically.',
  };
}

export function getEventStatus(eventId: string) {
  return eventRepo.getEventById(eventId);
}
