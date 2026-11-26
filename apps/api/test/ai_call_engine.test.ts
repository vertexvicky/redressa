import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiCallEvents,
  auditLog,
  consents,
  departmentReplies,
  departments,
  tickets,
  users,
  verificationCases
} from "../src/db/schema.js";
import type { AppDb } from "../src/db/client.js";
import type { Env } from "../src/env.js";
import {
  isValidE164Phone,
  maskPhone,
  processAiCallWebhook,
  queueAndDispatchAiCallOnClosure,
  retryPendingAiCallEvents,
  signWebhookPayload,
  verifyWebhookSignature
} from "../src/services/aiCallEngine.js";
import { encryptText } from "../src/services/crypto.js";

interface InMemoryStore {
  tickets: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  consents: Array<Record<string, unknown>>;
  departments: Array<Record<string, unknown>>;
  department_replies: Array<Record<string, unknown>>;
  verification_cases: Array<Record<string, unknown>>;
  ai_call_events: Array<Record<string, unknown>>;
  audit_log: Array<Record<string, unknown>>;
}

function getTableName(table: unknown): keyof InMemoryStore {
  if (table === tickets) return "tickets";
  if (table === users) return "users";
  if (table === consents) return "consents";
  if (table === departments) return "departments";
  if (table === departmentReplies) return "department_replies";
  if (table === verificationCases) return "verification_cases";
  if (table === aiCallEvents) return "ai_call_events";
  if (table === auditLog) return "audit_log";
  throw new Error("Unknown table in test mock");
}

function createMockDb(store: InMemoryStore): AppDb {
  function matchWhere(row: Record<string, unknown>, expr: unknown): boolean {
    if (!expr || typeof expr !== "object") return true;
    const chunks = (expr as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return true;

    // Parse simple Drizzle eq / and / lte conditions by inspecting chunks
    const flat: Array<{ col?: string; op?: string; val?: unknown }> = [];
    let currentCol: string | undefined;
    let currentOp = "=";

    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.queryChunks)) {
        for (const c of obj.queryChunks) visit(c);
        return;
      }
      if (typeof obj.name === "string" && obj.table) {
        currentCol = toCamel(obj.name);
        return;
      }
      if (Array.isArray(obj.value)) {
        const text = obj.value.join("");
        if (text.includes("<=")) currentOp = "<=";
        else if (text.includes("=")) currentOp = "=";
        return;
      }
      if ("value" in obj && obj.constructor?.name === "Param") {
        if (currentCol) {
          flat.push({ col: currentCol, op: currentOp, val: obj.value });
          currentCol = undefined;
          currentOp = "=";
        }
      }
    };
    visit(expr);

    return flat.every((cond) => {
      const actual = row[cond.col!];
      if (cond.op === "<=") {
        return typeof actual === "number" && typeof cond.val === "number" && actual <= cond.val;
      }
      return actual === cond.val;
    });
  }

  function toCamel(snake: string): string {
    return snake.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  }

  const db = {
    select(projection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const name = getTableName(table);
          let rows = [...store[name]];
          const project = (list: Array<Record<string, unknown>>) =>
            list.map((r) => {
              if (!projection) return r;
              const out: Record<string, unknown> = {};
              for (const k of Object.keys(projection)) out[k] = r[k];
              return out;
            });
          const chain = {
            where(expr: unknown) {
              rows = rows.filter((r) => matchWhere(r, expr));
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit(n: number) {
              return Promise.resolve(project(rows.slice(0, n)));
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ) {
              return Promise.resolve(project(rows)).then(onfulfilled, onrejected);
            }
          };
          return chain;
        }
      };
    },
    insert(table: unknown) {
      const name = getTableName(table);
      return {
        values(vals: Record<string, unknown>) {
          store[name].push({
            attempts: 0,
            ...vals
          });
          return Promise.resolve();
        }
      };
    },
    update(table: unknown) {
      const name = getTableName(table);
      return {
        set(vals: Record<string, unknown>) {
          return {
            where(expr: unknown) {
              for (const row of store[name]) {
                if (matchWhere(row, expr)) {
                  Object.assign(row, vals);
                }
              }
              return Promise.resolve();
            }
          };
        }
      };
    }
  };

  return db as unknown as AppDb;
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    AGENT_EVENTS: {} as Queue<never>,
    EVIDENCE_JOBS: {} as Queue<never>,
    CASE_ROOM: {} as DurableObjectNamespace,
    VOICE_SESSION: {} as DurableObjectNamespace,
    FIREBASE_PROJECT_ID: "test",
    FRONTEND_ORIGIN: "http://localhost:5173",
    DEMO_SESSION_TTL_HOURS: "24",
    CONTACT_WINDOW_START: "09:00",
    CONTACT_WINDOW_END: "20:00",
    GEMINI_MODEL_AGENT: "gemini-3.1-flash-lite",
    GEMINI_MODEL_FAST: "gemini-3.1-flash-lite",
    GEMINI_MODEL_VISION: "gemini-3.1-flash-lite",
    GEMINI_MODEL_LIVE: "gemini-3.1-flash-live",
    ENCRYPTION_KEY: btoa("redressa-32-byte-encryption-key!"),
    AI_CALL_ENGINE_URL: "http://localhost:4000",
    AI_CALL_ENGINE_TOKEN: "test-engine-token",
    AI_CALL_ENGINE_WEBHOOK_SECRET: "test-webhook-secret",
    AI_CALL_ENGINE_TIMEOUT_MS: "2000",
    ORGANIZATION_NAME: "Redressa Test Dept",
    ...overrides
  };
}

describe("AI Call Engine integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates E.164 phone numbers and masks numbers in logs", () => {
    expect(isValidE164Phone("+919876543210")).toBe(true);
    expect(isValidE164Phone("9876543210")).toBe(false);
    expect(isValidE164Phone("+0123456")).toBe(false);
    expect(maskPhone("+919876543210")).toBe("+91••••3210");
  });

  it("dispatches REQUEST_CLOSED on closure, prevents duplicates, and updates status via webhook", async () => {
    const env = createEnv();
    const encryptedPhone = await encryptText("+919876543210", env.ENCRYPTION_KEY!);
    const now = Date.now();
    const store: InMemoryStore = {
      tickets: [
        {
          id: "t-1",
          citizenId: "u-1",
          departmentId: "d-1",
          title: "Streetlight outage",
          status: "verified_resolved",
          language: "ta",
          optOut: 0
        }
      ],
      users: [{ id: "u-1", name: "Karthik", phoneEnc: encryptedPhone, deletedAt: null }],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 1 }],
      departments: [{ id: "d-1", name: "Municipal Lighting" }],
      department_replies: [
        { id: "r-1", ticketId: "t-1", text: "Replaced faulty LED fixture.", returned: 0, repliedAt: now }
      ],
      verification_cases: [],
      ai_call_events: [],
      audit_log: []
    };
    const db = createMockDb(store);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { eventId: "evt_123", status: "QUEUED" } }),
        { status: 202 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await queueAndDispatchAiCallOnClosure(db, env, {
      ticketId: "t-1",
      closedAt: now,
      closedBy: "officer-1"
    });

    // Duplicate call should be ignored
    await queueAndDispatchAiCallOnClosure(db, env, {
      ticketId: "t-1",
      closedAt: now,
      closedBy: "officer-1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:4000/api/events/request-closed");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.event).toBe("REQUEST_CLOSED");
    expect(sentBody.requestId).toBe("t-1");
    expect(sentBody.customer).toEqual({ name: "Karthik", phone: "+919876543210" });
    expect(sentBody.metadata.language).toBe("ta");
    expect(sentBody.metadata.organization).toBe("Municipal Lighting");
    expect(sentBody.consent.automatedCallAllowed).toBe(true);

    expect(store.ai_call_events).toHaveLength(1);
    expect(store.ai_call_events[0]!.deliveryStatus).toBe("sent");
    expect(store.ai_call_events[0]!.engineEventId).toBe("evt_123");

    // Simulate webhook lifecycle updates
    await processAiCallWebhook(db, {
      callId: "call_1",
      requestId: "t-1",
      status: "COMPLETED",
      outcome: "INFORMED",
      durationSeconds: 38
    });

    expect(store.ai_call_events[0]!.callStatus).toBe("COMPLETED");
    expect(store.ai_call_events[0]!.callOutcome).toBe("INFORMED");
    expect(store.ai_call_events[0]!.callDurationSeconds).toBe(38);
    expect(store.tickets[0]!.status).toBe("verified_resolved");
  });

  it("skips calling when consent is missing, phone is missing, or phone is invalid", async () => {
    const env = createEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // 1. Missing consent
    const storeNoConsent: InMemoryStore = {
      tickets: [{ id: "t-nc", citizenId: "u-1", title: "Issue", status: "verified_resolved", language: "en", optOut: 0 }],
      users: [{ id: "u-1", name: "A", phoneEnc: await encryptText("+919876543210", env.ENCRYPTION_KEY!), deletedAt: null }],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 0 }],
      departments: [],
      department_replies: [],
      verification_cases: [],
      ai_call_events: [],
      audit_log: []
    };
    await queueAndDispatchAiCallOnClosure(createMockDb(storeNoConsent), env, {
      ticketId: "t-nc",
      closedAt: Date.now()
    });
    expect(storeNoConsent.ai_call_events[0]!.deliveryStatus).toBe("skipped");
    expect(storeNoConsent.ai_call_events[0]!.skipReason).toBe("missing_consent");

    // 2. Missing phone
    const storeNoPhone: InMemoryStore = {
      tickets: [{ id: "t-np", citizenId: "u-1", title: "Issue", status: "verified_resolved", language: "en", optOut: 0 }],
      users: [{ id: "u-1", name: "A", phoneEnc: null, deletedAt: null }],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 1 }],
      departments: [],
      department_replies: [],
      verification_cases: [],
      ai_call_events: [],
      audit_log: []
    };
    await queueAndDispatchAiCallOnClosure(createMockDb(storeNoPhone), env, {
      ticketId: "t-np",
      closedAt: Date.now()
    });
    expect(storeNoPhone.ai_call_events[0]!.skipReason).toBe("missing_phone");

    // 3. Invalid phone
    const storeBadPhone: InMemoryStore = {
      tickets: [{ id: "t-bp", citizenId: "u-1", title: "Issue", status: "verified_resolved", language: "en", optOut: 0 }],
      users: [{ id: "u-1", name: "A", phoneEnc: await encryptText("12345", env.ENCRYPTION_KEY!), deletedAt: null }],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 1 }],
      departments: [],
      department_replies: [],
      verification_cases: [],
      ai_call_events: [],
      audit_log: []
    };
    await queueAndDispatchAiCallOnClosure(createMockDb(storeBadPhone), env, {
      ticketId: "t-bp",
      closedAt: Date.now()
    });
    expect(storeBadPhone.ai_call_events[0]!.skipReason).toBe("invalid_phone");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps pending outbox entry on temporary engine failure and retries safely", async () => {
    const env = createEnv();
    const now = Date.now();
    const store: InMemoryStore = {
      tickets: [{ id: "t-retry", citizenId: "u-1", title: "Water leak", status: "verified_resolved", language: "en", optOut: 0 }],
      users: [{ id: "u-1", name: "Meena", phoneEnc: await encryptText("+919876543210", env.ENCRYPTION_KEY!), deletedAt: null }],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 1 }],
      departments: [],
      department_replies: [],
      verification_cases: [],
      ai_call_events: [],
      audit_log: []
    };
    const db = createMockDb(store);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { eventId: "evt_retry_1", status: "QUEUED" } }), {
          status: 202
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await queueAndDispatchAiCallOnClosure(db, env, { ticketId: "t-retry", closedAt: now });
    expect(store.ai_call_events[0]!.deliveryStatus).toBe("pending");
    expect(store.ai_call_events[0]!.attempts).toBe(1);

    // Force retry window due
    store.ai_call_events[0]!.nextRetryAt = Date.now() - 1000;
    const retried = await retryPendingAiCallEvents(db, env);
    expect(retried).toBe(1);
    expect(store.ai_call_events[0]!.deliveryStatus).toBe("sent");
    expect(store.ai_call_events[0]!.engineEventId).toBe("evt_retry_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("verifies HMAC webhook signatures and persists opt-out", async () => {
    const secret = "webhook-secret-123";
    const body = JSON.stringify({ requestId: "t-opt", status: "COMPLETED", optOut: true });
    const sig = await signWebhookPayload(body, secret);

    expect(await verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(await verifyWebhookSignature(body, "deadbeef", secret)).toBe(false);

    const store: InMemoryStore = {
      tickets: [{ id: "t-opt", citizenId: "u-1", status: "verified_resolved", optOut: 0 }],
      users: [],
      consents: [{ id: "c-1", userId: "u-1", type: "phone_contact", granted: 1 }],
      departments: [],
      department_replies: [],
      verification_cases: [],
      ai_call_events: [{ id: "ace-1", ticketId: "t-opt", eventType: "REQUEST_CLOSED", callStatus: "RINGING" }],
      audit_log: []
    };
    const db = createMockDb(store);

    await processAiCallWebhook(db, {
      requestId: "t-opt",
      status: "COMPLETED",
      optOut: true
    });

    expect(store.tickets[0]!.optOut).toBe(1);
    expect(store.consents[0]!.granted).toBe(0);
    // Ticket status must remain verified_resolved
    expect(store.tickets[0]!.status).toBe("verified_resolved");
  });
});
