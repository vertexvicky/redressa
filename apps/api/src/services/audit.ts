import type { AppDb } from "../db/client.js";
import { auditLog } from "../db/schema.js";

export interface AuditEntryInput {
  actorType: "citizen" | "officer" | "reviewer" | "admin" | "agent" | "system" | "judge";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export function buildAuditInsert(db: AppDb, entry: AuditEntryInput) {
  const now = Date.now();
  return db.insert(auditLog).values({
    id: crypto.randomUUID(),
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt: now,
    updatedAt: now
  });
}

export async function writeAuditLog(db: AppDb, entry: AuditEntryInput): Promise<void> {
  await buildAuditInsert(db, entry);
}
