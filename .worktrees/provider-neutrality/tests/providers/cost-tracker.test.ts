import { describe, it } from "node:test";
import assert from "node:assert";
import { CostTracker } from "../../src/providers/cost-tracker.js";

describe("CostTracker", () => {
  it("tracks single request cost", () => {
    const tracker = new CostTracker();
    tracker.record({
      provider: "openai",
      model: "gpt-4",
      inputTokens: 1000,
      outputTokens: 500,
    });
    const summary = tracker.summary();
    assert.ok(summary.totalInputTokens > 0);
    assert.ok(summary.totalOutputTokens > 0);
  });

  it("accumulates across multiple requests", () => {
    const tracker = new CostTracker();
    tracker.record({ provider: "openai", model: "gpt-4", inputTokens: 1000, outputTokens: 200 });
    tracker.record({ provider: "openai", model: "gpt-4", inputTokens: 500, outputTokens: 100 });
    const summary = tracker.summary();
    assert.equal(summary.totalInputTokens, 1500);
    assert.equal(summary.totalOutputTokens, 300);
  });

  it("calculates cost from cost profile", () => {
    const tracker = new CostTracker({
      "openai/gpt-4": { inputPerMillion: 2.5, outputPerMillion: 10 },
    });
    tracker.record({ provider: "openai", model: "gpt-4", inputTokens: 1_000_000, outputTokens: 0 });
    const summary = tracker.summary();
    assert.equal(summary.totalCostUSD, 2.5);
  });

  it("exports summary for event logging", () => {
    const tracker = new CostTracker();
    tracker.record({ provider: "openai", model: "gpt-4", inputTokens: 100, outputTokens: 50 });
    const summary = tracker.summary();
    assert.ok(typeof summary.totalCostUSD === "number");
    assert.ok(typeof summary.sessionId === "string");
  });
});