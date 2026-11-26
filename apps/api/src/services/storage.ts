import type { AppDb } from "../db/client.js";
import { evidence } from "../db/schema.js";
import type { Env } from "../env.js";
import { sha256Hex, signEvidenceUrlToken } from "./crypto.js";
import { getFirestoreEvidenceBlob, putFirestoreEvidenceBlob } from "./firestore.js";

export interface VirusScanner {
  scan(bytes: Uint8Array, mime: string): Promise<{ clean: boolean; reason?: string }>;
}

export class NoopVirusScanner implements VirusScanner {
  async scan(): Promise<{ clean: boolean }> {
    return { clean: true };
  }
}

export const ALLOWED_EVIDENCE_LIMITS: Record<string, number> = {
  "image/jpeg": 15 * 1024 * 1024,
  "image/png": 15 * 1024 * 1024,
  "image/webp": 15 * 1024 * 1024,
  "video/mp4": 50 * 1024 * 1024,
  "application/pdf": 20 * 1024 * 1024,
  "text/plain": 5 * 1024 * 1024,
  "audio/mp4": 20 * 1024 * 1024,
  "audio/x-m4a": 20 * 1024 * 1024,
  "audio/ogg": 20 * 1024 * 1024,
  "audio/mpeg": 20 * 1024 * 1024
};

export function extractBasicExifMetadata(bytes: Uint8Array, mime: string): Record<string, unknown> | null {
  if (mime !== "image/jpeg" || bytes.length < 12) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const textChunk = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const dateMatch = textChunk.match(/(\d{4}:\d{2}:\d{2}\s\d{2}:\d{2}:\d{2})/);
  return {
    format: "jpeg",
    hasApp1: textChunk.includes("Exif"),
    capturedAt: dateMatch ? dateMatch[1] : null
  };
}

export async function storeEvidenceFile(params: {
  env: Env;
  db: AppDb;
  ticketId: string;
  verificationCaseId?: string | null;
  uploaderId: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
  geo?: { lat: number; lng: number } | null;
  scanner?: VirusScanner;
}) {
  const maxSize = ALLOWED_EVIDENCE_LIMITS[params.mime];
  if (!maxSize) {
    throw new Error(`Unsupported evidence MIME type: ${params.mime}`);
  }
  if (params.bytes.byteLength === 0 || params.bytes.byteLength > maxSize) {
    throw new Error(`File size out of allowed range for ${params.mime}`);
  }

  const scanner: VirusScanner = params.scanner ?? new NoopVirusScanner();
  const scanResult = await scanner.scan(params.bytes, params.mime);
  if (!scanResult.clean) {
    throw new Error(scanResult.reason ?? "Evidence failed security scan");
  }

  const sha256 = await sha256Hex(params.bytes);
  const exif = extractBasicExifMetadata(params.bytes, params.mime);
  const evidenceId = crypto.randomUUID();
  const now = Date.now();

  const storageKey = await putFirestoreEvidenceBlob({
    env: params.env,
    evidenceId,
    ticketId: params.ticketId,
    uploaderId: params.uploaderId,
    mime: params.mime,
    sha256,
    bytes: params.bytes
  });

  await params.db.insert(evidence).values({
    id: evidenceId,
    ticketId: params.ticketId,
    verificationCaseId: params.verificationCaseId ?? null,
    uploaderId: params.uploaderId,
    r2Key: storageKey,
    mime: params.mime,
    size: params.bytes.byteLength,
    sha256,
    exif,
    geo: params.geo ?? null,
    createdAt: now,
    updatedAt: now
  });

  await params.env.EVIDENCE_JOBS.send({
    evidenceId,
    ticketId: params.ticketId,
    storageKey,
    mime: params.mime
  });

  return {
    id: evidenceId,
    storageKey,
    mime: params.mime,
    size: params.bytes.byteLength,
    sha256,
    exif,
    geo: params.geo ?? null,
    createdAt: now
  };
}

export async function readEvidenceBytes(
  env: Env,
  evidenceId: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  return getFirestoreEvidenceBlob(env, evidenceId);
}

export async function createSignedEvidenceDownloadPath(
  evidenceId: string,
  env: Env,
  ttlSeconds = 300
): Promise<string> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const secret = env.SIGNING_SECRET || env.ENCRYPTION_KEY || "redressa-dev-signing-secret";
  const sig = await signEvidenceUrlToken(evidenceId, expiresAt, secret);
  return `/api/v1/evidence/${evidenceId}/file?exp=${expiresAt}&sig=${sig}`;
}
