import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PatternRegistry } from "../../src/context/pattern-registry.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("PatternRegistry", () => {
  const testDir = join("/tmp", `test-patterns-${Date.now()}`);

  beforeEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  it("records outcome for task type", async () => {
    const registry = new PatternRegistry(testDir);
    await registry.recordOutcome("feature", { success: true, iterations: 5, totalTokens: 1000 });

    const stats = registry.getStats("feature");
    expect(stats).toBeDefined();
    expect(stats!.count).toBe(1);
    expect(stats!.successRate).toBe(1.0);
    expect(stats!.avgIterations).toBe(5);
  });

  it("calculates rolling success rate", async () => {
    const registry = new PatternRegistry(testDir);
    await registry.recordOutcome("bugfix", { success: true, iterations: 3, totalTokens: 500 });
    await registry.recordOutcome("bugfix", { success: false, iterations: 10, totalTokens: 2000 });

    const stats = registry.getStats("bugfix");
    expect(stats).toBeDefined();
    expect(stats!.count).toBe(2);
    expect(stats!.successRate).toBe(0.5);
    expect(stats!.avgIterations).toBe(6.5); // (3 + 10) / 2
  });

  it("persists stats to disk", async () => {
    const registry = new PatternRegistry(testDir);
    await registry.recordOutcome("refactor", { success: true, iterations: 2, totalTokens: 300 });

    // Create new instance to verify persistence
    const registry2 = new PatternRegistry(testDir);
    await registry2.init();
    const stats = registry2.getStats("refactor");

    expect(stats).toBeDefined();
    expect(stats!.count).toBe(1);
    expect(stats!.successRate).toBe(1.0);
  });

  it("calculates threshold bias based on success rate", async () => {
    const registry = new PatternRegistry(testDir);

    // Low success rate (< 0.5) → high bias
    await registry.recordOutcome("bugfix", { success: false, iterations: 5, totalTokens: 1000 });
    await registry.recordOutcome("bugfix", { success: false, iterations: 5, totalTokens: 1000 });
    expect(registry.getThresholdBias("bugfix")).toBe(20);

    // Medium success rate (0.5 - 0.7) → medium bias
    await registry.recordOutcome("feature", { success: true, iterations: 3, totalTokens: 500 });
    await registry.recordOutcome("feature", { success: false, iterations: 7, totalTokens: 1500 });
    expect(registry.getThresholdBias("feature")).toBe(10);

    // High success rate (> 0.85) → no bias
    await registry.recordOutcome("docs", { success: true, iterations: 1, totalTokens: 100 });
    await registry.recordOutcome("docs", { success: true, iterations: 1, totalTokens: 100 });
    expect(registry.getThresholdBias("docs")).toBe(0);
  });

  it("returns zero bias for unknown task types", async () => {
    const registry = new PatternRegistry(testDir);
    expect(registry.getThresholdBias("unknown")).toBe(0);
  });
});