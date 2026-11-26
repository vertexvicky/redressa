import { desc, eq } from "drizzle-orm";
import {
  AdminDepartmentSchema,
  AdminOfficerSchema,
  AdminUserRoleSchema
} from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, requireRole, type AppVariables } from "../auth/guard.js";
import { auditLog, departments, officers, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { writeAuditLog } from "../services/audit.js";

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminRoutes.use("*", requireRole("admin", "judge"));

adminRoutes.get("/departments", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const rows = user.isDemo && user.demoSessionId
    ? await db.select().from(departments).where(eq(departments.demoSessionId, user.demoSessionId))
    : await db.select().from(departments).where(eq(departments.isDemo, 0));
  return c.json({ departments: rows });
});

adminRoutes.post("/departments", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = await c.req.json();
  const parsed = AdminDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid department", parsed.error.flatten());
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(departments).values({
    id,
    name: parsed.data.name,
    region: parsed.data.region,
    parentDepartmentId: parsed.data.parent_department_id ?? null,
    escalationLevel: parsed.data.escalation_level,
    contactEmail: parsed.data.contact_email,
    isDemo: user.isDemo ? 1 : 0,
    demoSessionId: user.demoSessionId,
    createdAt: now,
    updatedAt: now
  });

  await writeAuditLog(db, {
    actorType: "admin",
    actorId: user.id,
    action: "department_created",
    entityType: "department",
    entityId: id,
    diff: parsed.data
  });

  const [created] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  return c.json({ department: created }, 201);
});

adminRoutes.delete("/departments/:id", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  await db.delete(departments).where(eq(departments.id, id));
  await writeAuditLog(db, {
    actorType: "admin",
    actorId: user.id,
    action: "department_deleted",
    entityType: "department",
    entityId: id
  });
  return c.json({ ok: true });
});

adminRoutes.get("/officers", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(officers).orderBy(desc(officers.createdAt));
  return c.json({ officers: rows });
});

adminRoutes.post("/officers", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = await c.req.json();
  const parsed = AdminOfficerSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid officer", parsed.error.flatten());
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(officers).values({
    id,
    userId: parsed.data.user_id,
    departmentId: parsed.data.department_id,
    designation: parsed.data.designation,
    isNodal: parsed.data.is_nodal ? 1 : 0,
    createdAt: now,
    updatedAt: now
  });

  await db
    .update(users)
    .set({ role: "officer", updatedAt: now })
    .where(eq(users.id, parsed.data.user_id));

  await writeAuditLog(db, {
    actorType: "admin",
    actorId: user.id,
    action: "officer_assigned",
    entityType: "officer",
    entityId: id,
    diff: parsed.data
  });

  return c.json({ ok: true, id }, 201);
});

adminRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(100);
  return c.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      language: u.language,
      isDemo: u.isDemo === 1,
      createdAt: u.createdAt
    }))
  });
});

adminRoutes.patch("/users/:id/role", async (c) => {
  const actor = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = AdminUserRoleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid role", parsed.error.flatten());
  }

  await db
    .update(users)
    .set({ role: parsed.data.role, updatedAt: Date.now() })
    .where(eq(users.id, id));

  await writeAuditLog(db, {
    actorType: "admin",
    actorId: actor.id,
    action: "user_role_updated",
    entityType: "user",
    entityId: id,
    diff: { role: parsed.data.role }
  });

  return c.json({ ok: true });
});

adminRoutes.get("/audit", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(100);
  return c.json({ audit: rows });
});
