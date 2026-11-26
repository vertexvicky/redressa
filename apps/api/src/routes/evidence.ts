import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { jsonError, type AppVariables } from "../auth/guard.js";
import { evidence } from "../db/schema.js";
import type { Env } from "../env.js";
import { hasConsent } from "../services/consent.js";
import { verifyEvidenceUrlToken } from "../services/crypto.js";
import {
  createSignedEvidenceDownloadPath,
  readEvidenceBytes,
  storeEvidenceFile
} from "../services/storage.js";

export const evidenceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

evidenceRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const formData = await c.req.formData();

  const file = formData.get("file") as unknown;
  const ticketId = formData.get("ticketId");
  const verificationCaseId = formData.get("verificationCaseId");
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");

  const isUploadedFile =
    typeof file === "object" &&
    file !== null &&
    "arrayBuffer" in file &&
    typeof (file as { arrayBuffer: unknown }).arrayBuffer === "function";

  if (!isUploadedFile || typeof ticketId !== "string" || !ticketId) {
    return jsonError(c, 400, "VALIDATION_ERROR", "file and ticketId are required");
  }

  const uploadedFile = file as { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> };
  const fileName = uploadedFile.name || "evidence.bin";
  let mime = uploadedFile.type?.trim() || "";
  if (!mime || mime === "application/octet-stream") {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".pdf")) mime = "application/pdf";
    else if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (lower.endsWith(".webp")) mime = "image/webp";
    else if (lower.endsWith(".txt") || lower.endsWith(".csv") || lower.endsWith(".log")) mime = "text/plain";
    else if (lower.endsWith(".mp4")) mime = "video/mp4";
    else mime = "application/octet-stream";
  }

  let geo: { lat: number; lng: number } | null = null;
  if (typeof latRaw === "string" && typeof lngRaw === "string") {
    const lat = Number.parseFloat(latRaw);
    const lng = Number.parseFloat(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const geoConsent = await hasConsent(db, user.id, "geolocation");
      if (geoConsent) {
        geo = { lat, lng };
      }
    }
  }

  try {
    const bytes = new Uint8Array(await uploadedFile.arrayBuffer());
    const stored = await storeEvidenceFile({
      env: c.env,
      db,
      ticketId,
      verificationCaseId: typeof verificationCaseId === "string" ? verificationCaseId : null,
      uploaderId: user.id,
      fileName,
      mime,
      bytes,
      geo
    });
    const signedUrl = await createSignedEvidenceDownloadPath(stored.id, c.env);
    return c.json({ evidence: stored, signedUrl }, 201);
  } catch (err) {
    return jsonError(
      c,
      400,
      "EVIDENCE_UPLOAD_FAILED",
      err instanceof Error ? err.message : "Upload failed"
    );
  }
});

evidenceRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const [ev] = await db.select().from(evidence).where(eq(evidence.id, id)).limit(1);
  if (!ev) return jsonError(c, 404, "NOT_FOUND", "Evidence not found");

  const signedUrl = await createSignedEvidenceDownloadPath(id, c.env);
  return c.json({ evidence: ev, signedUrl });
});

export const evidencePublicFileRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

evidencePublicFileRoutes.get("/:id/file", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const exp = Number.parseInt(c.req.query("exp") ?? "0", 10);
  const sig = c.req.query("sig") ?? "";
  const secret = c.env.SIGNING_SECRET || c.env.ENCRYPTION_KEY || "redressa-dev-signing-secret";

  const valid = await verifyEvidenceUrlToken(id, exp, sig, secret);
  if (!valid) {
    return jsonError(c, 403, "INVALID_SIGNATURE", "Signed evidence URL expired or invalid");
  }

  const [ev] = await db.select().from(evidence).where(eq(evidence.id, id)).limit(1);
  if (!ev) return jsonError(c, 404, "NOT_FOUND", "Evidence not found");

  const stored = await readEvidenceBytes(c.env, ev.id);
  if (!stored) return jsonError(c, 404, "NOT_FOUND", "Evidence file missing from Firestore");

  return new Response(stored.bytes, {
    headers: {
      "content-type": ev.mime,
      "cache-control": "private, max-age=300"
    }
  });
});
