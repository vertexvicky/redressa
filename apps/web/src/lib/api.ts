import { getCurrentIdToken } from "./firebase.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787").replace(/\/$/, "");

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!options.skipAuth) {
    const token = await getCurrentIdToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let payload: { code?: string; message?: string; details?: unknown } = {};
    try {
      payload = (await response.json()) as { code?: string; message?: string; details?: unknown };
    } catch {
    }
    throw new ApiRequestError(
      response.status,
      payload.code ?? "HTTP_ERROR",
      payload.message ?? `Request failed (${response.status})`,
      payload.details
    );
  }

  return (await response.json()) as T;
}

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900_000) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg"
    });
  } catch {
    return file;
  }
}

export async function uploadEvidenceFile(params: {
  file: File;
  ticketId: string;
  verificationCaseId?: string;
  lat?: number;
  lng?: number;
}) {
  const prepared = await compressImageIfNeeded(params.file);
  const form = new FormData();
  form.append("file", prepared);
  form.append("ticketId", params.ticketId);
  if (params.verificationCaseId) {
    form.append("verificationCaseId", params.verificationCaseId);
  }
  if (params.lat !== undefined && params.lng !== undefined) {
    form.append("lat", String(params.lat));
    form.append("lng", String(params.lng));
  }

  return apiFetch<{
    evidence: {
      id: string;
      mime: string;
      size: number;
      sha256: string;
    };
    signedUrl: string;
  }>("/api/v1/evidence", {
    method: "POST",
    body: form
  });
}

export async function buildWsUrl(path: string): Promise<string> {
  const token = await getCurrentIdToken();
  const wsBase = API_BASE.replace(/^http/, "ws");
  const separator = path.includes("?") ? "&" : "?";
  return token ? `${wsBase}${path}${separator}token=${encodeURIComponent(token)}` : `${wsBase}${path}`;
}

export function resolveApiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}
