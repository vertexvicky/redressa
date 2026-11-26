import { desc, eq } from "drizzle-orm";
import { ReviewDecideSchema } from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, requireRole, type AppVariables } from "../auth/guard.js";
import {
  agentRuns,
  appealItems,
  evidence,
  integritySignals,
  tickets,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { writeAuditLog } from "../services/audit.js";
import { triggerAiCallNonBlocking } from "../services/aiCallEngine.js";
import { transition } from "../services/transition.js";

export const reviewRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

reviewRoutes.use("*", requireRole("reviewer", "admin", "judge"));

reviewRoutes.get("/appeals", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");

  const allAppeals = await db.select().from(appealItems).orderBy(desc(appealItems.createdAt));
  const enriched = [];

  for (const appeal of allAppeals) {
    const [vCase] = await db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, appeal.verificationCaseId))
      .limit(1);
    if (!vCase) continue;
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, vCase.ticketId))
      .limit(1);
    if (!ticket) continue;

    if (user.isDemo && user.demoSessionId) {
      if (ticket.demoSessionId !== user.demoSessionId) continue;
    } else if (ticket.isDemo === 1) {
      continue;
    }

    enriched.push({
      appeal,
      verificationCase: vCase,
      ticket
    });
  }

  return c.json({ appeals: enriched });
});

reviewRoutes.get("/agent-actions", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");

  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(50);
  const filtered = [];
  for (const run of runs) {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, run.ticketId))
      .limit(1);
    if (!ticket) continue;
    if (user.isDemo && user.demoSessionId) {
      if (ticket.demoSessionId !== user.demoSessionId) continue;
    } else if (ticket.isDemo === 1) {
      continue;
    }
    filtered.push({
      ...run,
      ticketTitle: ticket.title,
      ticketStatus: ticket.status
    });
  }

  return c.json({ actions: filtered });
});

reviewRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");

  const [appeal] = await db.select().from(appealItems).where(eq(appealItems.id, id)).limit(1);
  if (!appeal) return jsonError(c, 404, "NOT_FOUND", "Appeal record not found");

  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, appeal.verificationCaseId))
    .limit(1);
  if (!vCase) return jsonError(c, 404, "NOT_FOUND", "Verification case not found");

  const [ticket, signals, evList] = await Promise.all([
    db.select().from(tickets).where(eq(tickets.id, vCase.ticketId)).limit(1),
    db
      .select()
      .from(integritySignals)
      .where(eq(integritySignals.verificationCaseId, vCase.id)),
    db.select().from(evidence).where(eq(evidence.ticketId, vCase.ticketId))
  ]);

  return c.json({
    appeal,
    verificationCase: vCase,
    ticket: ticket[0] ?? null,
    signals,
    evidence: evList
  });
});

reviewRoutes.post("/:id/decide", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = ReviewDecideSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid reviewer decision", parsed.error.flatten());
  }

  const [appeal] = await db.select().from(appealItems).where(eq(appealItems.id, id)).limit(1);
  if (!appeal) return jsonError(c, 404, "NOT_FOUND", "Appeal record not found");

  const now = Date.now();
  await db
    .update(appealItems)
    .set({
      status: parsed.data.status,
      reviewerId: user.id,
      correctedVerdict: parsed.data.corrected_verdict ?? null,
      decisionNote: parsed.data.decision_note,
      decidedAt: now,
      updatedAt: now
    })
    .where(eq(appealItems.id, id));

  await db
    .update(verificationCases)
    .set({
      appealStatus: parsed.data.status,
      ...(parsed.data.status === "corrected" && parsed.data.corrected_verdict
        ? { verdict: parsed.data.corrected_verdict }
        : {}),
      updatedAt: now
    })
    .where(eq(verificationCases.id, appeal.verificationCaseId));

  if (parsed.data.status === "corrected" && parsed.data.corrected_verdict) {
    const [vCase] = await db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, appeal.verificationCaseId))
      .limit(1);
    if (vCase) {
      const [ticket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, vCase.ticketId))
        .limit(1);
      if (ticket && parsed.data.corrected_verdict === "verified_resolved") {
        if (ticket.status === "reopened") {
          await transition(
            db,
            ticket.id,
            "in_progress",
            { type: "reviewer", id: user.id },
            "Reviewer correction transition"
          );
          await transition(
            db,
            ticket.id,
            "closure_claimed",
            { type: "reviewer", id: user.id },
            "Reviewer correction closure"
          );
          await transition(
            db,
            ticket.id,
            "under_verification",
            { type: "reviewer", id: user.id },
            "Reviewer correction evaluation"
          );
          const result = await transition(
            db,
            ticket.id,
            "verified_resolved",
            { type: "reviewer", id: user.id },
            `Reviewer corrected verdict: ${parsed.data.decision_note}`,
            { closedAt: now }
          );
          if (result.previousStatus !== "verified_resolved" && result.previousStatus !== "closed_final") {
            let waitUntil: ((p: Promise<unknown>) => void) | undefined;
            try {
              waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
            } catch {
              waitUntil = undefined;
            }
            triggerAiCallNonBlocking(
              db,
              c.env,
              { ticketId: ticket.id, closedAt: now, closedBy: user.id },
              waitUntil
            );
          }
        }
      }
    }
  }

  await writeAuditLog(db, {
    actorType: "reviewer",
    actorId: user.id,
    action: `appeal_${parsed.data.status}`,
    entityType: "appeal_item",
    entityId: id,
    diff: {
      correctedVerdict: parsed.data.corrected_verdict ?? null,
      decisionNote: parsed.data.decision_note
    }
  });

  return c.json({ ok: true });
});
