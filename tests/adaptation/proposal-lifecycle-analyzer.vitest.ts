import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalLifecycleAnalyzer } from "../../src/adaptation/proposal-lifecycle-analyzer.js";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { EffectivenessStore } from "../../src/adaptation/effectiveness-store.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import type { IntelligenceOptions } from "../../src/adaptation/intelligence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProposalSeed {
  id: string;
  createdAt: string;
  status: AdaptationProposal["status"];
  action: AdaptationProposal["action"];
  target: AdaptationProposal["target"];
  sourceConfidence?: number;
  approvedAt?: string;
  appliedAt?: string;
  provenance?: "auto" | "manual";
}

function makeProposal(seed: ProposalSeed): AdaptationProposal {
  return {
    id: seed.id,
    createdAt: seed.createdAt,
    status: seed.status,
    action: seed.action,
    target: seed.target,
    payload: {},
    sourceRecommendationType: "capability_gap",
    sourceConfidence: seed.sourceConfidence ?? 0.9,
    evidenceFingerprints: [],
    reason: `Reason for ${seed.id}`,
    approvedAt: seed.approvedAt,
    approvedBy: seed.approvedAt ? "test-human" : undefined,
    appliedAt: seed.appliedAt,
    provenance: seed.provenance,
  };
}

function seedProposal(store: ProposalStore, seed: ProposalSeed): Promise<void> {
  return store.save(makeProposal(seed));
}

function makeEffectivenessReport(id: string): ProposalEffectivenessReport {
  return {
    proposalId: id,
    assessedAt: "2026-06-19T00:00:00.000Z",
    appliedAt: "2026-06-12T00:00:00.000Z",
    windowDays: 7,
    metricsBefore: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 5,
      reviewApprovalRate: 1,
    },
    metricsAfter: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 2,
      reviewApprovalRate: 1,
    },
    primary: {
      metric: "unresolvedCapabilities",
      direction: "lower_is_better",
      before: 5,
      after: 2,
      absoluteDelta: -3,
      relativeDelta: -0.6,
    },
    dataSufficient: true,
    recommendation: "keep",
    reason: "improved",
  };
}

describe("ProposalLifecycleAnalyzer", () => {
  let proposalDir: string;
  let effectivenessDir: string;
  let evidenceDir: string;
  let proposalStore: ProposalStore;
  let effectivenessStore: EffectivenessStore;
  let evidenceStore: EvidenceStore;
  let analyzer: ProposalLifecycleAnalyzer;

  beforeEach(() => {
    proposalDir = mkdtempSync(join(tmpdir(), "prop-"));
    effectivenessDir = mkdtempSync(join(tmpdir(), "eff-"));
    evidenceDir = mkdtempSync(join(tmpdir(), "ev-"));
    proposalStore = new ProposalStore(proposalDir);
    effectivenessStore = new EffectivenessStore(effectivenessDir);
    evidenceStore = new EvidenceStore({ storeDir: evidenceDir });
    analyzer = new ProposalLifecycleAnalyzer(
      proposalStore,
      effectivenessStore,
      evidenceStore,
    );
  });

  afterEach(() => {
    rmSync(proposalDir, { recursive: true, force: true });
    rmSync(effectivenessDir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // (a) Basic applied proposal — no effectiveness, no revert
  // -----------------------------------------------------------------------
  it("loads and enriches a basic applied proposal (no effectiveness, no revert)", async () => {
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-001",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      approvedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T02:00:00.000Z",
    });

    const results = await analyzer.analyze();
    expect(results.length).toBe(1);

    const e = results[0];
    expect(e.proposal.id).toBe("prop-2026-06-19-001");
    expect(e.effectivenessReport).toBeNull();
    expect(e.wasReverted).toBe(false);
    expect(e.revertProposalId).toBeNull();
    expect(e.outcome).toBe("applied");
    expect(e.timeToApprovalHours).toBe(1); // 1 hour from createdAt to approvedAt
    expect(e.timeToApplyHours).toBe(1); // 1 hour from approvedAt to appliedAt
  });

  // -----------------------------------------------------------------------
  // (b) Proposal with an effectiveness report
  // -----------------------------------------------------------------------
  it("loads and enriches a proposal with an effectiveness report", async () => {
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-002",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "add_capability",
      target: { kind: "capability", capability: "test", agentId: "a1" },
      approvedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T02:00:00.000Z",
    });
    await effectivenessStore.save(makeEffectivenessReport("prop-2026-06-19-002"));

    const results = await analyzer.analyze();
    expect(results.length).toBe(1);

    const e = results[0];
    expect(e.effectivenessReport).not.toBeNull();
    expect(e.effectivenessReport!.proposalId).toBe("prop-2026-06-19-002");
    expect(e.effectivenessReport!.recommendation).toBe("keep");
  });

  // -----------------------------------------------------------------------
  // (c) Reverted proposal (revert_proposal exists and is applied)
  // -----------------------------------------------------------------------
  it("loads and enriches a reverted proposal", async () => {
    // Original proposal
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-003",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      approvedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T02:00:00.000Z",
    });

    // Revert proposal targeting the original (applied)
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-004",
      createdAt: "2026-06-19T03:00:00.000Z",
      status: "applied",
      action: "revert_proposal",
      target: { kind: "revert", sourceProposalId: "prop-2026-06-19-003" },
    });

    const results = await analyzer.analyze();
    expect(results.length).toBe(2);

    const original = results.find((e) => e.proposal.id === "prop-2026-06-19-003")!;
    expect(original.wasReverted).toBe(true);
    expect(original.revertProposalId).toBe("prop-2026-06-19-004");
    expect(original.outcome).toBe("reverted");

    const revert = results.find((e) => e.proposal.id === "prop-2026-06-19-004")!;
    expect(revert.wasReverted).toBe(false);
    expect(revert.outcome).toBe("applied");
  });

  // -----------------------------------------------------------------------
  // (d) Revert proposal exists but is NOT applied (still pending)
  // -----------------------------------------------------------------------
  it("does not mark proposal as reverted when revert proposal is not applied", async () => {
    // Original proposal
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-005",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      approvedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T02:00:00.000Z",
    });

    // Revert proposal targeting the original (NOT applied — still pending)
    await seedProposal(proposalStore, {
      id: "prop-2026-06-19-006",
      createdAt: "2026-06-19T03:00:00.000Z",
      status: "pending",
      action: "revert_proposal",
      target: { kind: "revert", sourceProposalId: "prop-2026-06-19-005" },
    });

    const results = await analyzer.analyze();
    const original = results.find((e) => e.proposal.id === "prop-2026-06-19-005")!;
    expect(original.wasReverted).toBe(false);
    expect(original.revertProposalId).toBeNull();
    expect(original.outcome).toBe("applied");
  });

  // -----------------------------------------------------------------------
  // (e) Filtering by since
  // -----------------------------------------------------------------------
  it("filters by since returning only proposals on or after that date", async () => {
    await seedProposal(proposalStore, {
      id: "prop-early",
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "early" },
    });
    await seedProposal(proposalStore, {
      id: "prop-mid",
      createdAt: "2026-06-15T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "mid" },
    });
    await seedProposal(proposalStore, {
      id: "prop-late",
      createdAt: "2026-06-25T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "late" },
    });

    const opts: IntelligenceOptions = { since: "2026-06-15T00:00:00.000Z" };
    const results = await analyzer.analyze(opts);
    expect(results.length).toBe(2);
    const ids = results.map((e) => e.proposal.id).sort();
    expect(ids).toEqual(["prop-late", "prop-mid"]);
  });

  // -----------------------------------------------------------------------
  // (f) Filtering by until
  // -----------------------------------------------------------------------
  it("filters by until returning only proposals on or before that date", async () => {
    await seedProposal(proposalStore, {
      id: "prop-early",
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "early" },
    });
    await seedProposal(proposalStore, {
      id: "prop-mid",
      createdAt: "2026-06-15T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "mid" },
    });
    await seedProposal(proposalStore, {
      id: "prop-late",
      createdAt: "2026-06-25T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "late" },
    });

    const opts: IntelligenceOptions = { until: "2026-06-15T00:00:00.000Z" };
    const results = await analyzer.analyze(opts);
    expect(results.length).toBe(2);
    const ids = results.map((e) => e.proposal.id).sort();
    expect(ids).toEqual(["prop-early", "prop-mid"]);
  });

  // -----------------------------------------------------------------------
  // (g) Filtering by minConfidence
  // -----------------------------------------------------------------------
  it("filters by minConfidence returning only proposals at or above threshold", async () => {
    await seedProposal(proposalStore, {
      id: "prop-low",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "low" },
      sourceConfidence: 0.5,
    });
    await seedProposal(proposalStore, {
      id: "prop-mid",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "mid" },
      sourceConfidence: 0.7,
    });
    await seedProposal(proposalStore, {
      id: "prop-high",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "high" },
      sourceConfidence: 0.9,
    });

    const opts: IntelligenceOptions = { minConfidence: 0.7 };
    const results = await analyzer.analyze(opts);
    expect(results.length).toBe(2);
    const ids = results.map((e) => e.proposal.id).sort();
    expect(ids).toEqual(["prop-high", "prop-mid"]);
  });

  // -----------------------------------------------------------------------
  // (h) Empty store returns empty array
  // -----------------------------------------------------------------------
  it("returns empty array for an empty store", async () => {
    const results = await analyzer.analyze();
    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // (i) Time metrics computed correctly
  // -----------------------------------------------------------------------
  it("computes time metrics correctly for a proposal with known timestamps", async () => {
    // 1 hour from createdAt to approvedAt, 2 hours from approvedAt to appliedAt
    await seedProposal(proposalStore, {
      id: "prop-metrics",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      approvedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T03:00:00.000Z",
    });

    const results = await analyzer.analyze();
    expect(results.length).toBe(1);
    const e = results[0];
    expect(e.timeToApprovalHours).toBe(1); // 1h
    expect(e.timeToApplyHours).toBe(2); // 2h
  });

  // -----------------------------------------------------------------------
  // (j) Null time metrics when timestamps are missing
  // -----------------------------------------------------------------------
  it("returns null time metrics when timestamps are missing", async () => {
    await seedProposal(proposalStore, {
      id: "prop-pending",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
    });

    const results = await analyzer.analyze();
    expect(results.length).toBe(1);
    const e = results[0];
    expect(e.timeToApprovalHours).toBeNull();
    expect(e.timeToApplyHours).toBeNull();
    expect(e.outcome).toBe("pending");
  });

  // -----------------------------------------------------------------------
  // (k) All filters combined
  // -----------------------------------------------------------------------
  it("combines since, until, and minConfidence filters", async () => {
    await seedProposal(proposalStore, {
      id: "prop-a",
      createdAt: "2026-06-01T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "a" },
      sourceConfidence: 0.5,
    });
    await seedProposal(proposalStore, {
      id: "prop-b",
      createdAt: "2026-06-10T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "b" },
      sourceConfidence: 0.9,
    });
    await seedProposal(proposalStore, {
      id: "prop-c",
      createdAt: "2026-06-20T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "c" },
      sourceConfidence: 0.8,
    });
    await seedProposal(proposalStore, {
      id: "prop-d",
      createdAt: "2026-06-25T00:00:00.000Z",
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "d" },
      sourceConfidence: 0.7,
    });

    const opts: IntelligenceOptions = {
      since: "2026-06-10T00:00:00.000Z",
      until: "2026-06-20T00:00:00.000Z",
      minConfidence: 0.8,
    };
    const results = await analyzer.analyze(opts);
    expect(results.length).toBe(2);
    const ids = results.map((e) => e.proposal.id).sort();
    expect(ids).toEqual(["prop-b", "prop-c"]);
  });

  // -----------------------------------------------------------------------
  // (l) Reverted outcome overrides applied status
  // -----------------------------------------------------------------------
  it("reverted outcome overrides the original proposal status", async () => {
    // Even a failed proposal can be reverted
    await seedProposal(proposalStore, {
      id: "prop-failed-reverted",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "failed",
      action: "add_capability",
      target: { kind: "capability", capability: "test" },
    });

    await seedProposal(proposalStore, {
      id: "prop-rev",
      createdAt: "2026-06-19T01:00:00.000Z",
      status: "applied",
      action: "revert_proposal",
      target: { kind: "revert", sourceProposalId: "prop-failed-reverted" },
    });

    const results = await analyzer.analyze();
    const original = results.find((e) => e.proposal.id === "prop-failed-reverted")!;
    expect(original.outcome).toBe("reverted");
    expect(original.wasReverted).toBe(true);
  });

  // -----------------------------------------------------------------------
  // (m) Approved-only proposal (no appliedAt)
  // -----------------------------------------------------------------------
  it("handles approved-only proposal with timeToApproval but null timeToApply", async () => {
    await seedProposal(proposalStore, {
      id: "prop-approved",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "approved",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      approvedAt: "2026-06-19T02:00:00.000Z",
    });

    const results = await analyzer.analyze();
    expect(results.length).toBe(1);
    const e = results[0];
    expect(e.outcome).toBe("approved");
    expect(e.timeToApprovalHours).toBe(2);
    expect(e.timeToApplyHours).toBeNull();
  });
});
