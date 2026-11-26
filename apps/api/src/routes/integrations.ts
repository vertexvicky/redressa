import { Hono } from "hono";
import { z } from "zod";
import { jsonError, type AppVariables } from "../auth/guard.js";
import type { Env } from "../env.js";
import {
  processAiCallWebhook,
  verifyWebhookSignature
} from "../services/aiCallEngine.js";

const WebhookPayloadSchema = z.object({
  callId: z.string().optional(),
  providerCallId: z.string().optional(),
  requestId: z.string().min(1),
  status: z.string().min(1),
  outcome: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  optOut: z.boolean().optional(),
  timestamp: z.string().optional()
});

export const integrationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

integrationRoutes.post("/ai-call-engine/webhook", async (c) => {
  const secret = c.env.AI_CALL_ENGINE_WEBHOOK_SECRET;
  const rawBody = await c.req.text();

  if (secret) {
    const sig = c.req.header("x-ai-call-engine-signature") || "";
    const valid = await verifyWebhookSignature(rawBody, sig, secret);
    if (!valid) {
      return jsonError(c, 401, "INVALID_SIGNATURE", "Webhook signature verification failed");
    }
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(c, 400, "INVALID_JSON", "Malformed JSON payload");
  }

  const parsed = WebhookPayloadSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return jsonError(c, 400, "VALIDATION_ERROR", "Invalid webhook payload", parsed.error.flatten());
  }

  const result = await processAiCallWebhook(c.get("db"), parsed.data);
  return c.json({ ok: true, updated: result.updated });
});
