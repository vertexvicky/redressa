import { describe, expect, it } from "vitest";
import {
  concatChunks,
  decodeBase64,
  encodeBase64,
  splitBytesIntoChunks
} from "../src/services/firestore.js";

describe("Firestore chunked blob helpers", () => {
  it("splits and reassembles binary payloads cleanly across chunks", () => {
    const sample = new Uint8Array(1024 * 1024 + 137);
    for (let i = 0; i < sample.length; i += 1) {
      sample[i] = i % 251;
    }

    const chunks = splitBytesIntoChunks(sample, 450 * 1024);
    expect(chunks.length).toBe(3);

    const decoded = chunks.map((chunk) => decodeBase64(encodeBase64(chunk)));
    const merged = concatChunks(decoded);
    expect(merged.byteLength).toBe(sample.byteLength);
    expect(merged[0]).toBe(sample[0]);
    expect(merged[merged.length - 1]).toBe(sample[sample.length - 1]);
  });
});
