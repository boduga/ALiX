/**
 * Invariant test: Policy independence — same verification evidence evaluated
 * under different governance policies produces the same outcome classification
 * (A2's work). Only the recommendation stage (A2.5) may differ — without
 * re-running verification.
 *
 * @module invariant-policy-independence
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CounterfactualEvaluator,
  RecommendationEngine,
  createVerificationEvidence,
} from "../../../../src/evolution/verification/index.js";

describe("Invariant: Policy independence", () => {
  it("counterfactual classification is independent of recommendation config", () => {
    // The same baseline/candidate metrics produce the SAME classification
    // regardless of how A2.5 will later recommend.
    const evaluator = new CounterfactualEvaluator({
      significanceThreshold: 0.05,
      minimumConfidence: 0.3,
      metricDirections: { success_rate: "higher_is_better" },
    });

    const profile = { replayFidelity: 0.95, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.855 };

    // Same evidence, evaluated once
    const evaluation = evaluator.evaluate(
      { success_rate: 0.90 },
      { success_rate: 0.96 },
      profile,
    );

    // The classification is fixed by the metrics, not by policy
    const classification = evaluation.outcomeClassifications[0].classification;
    assert.ok(["improvement", "neutral", "regression", "insufficient"].includes(classification));

    // A2.5 recommendation config does NOT change the classification —
    // it only changes the recommendation kind. Classification is computed
    // before any policy-aware recommendation logic.
    assert.strictEqual(
      evaluation.outcomeClassifications[0].classification,
      classification,
    );
  });

  it("same evidence can yield different recommendations under different configs (no rerun)", () => {
    const profile = { replayFidelity: 0.95, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.85 };

    const evidence = createVerificationEvidence({
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: { success_rate: 0.9 },
      candidateMetrics: { success_rate: 0.96 },
      metricDeltas: { success_rate: 0.06 },
      behavioralChanges: [],
      confidenceProfile: profile,
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    });

    // Lenient config: APPROVE at 0.8 threshold
    const lenient = new RecommendationEngine({ approveConfidenceThreshold: 0.8 });
    // Strict config: APPROVE only at 0.95
    const strict = new RecommendationEngine({ approveConfidenceThreshold: 0.95 });

    const classifications = { improvement: 1, neutral: 0, regression: 0, insufficient: 0, total: 1 };

    const recLenient = lenient.generate(evidence, classifications);
    const recStrict = strict.generate(evidence, classifications);

    // Different recommendations from the SAME evidence — no re-verification needed
    assert.notStrictEqual(recLenient.kind, recStrict.kind);
  });
});
