import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCandidates } from "../../src/governance/policy-review-candidate-builder.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
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
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

describe("buildCandidates", () => {

  it("empty signals produce empty candidates", () => {
    const candidates = buildCandidates([]);
    assert.equal(candidates.length, 0);
  });

  it("medium severity signal produces a candidate", () => {
    const candidates = buildCandidates([signal({ severity: "medium" })]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.source.signalKind, "calibration_skew");
    assert.equal(candidates[0]!.source.signalSeverity, "medium");
  });

  it("high severity signal produces a candidate", () => {
    const candidates = buildCandidates([signal({ severity: "high" })]);
    assert.equal(candidates.length, 1);
  });

  it("low severity signal is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "low" })]);
    assert.equal(candidates.length, 0);
  });

  it("none severity signal is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "none" })]);
    assert.equal(candidates.length, 0);
  });

  it("evidence_coverage signal is filtered out even if medium", () => {
    const candidates = buildCandidates([signal({ kind: "evidence_coverage", severity: "medium" })]);
    assert.equal(candidates.length, 0);
  });

  it("neutral direction is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "medium", direction: "neutral" })]);
    assert.equal(candidates.length, 0);
  });

  it("insufficient_evidence direction is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "medium", direction: "insufficient_evidence" })]);
    assert.equal(candidates.length, 0);
  });

  it("volatility with medium severity produces a candidate", () => {
    const candidates = buildCandidates([signal({
      kind: "volatility",
      severity: "medium",
      direction: "unstable",
    })]);
    assert.equal(candidates.length, 1);
  });

  it("candidateId is deterministic (same input produces same ID)", () => {
    const candidates1 = buildCandidates([signal({ severity: "medium" })]);
    const candidates2 = buildCandidates([signal({ severity: "medium" })]);
    assert.equal(candidates1[0]!.candidateId, candidates2[0]!.candidateId);
  });
});
