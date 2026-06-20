/**
 * P5.3.7 — BucketAggregator tests
 *
 * Verifies grouping across all six dimensions, empty/single/multi-proposal
 * scenarios, capability extraction, provenance normalization, outcome grouping,
 * and alphabetical bucket sorting.
 */

import { describe, it, expect } from "vitest";
import { BucketAggregator } from "../../src/adaptation/bucket-aggregator.js";
import { EffectivenessTrendAnalyzer } from "../../src/adaptation/effectiveness-trend-analyzer.js";
import type {
  AdaptationProposal,
  ProposalStatus,
  ProposalAction,
  ProposalTarget,
} from "../../src/adaptation/adaptation-types.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let proposalCounter = 0;

interface MakeEPOpts {
  action?: string;
  targetKind?: string;
  targetCapability?: string;
  payloadCapability?: string;
  sourceRecommendationType?: string;
  provenance?: "auto" | "manual";
  outcome?: "applied" | "rejected" | "failed" | "reverted" | "pending" | "approved";
  status?: "applied" | "rejected" | "failed" | "pending" | "approved";
  wasReverted?: boolean;
  recommendation?: "keep" | "revert" | "investigate";
  hasEffectivenessReport?: boolean;
  sourceConfidence?: number;
  timeToApprovalHours?: number | null;
}

function makeEP(opts: MakeEPOpts = {}): EnrichedProposal {
  const id = `prop-2026-06-19-${String(++proposalCounter).padStart(3, "0")}`;
  const action = (opts.action ?? "update_agent_card") as ProposalAction;
  const targetKind = opts.targetKind ?? "agent_card";
  const outcome = opts.outcome ?? "applied";
  const status = opts.status ?? "applied";
  const wasReverted = opts.wasReverted ?? (outcome === "reverted");

  let target: ProposalTarget;
  switch (targetKind) {
    case "agent_card":
      target = { kind: "agent_card", id: "test.agent" };
      break;
    case "skill":
      target = { kind: "skill", id: "test.skill" };
      break;
    case "capability":
      target = {
        kind: "capability",
        capability: opts.targetCapability ?? "test_capability",
      };
      break;
    case "issue":
      target = { kind: "issue", title: "Test issue" };
      break;
    case "routing_weight":
      target = { kind: "routing_weight", capability: opts.targetCapability ?? "route_cap" };
      break;
    case "revert":
      target = { kind: "revert", sourceProposalId: "prop-other" };
      break;
    default:
      target = { kind: "agent_card", id: "test.agent" };
  }

  const payload: Record<string, unknown> = {};
  if (opts.payloadCapability !== undefined) {
    payload.capability = opts.payloadCapability;
  }

  const proposal: AdaptationProposal = {
    id,
    createdAt: "2026-06-19T00:00:00.000Z",
    status: status as ProposalStatus,
    action,
    target,
    payload,
    sourceRecommendationType: opts.sourceRecommendationType ?? "agent_card_update",
    sourceConfidence: opts.sourceConfidence ?? 0.85,
    evidenceFingerprints: [],
    reason: "Test proposal",
    provenance: opts.provenance,
  };

  let effectivenessReport: EnrichedProposal["effectivenessReport"] = null;
  if (opts.hasEffectivenessReport !== false) {
    effectivenessReport = {
      proposalId: id,
      assessedAt: "2026-06-19T01:00:00.000Z",
      appliedAt: "2026-06-19T00:30:00.000Z",
      windowDays: 7,
      metricsBefore: {
        workflowsCompleted: 10,
        workflowsAborted: 0,
        workflowsBlocked: 0,
        unresolvedCapabilities: 5,
        capabilitiesRequested: 0,
        reviewApprovalRate: 0,
      },
      metricsAfter: {
        workflowsCompleted: 12,
        workflowsAborted: 0,
        workflowsBlocked: 0,
        unresolvedCapabilities: 3,
        capabilitiesRequested: 0,
        reviewApprovalRate: 0,
      },
      primary: {
        metric: "unresolvedCapabilities",
        direction: "lower_is_better",
        before: 5,
        after: 3,
        absoluteDelta: -2,
        relativeDelta: -0.4,
      },
      dataSufficient: true,
      recommendation: opts.recommendation ?? "keep",
      reason: "Test effectiveness reason",
    };
  }

  return {
    proposal,
    effectivenessReport,
    wasReverted,
    revertProposalId: wasReverted ? "prop-revert-001" : null,
    outcome,
    timeToApprovalHours: opts.timeToApprovalHours ?? 2.0,
    timeToApplyHours: 1.0,
  };
}

function createAnalyzer(): EffectivenessTrendAnalyzer {
  return new EffectivenessTrendAnalyzer();
}

function createAggregator(): BucketAggregator {
  return new BucketAggregator(createAnalyzer());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BucketAggregator", () => {
  // (a) Basic grouping: 5 proposals with various actions
  it("groups byAction correctly with multiple actions", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ action: "update_agent_card" }),
      makeEP({ action: "update_agent_card" }),
      makeEP({ action: "add_capability" }),
      makeEP({ action: "create_agent_card" }),
      makeEP({ action: "adjust_skill_definition" }),
    ];

    const result = agg.aggregate(proposals);

    expect(result.byAction.dimension).toBe("byAction");
    expect(result.byAction.buckets).toHaveLength(4);
    expect(result.byAction.totalInDimension).toBe(5);

    // Find specific buckets
    const updateBucket = result.byAction.buckets.find(
      (b) => b.value === "update_agent_card",
    );
    expect(updateBucket).toBeDefined();
    expect(updateBucket!.totalProposals).toBe(2);

    const addCapBucket = result.byAction.buckets.find(
      (b) => b.value === "add_capability",
    );
    expect(addCapBucket).toBeDefined();
    expect(addCapBucket!.totalProposals).toBe(1);
  });

  // (b) Empty proposals list
  it("returns empty buckets for all dimensions when proposals is empty", () => {
    const agg = createAggregator();
    const result = agg.aggregate([]);

    const dimensions = [
      result.byAction,
      result.byTargetKind,
      result.bySourceRecommendationType,
      result.byProvenance,
      result.byCapability,
      result.byOutcome,
    ];

    for (const dim of dimensions) {
      expect(dim.buckets).toEqual([]);
      expect(dim.totalInDimension).toBe(0);
      expect(dim.insufficientDataCount).toBe(0);
    }
  });

  // (c) Single proposal
  it("produces one bucket per dimension for a single proposal", () => {
    const agg = createAggregator();
    const proposals = [makeEP()];

    const result = agg.aggregate(proposals);

    expect(result.byAction.buckets).toHaveLength(1);
    expect(result.byAction.buckets[0].value).toBe("update_agent_card");
    expect(result.byAction.buckets[0].totalProposals).toBe(1);
    expect(result.byAction.buckets[0].insufficientData).toBe(true);

    expect(result.byTargetKind.buckets).toHaveLength(1);
    expect(result.byTargetKind.buckets[0].value).toBe("agent_card");

    expect(result.byOutcome.buckets).toHaveLength(1);
    expect(result.byOutcome.buckets[0].value).toBe("applied");
  });

  // (d) Multiple proposals in the same bucket
  it("correctly aggregates multiple proposals in the same bucket", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ action: "update_agent_card", sourceRecommendationType: "agent_card_update" }),
      makeEP({ action: "update_agent_card", sourceRecommendationType: "agent_card_update" }),
      makeEP({ action: "update_agent_card", sourceRecommendationType: "agent_card_update" }),
      makeEP({ action: "update_agent_card", sourceRecommendationType: "agent_card_update" }),
      makeEP({ action: "update_agent_card", sourceRecommendationType: "agent_card_update" }),
    ];

    const result = agg.aggregate(proposals);

    expect(result.byAction.buckets).toHaveLength(1);
    expect(result.byAction.buckets[0].totalProposals).toBe(5);
    expect(result.byAction.totalInDimension).toBe(5);

    expect(result.bySourceRecommendationType.buckets).toHaveLength(1);
    expect(result.bySourceRecommendationType.buckets[0].value).toBe(
      "agent_card_update",
    );
  });

  // (e) Capability extraction
  it("extracts capability from payload, target, and defaults to (none)", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ payloadCapability: "payload_cap", targetKind: "agent_card" }),
      makeEP({
        targetKind: "capability",
        targetCapability: "target_cap",
      }),
      makeEP({ targetKind: "agent_card" }), // neither → (none)
    ];

    const result = agg.aggregate(proposals);

    expect(result.byCapability.buckets).toHaveLength(3);

    const payloadBucket = result.byCapability.buckets.find(
      (b) => b.value === "payload_cap",
    );
    expect(payloadBucket).toBeDefined();

    const targetBucket = result.byCapability.buckets.find(
      (b) => b.value === "target_cap",
    );
    expect(targetBucket).toBeDefined();

    const noneBucket = result.byCapability.buckets.find(
      (b) => b.value === "(none)",
    );
    expect(noneBucket).toBeDefined();
  });

  // (f) Provenance normalization
  it("normalizes undefined provenance to manual", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ provenance: "auto" }),
      makeEP({ provenance: "manual" }),
      makeEP(), // undefined provenance → "manual"
      makeEP(), // undefined provenance → "manual"
    ];

    const result = agg.aggregate(proposals);

    expect(result.byProvenance.buckets).toHaveLength(2);

    const autoBucket = result.byProvenance.buckets.find(
      (b) => b.value === "auto",
    );
    expect(autoBucket).toBeDefined();
    expect(autoBucket!.totalProposals).toBe(1);

    const manualBucket = result.byProvenance.buckets.find(
      (b) => b.value === "manual",
    );
    expect(manualBucket).toBeDefined();
    expect(manualBucket!.totalProposals).toBe(3);
  });

  // (g) Outcome grouping includes "reverted"
  it("groups by outcome and includes reverted when wasReverted is true", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ outcome: "applied", wasReverted: false }),
      makeEP({ outcome: "reverted", wasReverted: true }),
      makeEP({ outcome: "rejected", status: "rejected" }),
      makeEP({ outcome: "failed", status: "failed" }),
      makeEP({ outcome: "pending", status: "pending" }),
      makeEP({ outcome: "approved", status: "approved" }),
    ];

    const result = agg.aggregate(proposals);

    expect(result.byOutcome.buckets).toHaveLength(6);
    expect(result.byOutcome.totalInDimension).toBe(6);

    const revertedBucket = result.byOutcome.buckets.find(
      (b) => b.value === "reverted",
    );
    expect(revertedBucket).toBeDefined();
    expect(revertedBucket!.totalProposals).toBe(1);

    const appliedBucket = result.byOutcome.buckets.find(
      (b) => b.value === "applied",
    );
    expect(appliedBucket).toBeDefined();
    expect(appliedBucket!.totalProposals).toBe(1);
  });

  // (h) All 6 dimensions returned with correct names
  it("returns all 6 dimensions with correct dimension names", () => {
    const agg = createAggregator();
    const proposals = [makeEP()];

    const result = agg.aggregate(proposals);

    expect(result.byAction.dimension).toBe("byAction");
    expect(result.byTargetKind.dimension).toBe("byTargetKind");
    expect(result.bySourceRecommendationType.dimension).toBe(
      "bySourceRecommendationType",
    );
    expect(result.byProvenance.dimension).toBe("byProvenance");
    expect(result.byCapability.dimension).toBe("byCapability");
    expect(result.byOutcome.dimension).toBe("byOutcome");

    // All should have totalInDimension of 1 (single proposal)
    expect(result.byAction.totalInDimension).toBe(1);
    expect(result.byTargetKind.totalInDimension).toBe(1);
    expect(result.bySourceRecommendationType.totalInDimension).toBe(1);
    expect(result.byProvenance.totalInDimension).toBe(1);
    expect(result.byCapability.totalInDimension).toBe(1);
    expect(result.byOutcome.totalInDimension).toBe(1);
  });

  // (i) Buckets sorted alphabetically by value
  it("sorts buckets alphabetically by value", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ action: "create_improvement_issue" }),
      makeEP({ action: "add_capability" }),
      makeEP({ action: "update_agent_card" }),
      makeEP({ action: "suggest_routing_weight" }),
      makeEP({ action: "adjust_skill_definition" }),
    ];

    const result = agg.aggregate(proposals);

    const values = result.byAction.buckets.map((b) => b.value);
    expect(values).toEqual([
      "add_capability",
      "adjust_skill_definition",
      "create_improvement_issue",
      "suggest_routing_weight",
      "update_agent_card",
    ]);
  });

  // Additional: insufficientDataCount correctness
  it("correctly counts insufficientData buckets", () => {
    const agg = createAggregator();
    // With default minBucketSize of 5, any dimension with <5 proposals per bucket
    // will have insufficientData = true on that bucket
    const proposals = [
      makeEP({ action: "update_agent_card" }),
      makeEP({ action: "add_capability" }),
    ];

    const result = agg.aggregate(proposals, { minBucketSize: 5 });

    // Two different actions, each with 1 proposal → both insufficient
    expect(result.byAction.insufficientDataCount).toBe(2);
  });

  // Additional: metrics populated when sufficient data
  it("populates metrics when bucket has sufficient data", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
    ];

    // minBucketSize=3, 5 proposals → sufficient
    const result = agg.aggregate(proposals, { minBucketSize: 3 });

    const bucket = result.byAction.buckets[0];
    expect(bucket.insufficientData).toBe(false);
    expect(bucket.keepCount).toBe(5);
    expect(bucket.keepRate).toBe(1.0);
  });

  // Additional: mixed recommendations
  it("handles mixed effectiveness recommendations", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
      makeEP({ action: "update_agent_card", recommendation: "revert" }),
      makeEP({ action: "update_agent_card", recommendation: "investigate" }),
      makeEP({ action: "update_agent_card", recommendation: "keep" }),
    ];

    const result = agg.aggregate(proposals, { minBucketSize: 3 });

    const bucket = result.byAction.buckets[0];
    expect(bucket.insufficientData).toBe(false);
    expect(bucket.keepCount).toBe(3);
    expect(bucket.keepRate).toBe(0.6);
    expect(bucket.advisoryRevertCount).toBe(1);
    expect(bucket.investigateCount).toBe(1);
  });

  // Additional: byTargetKind dimension
  it("groups by targetKind correctly", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ targetKind: "agent_card" }),
      makeEP({ targetKind: "skill" }),
      makeEP({ targetKind: "capability", targetCapability: "c1" }),
      makeEP({ targetKind: "agent_card" }),
    ];

    const result = agg.aggregate(proposals);

    expect(result.byTargetKind.buckets).toHaveLength(3);

    const agentCardBucket = result.byTargetKind.buckets.find(
      (b) => b.value === "agent_card",
    );
    expect(agentCardBucket).toBeDefined();
    expect(agentCardBucket!.totalProposals).toBe(2);

    const skillBucket = result.byTargetKind.buckets.find(
      (b) => b.value === "skill",
    );
    expect(skillBucket).toBeDefined();
    expect(skillBucket!.totalProposals).toBe(1);
  });

  // Additional: bySourceRecommendationType
  it("groups by sourceRecommendationType correctly", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ sourceRecommendationType: "agent_card_update" }),
      makeEP({ sourceRecommendationType: "capability_gap" }),
      makeEP({ sourceRecommendationType: "agent_card_update" }),
    ];

    const result = agg.aggregate(proposals);

    expect(result.bySourceRecommendationType.buckets).toHaveLength(2);

    const acuBucket = result.bySourceRecommendationType.buckets.find(
      (b) => b.value === "agent_card_update",
    );
    expect(acuBucket).toBeDefined();
    expect(acuBucket!.totalProposals).toBe(2);
  });

  // Additional: notAssessed proposals
  it("counts proposals without effectiveness reports", () => {
    const agg = createAggregator();
    const proposals = [
      makeEP({ recommendation: "keep" }),
      makeEP({ recommendation: "keep" }),
      makeEP({ hasEffectivenessReport: false }),
      makeEP({ hasEffectivenessReport: false }),
      makeEP({ recommendation: "keep" }),
    ];

    const result = agg.aggregate(proposals, { minBucketSize: 3 });

    const bucket = result.byAction.buckets[0];
    expect(bucket.notAssessedCount).toBe(2);
    expect(bucket.notAssessedRate).toBe(0.4);
  });
});
