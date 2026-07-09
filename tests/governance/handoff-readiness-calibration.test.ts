import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calibrateReadiness } from "../../src/governance/handoff-readiness-calibration.js";
import type { HandoffIntelligenceRef } from "../../src/governance/handoff-intelligence-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

function handoff(overrides: Partial<HandoffIntelligenceRef> = {}): HandoffIntelligenceRef {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    handoffType: "config_update",
    createdAt: VALID_ISO,
    readinessLevel: "dry_run_capable",
    requiredEvidenceKinds: ["log_ref"],
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

describe("calibrateReadiness", () => {
  it("accurate for matching readiness + accepted", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "dry_run_capable" })],
      [review({ decision: "accepted" })],
    );
    assert.equal(signals[0]!.calibration, "accurate");
  });

  it("overconfident for higher-readiness + rejected", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "dry_run_capable" })],
      [review({ decision: "rejected" })],
    );
    assert.equal(signals[0]!.calibration, "overconfident");
  });

  it("overconfident for higher-readiness + incomplete", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "reversible" })],
      [review({ decision: "incomplete", followUpSummary: "Need more" })],
    );
    assert.equal(signals[0]!.calibration, "overconfident");
  });

  it("underconfident for manual_only + accepted", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "manual_only" })],
      [review({ decision: "accepted" })],
    );
    assert.equal(signals[0]!.calibration, "underconfident");
  });

  it("accurate for manual_only + rejected", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "manual_only" })],
      [review({ decision: "rejected" })],
    );
    assert.equal(signals[0]!.calibration, "accurate");
  });

  it("needs_follow_up treated as overconfident for higher readiness", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "dry_run_capable" })],
      [review({ decision: "needs_follow_up", followUpSummary: "Follow" })],
    );
    assert.equal(signals[0]!.calibration, "overconfident");
  });

  it("handoff without closure review is excluded", () => {
    const signals = calibrateReadiness([handoff()], []);
    assert.equal(signals.length, 0);
  });

  it("latest review wins deterministically", () => {
    const signals = calibrateReadiness(
      [handoff({ handoffId: "ho-latest" })],
      [
        review({ closureReviewId: "cr-first", handoffId: "ho-latest", decision: "incomplete", followUpSummary: "First", reviewedAt: "2026-07-07T12:00:00.000Z", evidenceIds: ["ev-1"] }),
        review({ closureReviewId: "cr-second", handoffId: "ho-latest", decision: "accepted", reviewedAt: "2026-07-08T12:00:00.000Z", evidenceIds: ["ev-2"] }),
      ],
    );
    assert.equal(signals[0]!.calibration, "accurate");
    assert.equal(signals[0]!.closureDecision, "accepted");
  });

  it("evidenceComplete and evidenceCount computed correctly", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "dry_run_capable" })],
      [review({ decision: "accepted", evidenceIds: ["ev-1", "ev-2"] })],
    );
    assert.equal(signals[0]!.evidenceComplete, true);
    assert.equal(signals[0]!.evidenceCount, 2);
  });

  it("no operator identity appears in calibration output", () => {
    const signals = calibrateReadiness(
      [handoff({ readinessLevel: "dry_run_capable" })],
      [review({ decision: "accepted" })],
    );
    const json = JSON.stringify(signals);
    assert.equal(json.includes("operatorId"), false);
    assert.equal(json.includes("ranking"), false);
  });
});
