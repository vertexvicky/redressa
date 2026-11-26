import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware, jsonError, type AppVariables } from "./auth/guard.js";
import { createDb } from "./db/client.js";
import { CaseRoom } from "./do/CaseRoom.js";
import { VoiceSession } from "./do/VoiceSession.js";
import type { AgentEventMessage, Env, EvidenceJobMessage } from "./env.js";
import { handleScheduledCron } from "./jobs/cron.js";
import { handleQueueBatch } from "./jobs/queue.js";
import { adminRoutes } from "./routes/admin.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { demoRoutes } from "./routes/demo.js";
import { evidencePublicFileRoutes, evidenceRoutes } from "./routes/evidence.js";
import { intakeRoutes } from "./routes/intake.js";
import { integrationRoutes } from "./routes/integrations.js";
import { meRoutes } from "./routes/me.js";
import { caseMessageRoutes } from "./routes/messages.js";
import { officerRoutes } from "./routes/officer.js";
import { reviewRoutes } from "./routes/review.js";
import { recordRoutes } from "./routes/records.js";
import { ticketRoutes } from "./routes/tickets.js";
import { voiceRoutes } from "./routes/voice.js";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  c.set("requestId", requestId);
  c.set("db", createDb(c.env.DB));
  const started = Date.now();
  await next();
  c.header("x-request-id", requestId);
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  c.header(
    "content-security-policy",
    "default-src 'self'; connect-src 'self' https://securetoken.google.com https://identitytoolkit.googleapis.com wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'"
  );
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - started
    })
  );
});

app.use("*", async (c, next) => {
  const allowedOrigin = c.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const allowedOrigins = new Set([
    allowedOrigin,
    "https://redressa-web.thevertexvicky.workers.dev",
    "https://redressa.thevertexvicky.workers.dev",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);
  const middleware = cors({
    origin: (origin) => {
      if (!origin) return allowedOrigin;
      if (allowedOrigins.has(origin)) {
        return origin;
      }
      return allowedOrigin;
    },
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400
  });
  return middleware(c, next);
});

app.get("/health", async (c) => {
  let dbOk = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    service: "redressa-api",
    status: dbOk ? "ok" : "degraded",
    timestamp: new Date().toISOString()
  });
});

app.route("/api/v1/dashboard", dashboardRoutes);
app.route("/api/v1/evidence", evidencePublicFileRoutes);
app.route("/api/v1/integrations", integrationRoutes);

const authed = new Hono<{ Bindings: Env; Variables: AppVariables }>();
authed.use("*", authMiddleware);
authed.route("/me", meRoutes);
authed.route("/intake", intakeRoutes);
authed.route("/tickets", ticketRoutes);
authed.route("/evidence", evidenceRoutes);
authed.route("/records", recordRoutes);
authed.route("/cases", caseMessageRoutes);
authed.route("/officer", officerRoutes);
authed.route("/review", reviewRoutes);
authed.route("/demo", demoRoutes);
authed.route("/voice", voiceRoutes);
authed.route("/admin", adminRoutes);

app.route("/api/v1", authed);

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"));

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      requestId: c.get("requestId"),
      error: err.message
    })
  );
  return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error");
});

export { CaseRoom, VoiceSession };

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<AgentEventMessage | EvidenceJobMessage>, env: Env) {
    await handleQueueBatch(batch, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduledCron(controller, env));
  }
};
