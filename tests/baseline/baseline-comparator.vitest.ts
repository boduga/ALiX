import { describe, it, expect } from "vitest";
import { NumericComparator } from "../../src/baseline/baseline-comparator.js";
import type { BaselineArtifact } from "../../src/baseline/baseline-types.js";

const comparator = new NumericComparator();

function makeArtifact(data: Record<string, number>): BaselineArtifact {
  return {
    subsystem: "demo",
    capturedAt: new Date().toISOString(),
    data,
  };
}

describe("NumericComparator", () => {
  it("identical artifacts → score 100, no drift", () => {
    const artifact = makeArtifact({ uptime: 100, latency: 200 });
    const result = comparator.compare(artifact, artifact);
    expect(result.score).toBe(100);
    expect(result.status).toBe("excellent");
    expect(result.drift).toHaveLength(2);
    expect(result.drift.every((d) => d.delta === 0)).toBe(true);
  });

  it("moderate deltas → warning status", () => {
    const baseline = makeArtifact({ uptime: 100, latency: 200 });
    const current = makeArtifact({ uptime: 60, latency: 400 });
    const result = comparator.compare(baseline, current);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(70);
    expect(result.status).toBe("warning");
  });

  it("multiple metrics each drift correctly", () => {
    const baseline = makeArtifact({ a: 100, b: 100, c: 100 });
    const current = makeArtifact({ a: 100, b: 80, c: 50 });
    const result = comparator.compare(baseline, current);
    expect(result.drift).toHaveLength(3);
    expect(result.drift.find((d) => d.metric === "a")!.delta).toBe(0);
    expect(result.drift.find((d) => d.metric === "b")!.delta).toBe(-20);
    expect(result.drift.find((d) => d.metric === "c")!.delta).toBe(-50);
  });

  it("drift items sorted by severity (critical first)", () => {
    const baseline = makeArtifact({ a: 100, b: 100 });
    const current = makeArtifact({ a: 10, b: 98 });
    const result = comparator.compare(baseline, current);
    expect(result.drift.length).toBe(2);
    expect(result.drift[0].severity).toBe("critical"); // biggest delta
  });
});
