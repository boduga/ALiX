import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CorrelationEngine } from "../../src/correlation/correlation-engine.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../src/correlation/correlation-config.js";
import type { BaselineRegistry } from "../../src/baseline/baseline-registry.js";
import type { ExecutiveTrendStore } from "../../src/executive/trend-store.js";

function createMockRegistry(): BaselineRegistry {
  return {
    runAll: vi.fn().mockResolvedValue([]),
    runOne: vi.fn(),
    register: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  } as unknown as BaselineRegistry;
}

describe("CorrelationEngine", () => {
  let dir: string;
  let trendDir: string;
  let registry: BaselineRegistry;
  let trendStore: ExecutiveTrendStore;

  beforeEach(async () => {
    dir = join(tmpdir(), `corr-engine-test-${randomUUID()}`);
    trendDir = join(dir, ".alix", "executive");
    mkdirSync(trendDir, { recursive: true });
    registry = createMockRegistry();
    const { ExecutiveTrendStore: Store } = await import("../../src/executive/trend-store.js");
    trendStore = new Store(trendDir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("run() returns valid CorrelationGraph with no trend data", async () => {
    const engine = new CorrelationEngine(registry, trendStore, {
      ...DEFAULT_CORRELATION_CONFIG,
      minSamples: 6,
    });
    const graph = await engine.run();
    expect(graph.schemaVersion).toBe("p11.1.0");
    expect(typeof graph.generatedAt).toBe("string");
    expect(graph.nodes.length).toBeGreaterThanOrEqual(0);
  });

  it("run() with trend data produces correlation graph", async () => {
    const subsystemNames = ["memory", "workflow", "learning", "agents", "tools", "security", "governance", "adaptation"];
    // Save oldest-first so loadLatest() returns the most recent and
    // findBaseline can walk back through distinct older snapshots.
    for (let i = 7; i >= 0; i--) {
      await trendStore.save({
        schemaVersion: "p10.0.0",
        generatedAt: new Date(Date.now() - i * 86400000).toISOString(),
        windowDays: 7,
        overallScore: 80,
        rankedSubsystems: subsystemNames.map(name => ({
          subsystem: name as any,
          score: 80 - i * 2,
          summary: "trend",
          status: "healthy" as const,
          topIssues: [],
        })),
      });
    }
    const engine = new CorrelationEngine(registry, trendStore, {
      ...DEFAULT_CORRELATION_CONFIG,
      minSamples: 1,
    });
    const graph = await engine.run();
    expect(graph.schemaVersion).toBe("p11.1.0");
    expect(graph.meta.totalSnapshotsExamined).toBe(8);
  });

  it("loadTrendHistory walks back distinct snapshots without duplicates", async () => {
    // Regression test for C1: findBaseline's <= predicate must not re-find
    // the same snapshot, which would inflate the window with duplicates.
    const subsystemNames = ["memory", "workflow", "learning", "agents", "tools", "security", "governance", "adaptation"];
    // Save oldest-first: 4 snapshots at 7-day intervals
    for (let i = 3; i >= 0; i--) {
      await trendStore.save({
        schemaVersion: "p10.0.0",
        generatedAt: new Date(Date.now() - i * 7 * 86400000).toISOString(),
        windowDays: 7,
        overallScore: 80,
        rankedSubsystems: subsystemNames.map(name => ({
          subsystem: name as any,
          score: 80 - i * 5,
          summary: "trend",
          status: "healthy" as const,
          topIssues: [],
        })),
      });
    }
    const engine = new CorrelationEngine(registry, trendStore, {
      ...DEFAULT_CORRELATION_CONFIG,
      minSamples: 1,
      windowSize: 12,
    });
    const graph = await engine.run();
    // Should have exactly 4 distinct snapshots, not 12 (windowSize) duplicates
    expect(graph.meta.totalSnapshotsExamined).toBe(4);
  });
});
