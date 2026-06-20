import { describe, it, expect, vi } from "vitest";
import { LineageBuilder } from "../../src/adaptation/lineage-builder";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types";

function mockProposalStore(proposals: Record<string, AdaptationProposal>) {
  return {
    load: vi.fn(async (id: string) => proposals[id] ?? null),
    list: vi.fn(async (status?: string) =>
      Object.values(proposals).filter(
        (p) => !status || p.status === status,
      ),
    ),
  } as any;
}

function mockEvidenceStore(records: any[]) {
  return {
    getByFingerprint: vi.fn(async (fp: string) =>
      records.find((r) => r.fingerprint === fp) ?? null,
    ),
    query: vi.fn(async (q: any) => ({
      records: records.filter((r) => r.type === q.type),
      total: records.length,
      truncated: false,
    })),
  } as any;
}

function mockEffectivenessStore(report: any | null) {
  return {
    load: vi.fn(async (_id: string) => report),
  } as any;
}

function mockIntelligenceStore(reports: any[]) {
  return {
    list: vi.fn(async () => reports.map((r) => `${r.generatedAt}.json`)),
    load: vi.fn(async (filename: string) =>
      reports.find((r) => filename.startsWith(r.generatedAt)) ?? null,
    ),
  } as any;
}

describe("LineageBuilder", () => {
  it("builds a minimal graph for a pending proposal", async () => {
    const now = new Date().toISOString();
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

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-test-001": proposal }),
      mockEvidenceStore([]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-test-001");
    expect(graph.rootId).toBe("prop-test-001");
    expect(graph.completeness).toBe("partial");
    expect(graph.nodes.length).toBe(1);
    expect(graph.edges.length).toBe(0);
  });

  it("detects broken lineage when root proposal is missing", async () => {
    const builder = new LineageBuilder(
      mockProposalStore({}),
      mockEvidenceStore([]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-nonexistent");
    expect(graph.completeness).toBe("broken");
    expect(graph.warnings.length).toBeGreaterThan(0);
  });

  it("includes approval and application nodes when evidence exists", async () => {
    const now = new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: "prop-test-002",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test-agent" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: [],
      reason: "Test proposal",
    };

    const approvalRec = {
      id: "evt-approve-1",
      type: "adaptation_approved",
      timestamp: now,
      fingerprint: "fp-approve-1",
      payload: { proposalId: "prop-test-002", approvedBy: "human" },
    };
    const appliedRec = {
      id: "evt-apply-1",
      type: "adaptation_applied",
      timestamp: now,
      fingerprint: "fp-apply-1",
      payload: { proposalId: "prop-test-002" },
    };

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-test-002": proposal }),
      mockEvidenceStore([approvalRec, appliedRec]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-test-002");
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBe(2);
    expect(graph.edges.some((e) => e.relation === "approved_as")).toBe(true);
    expect(graph.edges.some((e) => e.relation === "applied_as")).toBe(true);
  });

  it("includes revert proposals in the graph", async () => {
    const now = new Date().toISOString();
    const sourceProposal: AdaptationProposal = {
      id: "prop-source-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test-agent" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: [],
      reason: "Original update",
    };
    const revertProposal: AdaptationProposal = {
      id: "prop-revert-001",
      createdAt: now,
      status: "pending",
      action: "revert_proposal",
      target: { kind: "revert", sourceProposalId: "prop-source-001" },
      payload: { reason: "Reverting test", sourceProposalId: "prop-source-001" },
      sourceRecommendationType: "manual_revert",
      sourceConfidence: 1,
      evidenceFingerprints: [],
      reason: "Reverting test",
    };

    const builder = new LineageBuilder(
      mockProposalStore({
        "prop-source-001": sourceProposal,
        "prop-revert-001": revertProposal,
      }),
      mockEvidenceStore([]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-source-001");
    const revertEdge = graph.edges.find((e) => e.relation === "reverted_by");
    expect(revertEdge).toBeDefined();
  });

  it("includes effectiveness reports when they exist", async () => {
    const now = new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: "prop-eff-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test-agent" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: [],
      reason: "Test",
    };

    const approvalRec = {
      id: "evt-appr-1",
      type: "adaptation_approved",
      timestamp: now,
      fingerprint: "fp-appr-1",
      payload: { proposalId: "prop-eff-001", approvedBy: "human" },
    };

    const effReport = {
      proposalId: "prop-eff-001",
      recommendation: "keep",
      primary: { metric: "keep" },
      assessedAt: now,
      dataSufficient: true,
    };

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-eff-001": proposal }),
      mockEvidenceStore([approvalRec]),
      mockEffectivenessStore(effReport),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-eff-001");
    expect(graph.nodes.some((n) => n.type === "effectiveness")).toBe(true);
    expect(graph.edges.some((e) => e.relation === "measured_as")).toBe(true);
  });

  it("reports generatedAt timestamp", async () => {
    const now = new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: "prop-ts-001",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test",
    };

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-ts-001": proposal }),
      mockEvidenceStore([]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-ts-001");
    expect(graph.generatedAt).toBeDefined();
    expect(typeof graph.generatedAt).toBe("string");
    expect(graph.generatedAt.length).toBeGreaterThan(10);
  });

  it("returns complete for applied proposals", async () => {
    const now = new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: "prop-complete-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test",
    };

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-complete-001": proposal }),
      mockEvidenceStore([]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-complete-001");
    expect(graph.completeness).toBe("complete");
  });

  it("evidence nodes use type 'evidence'", async () => {
    const now = new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: "prop-evidence-type-001",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: ["fp-existing"],
      reason: "Test evidence type",
    };

    const evidenceRec = {
      id: "evt-1",
      type: "adaptation_proposed",
      timestamp: now,
      fingerprint: "fp-existing",
      payload: { proposalId: "prop-evidence-type-001" },
    };

    const builder = new LineageBuilder(
      mockProposalStore({ "prop-evidence-type-001": proposal }),
      mockEvidenceStore([evidenceRec]),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const graph = await builder.build("prop-evidence-type-001");
    const evidenceNode = graph.nodes.find((n) => n.type === "evidence");
    expect(evidenceNode).toBeDefined();
  });
});
