import { describe, it, expect, vi } from "vitest";
import { DecisionContextBuilder } from "../../src/adaptation/decision-context-builder";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types";

// ---------------------------------------------------------------------------
// Mock helpers (same pattern as lineage-builder tests)
// ---------------------------------------------------------------------------

function mockProposalStore(proposals: Record<string, AdaptationProposal>) {
  return {
    load: vi.fn(async (id: string) => proposals[id] ?? null),
    list: vi.fn(async () => Object.values(proposals)),
  } as any;
}

function mockEvidenceStore() {
  return {
    getByFingerprint: vi.fn(async () => null),
    query: vi.fn(async () => ({ records: [], total: 0, truncated: false })),
  } as any;
}

function mockLineageBuilder(graph: any) {
  return {
    build: vi.fn(async () => graph),
  } as any;
}

function mockEffectivenessStore(report: any | null) {
  return {
    load: vi.fn(async () => report),
  } as any;
}

function mockIntelligenceStore(reports: any[]) {
  return {
    findSimilarProposals: vi.fn(async () => []),
    list: vi.fn(async () => reports.map((r) => `${r.generatedAt}.json`)),
    load: vi.fn(async (filename: string) =>
      reports.find((r) => filename.startsWith(r.generatedAt)) ?? null,
    ),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DecisionContextBuilder", () => {
  const now = new Date().toISOString();

  it("builds a minimal context for a pending proposal", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-test-001",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test proposal",
    };

    const lineageGraph = {
      rootId: "prop-test-001",
      generatedAt: now,
      completeness: "partial" as const,
      nodes: [{ id: "prop-test-001", type: "proposal" as const, label: "test", timestamp: now }],
      edges: [],
      warnings: [],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-test-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-test-001");
    expect(ctx.proposalId).toBe("prop-test-001");
    expect(ctx.contextStatus).toBe("partial_context");
    expect(ctx.confidence).toBeGreaterThan(0);
    expect(ctx.lineageCompleteness).toBe("partial");
    expect(ctx.sourceArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.dataFreshness).toBeDefined();
    expect(typeof ctx.dataFreshness.newestArtifactAgeDays).toBe("number");
  });

  it("returns insufficient_data for missing proposals", async () => {
    const builder = new DecisionContextBuilder(
      mockProposalStore({}),
      mockEvidenceStore(),
      mockLineageBuilder({ rootId: "", generatedAt: now, completeness: "broken", nodes: [], edges: [], warnings: [] }),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-nonexistent");
    expect(ctx.contextStatus).toBe("insufficient_data");
    expect(ctx.confidence).toBe(0);
    expect(ctx.warnings).toBeDefined();
  });

  it("returns complete_context for applied proposals with full lineage", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-applied-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1"],
      reason: "Test applied",
    };

    const lineageGraph = {
      rootId: "prop-applied-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [
        { id: "prop-applied-001", type: "proposal" as const, label: "test", timestamp: now },
        { id: "approval:evt-1", type: "approval" as const, label: "approved", timestamp: now },
      ],
      edges: [{ sourceId: "prop-applied-001", targetId: "approval:evt-1", relation: "approved_as" as const }],
      warnings: [],
    };

    const effReport = {
      proposalId: "prop-applied-001",
      recommendation: "keep",
      assessedAt: now,
      dataSufficient: true,
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-applied-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(effReport),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-applied-001");
    expect(ctx.contextStatus).toBe("complete_context");
    expect(ctx.lineageCompleteness).toBe("complete");
    expect(ctx.effectivenessTrend.sampleSize).toBe(1);
    expect(ctx.sourceArtifacts.some((s) => s.type === "effectiveness")).toBe(true);
  });

  it("detects stale proposals", async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const proposal: AdaptationProposal = {
      id: "prop-stale-001",
      createdAt: oldDate,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "stale" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.5,
      evidenceFingerprints: [],
      reason: "Stale proposal",
    };

    const lineageGraph = {
      rootId: "prop-stale-001",
      generatedAt: oldDate,
      completeness: "partial" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-stale-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-stale-001");
    expect(ctx.contextStatus).toBe("stale_context");
    expect(ctx.ageDays).toBeGreaterThan(30);
    expect(ctx.warnings).toBeDefined();
    expect(ctx.warnings!.some((w) => w.message.includes("stale") || w.message.includes("activity"))).toBe(true);
  });

  it("includes similar proposals from intelligence store", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-sim-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test with similar",
    };

    const lineageGraph = {
      rootId: "prop-sim-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    // Mock IntelligenceStore with findSimilarProposals
    const intelStore = mockIntelligenceStore([]);
    intelStore.findSimilarProposals = vi.fn(async () => [
      { proposalId: "prop-old-001", outcome: "keep", confidence: 0.85 },
      { proposalId: "prop-old-002", outcome: "revert", confidence: 0.6 },
    ]);

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-sim-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      intelStore,
    );

    const ctx = await builder.build("prop-sim-001");
    expect(ctx.similarProposals.length).toBeGreaterThan(0);
    expect(ctx.similarProposals[0].action).toBe("update_agent_card");
  });

  it("includes source artifacts for all consumed data", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-src-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1"],
      reason: "Source artifact test",
    };

    const lineageGraph = {
      rootId: "prop-src-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const intelStore = mockIntelligenceStore([]);
    intelStore.findSimilarProposals = vi.fn(async () => []);

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-src-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore({ proposalId: "prop-src-001", recommendation: "keep", assessedAt: now, dataSufficient: true }),
      intelStore,
    );

    const ctx = await builder.build("prop-src-001");
    // Should have: proposal + lineage + effectiveness artifacts
    const types = ctx.sourceArtifacts.map((s) => s.type);
    expect(types).toContain("proposal");
    expect(types).toContain("lineage");
    expect(types).toContain("effectiveness");
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it("confidence reflects evidence completeness", async () => {
    // Proposal with full data should have higher confidence than one without
    const lineageComplete = {
      rootId: "prop-a",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };
    const lineagePartial = {
      rootId: "prop-b",
      generatedAt: now,
      completeness: "partial" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const proposalA: AdaptationProposal = {
      id: "prop-a",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1", "fp-2"],
      reason: "Full data",
    };
    const proposalB: AdaptationProposal = {
      id: "prop-b",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "minimal" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.5,
      evidenceFingerprints: [],
      reason: "Minimal data",
    };

    const builderA = new DecisionContextBuilder(
      mockProposalStore({ "prop-a": proposalA }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageComplete),
      mockEffectivenessStore({ proposalId: "prop-a", recommendation: "keep", assessedAt: now, dataSufficient: true }),
      mockIntelligenceStore([{ generatedAt: now, trends: [] }]),
    );
    const builderB = new DecisionContextBuilder(
      mockProposalStore({ "prop-b": proposalB }),
      mockEvidenceStore(),
      mockLineageBuilder(lineagePartial),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctxA = await builderA.build("prop-a");
    const ctxB = await builderB.build("prop-b");
    expect(ctxA.confidence).toBeGreaterThan(ctxB.confidence);
  });

  it("populates lineage warnings into context warnings", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-warn-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Warning test",
    };

    const lineageGraph = {
      rootId: "prop-warn-001",
      generatedAt: now,
      completeness: "broken" as const,
      nodes: [],
      edges: [],
      warnings: [
        { type: "missing_evidence_fingerprint" as const, message: "Evidence fingerprint fp-abc not found", sourceId: "prop-warn-001" },
      ],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-warn-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-warn-001");
    expect(ctx.warnings).toBeDefined();
    expect(ctx.warnings!.length).toBeGreaterThan(0);
    expect(ctx.warnings!.some((w) => w.message.includes("fingerprint"))).toBe(true);
  });
});
