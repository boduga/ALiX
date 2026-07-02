import { describe, it, expect } from "vitest";
import { computeHealthScore } from "../../src/baseline/health-score.js";
import type { DriftItem } from "../../src/baseline/baseline-types.js";

function makeDrift(overrides: Partial<DriftItem> & { metric: string }): DriftItem {
  return {
    id: `test.${overrides.metric}`,
    category: "performance",
    baselineValue: 100,
    currentValue: 100,
    delta: 0,
    severity: "low",
    ...overrides,
  };
}

describe("computeHealthScore", () => {
  it("no drift → 100 excellent", () => {
    const { score, status } = computeHealthScore([]);
    expect(score).toBe(100);
    expect(status).toBe("excellent");
  });

  it("small drift → healthy", () => {
    // ~17% change → ~83 score → healthy
    const drift = [makeDrift({ metric: "latency", baselineValue: 100, currentValue: 120, delta: 20 })];
    const { score, status } = computeHealthScore(drift);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThan(90);
    expect(status).toBe("healthy");
  });

  it("moderate drift → warning", () => {
    // ~38% change → ~62 score → warning
    const drift = [makeDrift({ metric: "latency", baselineValue: 100, currentValue: 160, delta: 60 })];
    const { score, status } = computeHealthScore(drift);
    expect(score).toBeGreaterThanOrEqual(40);
    expect(score).toBeLessThan(70);
    expect(status).toBe("warning");
  });

  it("large drift → critical", () => {
    // ~67% change → ~33 score → critical
    const drift = [makeDrift({ metric: "latency", baselineValue: 100, currentValue: 300, delta: 200 })];
    const { score, status } = computeHealthScore(drift);
    expect(score).toBeLessThan(40);
    expect(status).toBe("critical");
  });

  it("custom weights skew the score", () => {
    const drift = [
      makeDrift({ metric: "a", baselineValue: 100, currentValue: 100, delta: 0 }),
      makeDrift({ metric: "b", baselineValue: 100, currentValue: 50, delta: -50 }),
    ];
    // Weight metric 'b' at 10x — should pull score down
    const weights = { a: 1, b: 10 };
    const unweighted = computeHealthScore(drift);
    const weighted = computeHealthScore(drift, weights);
    expect(weighted.score).toBeLessThan(unweighted.score);
  });

  it("zero baseline value returns 0 for that item", () => {
    const drift = [
      makeDrift({ metric: "zero", baselineValue: 0, currentValue: 50, delta: 50 }),
    ];
    const { score } = computeHealthScore(drift);
    expect(score).toBe(0);
  });
});
