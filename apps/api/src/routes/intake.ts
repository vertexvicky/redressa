import { desc, eq } from "drizzle-orm";
import {
  ContractUpdateSchema,
  IntakeMessageSchema,
  IntakeSubmitSchema
} from "@redressa/shared";
import { Hono } from "hono";
import { jsonError, requireRole, type AppVariables } from "../auth/guard.js";
import {
  contractCriteria,
  conversations,
  expectationContracts,
  messages,
  responseRequirements,
  tickets
} from "../db/schema.js";
import type { Env } from "../env.js";
import { toolCreateExpectationContract } from "../agent/tools/contract.js";
import { runIntakeAudit } from "../agent/orchestrator.js";
import { writeAuditLog } from "../services/audit.js";
import { transition } from "../services/transition.js";

export const intakeRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

intakeRoutes.use("*", requireRole("citizen", "judge", "admin"));

intakeRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const body = await c.req.json();
  const parsed = IntakeSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid intake submission", parsed.error.flatten());
  }

  const now = Date.now();
  const ticketId = crypto.randomUUID();

  await db.insert(tickets).values({
    id: ticketId,
    citizenId: user.id,
    departmentId: parsed.data.department_id ?? null,
    title: parsed.data.title,
    description: parsed.data.question,
    category: parsed.data.category,
    locationText: parsed.data.location_text ?? null,
    lat: parsed.data.lat ?? null,
    lng: parsed.data.lng ?? null,
    severity: parsed.data.severity,
    status: "intake_audit",
    language: parsed.data.language,
    originalQuestion: parsed.data.question,
    isDemo: user.role === "judge" || user.isDemo ? 1 : 0,
    demoSessionId: user.demoSessionId,
    createdAt: now,
    updatedAt: now
  });

  const auditResult = await runIntakeAudit(db, c.env, ticketId, user.id);

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);

  const [criteria, reqs] = contract
    ? await Promise.all([
        db
          .select()
          .from(contractCriteria)
          .where(eq(contractCriteria.contractId, contract.id))
          .orderBy(contractCriteria.position),
        db
          .select()
          .from(responseRequirements)
          .where(eq(responseRequirements.contractId, contract.id))
          .orderBy(responseRequirements.position)
      ])
    : [[], []];

  return c.json(
    {
      ticket,
      intakeStatus: auditResult.status ?? "contract_ready",
      contract: contract ? { ...contract, criteria, responseRequirements: reqs } : null,
      messages: []
    },
    201
  );
});

intakeRoutes.post("/:ticketId/messages", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const ticketId = c.req.param("ticketId");
  const body = await c.req.json();
  const parsed = IntakeMessageSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid message", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  let [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.ticketId, ticketId))
    .limit(1);
  const now = Date.now();
  if (!conv) {
    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId,
      kind: "intake",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
  }

  if (conv) {
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      sender: "citizen",
      text: parsed.data.text,
      language: parsed.data.language,
      createdAt: now,
      updatedAt: now
    });
  }

  await db
    .update(tickets)
    .set({
      description: `${ticket.description}\nClarification: ${parsed.data.text}`,
      updatedAt: now
    })
    .where(eq(tickets.id, ticketId));

  if (c.env.AGENT_EVENTS) {
    await c.env.AGENT_EVENTS.send({
      eventId: crypto.randomUUID(),
      eventType: "ticket_submitted",
      ticketId,
      actorId: user.id
    });
  }

  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);
  const convMsgs = conv
    ? await db.select().from(messages).where(eq(messages.conversationId, conv.id))
    : [];

  return c.json({
    intakeStatus: "processing",
    contract: contract ?? null,
    messages: convMsgs
  });
});

intakeRoutes.post("/:ticketId/contract/confirm", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const ticketId = c.req.param("ticketId");

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);
  if (!contract) {
    return jsonError(c, 404, "NO_CONTRACT", "Expectation Contract not generated yet");
  }

  const now = Date.now();
  await db
    .update(expectationContracts)
    .set({ confirmedByCitizen: 1, confirmedAt: now, updatedAt: now })
    .where(eq(expectationContracts.id, contract.id));

  if (ticket.status === "awaiting_citizen_confirmation" || ticket.status === "intake_audit") {
    await transition(
      db,
      ticketId,
      "filed",
      { type: "citizen", id: user.id },
      "Citizen confirmed Expectation Contract",
      { filedAt: now }
    );
    if (ticket.departmentId) {
      await transition(
        db,
        ticketId,
        "assigned",
        { type: "system", id: null },
        "Ticket assigned to owning department"
      );
    }
  }

  await writeAuditLog(db, {
    actorType: "citizen",
    actorId: user.id,
    action: "contract_confirmed",
    entityType: "expectation_contract",
    entityId: contract.id
  });

  const [updatedTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  return c.json({ ok: true, ticket: updatedTicket });
});

intakeRoutes.patch("/:ticketId/contract", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const ticketId = c.req.param("ticketId");
  const body = await c.req.json();
  const parsed = ContractUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid contract update", parsed.error.flatten());
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  const [current] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);
  if (!current) return jsonError(c, 404, "NOT_FOUND", "Contract not found");

  const [oldCriteria, oldReqs] = await Promise.all([
    db.select().from(contractCriteria).where(eq(contractCriteria.contractId, current.id)),
    db.select().from(responseRequirements).where(eq(responseRequirements.contractId, current.id))
  ]);

  const created = await toolCreateExpectationContract(db, ticketId, {
    core_question: current.coreQuestion,
    user_intent: parsed.data.user_intent ?? current.userIntent,
    desired_outcome: parsed.data.desired_outcome ?? current.desiredOutcome,
    jurisdiction_note: current.jurisdictionNote,
    urgency: (ticket.severity as "low" | "medium" | "high" | "urgent") ?? "medium",
    criteria:
      parsed.data.criteria ??
      oldCriteria.map((cr) => ({
        text: cr.text,
        verification_method: cr.verificationMethod as
          | "photo"
          | "bus_number_time"
          | "document"
          | "third_party_confirmation"
          | "officer_statement",
        critical: cr.critical === 1
      })),
    response_requirements:
      parsed.data.response_requirements ??
      oldReqs.map((rq) => ({
        label: rq.label,
        description: rq.description,
        evidence_required: rq.evidenceRequired === 1
      }))
  });

  return c.json({ ok: true, contract: created });
});
