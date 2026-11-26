import { v4 as uuid } from 'uuid';
import { EventRecord, EventStatus, EventType } from '@ai-call-engine/shared';
import { getDb } from '../index';

interface EventRow {
  id: string;
  request_id: string;
  event_type: string;
  status: string;
  payload: string;
  call_id: string | null;
  failure_reason: string | null;
  idempotency_key: string;
  created_at: string;
  processed_at: string | null;
}

function rowToRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    eventType: row.event_type as EventType,
    status: row.status as EventStatus,
    payload: JSON.parse(row.payload),
    callId: row.call_id ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    processedAt: row.processed_at ?? undefined,
  };
}

export function createEvent(data: {
  requestId: string;
  eventType: EventType;
  status: EventStatus;
  payload: object;
  idempotencyKey: string;
}): EventRecord {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO events (id, request_id, event_type, status, payload, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.requestId, data.eventType, data.status, JSON.stringify(data.payload), data.idempotencyKey, now);

  return getEventById(id)!;
}

export function getEventById(id: string): EventRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getEventByRequestId(requestId: string): EventRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE request_id = ? ORDER BY created_at DESC LIMIT 1').get(requestId) as EventRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getEventByIdempotencyKey(key: string): EventRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE idempotency_key = ?').get(key) as EventRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateEventStatus(
  id: string,
  status: EventStatus,
  extras?: { callId?: string; failureReason?: string; processedAt?: string },
): void {
  const db = getDb();
  const sets: string[] = ['status = ?'];
  const params: unknown[] = [status];

  if (extras?.callId) { sets.push('call_id = ?'); params.push(extras.callId); }
  if (extras?.failureReason) { sets.push('failure_reason = ?'); params.push(extras.failureReason); }
  if (extras?.processedAt) { sets.push('processed_at = ?'); params.push(extras.processedAt); }

  params.push(id);
  db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function listEvents(filters?: { status?: string; limit?: number; offset?: number }): EventRecord[] {
  const db = getDb();
  let sql = 'SELECT * FROM events';
  const params: unknown[] = [];

  if (filters?.status) { sql += ' WHERE status = ?'; params.push(filters.status); }
  sql += ' ORDER BY created_at DESC';
  if (filters?.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  if (filters?.offset) { sql += ' OFFSET ?'; params.push(filters.offset); }

  const rows = db.prepare(sql).all(...params) as EventRow[];
  return rows.map(rowToRecord);
}
