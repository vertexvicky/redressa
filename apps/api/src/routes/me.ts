import { eq } from "drizzle-orm";
import { ConsentUpdateSchema, ProfilePatchSchema } from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import { consents, tickets, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { writeAuditLog } from "../services/audit.js";
import { getUserConsents, upsertUserConsents } from "../services/consent.js";
import { decryptText, encryptText, sha256Hex } from "../services/crypto.js";

export const meRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

meRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const userConsents = await getUserConsents(db, user.id);

  let maskedPhone: string | null = null;
  if (dbUser?.phoneEnc && c.env.ENCRYPTION_KEY) {
    try {
      const plain = await decryptText(dbUser.phoneEnc, c.env.ENCRYPTION_KEY);
      maskedPhone = plain.length > 4 ? `••••${plain.slice(-4)}` : "••••";
    } catch {
      maskedPhone = "••••";
    }
  }

  return c.json({
    id: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    name: user.name,
    role: user.role,
    baseRole: user.baseRole,
    language: user.language,
    isDemo: user.isDemo,
    demoSessionId: user.demoSessionId,
    officerId: user.officerId,
    departmentId: user.departmentId,
    hasSafeWord: Boolean(dbUser?.safeWordHash),
    maskedPhone,
    consents: userConsents
  });
});

meRoutes.patch("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = await c.req.json();
  const parsed = ProfilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid profile update", parsed.error.flatten());
  }

  const now = Date.now();
  const updates: Partial<typeof users.$inferInsert> = { updatedAt: now };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.language !== undefined) updates.language = parsed.data.language;

  if (parsed.data.phone !== undefined) {
    if (parsed.data.phone === null) {
      updates.phoneEnc = null;
    } else if (c.env.ENCRYPTION_KEY) {
      updates.phoneEnc = await encryptText(parsed.data.phone, c.env.ENCRYPTION_KEY);
    } else {
      updates.phoneEnc = await encryptText(
        parsed.data.phone,
        btoa("redressa-local-dev-key-32-bytes!!")
      );
    }
  }

  if (parsed.data.safe_word !== undefined) {
    updates.safeWordHash =
      parsed.data.safe_word === null ? null : await sha256Hex(parsed.data.safe_word.trim().toLowerCase());
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  await writeAuditLog(db, {
    actorType: user.isDemo ? "judge" : "citizen",
    actorId: user.id,
    action: "profile_updated",
    entityType: "user",
    entityId: user.id
  });

  return c.json({ ok: true });
});

meRoutes.get("/consents", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const items = await getUserConsents(db, user.id);
  return c.json({ consents: items });
});

meRoutes.put("/consents", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = await c.req.json();
  const parsed = ConsentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid consent payload", parsed.error.flatten());
  }

  const updated = await upsertUserConsents(
    db,
    user.id,
    parsed.data.consents,
    user.isDemo ? "judge" : "citizen"
  );
  return c.json({ consents: updated });
});

meRoutes.get("/export", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const userConsents = await db.select().from(consents).where(eq(consents.userId, user.id));
  const userTickets = await db.select().from(tickets).where(eq(tickets.citizenId, user.id));

  return c.json({
    exportedAt: new Date().toISOString(),
    user: {
      id: dbUser?.id,
      email: dbUser?.email,
      name: dbUser?.name,
      role: dbUser?.role,
      language: dbUser?.language,
      createdAt: dbUser?.createdAt
    },
    consents: userConsents,
    tickets: userTickets
  });
});

meRoutes.delete("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const now = Date.now();
  await db
    .update(users)
    .set({
      deletedAt: now,
      email: null,
      phoneEnc: null,
      safeWordHash: null,
      name: "Deleted User",
      updatedAt: now
    })
    .where(eq(users.id, user.id));

  await writeAuditLog(db, {
    actorType: user.isDemo ? "judge" : "citizen",
    actorId: user.id,
    action: "user_deleted_dpdp",
    entityType: "user",
    entityId: user.id
  });

  return c.json({ deleted: true });
});
