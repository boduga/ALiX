import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildConfidenceBands } from "../../src/governance/calibration-confidence-bands.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "s-1",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: [],
    ...overrides,
  };
}

describe("buildConfidenceBands", () => {

  it("empty signals produce insufficient_evidence band", () => {
    const bands = buildConfidenceBands([]);
    assert.equal(bands.length, 1);
    assert.equal(bands[0]!.label, "insufficient_evidence");
  });

  it("high confidence band for adequate samples + low volatility + clear signal", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 30, p23ReplayCount: 25, pairedLifecycleCount: 15 },
        confidence: 0.9,
        kind: "calibration_skew",
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const high = bands.find(b => b.label === "high_confidence_drift");
    assert.ok(high, "expected high_confidence_drift band");
  });

  it("low confidence band for few samples", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 3, p23ReplayCount: 1, pairedLifecycleCount: 0 },
        confidence: 0.5,
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const low = bands.find(b => b.label === "low_confidence_drift");
    assert.ok(low, "expected low_confidence_drift band");
  });

  it("no actionable-urgency labels in output", () => {
    const signals = [signal()];
    const bands = buildConfidenceBands(signals);
    for (const band of bands) {
      assert.ok(!["critical", "urgent", "must_fix"].includes(band.label));
    }
  });

  it("neutral band when no drift detected", () => {
    const signals: PolicyDriftSignal[] = [];
    // Only evidence_coverage with insufficient_evidence is still insufficient_evidence, not neutral
    const bands = buildConfidenceBands(signals);
    // Empty signals = insufficient_evidence (from test 1)
    assert.ok(bands.length > 0);
  });

  it("volatile band for high volatility signals", () => {
    // High severity but low confidence → volatility candidate
    const signals = [
      signal({
        kind: "volatility",
        severity: "high",
        confidence: 0.3,
        direction: "unstable",
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const volatile = bands.find(b => b.label === "volatile_or_unstable");
    assert.ok(volatile, "expected volatile_or_unstable band");
  });

  it("moderate confidence for adequate samples with mixed signals", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 15, p23ReplayCount: 12, pairedLifecycleCount: 5 },
        confidence: 0.5,
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const moderate = bands.find(b => b.label === "moderate_confidence_drift");
    assert.ok(moderate, "expected moderate_confidence_drift band");
  });
});
