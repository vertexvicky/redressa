import { and, eq } from "drizzle-orm";
import { CONSENT_TYPES, type ConsentType } from "@redressa/shared";
import type { AppDb } from "../db/client.js";
import { consents } from "../db/schema.js";
import { writeAuditLog } from "./audit.js";

export interface ConsentStatus {
  type: ConsentType;
  granted: boolean;
  version: number;
  grantedAt: number | null;
  revokedAt: number | null;
}

export async function getUserConsents(db: AppDb, userId: string): Promise<ConsentStatus[]> {
  const rows = await db.select().from(consents).where(eq(consents.userId, userId));
  const map = new Map(rows.map((r) => [r.type as ConsentType, r]));

  return CONSENT_TYPES.map((type) => {
    const existing = map.get(type);
    return {
      type,
      granted: existing ? existing.granted === 1 : type === "chat_storage",
      version: existing?.version ?? 1,
      grantedAt: existing?.grantedAt ?? null,
      revokedAt: existing?.revokedAt ?? null
    };
  });
}

export async function hasConsent(
  db: AppDb,
  userId: string,
  type: ConsentType
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.type, type)))
    .limit(1);

  if (!row) {
    return type === "chat_storage";
  }
  return row.granted === 1;
}

export async function upsertUserConsents(
  db: AppDb,
  userId: string,
  updates: Array<{ type: ConsentType; granted: boolean }>,
  actorType: "citizen" | "judge" | "system" = "citizen"
): Promise<ConsentStatus[]> {
  const now = Date.now();
  for (const item of updates) {
    const [existing] = await db
      .select()
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.type, item.type)))
      .limit(1);

    if (existing) {
      await db
        .update(consents)
        .set({
          granted: item.granted ? 1 : 0,
          grantedAt: item.granted ? now : existing.grantedAt,
          revokedAt: item.granted ? null : now,
          updatedAt: now
        })
        .where(eq(consents.id, existing.id));
    } else {
      await db.insert(consents).values({
        id: crypto.randomUUID(),
        userId,
        type: item.type,
        granted: item.granted ? 1 : 0,
        version: 1,
        grantedAt: item.granted ? now : null,
        revokedAt: item.granted ? null : now,
        createdAt: now,
        updatedAt: now
      });
    }

    await writeAuditLog(db, {
      actorType,
      actorId: userId,
      action: item.granted ? "consent_granted" : "consent_revoked",
      entityType: "consent",
      entityId: `${userId}:${item.type}`,
      diff: { type: item.type, granted: item.granted }
    });
  }

  return getUserConsents(db, userId);
}
