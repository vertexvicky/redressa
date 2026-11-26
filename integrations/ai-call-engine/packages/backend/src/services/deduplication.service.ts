import crypto from 'crypto';
import * as eventRepo from '../database/repositories/event.repository';

/** Generate a deterministic idempotency key from request ID and event type */
export function generateIdempotencyKey(requestId: string, eventType: string): string {
  return crypto.createHash('sha256').update(`${requestId}:${eventType}`).digest('hex');
}

/** Check if an event is a duplicate based on the idempotency key */
export function checkDuplicate(requestId: string, eventType: string): { isDuplicate: boolean; existingEventId?: string } {
  const key = generateIdempotencyKey(requestId, eventType);
  const existing = eventRepo.getEventByIdempotencyKey(key);
  if (existing) {
    return { isDuplicate: true, existingEventId: existing.id };
  }
  return { isDuplicate: false };
}
