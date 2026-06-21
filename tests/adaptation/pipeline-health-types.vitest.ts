import { describe, it, expect } from "vitest";
import type { PipelineHealthReport, PipelineHealthInput, PipelineHealthStatus } from "../../src/adaptation/pipeline-health-types.js";

describe("PipelineHealthReport", () => {
  it("extends DecisionArtifact and has all required fields", () => {
    const report: PipelineHealthReport = {
      id: "status:2026-06-21:30d",
      subject: "Pipeline Health — Last 30 days",
      outcome: "observed",
      confidence: 1,
      reasons: ["All stores available"],
      generatedAt: "2026-06-21T00:00:00.000Z",
      windowDays: 30,
      health: "healthy",
      healthSignals: [],
      storeAvailability: {
        proposalStore: true,
        evidenceStore: true,
        effectivenessStore: true,
        intelligenceStore: true,
      },
      proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
      scopedProposals: {
        total: 0,
        staleProposals: 0,
        brokenLineage: 0,
        confidence: { contextAvg: 0, sampleSize: 0 },
        dataFreshness: { newestDays: null, oldestDays: null },
      },
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: true, confidence: 0.85, findings: 3 },
      governanceReview: { frameworkAvailable: true, liveLensExecutionAvailable: false, persistedReviews: false },
    };
    expect(report.id).toBeTruthy();
    expect(report.health).toBe("healthy");
    expect(Array.isArray(report.healthSignals)).toBe(true);
  });
});

describe("PipelineHealthStatus", () => {
  it("accepts all three health values", () => {
    const statuses: PipelineHealthStatus[] = ["healthy", "degraded", "attention_needed"];
    expect(statuses.length).toBe(3);
  });
});

describe("PipelineHealthInput", () => {
  it("has optional fields matching collector output", () => {
    const input: PipelineHealthInput = {
      proposalCounts: { total: 0, pending: 0, approved: 0, applied: 0, rejected: 0, failed: 0 },
      scopedProposalInputs: [],
      effectivenessReports: 0,
      intelligenceReports: 0,
      lifecycleEvents: { total: 0, inWindow: 0 },
      strategicBrief: { available: true, confidence: 0.85, findings: 3 },
      storeAvailability: { proposalStore: true, evidenceStore: true, effectivenessStore: true, intelligenceStore: true },
    };
    expect(input.proposalCounts.total).toBe(0);
  });
});
