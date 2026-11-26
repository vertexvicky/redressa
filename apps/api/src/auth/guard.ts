import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import type { Role } from "@redressa/shared";
import { createDb, type AppDb } from "../db/client.js";
import { demoSessions, officers, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { verifyFirebaseIdToken } from "./firebase.js";

export interface AuthUser {
  id: string;
  firebaseUid: string;
  email: string | null;
  name: string;
  role: Role;
  baseRole: Role;
  language: "en" | "ta";
  isDemo: boolean;
  demoSessionId: string | null;
  officerId: string | null;
  departmentId: string | null;
}

export interface AppVariables {
  db: AppDb;
  requestId: string;
  user?: AuthUser;
}

export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export function jsonError(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return c.json({ code, message, details }, status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500);
}

export async function resolveAuthFromToken(
  token: string,
  env: Env,
  db: AppDb
): Promise<AuthUser> {
  const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
  const now = Date.now();

  let [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, verified.uid))
    .limit(1);

  if (!dbUser) {
    const newId = crypto.randomUUID();
    const initialRole: Role = verified.isAnonymous ? "judge" : "citizen";
    const initialName =
      verified.name ??
      (verified.email ? verified.email.split("@")[0] ?? "Citizen" : verified.isAnonymous ? "Judge Guest" : "Citizen");

    await db.insert(users).values({
      id: newId,
      firebaseUid: verified.uid,
      email: verified.email,
      name: initialName,
      role: initialRole,
      language: "en",
      isDemo: verified.isAnonymous ? 1 : 0,
      consentVersion: 1,
      createdAt: now,
      updatedAt: now
    });

    [dbUser] = await db.select().from(users).where(eq(users.id, newId)).limit(1);
  }

  if (!dbUser || dbUser.deletedAt !== null) {
    throw new Error("Account unavailable");
  }

  let effectiveRole = dbUser.role as Role;
  let officerId: string | null = null;
  let departmentId: string | null = null;

  if (dbUser.isDemo === 1 && dbUser.demoSessionId) {
    const [session] = await db
      .select()
      .from(demoSessions)
      .where(eq(demoSessions.id, dbUser.demoSessionId))
      .limit(1);

    if (session && session.expiresAt > now) {
      effectiveRole = session.activeRole as Role;
      if (effectiveRole === "officer") {
        officerId = session.officerId;
        departmentId = session.departmentId;
      }
    }
  } else {
    const [officer] = await db
      .select()
      .from(officers)
      .where(eq(officers.userId, dbUser.id))
      .limit(1);
    if (officer) {
      officerId = officer.id;
      departmentId = officer.departmentId;
    }
  }

  return {
    id: dbUser.id,
    firebaseUid: dbUser.firebaseUid,
    email: dbUser.email,
    name: dbUser.name,
    role: effectiveRole,
    baseRole: dbUser.role as Role,
    language: dbUser.language === "ta" ? "ta" : "en",
    isDemo: dbUser.isDemo === 1,
    demoSessionId: dbUser.demoSessionId,
    officerId,
    departmentId
  };
}

export async function authMiddleware(c: AppContext, next: Next) {
  const authHeader = c.req.header("authorization");
  const queryToken = c.req.query("token");
  const rawToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : queryToken?.trim();

  if (!rawToken) {
    return jsonError(c, 401, "UNAUTHORIZED", "Missing Firebase ID token");
  }

  const db = c.get("db") ?? createDb(c.env.DB);
  c.set("db", db);

  try {
    const user = await resolveAuthFromToken(rawToken, c.env, db);
    if (c.env.RATE_LIMITER) {
      const rl = await c.env.RATE_LIMITER.limit({ key: `user:${user.id}` });
      if (!rl.success) {
        return jsonError(c, 429, "RATE_LIMITED", "Too many requests");
      }
    }
    c.set("user", user);
  } catch (err) {
    return jsonError(
      c,
      401,
      "INVALID_TOKEN",
      err instanceof Error ? err.message : "Invalid authentication token"
    );
  }

  await next();
}

export function requireRole(...allowedRoles: Role[]) {
  return async (c: AppContext, next: Next) => {
    const user = c.get("user");
    if (!user) {
      return jsonError(c, 401, "UNAUTHORIZED", "Authentication required");
    }

    if (allowedRoles.includes(user.role)) {
      await next();
      return;
    }

    if (user.isDemo && allowedRoles.includes("judge") && user.baseRole === "judge") {
      await next();
      return;
    }

    return jsonError(c, 403, "FORBIDDEN", "Insufficient role permissions");
  };
}
