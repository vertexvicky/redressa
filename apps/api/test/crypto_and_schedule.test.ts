import { describe, expect, it } from "vitest";
import { clampToIstContactWindow } from "../src/agent/tools/schedule.js";
import {
  decryptText,
  encryptText,
  sha256Hex,
  signEvidenceUrlToken,
  verifyEvidenceUrlToken
} from "../src/services/crypto.js";

describe("crypto and scheduling helpers", () => {
  it("encrypts and decrypts phone numbers with AES-GCM", async () => {
    const key = btoa("redressa-32-byte-encryption-key!");
    const encrypted = await encryptText("+919876543210", key);
    expect(encrypted).not.toContain("9876543210");
    const decrypted = await decryptText(encrypted, key);
    expect(decrypted).toBe("+919876543210");
  });

  it("signs and verifies short-lived evidence download tokens", async () => {
    const secret = "test-signing-secret";
    const expiresAt = Date.now() + 60_000;
    const sig = await signEvidenceUrlToken("ev-1", expiresAt, secret);
    expect(await verifyEvidenceUrlToken("ev-1", expiresAt, sig, secret)).toBe(true);
    expect(await verifyEvidenceUrlToken("ev-2", expiresAt, sig, secret)).toBe(false);
    expect(await verifyEvidenceUrlToken("ev-1", Date.now() - 1000, sig, secret)).toBe(false);
  });

  it("computes deterministic SHA-256 hex digests", async () => {
    const hash = await sha256Hex("hello-redressa");
    expect(hash).toHaveLength(64);
  });

  it("clamps follow-up timestamps inside 09:00-20:00 IST", () => {
    const lateUtc = Date.UTC(2026, 10, 26, 16, 0, 0);
    const clamped = clampToIstContactWindow(lateUtc, "09:00", "20:00");
    const istMinutes = ((clamped + 5.5 * 3600 * 1000) / 60000) % (24 * 60);
    expect(Math.round(istMinutes)).toBe(9 * 60);
  });
});
