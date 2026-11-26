import { eq } from "drizzle-orm";
import { ALLOWED_TICKET_TRANSITIONS, type TicketStatus } from "@redressa/shared";
import type { AppDb } from "../db/client.js";
import { ticketEvents, tickets } from "../db/schema.js";
import { buildAuditInsert } from "./audit.js";

export class TransitionError extends Error {
  constructor(
    public readonly currentStatus: TicketStatus,
    public readonly targetStatus: TicketStatus
  ) {
    super(`Illegal ticket transition from ${currentStatus} to ${targetStatus}`);
    this.name = "TransitionError";
  }
}

export interface TransitionActor {
  type: "citizen" | "officer" | "reviewer" | "admin" | "agent" | "system" | "judge";
  id: string | null;
}

export async function transition(
  db: AppDb,
  ticketId: string,
  newStatus: TicketStatus,
  actor: TransitionActor,
  reason: string,
  extraFields?: {
    filedAt?: number;
    closedAt?: number | null;
    departmentId?: string | null;
    escalationLevel?: number;
  }
): Promise<{ previousStatus: TicketStatus; newStatus: TicketStatus }> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  const currentStatus = ticket.status as TicketStatus;
  if (currentStatus === newStatus) {
    return { previousStatus: currentStatus, newStatus };
  }

  const allowed = ALLOWED_TICKET_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new TransitionError(currentStatus, newStatus);
  }

  const now = Date.now();
  const updateTicketQuery = db
    .update(tickets)
    .set({
      status: newStatus,
      updatedAt: now,
      ...(extraFields?.filedAt !== undefined ? { filedAt: extraFields.filedAt } : {}),
      ...(extraFields?.closedAt !== undefined ? { closedAt: extraFields.closedAt } : {}),
      ...(extraFields?.departmentId !== undefined
        ? { departmentId: extraFields.departmentId }
        : {}),
      ...(extraFields?.escalationLevel !== undefined
        ? { escalationLevel: extraFields.escalationLevel }
        : {})
    })
    .where(eq(tickets.id, ticketId));

  const insertEventQuery = db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId,
    actorType: actor.type,
    actorId: actor.id,
    eventType: "status_changed",
    payload: {
      from: currentStatus,
      to: newStatus,
      reason
    },
    occurredAt: now,
    createdAt: now,
    updatedAt: now
  });

  const insertAuditQuery = buildAuditInsert(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: "ticket_status_transition",
    entityType: "ticket",
    entityId: ticketId,
    diff: { from: currentStatus, to: newStatus, reason }
  });

  await db.batch([updateTicketQuery, insertEventQuery, insertAuditQuery]);
  return { previousStatus: currentStatus, newStatus };
}
