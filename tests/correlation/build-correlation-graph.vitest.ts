// tests/correlation/build-correlation-graph.vitest.ts

import { describe, it, expect } from "vitest";
import { buildCorrelationGraph } from "../../src/correlation/build-correlation-graph.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../src/correlation/correlation-config.js";
import type { BaselineComparison } from "../../src/baseline/baseline-types.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

function makeComparison(subsystem: string, score: number): BaselineComparison {
  const status = score >= 90 ? "excellent" : score >= 70 ? "healthy" : score >= 40 ? "warning" : "critical";
  return { subsystem: subsystem as any, score, status: status as any, drift: [] };
}

function makeSnapshot(id: string, scores: Record<string, number>): ExecutiveTrendSnapshot {
  return { id, generatedAt: new Date().toISOString(), windowDays: 7, subsystemScores: scores };
}

function stableScores(base: number, count: number): ExecutiveTrendSnapshot[] {
  return Array.from({ length: count }, (_, i) =>
    makeSnapshot(`snap-${i}`, {
      memory: base, workflow: base, skills: base,
      agents: base, tools: base, security: base,
      governance: base, adaptation: base,
    }));
}

function makeConfig(overrides: Partial<typeof DEFAULT_CORRELATION_CONFIG> = {}) {
  return { ...DEFAULT_CORRELATION_CONFIG, ...overrides };
}

describe("buildCorrelationGraph", () => {
  it("returns ok status with edges when subsystems correlate", () => {
    const comparisons = [
      makeComparison("memory", 80), makeComparison("workflow", 75),
      makeComparison("learning", 85), makeComparison("agents", 70),
      makeComparison("tools", 80), makeComparison("security", 85),
      makeComparison("governance", 80), makeComparison("adaptation", 75),
    ];
    const snapshots = Array.from({ length: 8 }, (_, t) => {
      const base = 80 - (t % 3 === 0 ? 10 : 0);
      return makeSnapshot(`snap-${t}`, {
        memory: base, workflow: base - 3, skills: 85, agents: 70,
        tools: 80, security: 85, governance: 80, adaptation: 75,
      });
    });
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.status).toBe("ok");
    expect(graph.nodes).toHaveLength(8);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.correlationConfidence).toBeGreaterThanOrEqual(0);
      expect(edge.correlationConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns insufficient_history when < minSamples snapshots", () => {
    const comparisons = [makeComparison("memory", 80)];
    const snapshots = [makeSnapshot("snap-1", { memory: 85, workflow: 80, skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75 })];
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ minSamples: 6 }));
    expect(graph.status).toBe("insufficient_history");
    expect(graph.edges).toHaveLength(0);
  });

  it("excludes demo from nodes", () => {
    const comparisons = [makeComparison("demo", 50), makeComparison("memory", 80)];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.nodes.every(n => n.subsystem !== ("demo" as any))).toBe(true);
    expect(graph.nodes.find(n => n.subsystem === "memory")).toBeDefined();
  });

  it("fills missing canonical subsystems as unknown", () => {
    const comparisons: BaselineComparison[] = [];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.nodes).toHaveLength(8);
    for (const node of graph.nodes) {
      expect(node.status).toBe("unknown");
    }
  });

  it("no edges when all scores are stable", () => {
    const comparisons = [makeComparison("memory", 90), makeComparison("workflow", 90)];
    const snapshots = stableScores(90, 12);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig());
    expect(graph.edges).toHaveLength(0);
  });

  it("detects negative correlation", () => {
    const comparisons = [makeComparison("memory", 80), makeComparison("workflow", 70)];
    const snapshots = Array.from({ length: 8 }, (_, i) =>
      makeSnapshot(`snap-${i}`, {
        memory: 70 + i * 2, workflow: 80 - i * 2,
        skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75,
      }));
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ maxTemporalLag: 0 }));
    const negativeEdges = graph.edges.filter(e => e.correlationDirection === "negative");
    expect(negativeEdges.length).toBeGreaterThan(0);
  });

  it("confidence clamped 0-1", () => {
    const comparisons = [makeComparison("memory", 80)];
    const snapshots = stableScores(80, 8);
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ minSamples: 1, minEdgeConfidence: 0 }));
    for (const edge of graph.edges) {
      expect(edge.correlationConfidence).toBeGreaterThanOrEqual(0);
      expect(edge.correlationConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("lag search is bounds-safe", () => {
    const comparisons = [makeComparison("memory", 80), makeComparison("workflow", 70)];
    const snapshots = Array.from({ length: 8 }, (_, i) =>
      makeSnapshot(`snap-${i}`, {
        memory: 80 - i, workflow: 70 - i,
        skills: 85, agents: 70, tools: 80, security: 85, governance: 80, adaptation: 75,
      }));
    const graph = buildCorrelationGraph(comparisons, snapshots, makeConfig({ maxTemporalLag: 3 }));
    expect(graph.status).toBe("ok");
  });
});
