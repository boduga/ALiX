/**
 * Tests A2.0/A2.4 — Confidence Calculator.
 *
 * @module confidence-calculator
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeOverallConfidence,
  computeOverallSimilarity,
} from "../../../src/evolution/verification/index.js";
import type { HistoricalSimilarityAssessment } from "../../../src/evolution/verification/index.js";

describe("computeOverallConfidence", () => {
  it("returns 1.0 when all factors are 1.0", () => {
    const result = computeOverallConfidence({
      replayFidelity: 1.0,
      coverage: 1.0,
      determinism: 1.0,
      historicalSimilarity: 1.0,
    });
    assert.strictEqual(result.overallConfidence, 1.0);
  });

  it("returns 0 when any factor is 0 (non-compensatory)", () => {
    const result = computeOverallConfidence({
      replayFidelity: 0.0,
      coverage: 1.0,
      determinism: 1.0,
      historicalSimilarity: 1.0,
    });
    assert.strictEqual(result.overallConfidence, 0);
  });

  it("weak historical similarity caps confidence", () => {
    const result = computeOverallConfidence({
      replayFidelity: 1.0,
      coverage: 1.0,
      determinism: 1.0,
      historicalSimilarity: 0.1,
    });
    assert.ok(result.overallConfidence <= 0.1);
  });

  it("uses min of first three factors times similarity", () => {
    const result = computeOverallConfidence({
      replayFidelity: 0.8,
      coverage: 0.6,
      determinism: 1.0,
      historicalSimilarity: 0.5,
    });
    // min(0.8, 0.6, 1.0) * 0.5 = 0.3
    assert.ok(Math.abs(result.overallConfidence - 0.3) < 1e-9);
  });

  it("clamps inputs to [0, 1]", () => {
    const result = computeOverallConfidence({
      replayFidelity: 1.5,
      coverage: -0.1,
      determinism: 1.0,
      historicalSimilarity: 1.0,
    });
    assert.ok(result.replayFidelity <= 1.0);
    assert.ok(result.coverage >= 0);
  });

  it("handles NaN inputs safely", () => {
    const result = computeOverallConfidence({
      replayFidelity: NaN,
      coverage: 1.0,
      determinism: 1.0,
      historicalSimilarity: 1.0,
    });
    assert.strictEqual(result.replayFidelity, 0);
    assert.strictEqual(result.overallConfidence, 0);
  });
});

describe("computeOverallSimilarity", () => {
  function makeAssessment(overrides: Partial<HistoricalSimilarityAssessment> = {}): HistoricalSimilarityAssessment {
    return {
      workloadSimilarity: 0.5,
      topologySimilarity: 0.5,
      policySimilarity: 0.5,
      resourceSimilarity: 0.5,
      agentCompositionSimilarity: 0.5,
      trafficSimilarity: 0.5,
      failurePatternSimilarity: 0.5,
      overallSimilarity: 0.5,
      coverageGaps: [],
      ...overrides,
    };
  }

  it("returns the mean of all dimensions", () => {
    const result = computeOverallSimilarity(makeAssessment({
      workloadSimilarity: 1.0,
      topologySimilarity: 1.0,
      policySimilarity: 1.0,
      resourceSimilarity: 1.0,
      agentCompositionSimilarity: 1.0,
      trafficSimilarity: 1.0,
      failurePatternSimilarity: 1.0,
    }));
    assert.strictEqual(result, 1.0);
  });

  it("returns 0 when all dimensions are out of range", () => {
    const result = computeOverallSimilarity(makeAssessment({
      workloadSimilarity: NaN,
      topologySimilarity: 2.0,
      policySimilarity: -1.0,
      resourceSimilarity: NaN,
      agentCompositionSimilarity: 5.0,
      trafficSimilarity: -5.0,
      failurePatternSimilarity: NaN,
    }));
    assert.strictEqual(result, 0);
  });

  it("computes mean of valid dimensions only", () => {
    const result = computeOverallSimilarity(makeAssessment({
      workloadSimilarity: 1.0,
      topologySimilarity: 1.0,
      policySimilarity: 1.0,
      resourceSimilarity: 1.0,
      agentCompositionSimilarity: 1.0,
      trafficSimilarity: 1.0,
      failurePatternSimilarity: 0.0,
    }));
    assert.ok(Math.abs(result - (6 / 7)) < 1e-9);
  });
});
