import { importPKCS8, SignJWT } from "jose";
import type { Env } from "../env.js";

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const CHUNK_RAW_BYTES = 450 * 1024;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function splitBytesIntoChunks(bytes: Uint8Array, chunkSize = CHUNK_RAW_BYTES): Uint8Array[] {
  if (bytes.byteLength === 0) return [new Uint8Array(0)];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  }
  return chunks;
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function getFirestoreAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = env.FIREBASE_PRIVATE_KEY;
  if (!clientEmail || !rawPrivateKey) {
    throw new Error(
      "Firestore storage requires FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY Worker secrets"
    );
  }

  const normalizedKey = rawPrivateKey.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(normalizedKey, "RS256");

  const assertion = await new SignJWT({ scope: FIRESTORE_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to obtain Firestore OAuth token: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000
  };
  return cachedToken.accessToken;
}

function firestoreDocUrl(projectId: string, collection: string, docId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
}

async function upsertFirestoreDoc(
  projectId: string,
  accessToken: string,
  collection: string,
  docId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const response = await fetch(firestoreDocUrl(projectId, collection, docId), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ fields })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore write failed (${collection}/${docId}): ${response.status} ${text}`);
  }
}

async function readFirestoreDoc(
  projectId: string,
  accessToken: string,
  collection: string,
  docId: string
): Promise<Record<string, { stringValue?: string; integerValue?: string }> | null> {
  const response = await fetch(firestoreDocUrl(projectId, collection, docId), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore read failed (${collection}/${docId}): ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    fields?: Record<string, { stringValue?: string; integerValue?: string }>;
  };
  return json.fields ?? null;
}

export async function putFirestoreEvidenceBlob(params: {
  env: Env;
  evidenceId: string;
  ticketId: string;
  uploaderId: string;
  mime: string;
  sha256: string;
  bytes: Uint8Array;
}): Promise<string> {
  const accessToken = await getFirestoreAccessToken(params.env);
  const projectId = params.env.FIREBASE_PROJECT_ID;
  const chunks = splitBytesIntoChunks(params.bytes);

  await upsertFirestoreDoc(projectId, accessToken, "evidence_blobs", params.evidenceId, {
    ticketId: { stringValue: params.ticketId },
    uploaderId: { stringValue: params.uploaderId },
    mime: { stringValue: params.mime },
    sha256: { stringValue: params.sha256 },
    size: { integerValue: String(params.bytes.byteLength) },
    chunkCount: { integerValue: String(chunks.length) },
    createdAt: { integerValue: String(Date.now()) }
  });

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkDocId = `${params.evidenceId}_${i}`;
    await upsertFirestoreDoc(projectId, accessToken, "evidence_chunks", chunkDocId, {
      evidenceId: { stringValue: params.evidenceId },
      index: { integerValue: String(i) },
      dataBase64: { stringValue: encodeBase64(chunks[i]!) }
    });
  }

  return `firestore://evidence_blobs/${params.evidenceId}`;
}

export async function getFirestoreEvidenceBlob(
  env: Env,
  evidenceId: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const accessToken = await getFirestoreAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const meta = await readFirestoreDoc(projectId, accessToken, "evidence_blobs", evidenceId);
  if (!meta) return null;

  const chunkCount = Number.parseInt(meta.chunkCount?.integerValue ?? "0", 10);
  const mime = meta.mime?.stringValue ?? "application/octet-stream";
  if (chunkCount <= 0) return null;

  const chunkBuffers: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const chunkDoc = await readFirestoreDoc(
      projectId,
      accessToken,
      "evidence_chunks",
      `${evidenceId}_${i}`
    );
    const b64 = chunkDoc?.dataBase64?.stringValue;
    if (!b64) {
      throw new Error(`Missing Firestore evidence chunk ${i} for ${evidenceId}`);
    }
    chunkBuffers.push(decodeBase64(b64));
  }

  return {
    bytes: concatChunks(chunkBuffers),
    mime
  };
}
