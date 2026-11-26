import { describe, expect, it } from "vitest";
import {
  ALLOWED_TICKET_TRANSITIONS,
  ExpectationContractPayloadSchema,
  VerdictSchema
} from "../src/index.js";

describe("shared schemas and state machine", () => {
  it("enforces valid ticket transitions and blocks closed_final exits", () => {
    expect(ALLOWED_TICKET_TRANSITIONS.draft).toEqual(["intake_audit"]);
    expect(ALLOWED_TICKET_TRANSITIONS.department_replied).toContain("reply_returned");
    expect(ALLOWED_TICKET_TRANSITIONS.closed_final).toEqual([]);
  });

  it("validates structured Verdict JSON", () => {
    const parsed = VerdictSchema.parse({
      verdict: "needs_review",
      confidence: 0.87,
      criteria_results: [
        {
          criterion_id: "c1",
          met: false,
          evidence_ids: [],
          note: "Buses still skip GH stop"
        }
      ],
      reasons: ["Withdrawal occurred within 24h of logged department contact."],
      signals: [
        {
          name: "withdrawal_soon_after_dept_contact",
          present: true,
          detail: "Call logged 30 minutes prior"
        }
      ],
      recommended_action: "escalate",
      citizen_summary: "Your case stays open for verification."
    });
    expect(parsed.verdict).toBe("needs_review");
  });

  it("requires 2 to 6 criteria in ExpectationContractPayloadSchema", () => {
    expect(() =>
      ExpectationContractPayloadSchema.parse({
        core_question: "Why do express buses skip GH stop?",
        user_intent: "Express buses must stop at GH.",
        desired_outcome: "Buses halt reliably.",
        jurisdiction_note: "Transport Division",
        urgency: "high",
        criteria: [{ text: "Only one", verification_method: "photo", critical: true }],
        response_requirements: [
          { label: "Reason", description: "Explain why", evidence_required: false },
          { label: "Order", description: "Attach order", evidence_required: true }
        ]
      })
    ).toThrow();
  });
});
