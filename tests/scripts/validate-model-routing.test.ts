import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeRoutingResults } from "../../src/kernel/model-routing-validation.js";
import type { ModelRoutingResult } from "../../src/kernel/model-routing-validation.js";

describe("summarizeRoutingResults", () => {

  const makeResult = (overrides: Partial<ModelRoutingResult>): ModelRoutingResult => ({
    caseId: "test-1", model: "test-model",
    validJson: true, domainCorrect: true, intentCorrect: true, riskCorrect: true,
    rawOutput: '{"domain":"coding","intent":"fix bug","risk":"low"}',
    ...overrides,
  });

  it("returns 100% for all-perfect results", () => {
    const results = [makeResult({})];
    const s = summarizeRoutingResults(results);
    assert.equal(s.validJsonRate, 1.0);
    assert.equal(s.domainAccuracy, 1.0);
  });

  it("computes partial accuracy correctly", () => {
    const results = [
      makeResult({ caseId: "a", domainCorrect: true }),
      makeResult({ caseId: "b", domainCorrect: false }),
    ];
    const s = summarizeRoutingResults(results);
    assert.equal(s.domainAccuracy, 0.5);
  });

  it("handles empty results without division by zero", () => {
    const s = summarizeRoutingResults([]);
    assert.equal(s.total, 0);
  });
});
