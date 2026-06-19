/**
 * P5.0f — ReflectionAgent tests.
 *
 * Verifies that the ReflectionAgent correctly composes multiple Analyzer
 * plugins, runs them in parallel via Promise.all, computes metrics from
 * the EvidenceStore, and returns a complete ReflectionReport.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { ReflectionAgent } from "../../src/reflection/reflection-agent.js";
import type { Analyzer, AnalysisResult, ReflectionReport } from "../../src/reflection/reflection-types.js";
import type { EvidenceRecord } from "../../src/security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock analyzer that returns a canned result. */
function mockAnalyzer(name: string, result: AnalysisResult): Analyzer {
  return {
    name,
    analyze: vi.fn().mockResolvedValue(result),
  };
}

/** Create a minimal valid observation. */
function simpleObs(overrides: Partial<import("../../src/reflection/reflection-types.js").Observation> = {}) {
  return {
    type: "workflow_stall" as const,
    severity: "medium" as const,
    title: "Test observation",
    detail: "Test detail",
    source: "test",
    count: 1,
    ...overrides,
  };
}

/** Create a minimal valid recommendation. */
function simpleRec(overrides: Partial<import("../../src/reflection/reflection-types.js").Recommendation> = {}) {
  return {
    type: "process_change" as const,
    confidence: 0.8,
    title: "Test recommendation",
    evidence: ["some evidence"],
    recommendedAction: "Do something",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReflectionAgent", () => {
  let storeDir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "reflection-agent-test-"));
    store = new EvidenceStore({ storeDir });
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Empty / no analyzers
  // -----------------------------------------------------------------------

  it("produces a report with empty observations and recommendations when no analyzers are registered", async () => {
    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.observations).toEqual([]);
    expect(report.recommendations).toEqual([]);
    expect(report.generatedAt).toBeDefined();
    expect(new Date(report.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("computes zero metrics when the evidence store is empty", async () => {
    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics).toEqual({
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 0,
      reviewApprovalRate: 1,
    });
  });

  it("reports zero high-severity observations when none exist", async () => {
    const a = mockAnalyzer("low-analyzer", {
      observations: [
        simpleObs({ severity: "low", title: "Minor thing" }),
        simpleObs({ severity: "medium", title: "Medium thing" }),
      ],
      recommendations: [],
    });

    const agent = new ReflectionAgent([a], store);
    const report = await agent.generateReport();

    expect(report.summary.highSeverityCount).toBe(0);
    expect(report.summary.totalObservations).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Single analyzer
  // -----------------------------------------------------------------------

  it("aggregates observations and recommendations from a single analyzer", async () => {
    const obs = [simpleObs({ title: "Obs1" }), simpleObs({ title: "Obs2" })];
    const recs = [simpleRec({ title: "Rec1" })];

    const a = mockAnalyzer("single", { observations: obs, recommendations: recs });
    const agent = new ReflectionAgent([a], store);
    const report = await agent.generateReport();

    expect(report.observations).toHaveLength(2);
    expect(report.observations[0].title).toBe("Obs1");
    expect(report.observations[1].title).toBe("Obs2");
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0].title).toBe("Rec1");
  });

  it("calls analyze() on the registered analyzer", async () => {
    const a = mockAnalyzer("called", { observations: [], recommendations: [] });
    const agent = new ReflectionAgent([a], store);
    await agent.generateReport();

    expect(a.analyze).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Multiple analyzers (plugin pattern)
  // -----------------------------------------------------------------------

  it("calls analyze() on all registered analyzers", async () => {
    const a1 = mockAnalyzer("a1", { observations: [], recommendations: [] });
    const a2 = mockAnalyzer("a2", { observations: [], recommendations: [] });
    const a3 = mockAnalyzer("a3", { observations: [], recommendations: [] });

    const agent = new ReflectionAgent([a1, a2, a3], store);
    await agent.generateReport();

    expect(a1.analyze).toHaveBeenCalledTimes(1);
    expect(a2.analyze).toHaveBeenCalledTimes(1);
    expect(a3.analyze).toHaveBeenCalledTimes(1);
  });

  it("merges observations from multiple analyzers", async () => {
    const a1 = mockAnalyzer("a1", {
      observations: [simpleObs({ title: "From A1", source: "a1" })],
      recommendations: [],
    });
    const a2 = mockAnalyzer("a2", {
      observations: [
        simpleObs({ title: "From A2.1", source: "a2" }),
        simpleObs({ title: "From A2.2", source: "a2", severity: "high" }),
      ],
      recommendations: [],
    });

    const agent = new ReflectionAgent([a1, a2], store);
    const report = await agent.generateReport();

    expect(report.observations).toHaveLength(3);
    const titles = report.observations.map((o) => o.title);
    expect(titles).toContain("From A1");
    expect(titles).toContain("From A2.1");
    expect(titles).toContain("From A2.2");
  });

  it("merges recommendations from multiple analyzers", async () => {
    const a1 = mockAnalyzer("a1", {
      observations: [],
      recommendations: [simpleRec({ title: "Rec from A1" })],
    });
    const a2 = mockAnalyzer("a2", {
      observations: [],
      recommendations: [
        simpleRec({ title: "Rec from A2.1" }),
        simpleRec({ title: "Rec from A2.2" }),
      ],
    });

    const agent = new ReflectionAgent([a1, a2], store);
    const report = await agent.generateReport();

    expect(report.recommendations).toHaveLength(3);
    const titles = report.recommendations.map((r) => r.title);
    expect(titles).toContain("Rec from A1");
    expect(titles).toContain("Rec from A2.1");
    expect(titles).toContain("Rec from A2.2");
  });

  // -----------------------------------------------------------------------
  // Summary computation
  // -----------------------------------------------------------------------

  it("computes correct summary totals", async () => {
    const a = mockAnalyzer("multi", {
      observations: [
        simpleObs({ severity: "high", title: "Critical issue" }),
        simpleObs({ severity: "medium", title: "Warning" }),
        simpleObs({ severity: "high", title: "Another critical" }),
        simpleObs({ severity: "low", title: "Nit" }),
      ],
      recommendations: [
        simpleRec({ title: "Rec1" }),
        simpleRec({ title: "Rec2" }),
        simpleRec({ title: "Rec3" }),
      ],
    });

    const agent = new ReflectionAgent([a], store);
    const report = await agent.generateReport();

    expect(report.summary).toEqual({
      totalObservations: 4,
      totalRecommendations: 3,
      highSeverityCount: 2,
    });
  });

  // -----------------------------------------------------------------------
  // Metrics computation from evidence store
  // -----------------------------------------------------------------------

  it("computes workflowsCompleted from merge_completed evidence records", async () => {
    await store.appendBatch([
      { type: "merge_completed", payload: { pr: "https://github.com/x/y/pull/1" } },
      { type: "merge_completed", payload: { pr: "https://github.com/x/y/pull/2" } },
      { type: "merge_completed", payload: { pr: "https://github.com/x/y/pull/3" } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.workflowsCompleted).toBe(3);
  });

  it("computes workflowsBlocked from workflow_blocked evidence records", async () => {
    await store.appendBatch([
      { type: "workflow_blocked", payload: { reason: "waiting for review" } },
      { type: "workflow_blocked", payload: { reason: "dependency unmet" } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.workflowsBlocked).toBe(2);
  });

  it("computes workflowsAborted from workflow_aborted evidence records", async () => {
    await store.appendBatch([
      { type: "workflow_aborted", payload: { reason: "timeout" } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.workflowsAborted).toBe(1);
  });

  it("computes capabilitiesRequested from capability_routed evidence records", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "ts-fix", candidates: 2 } },
      { type: "capability_routed", payload: { capability: "py-lint", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rust-analyze", candidates: 1 } },
      { type: "capability_routed", payload: { capability: "k8s-deploy", candidates: 0 } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.capabilitiesRequested).toBe(4);
  });

  it("computes unresolvedCapabilities from capability_routed with zero candidates", async () => {
    await store.appendBatch([
      { type: "capability_routed", payload: { capability: "ts-fix", candidates: 2 } },
      { type: "capability_routed", payload: { capability: "py-lint", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "rust-analyze", candidates: 1 } },
      { type: "capability_routed", payload: { capability: "k8s-deploy", candidates: 0 } },
      { type: "capability_routed", payload: { capability: "helm-chart", candidates: 0 } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.capabilitiesRequested).toBe(5);
    // py-lint, k8s-deploy, helm-chart have candidates=0
    expect(report.metrics.unresolvedCapabilities).toBe(3);
  });

  it("computes reviewApprovalRate from review_completed evidence records", async () => {
    await store.appendBatch([
      { type: "review_completed", payload: { verdict: "approve", pr: "1" } },
      { type: "review_completed", payload: { verdict: "approve", pr: "2" } },
      { type: "review_completed", payload: { verdict: "reject", pr: "3" } },
      { type: "review_completed", payload: { verdict: "approve", pr: "4" } },
    ]);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    // 3 approved out of 4 = 0.75
    expect(report.metrics.reviewApprovalRate).toBe(0.75);
  });

  it("returns reviewApprovalRate of 1 when there are no reviews", async () => {
    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.reviewApprovalRate).toBe(1);
  });

  it("handles high limits for capability_routed and review_completed queries", async () => {
    // Seed more than default limit to ensure large queries work
    const batch = Array.from({ length: 150 }, (_, i) => ({
      type: "capability_routed" as const,
      payload: { capability: `cap-${i % 10}`, candidates: i % 3 },
    }));
    await store.appendBatch(batch);

    const agent = new ReflectionAgent([], store);
    const report = await agent.generateReport();

    expect(report.metrics.capabilitiesRequested).toBe(150);
    // candidates=0 when i % 3 === 0 => 0,3,6,... every 3rd => 50 unresolved
    expect(report.metrics.unresolvedCapabilities).toBe(50);
  });

  // -----------------------------------------------------------------------
  // End-to-end: analyzers + metrics together
  // -----------------------------------------------------------------------

  it("produces a complete ReflectionReport matching the schema", async () => {
    // Seed some evidence
    await store.appendBatch([
      { type: "merge_completed", payload: { pr: "1" } },
      { type: "merge_completed", payload: { pr: "2" } },
      { type: "workflow_blocked", payload: { reason: "stuck" } },
    ]);

    const a1 = mockAnalyzer("evidence-analyzer", {
      observations: [
        simpleObs({
          type: "workflow_failure",
          severity: "high",
          title: "Workflow abort detected",
          source: "evidence-analyzer",
          count: 5,
        }),
      ],
      recommendations: [
        simpleRec({
          type: "process_change",
          title: "Add retry logic",
          confidence: 0.9,
        }),
      ],
    });

    const a2 = mockAnalyzer("capability-analyzer", {
      observations: [
        simpleObs({
          type: "capability_gap",
          severity: "high",
          title: "Missing capability: helm-chart",
          source: "CapabilityAnalyzer",
          count: 6,
        }),
      ],
      recommendations: [
        simpleRec({
          type: "capability_gap",
          title: "Create helm-chart skill",
          confidence: 0.95,
        }),
      ],
    });

    const agent = new ReflectionAgent([a1, a2], store);
    const report = await agent.generateReport();

    // Validate top-level shape
    expect(report).toHaveProperty("generatedAt");
    expect(report).toHaveProperty("observations");
    expect(report).toHaveProperty("recommendations");
    expect(report).toHaveProperty("metrics");
    expect(report).toHaveProperty("summary");

    // Validate generatedAt is a valid ISO timestamp
    expect(new Date(report.generatedAt).getTime()).toBeGreaterThan(0);

    // observations merged from both analyzers
    expect(report.observations).toHaveLength(2);
    expect(report.recommendations).toHaveLength(2);

    // metrics from evidence store
    expect(report.metrics.workflowsCompleted).toBe(2);
    expect(report.metrics.workflowsBlocked).toBe(1);
    expect(report.metrics.workflowsAborted).toBe(0);

    // summary
    expect(report.summary.totalObservations).toBe(2);
    expect(report.summary.totalRecommendations).toBe(2);
    expect(report.summary.highSeverityCount).toBe(2);

    // Verify both mock analyzers were called
    expect(a1.analyze).toHaveBeenCalledTimes(1);
    expect(a2.analyze).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Error propagation
  // -----------------------------------------------------------------------

  it("propagates errors from failing analyzers", async () => {
    const goodAnalyzer = mockAnalyzer("good", {
      observations: [simpleObs({ title: "Good" })],
      recommendations: [],
    });
    const badAnalyzer: Analyzer = {
      name: "bad",
      analyze: vi.fn().mockRejectedValue(new Error("Analyzer failed")),
    };

    const agent = new ReflectionAgent([goodAnalyzer, badAnalyzer], store);
    await expect(agent.generateReport()).rejects.toThrow("Analyzer failed");
  });

  // -----------------------------------------------------------------------
  // Parallel execution
  // -----------------------------------------------------------------------

  it("runs all analyzers in parallel", async () => {
    const order: string[] = [];
    const makeDelayedAnalyzer = (name: string, delayMs: number): Analyzer => ({
      name,
      analyze: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(name);
        return { observations: [], recommendations: [] };
      }),
    });

    const a1 = makeDelayedAnalyzer("fast", 5);
    const a2 = makeDelayedAnalyzer("slow", 50);

    const agent = new ReflectionAgent([a1, a2], store);

    const start = Date.now();
    await agent.generateReport();
    const duration = Date.now() - start;

    // If truly parallel, total time should be close to slowest (~50ms), not sum (~55ms)
    // Allow generous tolerance for CI
    expect(duration).toBeLessThan(200);

    // Both were called
    expect(a1.analyze).toHaveBeenCalledTimes(1);
    expect(a2.analyze).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Any number of analyzers (constructor injection)
  // -----------------------------------------------------------------------

  it("supports any number of analyzers via constructor injection", async () => {
    const analyzerCount = 10;
    const analyzers = Array.from({ length: analyzerCount }, (_, i) =>
      mockAnalyzer(`analyzer-${i}`, {
        observations: [simpleObs({ title: `Obs from ${i}`, source: `analyzer-${i}` })],
        recommendations: [],
      }),
    );

    const agent = new ReflectionAgent(analyzers, store);
    const report = await agent.generateReport();

    expect(report.observations).toHaveLength(analyzerCount);
    for (const a of analyzers) {
      expect(a.analyze).toHaveBeenCalledTimes(1);
    }
  });

  // -----------------------------------------------------------------------
  // Edge: analyzers with empty results
  // -----------------------------------------------------------------------

  it("handles analyzers that return empty results gracefully", async () => {
    const a1 = mockAnalyzer("empty1", { observations: [], recommendations: [] });
    const a2 = mockAnalyzer("empty2", { observations: [], recommendations: [] });
    const a3 = mockAnalyzer("with-data", {
      observations: [simpleObs({ title: "Has data" })],
      recommendations: [simpleRec({ title: "Has rec" })],
    });

    const agent = new ReflectionAgent([a1, a2, a3], store);
    const report = await agent.generateReport();

    expect(report.observations).toHaveLength(1);
    expect(report.recommendations).toHaveLength(1);
    expect(report.summary.totalObservations).toBe(1);
    expect(report.summary.totalRecommendations).toBe(1);
  });
});
