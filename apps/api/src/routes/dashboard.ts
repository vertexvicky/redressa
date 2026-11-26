import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppVariables } from "../auth/guard.js";
import { departmentReplies, departments, tickets } from "../db/schema.js";
import type { Env } from "../env.js";

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function loadScopedTicketsAndDepts(
  db: ReturnType<typeof import("../db/client.js").createDb>,
  demoSessionId?: string
) {
  if (demoSessionId) {
    const [deptRows, ticketRows] = await Promise.all([
      db.select().from(departments).where(eq(departments.demoSessionId, demoSessionId)),
      db.select().from(tickets).where(eq(tickets.demoSessionId, demoSessionId))
    ]);
    return { departments: deptRows, tickets: ticketRows };
  }

  const [deptRows, ticketRows] = await Promise.all([
    db.select().from(departments).where(eq(departments.isDemo, 0)),
    db.select().from(tickets).where(eq(tickets.isDemo, 0))
  ]);
  return { departments: deptRows, tickets: ticketRows };
}

function summarizeTickets(ticketRows: Array<typeof tickets.$inferSelect>) {
  const verifiedResolved = ticketRows.filter(
    (t) => t.status === "verified_resolved" || t.status === "closed_final"
  ).length;
  const unverified = ticketRows.filter((t) => t.status === "unverified").length;
  const needsReview = ticketRows.filter((t) => t.status === "needs_review").length;
  const reopened = ticketRows.filter(
    (t) => t.status === "reopened" || t.status === "not_resolved"
  ).length;
  const claimedResolved = verifiedResolved + unverified + needsReview + reopened;

  const closedWithDates = ticketRows.filter((t) => t.filedAt && t.closedAt);
  const avgDaysToVerified =
    closedWithDates.length > 0
      ? Number(
          (
            closedWithDates.reduce(
              (acc, t) => acc + (t.closedAt! - t.filedAt!) / (1000 * 60 * 60 * 24),
              0
            ) / closedWithDates.length
          ).toFixed(2)
        )
      : 0;

  return {
    totalTickets: ticketRows.length,
    claimedResolved,
    verifiedResolved,
    unverified,
    disputed: needsReview,
    reopened,
    integrityRate:
      claimedResolved > 0 ? Math.round((verifiedResolved / claimedResolved) * 100) : 100,
    reopenedRate: claimedResolved > 0 ? Math.round((reopened / claimedResolved) * 100) : 0,
    avgDaysToVerified
  };
}

dashboardRoutes.get("/overview", async (c) => {
  const db = c.get("db");
  const demoSessionId = c.req.query("demo_session_id");
  const { tickets: ticketRows, departments: deptRows } = await loadScopedTicketsAndDepts(
    db,
    demoSessionId
  );

  const summary = summarizeTickets(ticketRows);
  let totalReplies = 0;
  let returnedReplies = 0;
  for (const t of ticketRows) {
    const rps = await db
      .select()
      .from(departmentReplies)
      .where(eq(departmentReplies.ticketId, t.id));
    totalReplies += rps.length;
    returnedReplies += rps.filter((r) => r.returned === 1).length;
  }

  return c.json({
    ...summary,
    departmentCount: deptRows.length,
    totalReplies,
    repliesReturned: returnedReplies,
    replyComplianceRate:
      totalReplies > 0 ? Math.round(((totalReplies - returnedReplies) / totalReplies) * 100) : 100
  });
});

dashboardRoutes.get("/departments", async (c) => {
  const db = c.get("db");
  const demoSessionId = c.req.query("demo_session_id");
  const { tickets: ticketRows, departments: deptRows } = await loadScopedTicketsAndDepts(
    db,
    demoSessionId
  );

  const rows = [];
  for (const dept of deptRows) {
    const deptTickets = ticketRows.filter((t) => t.departmentId === dept.id);
    const summary = summarizeTickets(deptTickets);

    let totalReplies = 0;
    let returnedReplies = 0;
    for (const t of deptTickets) {
      const rps = await db
        .select()
        .from(departmentReplies)
        .where(eq(departmentReplies.ticketId, t.id));
      totalReplies += rps.length;
      returnedReplies += rps.filter((r) => r.returned === 1).length;
    }

    rows.push({
      id: dept.id,
      name: dept.name,
      region: dept.region,
      ...summary,
      totalReplies,
      repliesReturned: returnedReplies,
      replyComplianceRate:
        totalReplies > 0 ? Math.round(((totalReplies - returnedReplies) / totalReplies) * 100) : 100
    });
  }

  return c.json({ departments: rows });
});

dashboardRoutes.get("/claimed-vs-verified", async (c) => {
  const db = c.get("db");
  const demoSessionId = c.req.query("demo_session_id");
  const { tickets: ticketRows, departments: deptRows } = await loadScopedTicketsAndDepts(
    db,
    demoSessionId
  );

  const series = deptRows.map((dept) => {
    const deptTickets = ticketRows.filter((t) => t.departmentId === dept.id);
    const s = summarizeTickets(deptTickets);
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      region: dept.region,
      claimedResolved: s.claimedResolved,
      verifiedResolved: s.verifiedResolved,
      disputedOrReopened: s.disputed + s.reopened + s.unverified
    };
  });

  return c.json({ series });
});

dashboardRoutes.get("/reply-compliance", async (c) => {
  const db = c.get("db");
  const demoSessionId = c.req.query("demo_session_id");
  const { tickets: ticketRows, departments: deptRows } = await loadScopedTicketsAndDepts(
    db,
    demoSessionId
  );

  const items = [];
  for (const dept of deptRows) {
    const deptTickets = ticketRows.filter((t) => t.departmentId === dept.id);
    let total = 0;
    let returned = 0;
    for (const t of deptTickets) {
      const rps = await db
        .select()
        .from(departmentReplies)
        .where(and(eq(departmentReplies.ticketId, t.id)));
      total += rps.length;
      returned += rps.filter((r) => r.returned === 1).length;
    }
    items.push({
      departmentId: dept.id,
      departmentName: dept.name,
      totalReplies: total,
      returnedReplies: returned,
      complianceRate: total > 0 ? Math.round(((total - returned) / total) * 100) : 100
    });
  }

  return c.json({ items });
});

dashboardRoutes.get("/map", async (c) => {
  const db = c.get("db");
  const demoSessionId = c.req.query("demo_session_id");
  const { tickets: ticketRows } = await loadScopedTicketsAndDepts(db, demoSessionId);

  const points = ticketRows
    .filter((t) => t.lat !== null && t.lng !== null)
    .map((t) => ({
      ticketId: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      locationText: t.locationText,
      lat: t.lat,
      lng: t.lng
    }));

  return c.json({ points });
});
