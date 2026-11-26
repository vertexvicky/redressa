import { eq } from "drizzle-orm";
import {
  DemoScenarioSchema,
  DemoSwitchRoleSchema,
  DemoTakeoverSchema
} from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import { demoSessions, users } from "../db/schema.js";
import type { Env } from "../env.js";
import {
  executeDemoScenarioStep,
  getDemoState,
  startOrResetDemoSandbox
} from "../services/demo.js";

export const demoRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

demoRoutes.get("/state", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const state = await getDemoState(db, user.id);
  return c.json({ state });
});

demoRoutes.post("/start", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const state = await startOrResetDemoSandbox(db, c.env, user.id);
  return c.json({ ok: true, state }, 201);
});

demoRoutes.post("/reset", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const state = await startOrResetDemoSandbox(db, c.env, user.id);
  return c.json({ ok: true, state });
});

demoRoutes.post("/switch-role", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  if (!user.isDemo || !user.demoSessionId) {
    return jsonError(c, 403, "FORBIDDEN", "Role switching is allowed only inside demo sandboxes");
  }

  const body = await c.req.json();
  const parsed = DemoSwitchRoleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid role", parsed.error.flatten());
  }

  await db
    .update(demoSessions)
    .set({ activeRole: parsed.data.role, updatedAt: Date.now() })
    .where(eq(demoSessions.id, user.demoSessionId));

  const state = await getDemoState(db, user.id);
  return c.json({ ok: true, state });
});

demoRoutes.post("/scenario", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  if (!user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Demo sandbox required");
  }

  const body = await c.req.json();
  const parsed = DemoScenarioSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid scenario", parsed.error.flatten());
  }

  const state = await executeDemoScenarioStep(db, c.env, user.id, parsed.data.scenario);
  return c.json({ ok: true, state });
});

demoRoutes.post("/autoplay", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  if (!user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Demo sandbox required");
  }

  let body: { scenario?: string } = {};
  try {
    body = await c.req.json();
  } catch {
  }
  const parsed = DemoScenarioSchema.safeParse({
    scenario: body.scenario ?? "pressured_withdrawal"
  });
  const scenario = parsed.success ? parsed.data.scenario : "pressured_withdrawal";

  await startOrResetDemoSandbox(db, c.env, user.id);
  const state = await executeDemoScenarioStep(db, c.env, user.id, scenario);
  return c.json({ ok: true, state });
});

demoRoutes.post("/takeover", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  if (!user.isDemo || !user.demoSessionId) {
    return jsonError(c, 403, "FORBIDDEN", "Demo sandbox required");
  }

  const body = await c.req.json();
  const parsed = DemoTakeoverSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid takeover payload", parsed.error.flatten());
  }

  const now = Date.now();
  await db
    .update(demoSessions)
    .set(
      parsed.data.actor === "citizen"
        ? { takeoverCitizen: parsed.data.enabled ? 1 : 0, updatedAt: now }
        : { takeoverOfficer: parsed.data.enabled ? 1 : 0, updatedAt: now }
    )
    .where(eq(demoSessions.id, user.demoSessionId));

  const [owner] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const state = await getDemoState(db, owner?.id ?? user.id);
  return c.json({ ok: true, state });
});
