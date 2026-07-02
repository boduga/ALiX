// tests/reasoning/reasoning-engine.vitest.ts
//
// P11.2 — Integration tests for ReasoningEngine with mock stores.

import { describe, it, expect } from "vitest";
import { ReasoningEngine } from "../../src/reasoning/reasoning-engine.js";
import { DEFAULT_REASONING_CONFIG } from "../../src/reasoning/reasoning-config.js";
import { RootCauseAnalysisError } from "../../src/reasoning/reasoning-types.js";
import type { CorrelationGraph, CorrelationSubsystemId, CorrelationGraphStatus, CorrelationNode, CorrelationEdge } from "../../src/correlation/correlation-types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockGraphStore {
  private graph: CorrelationGraph | null;
  constructor(graph: CorrelationGraph | null) { this.graph = graph; }
  async loadLatest() { return this.graph; }
}

class MockRootCauseStore {
  saved: any = null;
  async save(a: any) { this.saved = a; }
  async loadLatest() { return null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(overrides?: Partial<CorrelationGraph>): CorrelationGraph {
  return {
    schemaVersion: "p11.1.0",
    generatedAt: new Date().toISOString(),
    windowSize: 12,
    status: "ok" as CorrelationGraphStatus,
    nodes: [{ subsystem: "workflow" as CorrelationSubsystemId, score: 80, status: "healthy" as any, drift: [], evidenceIds: [] }],
    edges: [],
    meta: {
      totalSnapshotsExamined: 12,
      minConfidenceThreshold: 0.35,
      maxLagExamined: 3,
      degradationThreshold: -5,
      canonicalSubsystems: ["workflow" as any],
      excludedSubsystems: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReasoningEngine", () => {
  // T12 — run returns analysis when graph exists
  it("run returns analysis when correlation graph exists", async () => {
    const graphStore = new MockGraphStore(makeGraph());
    const rootCauseStore = new MockRootCauseStore();
    const engine = new ReasoningEngine(graphStore as any, rootCauseStore as any, DEFAULT_REASONING_CONFIG);
    const result = await engine.run();
    expect(result).toBeDefined();
    expect(result.schemaVersion).toBe("p11.2.0");
    expect(result.analysisId).toContain("reason-");
    expect(result.status).toBe("no_degradation"); // all nodes healthy
    expect(rootCauseStore.saved).not.toBeNull();
    expect(rootCauseStore.saved.analysisId).toBe(result.analysisId);
  });

  // T13 — run throws when no graph
  it("throws RootCauseAnalysisError when no correlation graph exists", async () => {
    const graphStore = new MockGraphStore(null);
    const rootCauseStore = new MockRootCauseStore();
    const engine = new ReasoningEngine(graphStore as any, rootCauseStore as any, DEFAULT_REASONING_CONFIG);
    await expect(engine.run()).rejects.toThrow(RootCauseAnalysisError);
  });

  // T14 — loadLatest returns null when no analyses exist
  it("loadLatest returns null when no analyses exist", async () => {
    const graphStore = new MockGraphStore(makeGraph());
    const rootCauseStore = new MockRootCauseStore();
    const engine = new ReasoningEngine(graphStore as any, rootCauseStore as any, DEFAULT_REASONING_CONFIG);
    const loaded = await engine.loadLatest();
    expect(loaded).toBeNull();
  });
});
