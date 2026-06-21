import { describe, it, expect } from "vitest";
import { computeDecisionConfidence } from "../../src/adaptation/decision-confidence";

describe("computeDecisionConfidence", () => {
  it("returns high confidence for complete data", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 5,
      warningsCount: 0,
      ageDays: 2,
    });
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns lower confidence for partial data", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "partial",
      hasEvidenceFingerprints: false,
      hasEffectiveness: false,
      similarProposalsCount: 0,
      warningsCount: 0,
      ageDays: 2,
    });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("applies stale penalty for old proposals", () => {
    const fresh = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 3,
      warningsCount: 0,
      ageDays: 5,
    });
    const stale = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 3,
      warningsCount: 0,
      ageDays: 31,
    });
    expect(fresh.confidence).toBeGreaterThan(stale.confidence);
  });

  it("clamps confidence to [0, 1]", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "broken",
      hasEvidenceFingerprints: false,
      hasEffectiveness: false,
      similarProposalsCount: 0,
      warningsCount: 10,
      ageDays: 5,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
