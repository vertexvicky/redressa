import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

interface CertCacheEntry {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCacheEntry | null = null;

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  name: string | null;
  isAnonymous: boolean;
}

function parseMaxAge(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match?.[1]) return 3600;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

export async function fetchFirebaseCerts(
  fetcher: typeof fetch = fetch
): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) {
    return certCache.certs;
  }

  const response = await fetcher(FIREBASE_CERTS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Firebase public certificates: ${response.status}`);
  }

  const certs = (await response.json()) as Record<string, string>;
  const maxAgeSeconds = parseMaxAge(response.headers.get("cache-control"));
  certCache = {
    certs,
    expiresAt: now + maxAgeSeconds * 1000
  };
  return certs;
}

export function clearFirebaseCertCache(): void {
  certCache = null;
}

export async function verifyFirebaseTokenWithCerts(
  token: string,
  projectId: string,
  certs: Record<string, string>,
  now?: Date
): Promise<VerifiedFirebaseUser> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid token header");
  }

  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error("Unknown key ID");
  }

  const publicKey = await importX509(certPem, "RS256");
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    currentDate: now
  });

  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Missing subject claim");
  }

  const firebaseClaim = payload.firebase as
    | { sign_in_provider?: string }
    | undefined;
  const isAnonymous = firebaseClaim?.sign_in_provider === "anonymous";

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    isAnonymous
  };
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<VerifiedFirebaseUser> {
  const certs = await fetchFirebaseCerts(fetcher);
  return verifyFirebaseTokenWithCerts(token, projectId, certs);
}
