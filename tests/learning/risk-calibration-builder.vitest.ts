// tests/learning/risk-calibration-builder.vitest.ts
import { describe, it, expect } from "vitest";
import {
  RiskCalibrationBuilder,
  type RiskOutcomeObservation,
} from "../../src/learning/risk-calibration-builder.js";

const SOURCE_REPORT = "risk-cal-1";
const GENERATED_AT = "2026-06-22T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObs(
  proposalId: string,
  dims: Record<string, number>,
  outcome: string,
): RiskOutcomeObservation {
  return {
    proposalId,
    dimensions: Object.entries(dims).map(([dimension, score]) => ({
      dimension,
      score,
    })),
    outcome,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RiskCalibrationBuilder", () => {
  const builder = new RiskCalibrationBuilder();

  // -----------------------------------------------------------------------
  // Overfire detection
  // -----------------------------------------------------------------------

  it("detects overfire when high-risk proposals consistently succeed", () => {
    const observations = [
      // revertability: 3/3 high-risk all succeed
      makeObs("p1", { revertability: 0.85 }, "success"),
      makeObs("p2", { revertability: 0.9 }, "success"),
      makeObs("p3", { revertability: 0.8 }, "success"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const overfire = result.signals.find(
      (s) => s.signalType === "risk_dimension_overfire",
    );
    expect(overfire).toBeDefined();
    expect(overfire!.strength).toBeGreaterThanOrEqual(1.0); // 3/3 = 1.0 rate
  });

  it("does not overfire when high risk and actual failures occur", () => {
    const observations = [
      makeObs("p1", { governance: 0.85 }, "failure"),
      makeObs("p2", { governance: 0.9 }, "failure"),
      makeObs("p3", { governance: 0.8 }, "failure"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const overfire = result.signals.find(
      (s) => s.signalType === "risk_dimension_overfire",
    );
    expect(overfire).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Miss detection
  // -----------------------------------------------------------------------

  it("detects misses when low-risk proposals result in failure", () => {
    const observations = [
      makeObs("p1", { capability: 0.2 }, "failure"),
      makeObs("p2", { capability: 0.1 }, "failure"),
      makeObs("p3", { capability: 0.15 }, "failure"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const miss = result.signals.find(
      (s) => s.signalType === "risk_dimension_miss",
    );
    expect(miss).toBeDefined();
    expect(miss!.strength).toBeGreaterThanOrEqual(1.0);
  });

  // -----------------------------------------------------------------------
  // Mixed outcomes — proportional signals
  // -----------------------------------------------------------------------

  it("handles mixed outcomes with proportional signals", () => {
    const observations = [
      // 2/4 overfire for governance (50% rate = above default 30% threshold)
      makeObs("p1", { governance: 0.85 }, "success"),
      makeObs("p2", { governance: 0.9 }, "success"),
      makeObs("p3", { governance: 0.8 }, "failure"),
      makeObs("p4", { governance: 0.75 }, "failure"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const overfire = result.signals.find(
      (s) => s.signalType === "risk_dimension_overfire",
    );
    expect(overfire).toBeDefined();
    expect(overfire!.strength).toBeCloseTo(0.5, 1);
  });

  // -----------------------------------------------------------------------
  // Below minSamples
  // -----------------------------------------------------------------------

  it("produces zero signals with fewer than minSamples observations", () => {
    const observations = [
      makeObs("p1", { governance: 0.85 }, "success"),
      makeObs("p2", { governance: 0.9 }, "success"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Empty observations
  // -----------------------------------------------------------------------

  it("handles empty observations gracefully", () => {
    const result = builder.calibrate([], SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Ignored dimensions
  // -----------------------------------------------------------------------

  it("detects dimensions that are never assessed", () => {
    const observations = [
      // Only assessing governance, not the other expected dimensions
      makeObs("p1", { governance: 0.5 }, "success"),
      makeObs("p2", { governance: 0.6 }, "success"),
      makeObs("p3", { governance: 0.4 }, "success"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const ignored = result.signals.filter(
      (s) => s.signalType === "risk_dimension_ignored",
    );
    expect(ignored.length).toBeGreaterThan(0);
    // operational, capability, revertability, evidence_quality
    const subjects = ignored.map((s) => s.subject);
    expect(subjects.some((s) => s.includes("capability"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Profile generation (only for significant patterns)
  // -----------------------------------------------------------------------

  it("generates profiles only for significant patterns", () => {
    const observations = [
      makeObs("p1", { governance: 0.2, revertability: 0.85 }, "success"),
      makeObs("p2", { governance: 0.1, revertability: 0.9 }, "success"),
      makeObs("p3", { governance: 0.15, revertability: 0.8 }, "failure"),
    ];
    // governance: no overfire/miss pattern (all 3 are low risk, but not all failures)
    // revertability: 1 overfire (p1, p2 are high risk + success), but 2/3 = 0.67 rate

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    // revertability should have an overfire signal
    expect(
      result.signals.some((s) => s.signalType === "risk_dimension_overfire"),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Custom thresholds
  // -----------------------------------------------------------------------

  it("respects custom thresholds", () => {
    const strict = new RiskCalibrationBuilder({
      highRiskThreshold: 0.9,
      lowRiskThreshold: 0.1,
      minSamples: 10,
      rateThreshold: 0.5,
    });

    const observations = [
      makeObs("p1", { governance: 0.85 }, "success"),
      makeObs("p2", { governance: 0.92 }, "success"),
      makeObs("p3", { governance: 0.88 }, "success"),
    ];

    const result = strict.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // No overfire for partial_success (per spec: only "success" counts)
  // -----------------------------------------------------------------------

  it("counts only 'success' as overfire, not partial_success", () => {
    const observations = [
      // p1 is high risk + partial_success → NOT an overfire per spec
      makeObs("p1", { governance: 0.85 }, "partial_success"),
      // p2 is high risk + failure → definitely not an overfire
      makeObs("p2", { governance: 0.9 }, "failure"),
      // p3 is high risk + success → overfire
      makeObs("p3", { governance: 0.8 }, "success"),
    ];

    const result = builder.calibrate(observations, SOURCE_REPORT, GENERATED_AT);
    const overfire = result.signals.find(
      (s) => s.signalType === "risk_dimension_overfire",
    );
    // Only p3 counts: 1/3 = 0.33, just above 0.3 threshold
    expect(overfire).toBeDefined();
    expect(overfire!.strength).toBeCloseTo(0.33, 1);
  });
});
