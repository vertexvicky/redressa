import { eq } from "drizzle-orm";
import type { DemoScenario, Role } from "@redressa/shared";
import type { AppDb } from "../db/client.js";
import {
  contractCriteria,
  conversations,
  demoSessions,
  departmentContacts,
  departmentReplies,
  departments,
  evidence,
  expectationContracts,
  messages,
  officers,
  responseRequirements,
  ticketEvents,
  tickets,
  users,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { callGeminiModel } from "../agent/llm.js";
import { processAgentEvent, runIntakeAudit } from "../agent/orchestrator.js";
import { SIM_CITIZEN_PROMPT, SIM_OFFICER_PROMPT } from "../agent/prompts/catalog.js";
import { writeAuditLog } from "./audit.js";
import { sha256Hex } from "./crypto.js";
import { transition } from "./transition.js";

export const DEMO_GH_QUESTION =
  "Why do express buses skip the designated Government Hospital (GH) stop in our village every morning? We need express buses to stop at the GH stop.";

export async function startOrResetDemoSandbox(
  db: AppDb,
  env: Env,
  ownerUserId: string
) {
  const now = Date.now();
  const ttlHours = Number.parseInt(env.DEMO_SESSION_TTL_HOURS || "24", 10) || 24;
  const expiresAt = now + ttlHours * 60 * 60 * 1000;

  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1);
  if (!owner) throw new Error("User not found");

  if (owner.demoSessionId) {
    const oldSessionId = owner.demoSessionId;
    await db.delete(tickets).where(eq(tickets.demoSessionId, oldSessionId));
    await db.delete(departments).where(eq(departments.demoSessionId, oldSessionId));
    await db.delete(demoSessions).where(eq(demoSessions.id, oldSessionId));
  }

  const demoSessionId = crypto.randomUUID();
  const departmentId = crypto.randomUUID();
  const officerUserId = crypto.randomUUID();
  const officerId = crypto.randomUUID();
  const reviewerUserId = crypto.randomUUID();
  const ticketId = crypto.randomUUID();

  await db
    .update(users)
    .set({
      isDemo: 1,
      demoSessionId,
      updatedAt: now
    })
    .where(eq(users.id, ownerUserId));

  await db.insert(departments).values({
    id: departmentId,
    name: "State Transport Corporation — Division II",
    region: "Salem / GH Corridor",
    escalationLevel: 1,
    contactEmail: "nodal.transport@demo.redressa.local",
    isDemo: 1,
    demoSessionId,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(users).values([
    {
      id: officerUserId,
      firebaseUid: `demo-officer-${demoSessionId}`,
      email: "officer.demo@redressa.local",
      name: "Simulated Nodal Officer",
      role: "officer",
      language: "en",
      isDemo: 1,
      demoSessionId,
      consentVersion: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: reviewerUserId,
      firebaseUid: `demo-reviewer-${demoSessionId}`,
      email: "reviewer.demo@redressa.local",
      name: "Independent Audit Reviewer",
      role: "reviewer",
      language: "en",
      isDemo: 1,
      demoSessionId,
      consentVersion: 1,
      createdAt: now,
      updatedAt: now
    }
  ]);

  await db.insert(officers).values({
    id: officerId,
    userId: officerUserId,
    departmentId,
    designation: "Divisional Traffic Nodal Officer",
    isNodal: 1,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(tickets).values({
    id: ticketId,
    citizenId: ownerUserId,
    departmentId,
    title: "Express buses skipping Government Hospital (GH) stop",
    description: DEMO_GH_QUESTION,
    category: "transport",
    locationText: "Government Hospital Stop, Salem Main Road",
    lat: 11.6643,
    lng: 78.146,
    severity: "high",
    status: "draft",
    language: "en",
    originalQuestion: DEMO_GH_QUESTION,
    isDemo: 1,
    demoSessionId,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(demoSessions).values({
    id: demoSessionId,
    ownerUserId,
    activeRole: "citizen",
    scenario: "pressured_withdrawal",
    takeoverCitizen: 0,
    takeoverOfficer: 0,
    primaryTicketId: ticketId,
    departmentId,
    officerUserId,
    officerId,
    reviewerUserId,
    expiresAt,
    createdAt: now,
    updatedAt: now
  });

  await runIntakeAudit(db, env, ticketId, ownerUserId);

  await writeAuditLog(db, {
    actorType: "judge",
    actorId: ownerUserId,
    action: "demo_sandbox_started",
    entityType: "demo_session",
    entityId: demoSessionId,
    diff: { ticketId, departmentId }
  });

  return getDemoState(db, ownerUserId);
}

export async function getDemoState(db: AppDb, ownerUserId: string) {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1);
  if (!owner?.demoSessionId) {
    return null;
  }

  const [session] = await db
    .select()
    .from(demoSessions)
    .where(eq(demoSessions.id, owner.demoSessionId))
    .limit(1);

  if (!session) return null;

  const sessionTickets = await db
    .select()
    .from(tickets)
    .where(eq(tickets.demoSessionId, session.id));

  const primaryTicket =
    sessionTickets.find((t) => t.id === session.primaryTicketId) ?? sessionTickets[0] ?? null;

  return {
    sessionId: session.id,
    activeRole: session.activeRole as Role,
    scenario: session.scenario as DemoScenario,
    takeoverCitizen: session.takeoverCitizen === 1,
    takeoverOfficer: session.takeoverOfficer === 1,
    primaryTicketId: primaryTicket?.id ?? null,
    primaryTicketStatus: primaryTicket?.status ?? null,
    departmentId: session.departmentId,
    expiresAt: session.expiresAt
  };
}

async function generateSimulatedLine(
  db: AppDb,
  env: Env,
  userId: string,
  actor: "citizen" | "officer",
  scenario: DemoScenario,
  fallback: string
): Promise<string> {
  if (!env.GEMINI_API_KEY) return fallback;
  try {
    const res = await callGeminiModel({
      env,
      db,
      userId,
      model: env.GEMINI_MODEL_FAST,
      systemPrompt: actor === "citizen" ? SIM_CITIZEN_PROMPT : SIM_OFFICER_PROMPT,
      userPrompt: `Scenario: ${scenario}. Generate one realistic concise ${actor} message for the GH bus-stop grievance.`
    });
    return res.text.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function executeDemoScenarioStep(
  db: AppDb,
  env: Env,
  ownerUserId: string,
  scenario: DemoScenario
) {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1);
  if (!owner?.demoSessionId) {
    throw new Error("Demo sandbox not started");
  }

  const [session] = await db
    .select()
    .from(demoSessions)
    .where(eq(demoSessions.id, owner.demoSessionId))
    .limit(1);

  if (!session || !session.primaryTicketId) {
    throw new Error("Demo session missing primary ticket");
  }

  const now = Date.now();
  await db
    .update(demoSessions)
    .set({ scenario, updatedAt: now })
    .where(eq(demoSessions.id, session.id));

  const ticketId = session.primaryTicketId;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw new Error("Primary demo ticket missing");

  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .limit(1);

  if (contract && contract.confirmedByCitizen === 0) {
    await db
      .update(expectationContracts)
      .set({ confirmedByCitizen: 1, confirmedAt: now, updatedAt: now })
      .where(eq(expectationContracts.id, contract.id));
  }

  if (ticket.status === "awaiting_citizen_confirmation" || ticket.status === "intake_audit") {
    await transition(db, ticketId, "filed", { type: "judge", id: ownerUserId }, "Citizen confirmed contract", {
      filedAt: now
    });
    await transition(db, ticketId, "assigned", { type: "system", id: null }, "Assigned to division");
  } else if (ticket.status === "filed") {
    await transition(db, ticketId, "assigned", { type: "system", id: null }, "Assigned to division");
  }

  const [freshTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (freshTicket?.status === "assigned" || freshTicket?.status === "reopened") {
    await transition(db, ticketId, "in_progress", { type: "officer", id: session.officerUserId }, "Officer opened case");
  }

  const reqs = contract
    ? await db
        .select()
        .from(responseRequirements)
        .where(eq(responseRequirements.contractId, contract.id))
    : [];

  if (scenario === "genuinely_fixed") {
    const officerText = await generateSimulatedLine(
      db,
      env,
      ownerUserId,
      "officer",
      scenario,
      "Earlier skipping occurred due to temporary bypass diversion. Per Circular TNSTC/SLM/2026-114 effective today, all express buses halt at GH Stop. Depot supervisor inspection log attached."
    );
    const evId = crypto.randomUUID();
    const sha = await sha256Hex(`demo-proof-${ticketId}-${now}`);
    await db.insert(evidence).values({
      id: evId,
      ticketId,
      uploaderId: ownerUserId,
      r2Key: `firestore://evidence_blobs/${evId}`,
      mime: "image/png",
      size: 24576,
      sha256: sha,
      aiSummary: "Photo shows Express Route 45A halted at Government Hospital bus shelter at 08:15 AM.",
      aiSummaryJson: { consistent: true, summary: "Bus halted at GH stop sign visible." },
      createdAt: now,
      updatedAt: now
    });

    const replyId = crypto.randomUUID();
    await db.insert(departmentReplies).values({
      id: replyId,
      ticketId,
      officerId: session.officerId,
      text: officerText,
      structuredJson: reqs.map((r) => ({
        requirement_id: r.id,
        label: r.label,
        value: `${officerText} (Ref: TNSTC/SLM/2026-114, enforced ${new Date(now).toISOString().slice(0, 10)})`,
        evidence_ids: [evId]
      })),
      claimsResolved: 1,
      repliedAt: now,
      createdAt: now,
      updatedAt: now
    });

    await transition(db, ticketId, "department_replied", { type: "officer", id: session.officerUserId }, "Officer submitted structured reply");
    await processAgentEvent(db, env, {
      eventId: crypto.randomUUID(),
      eventType: "officer_reply",
      ticketId,
      replyId,
      actorId: ownerUserId
    });

    await transition(db, ticketId, "closure_claimed", { type: "officer", id: session.officerUserId }, "Officer marked resolved");
    const caseId = crypto.randomUUID();
    await db.insert(verificationCases).values({
      id: caseId,
      ticketId,
      trigger: "officer_resolved",
      startedAt: now,
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId,
      verificationCaseId: caseId,
      kind: "closure",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const citizenLine = await generateSimulatedLine(
      db,
      env,
      ownerUserId,
      "citizen",
      scenario,
      "Yes, buses now stop at the Government Hospital stop! Route 45A stopped this morning and the issue is confirmed fixed."
    );
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      sender: "simulated_citizen",
      text: citizenLine,
      language: "en",
      createdAt: now + 50,
      updatedAt: now + 50
    });

    await processAgentEvent(db, env, {
      eventId: crypto.randomUUID(),
      eventType: "citizen_message",
      ticketId,
      verificationCaseId: caseId,
      actorId: ownerUserId
    });
  } else if (scenario === "fake_closure") {
    const vagueReplyId = crypto.randomUUID();
    await db.insert(departmentReplies).values({
      id: vagueReplyId,
      ticketId,
      officerId: session.officerId,
      text: "Action taken and resolved.",
      structuredJson: [],
      claimsResolved: 1,
      repliedAt: now,
      createdAt: now,
      updatedAt: now
    });
    await transition(db, ticketId, "department_replied", { type: "officer", id: session.officerUserId }, "Officer submitted brief reply");
    await processAgentEvent(db, env, {
      eventId: crypto.randomUUID(),
      eventType: "officer_reply",
      ticketId,
      replyId: vagueReplyId,
      actorId: ownerUserId
    });

    const [afterReturn] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    if (afterReturn?.status === "reply_returned") {
      await transition(db, ticketId, "in_progress", { type: "officer", id: session.officerUserId }, "Officer reopened after return");
    }
    await transition(db, ticketId, "closure_claimed", { type: "officer", id: session.officerUserId }, "Officer marked resolved without proof");

    const caseId = crypto.randomUUID();
    await db.insert(verificationCases).values({
      id: caseId,
      ticketId,
      trigger: "officer_resolved",
      startedAt: now,
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId,
      verificationCaseId: caseId,
      kind: "closure",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const citizenLine = await generateSimulatedLine(
      db,
      env,
      ownerUserId,
      "citizen",
      scenario,
      "No, express buses still skip the GH stop every morning. Nothing changed on the ground."
    );
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      sender: "simulated_citizen",
      text: citizenLine,
      language: "en",
      createdAt: now + 50,
      updatedAt: now + 50
    });

    await processAgentEvent(db, env, {
      eventId: crypto.randomUUID(),
      eventType: "citizen_message",
      ticketId,
      verificationCaseId: caseId,
      actorId: ownerUserId
    });
  } else {
    await db.insert(departmentContacts).values({
      id: crypto.randomUUID(),
      ticketId,
      officerId: session.officerId,
      channel: "phone",
      direction: "outbound",
      loggedBy: session.officerUserId ?? ownerUserId,
      notes: "Outbound phone call from division office to citizen.",
      occurredAt: now - 30 * 60 * 1000,
      createdAt: now,
      updatedAt: now
    });

    await transition(db, ticketId, "closure_claimed", { type: "citizen", id: ownerUserId }, "Citizen requested withdrawal shortly after department call");

    const caseId = crypto.randomUUID();
    await db.insert(verificationCases).values({
      id: caseId,
      ticketId,
      trigger: "citizen_withdrawn",
      startedAt: now,
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    const convId = crypto.randomUUID();
    await db.insert(conversations).values({
      id: convId,
      ticketId,
      verificationCaseId: caseId,
      kind: "closure",
      channel: "web_chat",
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const citizenLine = await generateSimulatedLine(
      db,
      env,
      ownerUserId,
      "citizen",
      scenario,
      "Please withdraw my complaint, I got a call from the depot office. The buses are still skipping the stop though."
    );
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      sender: "simulated_citizen",
      text: citizenLine,
      language: "en",
      createdAt: now + 50,
      updatedAt: now + 50
    });

    await processAgentEvent(db, env, {
      eventId: crypto.randomUUID(),
      eventType: "closure_claimed",
      ticketId,
      verificationCaseId: caseId,
      actorId: ownerUserId
    });
  }

  await db.insert(ticketEvents).values({
    id: crypto.randomUUID(),
    ticketId,
    actorType: "judge",
    actorId: ownerUserId,
    eventType: "demo_scenario_executed",
    payload: { scenario },
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  return getDemoState(db, ownerUserId);
}
