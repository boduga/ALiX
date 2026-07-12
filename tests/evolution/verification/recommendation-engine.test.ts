/**
 * Tests A2.5 — Recommendation Engine.
 *
 * @module recommendation-engine
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationEngine,
  createVerificationEvidence,
} from "../../../src/evolution/verification/index.js";
import type { VerificationEvidenceInput, ConfidenceProfile } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overall: number): ConfidenceProfile {
  return {
    replayFidelity: 0.95,
    coverage: 0.90,
    determinism: 1.0,
    historicalSimilarity: 0.90,
    overallConfidence: overall,
  };
}

function makeEvidence(
  overallConfidence: number,
  behavioralChanges: string[] = [],
  overrides: Partial<VerificationEvidenceInput> = {},
): ReturnType<typeof createVerificationEvidence> {
  // Build via createVerificationEvidence to get a valid integrity hash
  return createVerificationEvidence({
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1 },
    candidateMetrics: { m: 2 },
    metricDeltas: { m: 1 },
    behavioralChanges,
    confidenceProfile: makeProfile(overallConfidence),
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-07-12T10:00:00.000Z",
    expiresAt: "2099-12-31T00:00:00.000Z",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// RecommendationEngine
// ---------------------------------------------------------------------------

describe("RecommendationEngine", () => {
  const engine = new RecommendationEngine();

  it("recommends APPROVE for high confidence, no regressions", () => {
    const evidence = makeEvidence(0.9, []);
    const rec = engine.generate(evidence, { improvement: 3, neutral: 1, regression: 0, insufficient: 0, total: 4 });
    assert.strictEqual(rec.kind, "APPROVE");
    assert.ok(rec.confidence >= 0.8);
  });

  it("recommends MONITOR for acceptable confidence with regressions", () => {
    const evidence = makeEvidence(0.6, ["m regression: 1 -> 2"]);
    const rec = engine.generate(evidence, { improvement: 2, neutral: 1, regression: 1, insufficient: 0, total: 4 });
    assert.strictEqual(rec.kind, "MONITOR");
  });

  it("recommends REQUEST_ADDITIONAL_EVIDENCE for low confidence", () => {
    const evidence = makeEvidence(0.2);
    const rec = engine.generate(evidence, { improvement: 0, neutral: 0, regression: 0, insufficient: 4, total: 4 });
    assert.strictEqual(rec.kind, "REQUEST_ADDITIONAL_EVIDENCE");
  });

  it("recommends REQUEST_ADDITIONAL_EVIDENCE for high insufficient fraction", () => {
    const evidence = makeEvidence(0.6);
    const rec = engine.generate(evidence, { improvement: 1, neutral: 0, regression: 0, insufficient: 3, total: 4 });
    assert.strictEqual(rec.kind, "REQUEST_ADDITIONAL_EVIDENCE");
  });

  it("recommends REJECT for regressions with low confidence", () => {
    const evidence = makeEvidence(0.4, ["m regression: 1 -> 2"]);
    const rec = engine.generate(evidence, { improvement: 0, neutral: 0, regression: 2, insufficient: 0, total: 2 });
    assert.strictEqual(rec.kind, "REJECT");
  });

  it("recommends ESCALATE when signals are ambiguous", () => {
    // Confidence between monitor threshold and approve, with regressions
    // but above monitor threshold → MONITOR not ESCALATE.
    // To get ESCALATE: confidence below monitor but above insufficient,
    // with no regressions.
    const evidence = makeEvidence(0.4);
    const rec = engine.generate(evidence, { improvement: 0, neutral: 4, regression: 0, insufficient: 0, total: 4 });
    assert.strictEqual(rec.kind, "ESCALATE");
  });

  it("every recommendation carries numeric confidence", () => {
    const evidence = makeEvidence(0.7);
    const rec = engine.generate(evidence, { improvement: 2, neutral: 2, regression: 0, insufficient: 0, total: 4 });
    assert.ok(typeof rec.confidence === "number");
    assert.ok(rec.confidence >= 0 && rec.confidence <= 1);
  });

  it("every recommendation references source evidence", () => {
    const evidence = makeEvidence(0.9);
    const rec = engine.generate(evidence, { improvement: 1, neutral: 0, regression: 0, insufficient: 0, total: 1 });
    assert.strictEqual(rec.evidenceId, evidence.evidenceId);
    assert.strictEqual(rec.proposalId, evidence.proposalId);
    assert.ok(rec.supportingEvidence.includes(evidence.evidenceId));
  });

  it("deterministic: same evidence + config = same kind", () => {
    const evidence = makeEvidence(0.9);
    const classifications = { improvement: 1, neutral: 0, regression: 0, insufficient: 0, total: 1 };
    const rec1 = engine.generate(evidence, classifications);
    const rec2 = engine.generate(evidence, classifications);
    assert.strictEqual(rec1.kind, rec2.kind);
    assert.strictEqual(rec1.confidence, rec2.confidence);
  });

  it("infers regressions from behavioralChanges when classifications omitted", () => {
    const evidence = makeEvidence(0.4, ["latency regression: 100 -> 200"]);
    const rec = engine.generate(evidence);
    // Low confidence + inferred regression → REJECT
    assert.strictEqual(rec.kind, "REJECT");
    assert.ok(rec.risks.some((r) => r.includes("regression")));
  });

  it("respects custom config thresholds", () => {
    const strictEngine = new RecommendationEngine({
      approveConfidenceThreshold: 0.95,
    });
    const evidence = makeEvidence(0.85);
    const rec = strictEngine.generate(evidence, { improvement: 1, neutral: 0, regression: 0, insufficient: 0, total: 1 });
    // 0.85 < 0.95 strict approve threshold, no regressions, above monitor → MONITOR
    assert.strictEqual(rec.kind, "MONITOR");
  });

  it("reasoning is non-empty for every kind", () => {
    const cases = [
      { confidence: 0.9, c: { improvement: 1, neutral: 0, regression: 0, insufficient: 0, total: 1 } },
      { confidence: 0.6, c: { improvement: 0, neutral: 0, regression: 1, insufficient: 0, total: 1 } },
      { confidence: 0.2, c: { improvement: 0, neutral: 0, regression: 0, insufficient: 1, total: 1 } },
    ];
    for (const { confidence, c } of cases) {
      const evidence = makeEvidence(confidence);
      const rec = engine.generate(evidence, c);
      assert.ok(rec.reasoning.length > 0, `reasoning empty for kind ${rec.kind}`);
    }
  });
});
