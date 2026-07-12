/**
 * Tests A2.3 — Counterfactual Contract.
 *
 * @module counterfactual-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_CLASSIFICATIONS,
  isValidOutcomeClassification,
  validateCounterfactualMetricEvaluation,
} from "../../../src/evolution/verification/index.js";

describe("OutcomeClassification", () => {
  it("has 4 classifications", () => {
    assert.strictEqual(OUTCOME_CLASSIFICATIONS.length, 4);
    assert.ok(OUTCOME_CLASSIFICATIONS.includes("improvement"));
    assert.ok(OUTCOME_CLASSIFICATIONS.includes("neutral"));
    assert.ok(OUTCOME_CLASSIFICATIONS.includes("regression"));
    assert.ok(OUTCOME_CLASSIFICATIONS.includes("insufficient"));
  });

  it("isValidOutcomeClassification validates correctly", () => {
    assert.ok(isValidOutcomeClassification("improvement"));
    assert.ok(isValidOutcomeClassification("regression"));
    assert.ok(!isValidOutcomeClassification("acceptable"));
    assert.ok(!isValidOutcomeClassification(""));
  });
});

describe("validateCounterfactualMetricEvaluation", () => {
  it("accepts a valid evaluation", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "success_rate",
      baselineValue: 0.94,
      candidateValue: 0.96,
      delta: 0.02,
      threshold: 0.05,
      statisticalConfidence: 0.85,
      direction: "higher_is_better",
      classification: "improvement",
    });
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects missing metricName", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "",
      baselineValue: 0,
      candidateValue: 0,
      delta: 0,
      threshold: 0.05,
      statisticalConfidence: 0.5,
      direction: "higher_is_better",
      classification: "neutral",
    });
    assert.equal(result.valid, false);
  });

  it("rejects invalid direction", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "m",
      baselineValue: 0,
      candidateValue: 0,
      delta: 0,
      threshold: 0.05,
      statisticalConfidence: 0.5,
      direction: "sideways",
      classification: "neutral",
    });
    assert.equal(result.valid, false);
  });

  it("rejects statisticalConfidence outside [0,1]", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "m",
      baselineValue: 0,
      candidateValue: 0,
      delta: 0,
      threshold: 0.05,
      statisticalConfidence: 1.5,
      direction: "higher_is_better",
      classification: "neutral",
    });
    assert.equal(result.valid, false);
  });

  it("rejects negative threshold", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "m",
      baselineValue: 0,
      candidateValue: 0,
      delta: 0,
      threshold: -0.1,
      statisticalConfidence: 0.5,
      direction: "higher_is_better",
      classification: "neutral",
    });
    assert.equal(result.valid, false);
  });

  it("rejects invalid classification", () => {
    const result = validateCounterfactualMetricEvaluation({
      metricName: "m",
      baselineValue: 0,
      candidateValue: 0,
      delta: 0,
      threshold: 0.05,
      statisticalConfidence: 0.5,
      direction: "higher_is_better",
      classification: "acceptable",
    });
    assert.equal(result.valid, false);
  });
});
