import { describe, expect, it } from "vitest";
import { composeFallbackFinalReply } from "../src/agent/replyReview.js";
import { applyCaptureChecks } from "../src/agent/siteInspection.js";
import { haversineMeters } from "../src/services/geo.js";
import {
  issueCaptureToken,
  validateCaptureMetrics,
  verifyCaptureToken
} from "../src/services/liveCapture.js";
import { buildFtsQuery } from "../src/services/replyIndex.js";
import {
  buildWithdrawalQuestions,
  computeWithdrawalOutcome
} from "../src/services/withdrawal.js";
import type { Env } from "../src/env.js";

describe("core citizen-first verification flows", () => {
  it("builds safe FTS5 search queries and strips stopwords", () => {
    expect(buildFtsQuery("Why are express buses skipping the GH stop?")).toBe(
      '"express" OR "buses" OR "skipping" OR "stop"'
    );
    expect(buildFtsQuery("the and for")).toBeNull();
  });

  it("composes consolidated fallback reply when multiple rounds occurred", () => {
    const out = composeFallbackFinalReply("Express bus GH stop", [
      "Action taken.",
      "Circular #442 issued; express buses halt at GH stop from 12 Dec."
    ]);
    expect(out).toContain("Express bus GH stop");
    expect(out).toContain("Circular #442");
  });

  it("issues and verifies single-use live capture tokens and rejects invalid metrics", async () => {
    const env = { SIGNING_SECRET: "test-secret" } as Env;
    const token = await issueCaptureToken(env, "ticket-1", "user-1");
    expect(
      await verifyCaptureToken(env, "ticket-1", "user-1", token.nonce, token.expiresAt, token.sig)
    ).toBe(true);
    expect(
      await verifyCaptureToken(env, "ticket-2", "user-1", token.nonce, token.expiresAt, token.sig)
    ).toBe(false);

    expect(validateCaptureMetrics({ durationMs: 500, lat: 13.08, lng: 80.27 })).toContain("short");
    expect(validateCaptureMetrics({ durationMs: 65_000, lat: 13.08, lng: 80.27 })).toContain("60");
    expect(
      validateCaptureMetrics({ durationMs: 12_000, lat: Number.NaN, lng: 80.27 })
    ).toContain("GPS");
    expect(validateCaptureMetrics({ durationMs: 12_000, lat: 13.08, lng: 80.27 })).toBeNull();
  });

  it("caps video assessment confidence when GPS distance exceeds 1km", () => {
    const distance = haversineMeters({ lat: 13.0827, lng: 80.2707 }, { lat: 13.1027, lng: 80.2707 });
    expect(distance).toBeGreaterThan(1000);
    const checked = applyCaptureChecks(
      {
        assessment: "issue_confirmed",
        confidence: 0.92,
        summary: "Clear issue visible.",
        observations: [],
        safety_flags: [],
        urgent_hazard: false,
        missing_footage: [],
        recommended_next_steps: [],
        status_update: "Confirmed.",
        context_brief: "Confirmed.",
        round: 1,
        rounds_remaining: 4,
        disclaimer: "AI opinion",
        guardrail_notes: [],
        context_chars: 0
      },
      distance
    );
    expect(checked.confidence).toBeLessThanOrEqual(0.45);
    expect(checked.assessment).toBe("issue_partially_visible");
    expect(checked.missing_footage.length).toBe(1);
  });

  it("builds neutral withdrawal outcome questions and computes outcome", () => {
    const questions = buildWithdrawalQuestions(
      [
        { text: "Express buses halt at GH stop", critical: 1 },
        { text: "Depot circular issued", critical: 0 }
      ],
      "Buses halt reliably"
    );
    expect(questions.length).toBe(2);
    expect(questions[0]!.text).toContain("Has this actually happened");

    expect(
      computeWithdrawalOutcome(questions, [
        { question_id: "c1", answer: "yes" },
        { question_id: "c2", answer: "yes" }
      ])
    ).toBe("resolved");

    expect(
      computeWithdrawalOutcome(questions, [
        { question_id: "c1", answer: "no" },
        { question_id: "c2", answer: "yes" }
      ])
    ).toBe("not_resolved");
  });
});
