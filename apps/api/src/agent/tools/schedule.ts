import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.js";
import { scheduledActions, tickets, verificationCases } from "../../db/schema.js";
import type { Env } from "../../env.js";
import { writeAuditLog } from "../../services/audit.js";

const MAX_FOLLOWUPS_PER_CASE = 3;

export function clampToIstContactWindow(
  targetMs: number,
  windowStart = "09:00",
  windowEnd = "20:00"
): number {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(targetMs + istOffsetMs);
  const [startH = 9, startM = 0] = windowStart.split(":").map(Number);
  const [endH = 20, endM = 0] = windowEnd.split(":").map(Number);

  const minutes = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (minutes >= startMinutes && minutes <= endMinutes) {
    return targetMs;
  }

  const adjusted = new Date(istDate.getTime());
  if (minutes > endMinutes) {
    adjusted.setUTCDate(adjusted.getUTCDate() + 1);
  }
  adjusted.setUTCHours(startH, startM, 0, 0);
  return adjusted.getTime() - istOffsetMs;
}

export async function toolScheduleFollowup(
  db: AppDb,
  env: Env,
  caseId: string,
  delayHours: number,
  reason: string
) {
  const [vCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.id, caseId))
    .limit(1);

  if (!vCase) {
    return { scheduled: false, error: "Verification case not found" };
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, vCase.ticketId))
    .limit(1);

  if (!ticket) {
    return { scheduled: false, error: "Ticket not found" };
  }

  if (ticket.optOut === 1) {
    return { scheduled: false, reason: "Citizen opted out of unsolicited follow-ups" };
  }

  if (ticket.followupCount >= MAX_FOLLOWUPS_PER_CASE) {
    return { scheduled: false, reason: "Maximum 3 follow-ups reached for this case" };
  }

  const rawRunAt = Date.now() + Math.max(0.1, delayHours) * 60 * 60 * 1000;
  const runAt = clampToIstContactWindow(
    rawRunAt,
    env.CONTACT_WINDOW_START,
    env.CONTACT_WINDOW_END
  );

  const actionId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(scheduledActions).values({
    id: actionId,
    ticketId: ticket.id,
    verificationCaseId: caseId,
    actionType: "followup",
    runAt,
    status: "pending",
    payload: { reason },
    attempts: 0,
    createdAt: now,
    updatedAt: now
  });

  await db
    .update(tickets)
    .set({ followupCount: ticket.followupCount + 1, updatedAt: now })
    .where(eq(tickets.id, ticket.id));

  await writeAuditLog(db, {
    actorType: "agent",
    actorId: null,
    action: "schedule_followup",
    entityType: "scheduled_action",
    entityId: actionId,
    diff: { ticketId: ticket.id, runAt, reason }
  });

  return { scheduled: true, actionId, runAt };
}
