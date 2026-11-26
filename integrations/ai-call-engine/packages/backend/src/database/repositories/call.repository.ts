import { v4 as uuid } from 'uuid';
import { CallRecord, CallStatus, CallOutcome } from '@ai-call-engine/shared';
import { getDb } from '../index';

interface CallRow {
  id: string;
  event_id: string;
  request_id: string;
  masked_phone: string;
  provider_call_id: string | null;
  status: string;
  duration: number | null;
  outcome: string | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: CallRow): CallRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    requestId: row.request_id,
    maskedPhone: row.masked_phone,
    providerCallId: row.provider_call_id ?? undefined,
    status: row.status as CallStatus,
    duration: row.duration ?? undefined,
    outcome: row.outcome as CallOutcome | undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCall(data: {
  eventId: string;
  requestId: string;
  maskedPhone: string;
  status?: CallStatus;
  maxRetries?: number;
}): CallRecord {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const status = data.status ?? CallStatus.RECEIVED;
  const maxRetries = data.maxRetries ?? 3;

  db.prepare(`
    INSERT INTO calls (id, event_id, request_id, masked_phone, status, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, data.eventId, data.requestId, data.maskedPhone, status, maxRetries, now, now);

  return getCallById(id)!;
}

export function getCallById(id: string): CallRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(id) as CallRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getCallByEventId(eventId: string): CallRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM calls WHERE event_id = ?').get(eventId) as CallRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getCallByProviderCallId(providerCallId: string): CallRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM calls WHERE provider_call_id = ?').get(providerCallId) as CallRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateCallStatus(
  id: string,
  status: CallStatus,
  extras?: {
    providerCallId?: string;
    duration?: number;
    outcome?: CallOutcome;
    startedAt?: string;
    endedAt?: string;
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];

  if (extras?.providerCallId) { sets.push('provider_call_id = ?'); params.push(extras.providerCallId); }
  if (extras?.duration !== undefined) { sets.push('duration = ?'); params.push(extras.duration); }
  if (extras?.outcome) { sets.push('outcome = ?'); params.push(extras.outcome); }
  if (extras?.startedAt) { sets.push('started_at = ?'); params.push(extras.startedAt); }
  if (extras?.endedAt) { sets.push('ended_at = ?'); params.push(extras.endedAt); }

  params.push(id);
  db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function incrementRetryCount(id: string): void {
  const db = getDb();
  db.prepare('UPDATE calls SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function listCalls(filters?: { status?: string; requestId?: string; limit?: number; offset?: number }): CallRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters?.requestId) { clauses.push('request_id = ?'); params.push(filters.requestId); }

  let sql = 'SELECT * FROM calls';
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  if (filters?.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  if (filters?.offset) { sql += ' OFFSET ?'; params.push(filters.offset); }

  const rows = db.prepare(sql).all(...params) as CallRow[];
  return rows.map(rowToRecord);
}

export function getActiveCallForRequest(requestId: string): CallRecord | null {
  const db = getDb();
  const activeStatuses = [
    CallStatus.RECEIVED, CallStatus.VALIDATING, CallStatus.QUEUED,
    CallStatus.INITIATING, CallStatus.RINGING, CallStatus.CONNECTED, CallStatus.IN_PROGRESS,
  ];
  const placeholders = activeStatuses.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT * FROM calls WHERE request_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`
  ).get(requestId, ...activeStatuses) as CallRow | undefined;
  return row ? rowToRecord(row) : null;
}
