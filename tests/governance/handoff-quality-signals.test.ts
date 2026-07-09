import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectHandoffQualitySignals } from "../../src/governance/handoff-quality-signals.js";
import type { HandoffIntelligenceRef } from "../../src/governance/handoff-intelligence-types.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";
const DETECTED_AT = "2026-07-09T12:00:00.000Z";

function handoff(overrides: Partial<HandoffIntelligenceRef> = {}): HandoffIntelligenceRef {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    handoffType: "config_update",
    createdAt: VALID_ISO,
    readinessLevel: "dry_run_capable",
    requiredEvidenceKinds: ["log_ref", "manual_verification_note"],
    ...overrides,
  };
}

function evidence(overrides: Partial<HumanExecutionEvidenceRef> = {}): HumanExecutionEvidenceRef {
  return {
    evidenceId: "ev-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    kind: "log_ref",
    uri: "https://example.com/log",
    label: "Log",
    summary: "Done",
    submittedBy: "op",
    submittedAt: VALID_ISO,
    contentHash: null,
    auditRefs: [],
    ...overrides,
  };
}

function review(overrides: Partial<HumanExecutionClosureReview> = {}): HumanExecutionClosureReview {
  return {
    closureReviewId: "cr-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    decision: "accepted",
    rationale: "Good",
    reviewedBy: "rev",
    reviewedAt: VALID_ISO,
    evidenceIds: ["ev-1"],
    followUpRequired: false,
    followUpSummary: null,
    auditRefs: [],
    ...overrides,
  };
}

describe("detectHandoffQualitySignals", () => {
  it("evidence gap detected when required evidence is missing", () => {
    const signals = detectHandoffQualitySignals(
      [handoff()], [], [], { detectedAt: DETECTED_AT },
    );
    const gaps = signals.filter((s) => s.signalCode === "evidence_gap");
    assert.ok(gaps.length > 0);
    assert.equal(gaps[0]!.severity, "critical");
  });

  it("incomplete submission detected", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ decision: "incomplete", followUpSummary: "Need more evidence" })],
      { detectedAt: DETECTED_AT },
    );
    assert.ok(signals.some((s) => s.signalCode === "incomplete_submission"));
  });

  it("follow-up needed detected", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ decision: "needs_follow_up", followUpSummary: "Follow up" })],
      { detectedAt: DETECTED_AT },
    );
    assert.ok(signals.some((s) => s.signalCode === "follow_up_needed"));
  });

  it("repeated follow-up detected as critical", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: [] })],
      [evidence({ evidenceId: "ev-1" }), evidence({ evidenceId: "ev-2" })],
      [
        review({ closureReviewId: "cr-f1", decision: "needs_follow_up", followUpSummary: "First", evidenceIds: ["ev-1"] }),
        review({ closureReviewId: "cr-f2", decision: "needs_follow_up", followUpSummary: "Second", evidenceIds: ["ev-2"] }),
      ],
      { detectedAt: DETECTED_AT },
    );
    const repeated = signals.filter((s) => s.signalCode === "repeated_follow_up");
    assert.equal(repeated.length, 1);
    assert.equal(repeated[0]!.severity, "critical");
  });

  it("slow closure detected using default 14-day threshold", () => {
    const createdAt = "2026-06-20T12:00:00.000Z"; // 18 days before VALID_ISO (July 8)
    const reviewedAt = VALID_ISO; // July 8, ~18 days later
    const signals = detectHandoffQualitySignals(
      [handoff({ createdAt, requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ reviewedAt })],
      { detectedAt: DETECTED_AT },
    );
    assert.ok(signals.some((s) => s.signalCode === "slow_closure"));
  });

  it("slow closure threshold is configurable", () => {
    const createdAt = "2026-07-06T12:00:00.000Z"; // ~2 days before reviewedAt
    const reviewedAt = VALID_ISO;
    const signals = detectHandoffQualitySignals(
      [handoff({ createdAt, requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ reviewedAt })],
      { slowClosureDays: 1, detectedAt: DETECTED_AT },
    );
    assert.ok(signals.some((s) => s.signalCode === "slow_closure"));
  });

  it("no false positives for complete accepted handoffs", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: ["log_ref"] })],
      [evidence({ kind: "log_ref" })],
      [review({ decision: "accepted" })],
      { detectedAt: DETECTED_AT },
    );
    // With log_ref evidence submitted and accepted, only readiness_mismatch could fire
    // But dry_run_capable + accepted should not mismatch
    const mismatches = signals.filter((s) => s.signalCode === "readiness_mismatch");
    assert.equal(mismatches.length, 0);
  });

  it("severity levels are correct", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: [] })],
      [evidence()],
      [review({ decision: "needs_follow_up", followUpSummary: "Follow" })],
      { detectedAt: DETECTED_AT },
    );
    const followUp = signals.find((s) => s.signalCode === "follow_up_needed");
    assert.equal(followUp?.severity, "info");
  });

  it("deterministic ordering", () => {
    const h1 = handoff({ handoffId: "ho-a", requiredEvidenceKinds: ["log_ref"] });
    const h2 = handoff({ handoffId: "ho-b", requiredEvidenceKinds: ["log_ref"] });
    const first = detectHandoffQualitySignals([h1, h2], [], [], { detectedAt: DETECTED_AT });
    const second = detectHandoffQualitySignals([h2, h1], [], [], { detectedAt: DETECTED_AT });
    assert.deepEqual(first.map((s) => s.handoffId), second.map((s) => s.handoffId));
  });

  it("no operator identity appears in signal output", () => {
    const signals = detectHandoffQualitySignals(
      [handoff({ requiredEvidenceKinds: ["log_ref"] })],
      [], [], { detectedAt: DETECTED_AT },
    );
    const json = JSON.stringify(signals);
    assert.equal(json.includes("operatorId"), false);
    assert.equal(json.includes("ranking"), false);
  });
});
