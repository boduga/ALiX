/**
 * Tests A2.0 — Verification Confidence Contract Types.
 *
 * Covers ConfidenceProfile and HistoricalSimilarityAssessment validation.
 *
 * @module confidence-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfidenceProfile,
  validateHistoricalSimilarityAssessment,
} from "../../../src/evolution/verification/index.js";
import type {
  ConfidenceProfile,
  HistoricalSimilarityAssessment,
} from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Validate — ConfidenceProfile
// ---------------------------------------------------------------------------

describe("validateConfidenceProfile", () => {
  it("accepts a valid profile", () => {
    const profile: ConfidenceProfile = {
      replayFidelity: 0.95,
      coverage: 0.85,
      determinism: 1.0,
      historicalSimilarity: 0.90,
      overallConfidence: 0.765,
    };
    const result = validateConfidenceProfile(profile);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects null input", () => {
    assert.equal(validateConfidenceProfile(null).valid, false);
  });

  it("rejects value outside [0, 1]", () => {
    const profile = {
      replayFidelity: 1.5,
      coverage: 0.85,
      determinism: 1.0,
      historicalSimilarity: 0.90,
      overallConfidence: 0.8,
    };
    const result = validateConfidenceProfile(profile);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("replayFidelity")));
  });

  it("rejects negative value", () => {
    const profile = {
      replayFidelity: -0.1,
      coverage: 0.85,
      determinism: 1.0,
      historicalSimilarity: 0.90,
      overallConfidence: 0.8,
    };
    const result = validateConfidenceProfile(profile);
    assert.equal(result.valid, false);
  });

  it("rejects NaN", () => {
    const profile = {
      replayFidelity: NaN,
      coverage: 0.85,
      determinism: 1.0,
      historicalSimilarity: 0.90,
      overallConfidence: 0.8,
    };
    const result = validateConfidenceProfile(profile);
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// Validate — HistoricalSimilarityAssessment
// ---------------------------------------------------------------------------

describe("validateHistoricalSimilarityAssessment", () => {
  it("accepts a valid assessment", () => {
    const assessment: HistoricalSimilarityAssessment = {
      workloadSimilarity: 0.92,
      topologySimilarity: 0.88,
      policySimilarity: 0.75,
      resourceSimilarity: 0.95,
      agentCompositionSimilarity: 0.90,
      trafficSimilarity: 0.93,
      failurePatternSimilarity: 0.80,
      overallSimilarity: 0.88,
      coverageGaps: ["workload_variance"],
    };
    const result = validateHistoricalSimilarityAssessment(assessment);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects null input", () => {
    assert.equal(validateHistoricalSimilarityAssessment(null).valid, false);
  });

  it("rejects missing coverageGaps array", () => {
    const assessment = {
      workloadSimilarity: 0.5,
      topologySimilarity: 0.5,
      policySimilarity: 0.5,
      resourceSimilarity: 0.5,
      agentCompositionSimilarity: 0.5,
      trafficSimilarity: 0.5,
      failurePatternSimilarity: 0.5,
      overallSimilarity: 0.5,
    };
    const result = validateHistoricalSimilarityAssessment(assessment);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("coverageGaps")));
  });
});
