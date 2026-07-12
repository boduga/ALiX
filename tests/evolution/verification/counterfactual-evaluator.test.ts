/**
 * Tests A2.3 — CounterfactualEvaluator.
 *
 * @module counterfactual-evaluator
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CounterfactualEvaluator,
} from "../../../src/evolution/verification/index.js";
import type { ConfidenceProfile } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HIGH_CONFIDENCE: ConfidenceProfile = {
  replayFidelity: 0.95,
  coverage: 0.90,
  determinism: 1.0,
  historicalSimilarity: 0.90,
  overallConfidence: 0.85,
};

const LOW_CONFIDENCE: ConfidenceProfile = {
  replayFidelity: 0.2,
  coverage: 0.2,
  determinism: 0.2,
  historicalSimilarity: 0.2,
  overallConfidence: 0.04, // below default minimumConfidence (0.3)
};

// ---------------------------------------------------------------------------
// CounterfactualEvaluator
// ---------------------------------------------------------------------------

describe("CounterfactualEvaluator", () => {
  const evaluator = new CounterfactualEvaluator({
    significanceThreshold: 0.05,
    minimumConfidence: 0.3,
  });

  describe("classifyMetric", () => {
    it("classifies improvement for higher_is_better metric with increase", () => {
      const result = evaluator.classifyMetric(0.90, 0.95, 0.05, "higher_is_better", 0.85);
      assert.strictEqual(result, "improvement");
    });

    it("classifies regression for higher_is_better metric with decrease", () => {
      const result = evaluator.classifyMetric(0.95, 0.85, 0.05, "higher_is_better", 0.85);
      assert.strictEqual(result, "regression");
    });

    it("classifies improvement for lower_is_better metric with decrease", () => {
      const result = evaluator.classifyMetric(200, 150, 0.05, "lower_is_better", 0.85);
      assert.strictEqual(result, "improvement");
    });

    it("classifies regression for lower_is_better metric with increase", () => {
      const result = evaluator.classifyMetric(150, 200, 0.05, "lower_is_better", 0.85);
      assert.strictEqual(result, "regression");
    });

    it("classifies neutral within tolerance", () => {
      // 2% change, threshold 5%
      const result = evaluator.classifyMetric(100, 102, 0.05, "higher_is_better", 0.85);
      assert.strictEqual(result, "neutral");
    });

    it("classifies insufficient when confidence is low", () => {
      const result = evaluator.classifyMetric(0.90, 0.99, 0.05, "higher_is_better", 0.1);
      assert.strictEqual(result, "insufficient");
    });

    it("classifies neutral when both values are zero", () => {
      const result = evaluator.classifyMetric(0, 0, 0.05, "higher_is_better", 0.85);
      assert.strictEqual(result, "neutral");
    });

    it("classifies improvement for non-zero candidate from zero baseline (higher_is_better)", () => {
      const result = evaluator.classifyMetric(0, 10, 0.05, "higher_is_better", 0.85);
      assert.strictEqual(result, "improvement");
    });

    it("classifies regression for non-zero candidate from zero baseline (lower_is_better)", () => {
      const result = evaluator.classifyMetric(0, 10, 0.05, "lower_is_better", 0.85);
      assert.strictEqual(result, "regression");
    });

    it("policy independence: classification never returns 'acceptable'", () => {
      // The word "acceptable" must never be a classification
      for (const [b, c] of [[0.9, 0.95], [0.95, 0.9], [100, 101], [100, 150]] as const) {
        const result = evaluator.classifyMetric(b, c, 0.05, "higher_is_better", 0.85);
        assert.ok(result !== "acceptable" as unknown);
        assert.ok(["improvement", "neutral", "regression", "insufficient"].includes(result));
      }
    });
  });

  describe("evaluate", () => {
    it("produces per-metric classifications for all metrics", () => {
      const result = evaluator.evaluate(
        { success_rate: 0.90, latency_ms: 200 },
        { success_rate: 0.95, latency_ms: 150 },
        HIGH_CONFIDENCE,
      );

      assert.strictEqual(result.outcomeClassifications.length, 2);
      assert.ok(result.outcomeClassifications.some((c) => c.metricName === "success_rate"));
      assert.ok(result.outcomeClassifications.some((c) => c.metricName === "latency_ms"));
    });

    it("computes deltas correctly", () => {
      const result = evaluator.evaluate(
        { m: 100 },
        { m: 120 },
        HIGH_CONFIDENCE,
      );
      assert.strictEqual(result.metricDeltas.m, 20);
    });

    it("records behavioral changes for improvements and regressions", () => {
      const result = evaluator.evaluate(
        { success_rate: 0.90 },
        { success_rate: 0.99 },
        HIGH_CONFIDENCE,
      );
      assert.ok(result.behavioralChanges.length >= 1);
      assert.ok(result.behavioralChanges.some((c) => c.includes("success_rate")));
    });

    it("classifies missing metrics as insufficient", () => {
      const result = evaluator.evaluate(
        { m1: 100 },
        { m2: 100 },
        HIGH_CONFIDENCE,
      );
      assert.strictEqual(result.outcomeClassifications.length, 2);
      assert.ok(result.outcomeClassifications.every((c) => c.classification === "insufficient"));
    });

    it("uses metric direction overrides", () => {
      const eval2 = new CounterfactualEvaluator({
        significanceThreshold: 0.05,
        minimumConfidence: 0.3,
        metricDirections: { latency_ms: "lower_is_better" },
      });

      const result = eval2.evaluate(
        { latency_ms: 200 },
        { latency_ms: 150 },
        HIGH_CONFIDENCE,
      );
      assert.strictEqual(result.outcomeClassifications[0].classification, "improvement");
    });

    it("respects low overall confidence (all metrics insufficient)", () => {
      const result = evaluator.evaluate(
        { m: 100 },
        { m: 150 },
        LOW_CONFIDENCE,
      );
      assert.strictEqual(result.outcomeClassifications[0].classification, "insufficient");
    });

    it("pure: same inputs produce same output", () => {
      const r1 = evaluator.evaluate({ m: 100 }, { m: 110 }, HIGH_CONFIDENCE);
      const r2 = evaluator.evaluate({ m: 100 }, { m: 110 }, HIGH_CONFIDENCE);
      assert.deepStrictEqual(r1, r2);
    });
  });
});
