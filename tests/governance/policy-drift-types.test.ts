import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY_DRIFT_THRESHOLDS } from "../../src/governance/policy-drift-types.js";
import type {
  PolicyDriftSignalKind,
  PolicyDriftDirection,
  PolicyDriftSeverity,
  PolicyDriftSignal,
  PolicyDriftThresholds,
} from "../../src/governance/policy-drift-types.js";

describe("PolicyDriftTypes", () => {

  it("has 6 signal kinds", () => {
    const kinds: PolicyDriftSignalKind[] = [
      "calibration_skew",
      "replay_divergence",
      "convergent_gap",
      "trend_direction",
      "evidence_coverage",
      "volatility",
    ];
    assert.equal(kinds.length, 6);
  });

  it("has 7 drift directions", () => {
    const dirs: PolicyDriftDirection[] = [
      "too_loose",
      "too_strict",
      "stale",
      "unstable",
      "improving",
      "insufficient_evidence",
      "neutral",
    ];
    assert.equal(dirs.length, 7);
  });

  it("has 4 severity levels", () => {
    const sevs: PolicyDriftSeverity[] = ["none", "low", "medium", "high"];
    assert.equal(sevs.length, 4);
  });

  it("DEFAULT_POLICY_DRIFT_THRESHOLDS has all 3 threshold groups", () => {
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew);
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence);
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap);
  });

  it("calibrationSkew medium threshold defaults to 0.60 rate / 10 sample", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew.medium;
    assert.equal(t.minRate, 0.60);
    assert.equal(t.minSampleSize, 10);
  });

  it("calibrationSkew high threshold defaults to 0.70 rate / 20 sample", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew.high;
    assert.equal(t.minRate, 0.70);
    assert.equal(t.minSampleSize, 20);
  });

  it("replayDivergence medium threshold defaults to 0.40 rate / 10 replays", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence.medium;
    assert.equal(t.minRate, 0.40);
    assert.equal(t.minReplayCount, 10);
  });

  it("replayDivergence high threshold defaults to 0.60 rate / 20 replays", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence.high;
    assert.equal(t.minRate, 0.60);
    assert.equal(t.minReplayCount, 20);
  });

  it("convergentGap medium threshold defaults to 0.30 rate / 8 paired", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap.medium;
    assert.equal(t.minRate, 0.30);
    assert.equal(t.minPairedCount, 8);
  });

  it("convergentGap high threshold defaults to 0.50 rate / 12 paired", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap.high;
    assert.equal(t.minRate, 0.50);
    assert.equal(t.minPairedCount, 12);
  });
});
