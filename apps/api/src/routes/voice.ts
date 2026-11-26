import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import type { Env } from "../env.js";
import { hasConsent } from "../services/consent.js";

export const voiceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

voiceRoutes.get("/session", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");

  const allowed = await hasConsent(db, user.id, "voice");
  if (!allowed) {
    return jsonError(c, 403, "VOICE_CONSENT_REQUIRED", "Explicit voice consent is required");
  }

  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(c, 400, "UPGRADE_REQUIRED", "Expected WebSocket upgrade");
  }

  const caseId = c.req.query("caseId") ?? "";
  const conversationId = c.req.query("conversationId") ?? "";
  const sessionKey = `${user.id}:${caseId || "general"}`;
  const id = c.env.VOICE_SESSION.idFromName(sessionKey);
  const stub = c.env.VOICE_SESSION.get(id);

  const forwardUrl = new URL(c.req.url);
  forwardUrl.searchParams.set("userId", user.id);
  if (caseId) forwardUrl.searchParams.set("caseId", caseId);
  if (conversationId) forwardUrl.searchParams.set("conversationId", conversationId);

  return stub.fetch(new Request(forwardUrl.toString(), c.req.raw));
});
