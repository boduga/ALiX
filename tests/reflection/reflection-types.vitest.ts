/**
 * P5.0a — ReflectionReport type tests.
 *
 * Verifies that the core types are constructible and that the Analyzer
 * interface accepts typed results.
 */

import { describe, it, expect } from "vitest";
import type { ReflectionReport, Observation, Analyzer, AnalysisResult } from "../../src/reflection/reflection-types.js";

describe("ReflectionReport types", () => {
  it("constructs a valid ReflectionReport with metrics", () => {
    const report: ReflectionReport = {
      generatedAt: new Date().toISOString(),
      observations: [{ type: "workflow_stall", severity: "medium", title: "Stalled", detail: "", source: "WA", count: 3 }],
      recommendations: [{ type: "capability_gap", confidence: 0.85, title: "Add UI cap", evidence: ["12 reqs"], recommendedAction: "Create" }],
      metrics: { workflowsCompleted: 5, workflowsBlocked: 3, workflowsAborted: 1, capabilitiesRequested: 10, unresolvedCapabilities: 2, reviewApprovalRate: 0.6 },
      summary: { totalObservations: 1, totalRecommendations: 1, highSeverityCount: 0 },
    };
    expect(report.metrics.workflowsCompleted).toBe(5);
    expect(report.metrics.unresolvedCapabilities).toBe(2);
  });

  it("Analyzer interface accepts typed result", () => {
    const analyzer: Analyzer = {
      name: "test",
      analyze: async () => ({ observations: [], recommendations: [] }),
    };
    expect(analyzer.name).toBe("test");
  });
});
