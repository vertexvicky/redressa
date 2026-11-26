import { and, eq, lte } from "drizzle-orm";
import { createDb } from "../db/client.js";
import {
  demoSessions,
  departmentReplies,
  departmentStatsDaily,
  departments,
  scheduledActions,
  tickets,
  users,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { writeAuditLog } from "../services/audit.js";
import { retryPendingAiCallEvents } from "../services/aiCallEngine.js";
import { finalizeDueWithdrawals } from "../services/withdrawal.js";
import { processAgentEvent } from "../agent/orchestrator.js";
import { toolEscalateCase } from "../agent/tools/case.js";
import { clampToIstContactWindow } from "../agent/tools/schedule.js";

function isInsideIstWindow(nowMs: number, startStr: string, endStr: string): boolean {
  const clamped = clampToIstContactWindow(nowMs, startStr, endStr);
  return Math.abs(clamped - nowMs) < 60_000;
}

export async function runFiveMinuteCron(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = Date.now();

  const dueActions = await db
    .select()
    .from(scheduledActions)
    .where(and(eq(scheduledActions.status, "pending"), lte(scheduledActions.runAt, now)))
    .limit(25);

  for (const action of dueActions) {
    try {
      const [ticket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, action.ticketId))
        .limit(1);

      if (!ticket) {
        await db
          .update(scheduledActions)
          .set({ status: "done", updatedAt: now })
          .where(eq(scheduledActions.id, action.id));
        continue;
      }

      if (action.actionType === "followup") {
        if (ticket.optOut === 1) {
          await db
            .update(scheduledActions)
            .set({ status: "done", updatedAt: now })
            .where(eq(scheduledActions.id, action.id));
          continue;
        }
        if (!isInsideIstWindow(now, env.CONTACT_WINDOW_START, env.CONTACT_WINDOW_END)) {
          const nextWindow = clampToIstContactWindow(
            now,
            env.CONTACT_WINDOW_START,
            env.CONTACT_WINDOW_END
          );
          await db
            .update(scheduledActions)
            .set({ runAt: nextWindow, updatedAt: now })
            .where(eq(scheduledActions.id, action.id));
          continue;
        }
        await processAgentEvent(db, env, {
          eventId: `cron-followup-${action.id}-${action.attempts}`,
          eventType: "followup_due",
          ticketId: ticket.id,
          verificationCaseId: action.verificationCaseId ?? undefined
        });
      } else if (action.actionType === "retry_agent") {
        await processAgentEvent(db, env, {
          eventId: `cron-retry-${action.id}-${action.attempts}`,
          eventType: "closure_claimed",
          ticketId: ticket.id,
          verificationCaseId: action.verificationCaseId ?? undefined
        });
      } else if (action.actionType === "escalation" && action.verificationCaseId) {
        await toolEscalateCase(db, action.verificationCaseId, ticket.escalationLevel + 1, [
          "Department silent past deadline; autonomous escalation executed."
        ]);
      }

      await db
        .update(scheduledActions)
        .set({ status: "done", updatedAt: Date.now() })
        .where(eq(scheduledActions.id, action.id));

      await writeAuditLog(db, {
        actorType: "system",
        actorId: null,
        action: `cron_executed_${action.actionType}`,
        entityType: "scheduled_action",
        entityId: action.id
      });
    } catch {
      const nextAttempts = action.attempts + 1;
      await db
        .update(scheduledActions)
        .set({
          attempts: nextAttempts,
          status: nextAttempts >= 3 ? "failed" : "pending",
          runAt: now + 5 * 60 * 1000,
          updatedAt: now
        })
        .where(eq(scheduledActions.id, action.id));
    }
  }

  const silentCutoff = now - 48 * 60 * 60 * 1000;
  const silentCases = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.status, "decided"))
    .limit(30);

  for (const vCase of silentCases) {
    if (
      (vCase.verdict === "needs_review" || vCase.verdict === "unverified") &&
      vCase.decidedAt &&
      vCase.decidedAt < silentCutoff
    ) {
      const [ticket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, vCase.ticketId))
        .limit(1);
      if (ticket && ticket.escalationLevel < 3 && ticket.updatedAt < now - 24 * 60 * 60 * 1000) {
        await toolEscalateCase(db, vCase.id, ticket.escalationLevel + 1, [
          "Department silent for 48h after disputed/unverified closure."
        ]);
      }
    }
  }

  await finalizeDueWithdrawals(db, now);
  await retryPendingAiCallEvents(db, env);
}

export async function runHourlyCron(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const prodDepts = await db.select().from(departments).where(eq(departments.isDemo, 0));
  for (const dept of prodDepts) {
    const deptTickets = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.departmentId, dept.id), eq(tickets.isDemo, 0)));

    const verifiedResolved = deptTickets.filter(
      (t) => t.status === "verified_resolved" || t.status === "closed_final"
    ).length;
    const unverified = deptTickets.filter((t) => t.status === "unverified").length;
    const needsReview = deptTickets.filter((t) => t.status === "needs_review").length;
    const reopened = deptTickets.filter(
      (t) => t.status === "reopened" || t.status === "not_resolved"
    ).length;
    const claimedResolved = verifiedResolved + unverified + needsReview + reopened;

    let repliesReturned = 0;
    for (const t of deptTickets) {
      const rps = await db
        .select()
        .from(departmentReplies)
        .where(and(eq(departmentReplies.ticketId, t.id), eq(departmentReplies.returned, 1)));
      repliesReturned += rps.length;
    }

    const closedTickets = deptTickets.filter((t) => t.filedAt && t.closedAt);
    const avgHoursToClose =
      closedTickets.length > 0
        ? closedTickets.reduce((acc, t) => acc + ((t.closedAt! - t.filedAt!) / 3_600_000), 0) /
          closedTickets.length
        : 0;

    const [existingStat] = await db
      .select()
      .from(departmentStatsDaily)
      .where(
        and(eq(departmentStatsDaily.departmentId, dept.id), eq(departmentStatsDaily.date, today))
      )
      .limit(1);

    if (existingStat) {
      await db
        .update(departmentStatsDaily)
        .set({
          claimedResolved,
          verifiedResolved,
          unverified,
          needsReview,
          reopened,
          repliesReturned,
          avgHoursToClose,
          updatedAt: now
        })
        .where(eq(departmentStatsDaily.id, existingStat.id));
    } else {
      await db.insert(departmentStatsDaily).values({
        id: crypto.randomUUID(),
        departmentId: dept.id,
        date: today,
        claimedResolved,
        verifiedResolved,
        unverified,
        needsReview,
        reopened,
        repliesReturned,
        avgHoursToClose,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  const expiredSessions = await db
    .select()
    .from(demoSessions)
    .where(lte(demoSessions.expiresAt, now));

  for (const session of expiredSessions) {
    await db.delete(tickets).where(eq(tickets.demoSessionId, session.id));
    await db.delete(departments).where(eq(departments.demoSessionId, session.id));
    await db.delete(users).where(eq(users.demoSessionId, session.id));
    await db.delete(demoSessions).where(eq(demoSessions.id, session.id));
    await writeAuditLog(db, {
      actorType: "system",
      actorId: null,
      action: "demo_session_expired_cleanup",
      entityType: "demo_session",
      entityId: session.id
    });
  }
}

export async function handleScheduledCron(controller: ScheduledController, env: Env): Promise<void> {
  if (controller.cron === "0 * * * *") {
    await runHourlyCron(env);
  } else {
    await runFiveMinuteCron(env);
  }
}
