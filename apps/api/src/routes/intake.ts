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
  evidence,
  expectationContracts,
  messages,
  responseRequirements,
  ticketEvents,
  tickets
} from "../db/schema.js";
import type { Env } from "../env.js";
import {
  SITE_AGENT_RULES,
  SITE_ALLOWED_MIME,
  SITE_MAX_ROUNDS,
  SITE_VIDEO_MAX_BYTES,
  reviewSiteVideo,
  sanitizeContextBrief,
  type SiteInspectionOutput
} from "../agent/siteInspection.js";
import { toolCreateExpectationContract } from "../agent/tools/contract.js";
import { runIntakeAudit } from "../agent/orchestrator.js";
import { writeAuditLog } from "../services/audit.js";
import { haversineMeters } from "../services/geo.js";
import {
  describeCapture,
  issueCaptureToken,
  validateCaptureMetrics,
  verifyCaptureToken
} from "../services/liveCapture.js";
import { createSignedEvidenceDownloadPath, storeEvidenceFile } from "../services/storage.js";
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

interface StoredSiteInspectionState {
  context_brief: string;
  latest: SiteInspectionOutput | null;
  rounds: Array<{
    round: number;
    evidenceId: string;
    assessment: string;
    confidence: number;
    status_update: string;
    urgent_hazard: boolean;
    createdAt: number;
  }>;
}

intakeRoutes.post("/:ticketId/video-capture/start", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const ticketId = c.req.param("ticketId");
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id && !user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }
  const session = await issueCaptureToken(c.env, ticketId, user.id);
  return c.json(session);
});

intakeRoutes.post("/:ticketId/video-inspection", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const ticketId = c.req.param("ticketId");

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return jsonError(c, 404, "NOT_FOUND", "Ticket not found");
  if (ticket.citizenId !== user.id && !user.isDemo) {
    return jsonError(c, 403, "FORBIDDEN", "Not ticket owner");
  }

  const form = await c.req.formData();
  const file = form.get("video") as unknown;
  const isFile =
    typeof file === "object" &&
    file !== null &&
    "arrayBuffer" in file &&
    typeof (file as { arrayBuffer: unknown }).arrayBuffer === "function";
  if (!isFile) {
    return jsonError(c, 400, "VALIDATION_ERROR", "A video file is required");
  }

  const upload = file as { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> };
  const mime = (upload.type ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(SITE_ALLOWED_MIME as readonly string[]).includes(mime)) {
    return jsonError(c, 400, "UNSUPPORTED_VIDEO", "Use an MP4, WebM, or MOV video");
  }

  const captureNonce = String(form.get("captureNonce") ?? "");
  const captureExpiresAt = Number(form.get("captureExpiresAt") ?? 0);
  const captureSig = String(form.get("captureSig") ?? "");
  const durationMs = Number(form.get("durationMs") ?? 0);
  const lat = Number(form.get("lat") ?? Number.NaN);
  const lng = Number(form.get("lng") ?? Number.NaN);
  const accuracyRaw = Number(form.get("accuracy") ?? Number.NaN);
  const accuracyM = Number.isFinite(accuracyRaw) ? accuracyRaw : null;

  const tokenOk = await verifyCaptureToken(
    c.env,
    ticketId,
    user.id,
    captureNonce,
    captureExpiresAt,
    captureSig
  );
  if (!tokenOk) {
    return jsonError(
      c,
      400,
      "CAPTURE_SESSION_INVALID",
      "Recording session expired or invalid. Start a new live recording."
    );
  }
  const metricsError = validateCaptureMetrics({ durationMs, lat, lng });
  if (metricsError) {
    return jsonError(c, 400, "CAPTURE_REJECTED", metricsError);
  }
  const priorEvidence = await db.select().from(evidence).where(eq(evidence.ticketId, ticketId));
  const nonceUsed = priorEvidence.some(
    (item) => (item.exif as { capture?: { nonce?: string } } | null)?.capture?.nonce === captureNonce
  );
  if (nonceUsed) {
    return jsonError(c, 409, "CAPTURE_REPLAY", "This recording session was already used.");
  }

  const reported =
    ticket.lat !== null && ticket.lng !== null ? { lat: ticket.lat, lng: ticket.lng } : null;
  const distanceFromReportedM = reported ? haversineMeters({ lat, lng }, reported) : null;
  const captureNote = describeCapture({ durationMs, distanceFromReportedM, accuracyM });

  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > SITE_VIDEO_MAX_BYTES) {
    return jsonError(
      c,
      400,
      "VIDEO_SIZE",
      `Video must be between 1 byte and ${Math.floor(SITE_VIDEO_MAX_BYTES / (1024 * 1024))} MB`
    );
  }

  const [contract] = await db
    .select()
    .from(expectationContracts)
    .where(eq(expectationContracts.ticketId, ticketId))
    .orderBy(desc(expectationContracts.version))
    .limit(1);

  const auditJson = (contract?.questionAuditJson ?? {}) as Record<string, unknown> & {
    requested_footage_shots?: string[];
    siteInspection?: StoredSiteInspectionState;
  };
  const prevState: StoredSiteInspectionState = auditJson.siteInspection ?? {
    context_brief: "",
    latest: null,
    rounds: []
  };

  const nextRound = prevState.rounds.length + 1;
  if (nextRound > SITE_MAX_ROUNDS) {
    return jsonError(c, 400, "ROUND_LIMIT", "Maximum video inspection rounds reached for this ticket");
  }

  const stored = await storeEvidenceFile({
    env: c.env,
    db,
    ticketId,
    uploaderId: user.id,
    fileName: upload.name || `site-inspection-r${nextRound}.webm`,
    mime,
    bytes,
    geo: {
      lat,
      lng,
      accuracy: accuracyM,
      distanceFromReportedM,
      source: "live_gps"
    }
  });
  await db
    .update(evidence)
    .set({
      exif: {
        capture: {
          nonce: captureNonce,
          durationMs,
          source: "live_recorder",
          capturedAt: Date.now()
        }
      },
      updatedAt: Date.now()
    })
    .where(eq(evidence.id, stored.id));
  const signedUrl = await createSignedEvidenceDownloadPath(stored.id, c.env);

  if (!c.env.GEMINI_API_KEY) {
    return jsonError(
      c,
      503,
      "AI_UNAVAILABLE",
      "Video saved as evidence, but Gemini AI review is not configured"
    );
  }

  const requestedShots = Array.isArray(auditJson.requested_footage_shots)
    ? auditJson.requested_footage_shots
    : [];

  try {
    const result = await reviewSiteVideo({
      env: c.env,
      db,
      userId: user.id,
      ticketId,
      title: ticket.title,
      mime,
      bytes,
      issueType: ticket.category,
      description: ticket.originalQuestion,
      locationHint: ticket.locationText ?? "",
      requestedShots,
      contextBrief: sanitizeContextBrief(prevState.context_brief),
      priorEvidenceCount: prevState.rounds.length,
      round: nextRound,
      captureNote,
      distanceFromReportedM
    });

    const now = Date.now();
    await db
      .update(evidence)
      .set({
        aiSummary: result.summary,
        aiSummaryJson: result as unknown as Record<string, unknown>,
        updatedAt: now
      })
      .where(eq(evidence.id, stored.id));

    const nextState: StoredSiteInspectionState = {
      context_brief: result.context_brief,
      latest: result,
      rounds: [
        ...prevState.rounds,
        {
          round: nextRound,
          evidenceId: stored.id,
          assessment: result.assessment,
          confidence: result.confidence,
          status_update: result.status_update,
          urgent_hazard: result.urgent_hazard,
          createdAt: now
        }
      ]
    };

    if (contract) {
      await db
        .update(expectationContracts)
        .set({
          questionAuditJson: {
            ...auditJson,
            siteInspection: nextState
          },
          updatedAt: now
        })
        .where(eq(expectationContracts.id, contract.id));
    }

    await db.insert(ticketEvents).values({
      id: crypto.randomUUID(),
      ticketId,
      actorType: "agent",
      actorId: null,
      eventType: "site_video_evaluated",
      payload: {
        round: nextRound,
        evidenceId: stored.id,
        assessment: result.assessment,
        confidence: result.confidence,
        urgentHazard: result.urgent_hazard
      },
      occurredAt: now,
      createdAt: now,
      updatedAt: now
    });

    await writeAuditLog(db, {
      actorType: "agent",
      actorId: null,
      action: "site_video_evaluated",
      entityType: "ticket",
      entityId: ticketId,
      diff: {
        round: nextRound,
        evidenceId: stored.id,
        assessment: result.assessment,
        confidence: result.confidence
      }
    });

    return c.json({
      inspection: result,
      siteInspection: nextState,
      rules: SITE_AGENT_RULES,
      evidence: { ...stored, signedUrl }
    });
  } catch (err) {
    return jsonError(
      c,
      502,
      "AI_REVIEW_FAILED",
      err instanceof Error ? err.message : "The AI video review could not be completed"
    );
  }
});
