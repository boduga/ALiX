// tests/reasoning/build-root-cause-analysis.vitest.ts
//
// P11.2 — Pure function tests for buildRootCauseAnalysis.

import { describe, it, expect } from "vitest";
import { buildRootCauseAnalysis } from "../../src/reasoning/build-root-cause-analysis.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../src/correlation/correlation-config.js";
import type { CorrelationGraph, CorrelationEdge, CorrelationNode, CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";
import type { ReasoningEngineConfig } from "../../src/reasoning/reasoning-types.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeGraph(overrides?: Partial<CorrelationGraph>): CorrelationGraph {
  return {
    schemaVersion: "p11.1.0",
    generatedAt: new Date().toISOString(),
    windowSize: 12,
    status: "ok",
    nodes: [],
    edges: [],
    meta: {
      totalSnapshotsExamined: 12,
      minConfidenceThreshold: 0.35,
      maxLagExamined: 3,
      degradationThreshold: -5,
      canonicalSubsystems: DEFAULT_CORRELATION_CONFIG.canonicalSubsystems,
      excludedSubsystems: DEFAULT_CORRELATION_CONFIG.excludedSubsystems,
    },
    ...overrides,
  };
}

function makeNode(
  subsystem: string,
  score: number,
  status?: string,
  drifts?: Array<{ id: string; metric: string; delta: number }>,
): CorrelationNode {
  const defaultStatus =
    score >= 90 ? "excellent" : score >= 70 ? "healthy" : score >= 40 ? "warning" : "critical";
  return {
    subsystem: subsystem as CorrelationSubsystemId,
    score,
    status: (status ?? defaultStatus) as CorrelationNode["status"],
    drift: (drifts ?? []).map((d) => ({
      id: d.id,
      category: "performance" as const,
      metric: d.metric,
      baselineValue: 100,
      currentValue: 100 - d.delta,
      delta: d.delta,
      severity: "medium" as const,
    })),
    evidenceIds: [],
  };
}

function makeEdge(
  source: string,
  target: string,
  overrides?: Partial<CorrelationEdge>,
): CorrelationEdge {
  return {
    source: source as CorrelationSubsystemId,
    target: target as CorrelationSubsystemId,
    coOccurrenceRate: 0.8,
    temporalLag: 0,
    correlationDirection: "positive",
    correlationConfidence: 0.75,
    evidenceIds: ["snap-1", "snap-2"],
    ...overrides,
  };
}

function defaultConfig(): ReasoningEngineConfig {
  return { minCauseConfidence: 0.4, maxCausesPerSubsystem: 3, degradationThreshold: 40 };
}

// ---------------------------------------------------------------------------
// Canonical nodes used across tests
// ---------------------------------------------------------------------------

const ALL_SUBSYSTEMS: CorrelationSubsystemId[] = [
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildRootCauseAnalysis", () => {
  // T1 — no_degradation when all nodes healthy
  it("returns no_degradation when all subsystems are healthy", () => {
    const nodes = ALL_SUBSYSTEMS.map((s) => makeNode(s, 80));
    const graph = makeGraph({ nodes });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.status).toBe("no_degradation");
    expect(result.findings).toHaveLength(0);
  });

  // T2 — temporal_cascade detection
  it("detects temporal_cascade mechanism from lagged positive edges", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
      makeNode("agents", 80),
      makeNode("memory", 80),
      makeNode("skills", 80),
      makeNode("tools", 80),
      makeNode("security", 80),
      makeNode("governance", 80),
      makeNode("adaptation", 80),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", { temporalLag: 1, correlationDirection: "positive", correlationConfidence: 0.75 }),
    ];
    const graph = makeGraph({ nodes, edges });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.primarySubsystem).toBe("workflow");
    expect(f.likelyCauses).toHaveLength(1);
    expect(f.likelyCauses[0].causeSubsystem).toBe("agents");
    expect(f.likelyCauses[0].mechanism).toBe("temporal_cascade");
    expect(f.likelyCauses[0].confidence).toBeCloseTo(0.85, 2);
  });

  // T3 — concurrent_degradation detection
  it("detects concurrent_degradation mechanism from same-time positive edges", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
      ...ALL_SUBSYSTEMS.filter((s) => s !== "workflow").map((s) => makeNode(s, 80)),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", {
        temporalLag: 0,
        coOccurrenceRate: 0.8,
        correlationDirection: "positive",
        correlationConfidence: 0.7,
      }),
    ];
    const graph = makeGraph({ nodes, edges });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.primarySubsystem).toBe("workflow");
    expect(f.likelyCauses).toHaveLength(1);
    expect(f.likelyCauses[0].causeSubsystem).toBe("agents");
    expect(f.likelyCauses[0].mechanism).toBe("concurrent_degradation");
    expect(f.likelyCauses[0].confidence).toBeCloseTo(0.7, 2);
    expect(f.likelyCauses[0].coOccurrenceRate).toBe(0.8);
  });

  // T4 — inverse_correlation detection
  it("detects inverse_correlation mechanism from negative-direction edges", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
      ...ALL_SUBSYSTEMS.filter((s) => s !== "workflow").map((s) => makeNode(s, 80)),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", {
        correlationDirection: "negative",
        correlationConfidence: 0.7,
      }),
    ];
    const graph = makeGraph({ nodes, edges });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.primarySubsystem).toBe("workflow");
    expect(f.likelyCauses).toHaveLength(1);
    expect(f.likelyCauses[0].causeSubsystem).toBe("agents");
    expect(f.likelyCauses[0].mechanism).toBe("inverse_correlation");
    expect(f.likelyCauses[0].confidence).toBeCloseTo(0.56, 2);
  });

  // T5 — degradation_chain detection (2-hop indirect)
  it("detects degradation_chain mechanism across multi-hop edges", () => {
    const nodes: CorrelationNode[] = [
      makeNode("memory", 80),
      makeNode("skills", 75),
      makeNode("workflow", 30),
    ];
    const edges: CorrelationEdge[] = [
      // A→B: memory → skills
      makeEdge("memory", "skills", {
        temporalLag: 1,
        correlationDirection: "positive",
        correlationConfidence: 0.7,
        evidenceIds: ["snap-3", "snap-4"],
      }),
      // B→C: skills → workflow
      makeEdge("skills", "workflow", {
        temporalLag: 1,
        correlationDirection: "positive",
        correlationConfidence: 0.8,
        evidenceIds: ["snap-5", "snap-6"],
      }),
    ];
    const graph = makeGraph({ nodes, edges });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.primarySubsystem).toBe("workflow");

    // Should have 2 likelyCauses: direct skills (temporal_cascade) and chained memory (degradation_chain)
    expect(f.likelyCauses.length).toBeGreaterThanOrEqual(2);

    const memoryCause = f.likelyCauses.find((c) => c.causeSubsystem === "memory");
    expect(memoryCause).toBeDefined();
    expect(memoryCause!.mechanism).toBe("degradation_chain");
    expect(memoryCause!.chainPath).toEqual(["memory", "skills", "workflow"]);
  });

  // T6 — stale graph
  it("returns stale status when graph is stale", () => {
    const graph = makeGraph({ status: "stale" });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.status).toBe("stale");
    expect(result.findings).toHaveLength(0);
  });

  // T7 — insufficient_history
  it("returns insufficient_history status when graph has insufficient history", () => {
    const graph = makeGraph({ status: "insufficient_history" });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.status).toBe("insufficient_history");
    expect(result.findings).toHaveLength(0);
  });

  // T8 — low-confidence edges filtered
  it("filters edges below minCauseConfidence threshold", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
      makeNode("agents", 80),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", { correlationConfidence: 0.2 }),
    ];
    const graph = makeGraph({ nodes, edges });
    const config: ReasoningEngineConfig = { minCauseConfidence: 0.4, maxCausesPerSubsystem: 3, degradationThreshold: 40 };
    const result = buildRootCauseAnalysis(graph, config);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].likelyCauses).toHaveLength(0);
    expect(result.status).toBe("insufficient_edges");
  });

  // T9 — maxCausesPerSubsystem
  it("caps likely causes to maxCausesPerSubsystem", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
      ...ALL_SUBSYSTEMS.filter((s) => s !== "workflow").map((s) => makeNode(s, 80)),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", { temporalLag: 1, correlationConfidence: 0.9 }),
      makeEdge("tools", "workflow", { temporalLag: 1, correlationConfidence: 0.8 }),
      makeEdge("security", "workflow", { temporalLag: 1, correlationConfidence: 0.7 }),
      makeEdge("governance", "workflow", { temporalLag: 1, correlationConfidence: 0.6 }),
      makeEdge("adaptation", "workflow", { temporalLag: 1, correlationConfidence: 0.5 }),
    ];
    const graph = makeGraph({ nodes, edges });
    const config: ReasoningEngineConfig = { minCauseConfidence: 0.4, maxCausesPerSubsystem: 2, degradationThreshold: 40 };
    const result = buildRootCauseAnalysis(graph, config);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].likelyCauses.length).toBeLessThanOrEqual(2);
  });

  // T10 — driving metric from largest drift delta
  it("identifies driving metric from largest absolute delta", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35, undefined, [
        { id: "wf.mem", metric: "memory", delta: -3 },
        { id: "wf.lat", metric: "latency", delta: -15 },
        { id: "wf.err", metric: "errors", delta: 7 },
      ]),
      makeNode("agents", 80),
    ];
    const edges: CorrelationEdge[] = [
      makeEdge("agents", "workflow", { temporalLag: 1, correlationConfidence: 0.7 }),
    ];
    const graph = makeGraph({ nodes, edges });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].drivingMetric).toBe("wf.lat");
  });

  // T11 — insufficient_edges status with degraded but no edges at all
  it("returns insufficient_edges when degraded subsystem has no edges", () => {
    const nodes: CorrelationNode[] = [
      makeNode("workflow", 35),
    ];
    const graph = makeGraph({ nodes, edges: [] });
    const result = buildRootCauseAnalysis(graph, defaultConfig());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].likelyCauses).toHaveLength(0);
    expect(result.status).toBe("insufficient_edges");
    expect(result.findings[0].recommendedAction).toContain("independently");
  });
});
