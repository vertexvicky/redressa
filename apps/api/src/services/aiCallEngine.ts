import { and, desc, eq, lte } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import {
  aiCallEvents,
  consents,
  departmentReplies,
  departments,
  tickets,
  users,
  verificationCases
} from "../db/schema.js";
import type { Env } from "../env.js";
import { writeAuditLog } from "./audit.js";
import { hasConsent, upsertUserConsents } from "./consent.js";
import { decryptText } from "./crypto.js";
import { transition } from "./transition.js";

export const AI_CALL_STATUSES = [
  "QUEUED",
  "INITIATING",
  "RINGING",
  "CONNECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "REJECTED",
  "CANCELLED"
] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

export interface RequestClosedEventPayload {
  event: "REQUEST_CLOSED";
  requestId: string;
  customer: {
    name: string;
    phone: string;
  };
  request: {
    title: string;
    status: "CLOSED";
    resolution: string;
  };
  metadata: {
    organization: string;
    closedAt: string;
    closedBy?: string;
    language: "en" | "hi" | "ta";
  };
  consent: {
    automatedCallAllowed: true;
    consentReference: string;
  };
}

export interface AiCallWebhookPayload {
  callId?: string;
  providerCallId?: string;
  requestId: string;
  status: string;
  outcome?: string;
  durationSeconds?: number;
  optOut?: boolean;
  timestamp?: string;
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const TERMINAL_CALL_STATUSES = new Set<string>([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "REJECTED",
  "CANCELLED"
]);

export function isValidE164Phone(phone: string): boolean {
  return E164_REGEX.test(phone.trim());
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return "••••";
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export async function signWebhookPayload(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHex: string,
  secret: string
): Promise<boolean> {
  if (!secret || !signatureHex) return false;
  const expected = await signWebhookPayload(rawBody, secret);
  if (expected.length !== signatureHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}

async function resolveCustomerPhone(
  phoneEnc: string | null,
  env: Env
): Promise<string | null> {
  if (!phoneEnc) return null;
  const key = env.ENCRYPTION_KEY || btoa("redressa-local-dev-key-32-bytes!!");
  try {
    const plain = await decryptText(phoneEnc, key);
    return plain.trim();
  } catch {
    return null;
  }
}

export async function buildRequestClosedPayload(
  db: AppDb,
  env: Env,
  ticketId: string,
  closedAt: number,
  closedBy?: string | null
): Promise<
  | { ok: true; payload: RequestClosedEventPayload; maskedPhone: string }
  | { ok: false; skipReason: string }
> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    return { ok: false, skipReason: "ticket_not_found" };
  }

  if (ticket.optOut === 1) {
    return { ok: false, skipReason: "ticket_opt_out" };
  }

  if (ticket.discreetRequested === 1) {
    return { ok: false, skipReason: "discreet_mode_active" };
  }

  const [citizen] = await db
    .select()
    .from(users)
    .where(eq(users.id, ticket.citizenId))
    .limit(1);
  if (!citizen || citizen.deletedAt) {
    return { ok: false, skipReason: "customer_not_found" };
  }

  const phoneConsentGranted = await hasConsent(db, citizen.id, "phone_contact");
  if (!phoneConsentGranted) {
    return { ok: false, skipReason: "missing_consent" };
  }

  const [consentRow] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, citizen.id), eq(consents.type, "phone_contact")))
    .limit(1);

  const phone = await resolveCustomerPhone(citizen.phoneEnc, env);
  if (!phone) {
    return { ok: false, skipReason: "missing_phone" };
  }
  if (!isValidE164Phone(phone)) {
    return { ok: false, skipReason: "invalid_phone" };
  }

  const [department] = ticket.departmentId
    ? await db.select().from(departments).where(eq(departments.id, ticket.departmentId)).limit(1)
    : [];

  const [latestReply] = await db
    .select()
    .from(departmentReplies)
    .where(and(eq(departmentReplies.ticketId, ticketId), eq(departmentReplies.returned, 0)))
    .orderBy(desc(departmentReplies.repliedAt))
    .limit(1);

  const [latestCase] = await db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.ticketId, ticketId))
    .orderBy(desc(verificationCases.startedAt))
    .limit(1);

  const rawResolution =
    latestReply?.text?.trim() ||
    latestCase?.reasons?.[0]?.trim() ||
    "An official response is ready for your review.";
  const resolution =
    rawResolution.length > 180 ? `${rawResolution.slice(0, 177)}...` : rawResolution;

  const language: "en" | "hi" | "ta" =
    ticket.language === "ta" ? "ta" : ticket.language === "hi" ? "hi" : "en";

  return {
    ok: true,
    maskedPhone: maskPhone(phone),
    payload: {
      event: "REQUEST_CLOSED",
      requestId: ticket.id,
      customer: {
        name: citizen.name,
        phone
      },
      request: {
        title: ticket.title,
        status: "CLOSED",
        resolution
      },
      metadata: {
        organization: department?.name || env.ORGANIZATION_NAME || "Redressa Grievance Redressal",
        closedAt: new Date(closedAt).toISOString(),
        ...(closedBy ? { closedBy } : {}),
        language
      },
      consent: {
        automatedCallAllowed: true,
        consentReference: consentRow?.id || `consent-${citizen.id}-phone_contact`
      }
    }
  };
}

export async function dispatchAiCallEvent(
  db: AppDb,
  env: Env,
  eventRowId: string
): Promise<void> {
  const [row] = await db
    .select()
    .from(aiCallEvents)
    .where(eq(aiCallEvents.id, eventRowId))
    .limit(1);
  if (!row) return;
  if (row.deliveryStatus === "sent" || row.deliveryStatus === "skipped") return;

  const now = Date.now();
  const built = await buildRequestClosedPayload(db, env, row.ticketId, row.closedAt, row.closedBy);
  if (!built.ok) {
    await db
      .update(aiCallEvents)
      .set({
        deliveryStatus: "skipped",
        skipReason: built.skipReason,
        nextRetryAt: null,
        updatedAt: now
      })
      .where(eq(aiCallEvents.id, row.id));
    await writeAuditLog(db, {
      actorType: "system",
      actorId: null,
      action: "ai_call_skipped",
      entityType: "ticket",
      entityId: row.ticketId,
      diff: { reason: built.skipReason }
    });
    return;
  }

  const baseUrl = env.AI_CALL_ENGINE_URL?.replace(/\/+$/, "");
  const token = env.AI_CALL_ENGINE_TOKEN;
  if (!baseUrl || !token) {
    const nextAttempts = row.attempts + 1;
    await db
      .update(aiCallEvents)
      .set({
        deliveryStatus: "pending",
        attempts: nextAttempts,
        lastError: "AI_CALL_ENGINE_URL or AI_CALL_ENGINE_TOKEN not configured",
        nextRetryAt: now + 5 * 60_000,
        updatedAt: now
      })
      .where(eq(aiCallEvents.id, row.id));
    return;
  }

  const timeoutMs = Number.parseInt(env.AI_CALL_ENGINE_TIMEOUT_MS || "5000", 10) || 5000;

  try {
    const res = await fetch(`${baseUrl}/api/events/request-closed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(built.payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.ok) {
      const json = (await res.json()) as {
        success?: boolean;
        data?: { eventId?: string; status?: string };
      };
      await db
        .update(aiCallEvents)
        .set({
          deliveryStatus: "sent",
          engineEventId: json.data?.eventId ?? null,
          callStatus: json.data?.status ?? "QUEUED",
          lastError: null,
          nextRetryAt: null,
          sentAt: now,
          attempts: row.attempts + 1,
          updatedAt: now
        })
        .where(eq(aiCallEvents.id, row.id));

      console.log(
        JSON.stringify({
          event: "ai_call_dispatched",
          ticketId: row.ticketId,
          engineEventId: json.data?.eventId,
          maskedPhone: built.maskedPhone
        })
      );

      await writeAuditLog(db, {
        actorType: "system",
        actorId: null,
        action: "ai_call_queued",
        entityType: "ticket",
        entityId: row.ticketId,
        diff: { engineEventId: json.data?.eventId ?? null, maskedPhone: built.maskedPhone }
      });
      return;
    }

    if (res.status === 409) {
      await db
        .update(aiCallEvents)
        .set({
          deliveryStatus: "sent",
          lastError: null,
          nextRetryAt: null,
          sentAt: row.sentAt ?? now,
          updatedAt: now
        })
        .where(eq(aiCallEvents.id, row.id));
      return;
    }

    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    const nonRetryable = res.status >= 400 && res.status < 500 && res.status !== 429;
    const nextAttempts = row.attempts + 1;
    const shouldFail = nonRetryable || nextAttempts >= 5;

    await db
      .update(aiCallEvents)
      .set({
        deliveryStatus: shouldFail ? "failed" : "pending",
        attempts: nextAttempts,
        lastError: `HTTP ${res.status}: ${errText.slice(0, 300)}`,
        nextRetryAt: shouldFail ? null : now + Math.min(60_000 * Math.pow(2, row.attempts), 3_600_000),
        updatedAt: now
      })
      .where(eq(aiCallEvents.id, row.id));

    await writeAuditLog(db, {
      actorType: "system",
      actorId: null,
      action: "ai_call_dispatch_failed",
      entityType: "ticket",
      entityId: row.ticketId,
      diff: { status: res.status, attempts: nextAttempts, retryable: !shouldFail }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    const nextAttempts = row.attempts + 1;
    const shouldFail = nextAttempts >= 5;

    await db
      .update(aiCallEvents)
      .set({
        deliveryStatus: shouldFail ? "failed" : "pending",
        attempts: nextAttempts,
        lastError: message.slice(0, 300),
        nextRetryAt: shouldFail ? null : now + Math.min(60_000 * Math.pow(2, row.attempts), 3_600_000),
        updatedAt: now
      })
      .where(eq(aiCallEvents.id, row.id));

    console.error(
      JSON.stringify({
        event: "ai_call_dispatch_error",
        ticketId: row.ticketId,
        error: message,
        attempts: nextAttempts
      })
    );
  }
}

export async function queueAndDispatchAiCallOnClosure(
  db: AppDb,
  env: Env,
  params: {
    ticketId: string;
    closedAt: number;
    closedBy?: string | null;
  }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(aiCallEvents)
    .where(and(eq(aiCallEvents.ticketId, params.ticketId), eq(aiCallEvents.eventType, "REQUEST_CLOSED")))
    .limit(1);

  if (existing) {
    return;
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const built = await buildRequestClosedPayload(
    db,
    env,
    params.ticketId,
    params.closedAt,
    params.closedBy
  );

  if (!built.ok) {
    await db.insert(aiCallEvents).values({
      id,
      ticketId: params.ticketId,
      eventType: "REQUEST_CLOSED",
      deliveryStatus: "skipped",
      skipReason: built.skipReason,
      closedAt: params.closedAt,
      closedBy: params.closedBy ?? null,
      createdAt: now,
      updatedAt: now
    });
    await writeAuditLog(db, {
      actorType: "system",
      actorId: null,
      action: "ai_call_skipped",
      entityType: "ticket",
      entityId: params.ticketId,
      diff: { reason: built.skipReason }
    });
    return;
  }

  await db.insert(aiCallEvents).values({
    id,
    ticketId: params.ticketId,
    eventType: "REQUEST_CLOSED",
    deliveryStatus: "pending",
    callStatus: "QUEUED",
    closedAt: params.closedAt,
    closedBy: params.closedBy ?? null,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now
  });

  await dispatchAiCallEvent(db, env, id);
}

export function triggerAiCallNonBlocking(
  db: AppDb,
  env: Env,
  params: { ticketId: string; closedAt: number; closedBy?: string | null },
  waitUntil?: (promise: Promise<unknown>) => void
): void {
  const task = queueAndDispatchAiCallOnClosure(db, env, params).catch((err) => {
    console.error(
      JSON.stringify({
        event: "ai_call_trigger_error",
        ticketId: params.ticketId,
        error: err instanceof Error ? err.message : "Unknown error"
      })
    );
  });
  if (waitUntil) {
    waitUntil(task);
  }
}

export async function retryPendingAiCallEvents(db: AppDb, env: Env): Promise<number> {
  const now = Date.now();
  const pending = await db
    .select()
    .from(aiCallEvents)
    .where(and(eq(aiCallEvents.deliveryStatus, "pending"), lte(aiCallEvents.nextRetryAt, now)))
    .limit(20);

  for (const row of pending) {
    await dispatchAiCallEvent(db, env, row.id);
  }
  return pending.length;
}

export async function processAiCallWebhook(
  db: AppDb,
  payload: AiCallWebhookPayload
): Promise<{ updated: boolean }> {
  const normalizedStatus = payload.status.toUpperCase();
  const validStatus = AI_CALL_STATUSES.includes(normalizedStatus as AiCallStatus)
    ? normalizedStatus
    : "FAILED";

  const [existing] = await db
    .select()
    .from(aiCallEvents)
    .where(and(eq(aiCallEvents.ticketId, payload.requestId), eq(aiCallEvents.eventType, "REQUEST_CLOSED")))
    .limit(1);

  if (!existing) {
    return { updated: false };
  }

  const now = Date.now();
  const isTerminal = TERMINAL_CALL_STATUSES.has(validStatus);

  await db
    .update(aiCallEvents)
    .set({
      engineCallId: payload.callId ?? existing.engineCallId,
      callStatus: validStatus,
      callOutcome: payload.outcome ?? existing.callOutcome,
      callDurationSeconds: payload.durationSeconds ?? existing.callDurationSeconds,
      completedAt: isTerminal ? now : existing.completedAt,
      updatedAt: now
    })
    .where(eq(aiCallEvents.id, existing.id));

  if (payload.optOut) {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, payload.requestId))
      .limit(1);
    if (ticket) {
      await db
        .update(tickets)
        .set({ optOut: 1, updatedAt: now })
        .where(eq(tickets.id, ticket.id));
      await upsertUserConsents(
        db,
        ticket.citizenId,
        [{ type: "phone_contact", granted: false }],
        "system"
      );
    }
  }

  if (payload.outcome && !payload.optOut) {
    const normalizedOutcome = payload.outcome.trim().toUpperCase();
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, payload.requestId))
      .limit(1);

    if (ticket && ["department_replied", "closure_claimed", "under_verification"].includes(ticket.status)) {
      if (["NOT_RESOLVED", "DISPUTED", "UNSATISFIED", "REOPENED"].includes(normalizedOutcome)) {
        if (ticket.status === "department_replied") {
          await transition(db, ticket.id, "closure_claimed", { type: "system", id: null }, "Call verification outcome received");
          await transition(db, ticket.id, "under_verification", { type: "system", id: null }, "Processing call feedback");
        } else if (ticket.status === "closure_claimed") {
          await transition(db, ticket.id, "under_verification", { type: "system", id: null }, "Processing call feedback");
        }
        const [cur] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1);
        if (cur?.status === "under_verification") {
          await transition(db, ticket.id, "not_resolved", { type: "citizen", id: ticket.citizenId }, "Applicant reported issue unresolved on verification call");
          await transition(db, ticket.id, "reopened", { type: "citizen", id: ticket.citizenId }, "Reopened from phone verification", { closedAt: null });
        }
      } else if (["CONFIRMED", "SATISFIED", "RESOLVED", "CLOSED"].includes(normalizedOutcome)) {
        if (ticket.status === "department_replied") {
          await transition(db, ticket.id, "closure_claimed", { type: "system", id: null }, "Call verification outcome received");
          await transition(db, ticket.id, "under_verification", { type: "system", id: null }, "Processing call feedback");
        } else if (ticket.status === "closure_claimed") {
          await transition(db, ticket.id, "under_verification", { type: "system", id: null }, "Processing call feedback");
        }
        const [cur] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1);
        if (cur?.status === "under_verification") {
          await transition(db, ticket.id, "verified_resolved", { type: "citizen", id: ticket.citizenId }, "Applicant confirmed resolution on verification call", { closedAt: now });
        }
      }
    }
  }

  await writeAuditLog(db, {
    actorType: "system",
    actorId: null,
    action: "ai_call_status_updated",
    entityType: "ticket",
    entityId: payload.requestId,
    diff: {
      callStatus: validStatus,
      callOutcome: payload.outcome ?? null,
      durationSeconds: payload.durationSeconds ?? null
    }
  });

  return { updated: true };
}
