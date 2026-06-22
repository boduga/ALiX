// tests/adaptation/pipeline-health-collector.vitest.ts
import { describe, it, expect, vi } from "vitest";
import { PipelineHealthCollector } from "../../src/adaptation/pipeline-health-collector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockIntelligenceReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "intel-1",
    generatedAt: new Date().toISOString(),
    topPerforming: [],
    confidenceCalibration: { buckets: [] },
    revertSignalAnalysis: { totalAdvisoryReverts: 0 },
    totalProposalsAnalyzed: 0,
    recommendation: "keep",
    executiveSummary: "",
    ...overrides,
  };
}

function makeMockEffectivenessReport(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "eff-1",
    recommendation: "keep",
    assessedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockInfra(overrides: Record<string, any> = {}) {
  return {
    proposalStore: {
      list: vi.fn().mockResolvedValue([
        { id: "p1", status: "pending", createdAt: new Date().toISOString() },
        { id: "p2", status: "applied", createdAt: new Date().toISOString() },
        { id: "p3", status: "rejected", createdAt: new Date().toISOString() },
      ]),
    },
    evidenceStore: {
      query: vi.fn().mockResolvedValue({
        records: [{ timestamp: new Date().toISOString() }],
        total: 1,
        truncated: false,
      }),
    },
    effectivenessStore: {
      list: vi.fn().mockResolvedValue([makeMockEffectivenessReport()]),
    },
    intelligenceStore: {
      list: vi.fn().mockResolvedValue(["report1.json"]),
      load: vi.fn().mockResolvedValue(makeMockIntelligenceReport()),
    },
    contextBuilder: {
      build: vi.fn().mockResolvedValue({
        id: "ctx",
        confidence: 0.8,
        ageDays: 5,
        lineageCompleteness: "complete" as const,
        dataFreshness: { newestArtifactAgeDays: 2, oldestArtifactAgeDays: 10 },
      }),
    },
    riskScoreBuilder: {
      build: vi.fn().mockReturnValue({ id: "risk", confidence: 0.75, overallRisk: 0.4 }),
    },
    recommendationEngine: {
      recommend: vi.fn().mockReturnValue({ id: "rec", confidence: 0.82, recommendation: "approve" }),
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PipelineHealthCollector", () => {
  it("collects pending + window-scoped proposals", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    expect(input.proposalCounts.total).toBe(3);
    expect(input.proposalCounts.pending).toBe(1);
    expect(input.proposalCounts.applied).toBe(1);
    expect(input.proposalCounts.rejected).toBe(1);
    expect(input.scopedProposalInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("includes risk and recommendation confidence", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    if (input.scopedProposalInputs.length > 0) {
      const data = input.scopedProposalInputs[0];
      expect(data.contextConfidence).toBe(0.8);
      expect(data.riskConfidence).toBe(0.75);
      expect(data.recommendationConfidence).toBe(0.82);
    }
  });

  it("skips failed context builds", async () => {
    const infra = makeMockInfra({
      contextBuilder: {
        build: vi.fn().mockRejectedValue(new Error("Store error")),
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.scopedProposalInputs.length).toBe(0);
  });

  it("detects unavailable ProposalStore", async () => {
    const infra = makeMockInfra({
      proposalStore: { list: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.storeAvailability.proposalStore).toBe(false);
    expect(input.storeErrors?.proposalStore).toBe("ECONNREFUSED");
  });

  it("detects unavailable EvidenceStore", async () => {
    const infra = makeMockInfra({
      evidenceStore: {
        query: vi.fn().mockRejectedValue(new Error("File not found")),
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.storeAvailability.evidenceStore).toBe(false);
    expect(input.storeErrors?.evidenceStore).toBe("File not found");
  });

  it("sets strategicBrief available when build succeeds", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    expect(input.strategicBrief.available).toBe(true);
    expect(typeof input.strategicBrief.confidence).toBe("number");
    expect(input.strategicBrief.findings).toBeGreaterThanOrEqual(0);
  });

  it("loads intelligence reports via .load() for strategic brief", async () => {
    const loadMock = vi.fn().mockResolvedValue(makeMockIntelligenceReport());
    const infra = makeMockInfra({
      intelligenceStore: {
        list: vi.fn().mockResolvedValue(["report1.json", "report2.json"]),
        load: loadMock,
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    // intelligenceReports count reflects total filenames
    expect(input.intelligenceReports).toBe(2);
    // strategic brief is available because .load() provided real data
    expect(input.strategicBrief.available).toBe(true);
    // .load() was called for each filename
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(loadMock).toHaveBeenCalledWith("report1.json");
    expect(loadMock).toHaveBeenCalledWith("report2.json");
  });

  it("counts lifecycle events from evidenceStore query result", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    expect(input.lifecycleEvents.total).toBe(1);
    expect(input.lifecycleEvents.inWindow).toBeGreaterThanOrEqual(0);
  });

  it("returns effectiveness report count from store", async () => {
    const infra = makeMockInfra({
      effectivenessStore: {
        list: vi.fn().mockResolvedValue([
          makeMockEffectivenessReport({ proposalId: "e1" }),
          makeMockEffectivenessReport({ proposalId: "e2" }),
          makeMockEffectivenessReport({ proposalId: "e3" }),
        ]),
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.effectivenessReports).toBe(3);
  });

  it("includes storeErrors only for stores with actual errors", async () => {
    const infra = makeMockInfra({
      proposalStore: { list: vi.fn().mockRejectedValue(new Error("Down")) },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    expect(input.storeErrors?.proposalStore).toBe("Down");
    // No error for other stores — none should leak through
    expect(input.storeErrors?.evidenceStore).toBeUndefined();
    expect(input.storeErrors?.effectivenessStore).toBeUndefined();
    expect(input.storeErrors?.intelligenceStore).toBeUndefined();
  });

  it("handles intelligenceStore load returning null for missing files", async () => {
    const infra = makeMockInfra({
      intelligenceStore: {
        list: vi.fn().mockResolvedValue(["exists.json", "missing.json"]),
        load: vi.fn().mockImplementation((f: string) => {
          if (f === "exists.json") return Promise.resolve(makeMockIntelligenceReport());
          return Promise.resolve(null); // file not found on disk
        }),
      },
    });
    const collector = new PipelineHealthCollector(infra);
    const input = await collector.collect(30);
    // Count reflects all filenames
    expect(input.intelligenceReports).toBe(2);
    // Brief still available — nulls are filtered out
    expect(input.strategicBrief.available).toBe(true);
  });

  it("includes lineage and data freshness in scoped proposal data", async () => {
    const collector = new PipelineHealthCollector(makeMockInfra());
    const input = await collector.collect(30);
    if (input.scopedProposalInputs.length > 0) {
      const data = input.scopedProposalInputs[0];
      expect(data.lineageCompleteness).toBe("complete");
      expect(data.dataFreshness.newestDays).toBe(2);
      expect(data.dataFreshness.oldestDays).toBe(10);
      expect(data.ageDays).toBe(5);
    }
  });
});
