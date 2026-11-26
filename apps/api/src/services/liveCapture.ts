import type { Env } from "../env.js";
import { signEvidenceUrlToken, verifyEvidenceUrlToken } from "./crypto.js";

export const CAPTURE_WINDOW_MS = 4 * 60 * 1000;
export const MAX_CAPTURE_MS = 60_000;
export const MIN_CAPTURE_MS = 2_000;
export const LOCATION_MISMATCH_METERS = 1_000;

function captureSecret(env: Env): string {
  return env.SIGNING_SECRET || env.ENCRYPTION_KEY || "redressa-dev-signing-secret";
}

function captureSubject(ticketId: string, userId: string, nonce: string): string {
  return `capture:${ticketId}:${userId}:${nonce}`;
}

export async function issueCaptureToken(env: Env, ticketId: string, userId: string) {
  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + CAPTURE_WINDOW_MS;
  const sig = await signEvidenceUrlToken(
    captureSubject(ticketId, userId, nonce),
    expiresAt,
    captureSecret(env)
  );
  return {
    nonce,
    expiresAt,
    sig,
    maxSeconds: MAX_CAPTURE_MS / 1000
  };
}

export async function verifyCaptureToken(
  env: Env,
  ticketId: string,
  userId: string,
  nonce: string,
  expiresAt: number,
  sig: string
): Promise<boolean> {
  if (!nonce || !sig || !Number.isFinite(expiresAt)) return false;
  return verifyEvidenceUrlToken(
    captureSubject(ticketId, userId, nonce),
    expiresAt,
    sig,
    captureSecret(env)
  );
}

export function validateCaptureMetrics(params: {
  durationMs: number;
  lat: number;
  lng: number;
}): string | null {
  if (!Number.isFinite(params.durationMs) || params.durationMs < MIN_CAPTURE_MS) {
    return "Recording is too short. Record at least a few seconds of the site.";
  }
  if (params.durationMs > MAX_CAPTURE_MS + 1_500) {
    return "Recording exceeds the 60 second limit.";
  }
  if (
    !Number.isFinite(params.lat) ||
    !Number.isFinite(params.lng) ||
    Math.abs(params.lat) > 90 ||
    Math.abs(params.lng) > 180
  ) {
    return "GPS location is required to verify the recording.";
  }
  return null;
}

export function describeCapture(params: {
  durationMs: number;
  distanceFromReportedM: number | null;
  accuracyM: number | null;
}): string {
  const duration = `${Math.round(params.durationMs / 1000)}s live recording`;
  const accuracy =
    params.accuracyM !== null ? `, GPS accuracy ${Math.round(params.accuracyM)}m` : "";
  const location =
    params.distanceFromReportedM === null
      ? ", no reported coordinates to compare"
      : params.distanceFromReportedM > LOCATION_MISMATCH_METERS
        ? `, recorded ${Math.round(params.distanceFromReportedM)}m from the reported location`
        : `, recorded within ${Math.max(50, Math.round(params.distanceFromReportedM))}m of the reported location`;
  return `${duration}${accuracy}${location}`;
}
