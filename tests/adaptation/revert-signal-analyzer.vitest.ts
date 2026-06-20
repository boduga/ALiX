/**
 * P5.3.5 — RevertSignalAnalyzer tests.
 *
 * Validates cross-proposal revert signal analysis across seven scenarios:
 * mixed signals, empty, no effectiveness reports, perfect alignment,
 * humans overruled, bucket grouping, and negative flooring.
 */

import { describe, it, expect } from "vitest";
import { RevertSignalAnalyzer } from "../../src/adaptation/revert-signal-analyzer.js";
import type { EnrichedProposal, BucketSet } from "../../src/adaptation/intelligence-types.js";
import type { PrimaryMetricKey, MetricDirection } from "../../src/adaptation/effectiveness-types.js";
import type { ProposalAction } from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(prefix = "prop"): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Build a minimal EnrichedProposal.  Every dimension value is unique by
 * default so proposals do NOT accidentally share buckets across dimensions
 * unless the test deliberately groups them.
 */
function makeProposal(overrides: Partial<EnrichedProposal> = {}): EnrichedProposal {
  const id = nextId("prop");
  return {
    proposal: {
      id,
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: `test_action_${id}` as unknown as "add_capability" as ProposalAction,
      target: { kind: `test_kind_${id}` as unknown as "capability" as "agent_card", id: `test-${id}` },
      payload: {},
      sourceRecommendationType: `test_src_${id}`,
      sourceConfidence: 0.85,
      evidenceFingerprints: [],
      reason: "Test proposal",
      // provenance omitted — undefined ⇒ extractor maps to "manual"
    },
    effectivenessReport: null,
    wasReverted: false,
    revertProposalId: null,
    outcome: `test_outcome_${id}` as EnrichedProposal["outcome"],
    timeToApprovalHours: 1.0,
    timeToApplyHours: 2.0,
    ...overrides,
  };
}

/**
 * Create a proposal that shares specific dimension values so proposals
 * land in the same buckets.  Useful for testing per-bucket aggregation.
 */
function makeSharedProposal(
  action: string,
  targetKind: string,
  targetId: string,
  sourceRec: string,
  overrides: Partial<EnrichedProposal> = {},
): EnrichedProposal {
  const id = nextId("prop-s");
  return {
    proposal: {
      id,
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "applied",
      action: action as ProposalAction,
      target: { kind: targetKind as any, id: targetId },
      payload: {},
      sourceRecommendationType: sourceRec,
      sourceConfidence: 0.85,
      evidenceFingerprints: [],
      reason: "Test proposal",
      // provenance omitted — undefined ⇒ extractor maps to "manual"
    },
    effectivenessReport: null,
    wasReverted: false,
    revertProposalId: null,
    outcome: "applied",
    timeToApprovalHours: 1.0,
    timeToApplyHours: 2.0,
    ...overrides,
  };
}

function makeEffectivenessReport(
  proposalId: string,
  recommendation: "keep" | "revert" | "investigate" = "keep",
) {
  return {
    proposalId,
    assessedAt: "2026-06-19T00:00:00.000Z",
    appliedAt: "2026-06-18T00:00:00.000Z",
    windowDays: 1,
    metricsBefore: {
      workflowsCompleted: 10,
      workflowsAborted: 5,
      workflowsBlocked: 2,
      unresolvedCapabilities: 3,
      capabilitiesRequested: 10,
      reviewApprovalRate: 0.8,
    },
    metricsAfter: {
      workflowsCompleted: 5,
      workflowsAborted: 4,
      workflowsBlocked: 2,
      unresolvedCapabilities: 3,
      capabilitiesRequested: 10,
      reviewApprovalRate: 0.8,
    },
    primary: {
      metric: "workflowsAborted" as PrimaryMetricKey,
      direction: "lower_is_better" as MetricDirection,
      before: 5,
      after: 4,
      absoluteDelta: -1,
      relativeDelta: -0.2,
    },
    dataSufficient: true,
    recommendation,
    reason: "Test reason",
  };
}

function makeEmptyBucketSet(dimension: string): BucketSet {
  return { dimension, buckets: [], totalInDimension: 0, insufficientDataCount: 0 };
}

function makeEmptyBucketSets() {
  return {
    byAction: makeEmptyBucketSet("byAction"),
    byTargetKind: makeEmptyBucketSet("byTargetKind"),
    bySourceRecommendationType: makeEmptyBucketSet("bySourceRecommendationType"),
    byProvenance: makeEmptyBucketSet("byProvenance"),
    byCapability: makeEmptyBucketSet("byCapability"),
    byOutcome: makeEmptyBucketSet("byOutcome"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RevertSignalAnalyzer", () => {
  const analyzer = new RevertSignalAnalyzer();

  describe("(a) mixed signals — 10 proposals with various revert states", () => {
    it("computes correct revert counts and precision", () => {
      const proposals: EnrichedProposal[] = [
        // 3 advisory reverts that were actually reverted
        makeSharedProposal("update_agent_card", "agent_card", "a1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s1", "revert"),
          wasReverted: true,
          revertProposalId: "rev-001",
          outcome: "reverted",
        }),
        makeSharedProposal("add_capability", "capability", "c1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s2", "revert"),
          wasReverted: true,
          revertProposalId: "rev-002",
          outcome: "reverted",
        }),
        makeSharedProposal("adjust_skill_definition", "skill", "s1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s3", "revert"),
          wasReverted: true,
          revertProposalId: "rev-003",
          outcome: "reverted",
        }),
        // 2 advisory reverts NOT actually reverted (unacted)
        makeSharedProposal("update_agent_card", "agent_card", "a2", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s4", "revert"),
          wasReverted: false,
          outcome: "applied",
        }),
        makeSharedProposal("update_agent_card", "agent_card", "a3", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s5", "revert"),
          wasReverted: false,
          outcome: "applied",
        }),
        // 1 actual revert that had a "keep" recommendation → humans overruled
        makeSharedProposal("create_agent_card", "agent_card", "a4", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s6", "keep"),
          wasReverted: true,
          revertProposalId: "rev-006",
          outcome: "reverted",
        }),
        // 2 keeps that were not reverted
        makeSharedProposal("update_agent_card", "agent_card", "a5", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s7", "keep"),
          wasReverted: false,
          outcome: "applied",
        }),
        makeSharedProposal("add_capability", "capability", "c2", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s8", "keep"),
          wasReverted: false,
          outcome: "applied",
        }),
        // 1 investigate, not reverted
        makeSharedProposal("suggest_routing_weight", "routing_weight", "w1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s9", "investigate"),
          wasReverted: false,
          outcome: "applied",
        }),
        // 1 no effectiveness report, not reverted
        makeSharedProposal("create_improvement_issue", "issue", "i1", "agent_card_update", {
          effectivenessReport: null,
          wasReverted: false,
          outcome: "applied",
        }),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(5); // 3 acted + 2 unacted
      expect(result.totalActualReverts).toBe(4);   // 3 advisory + 1 overruled
      // 5 advisory - 4 actual = 1 (formula: max(0, advisory - actual))
      expect(result.totalUnactedReverts).toBe(1);
      // Precision: of 4 actual reverts, 3 had advisory "revert" → 3/4 = 0.75
      expect(result.revertPrecision).toBeCloseTo(0.75, 4);
      expect(result.humansOverruledCount).toBe(1);  // prop-s6
    });
  });

  describe("(b) empty proposals", () => {
    it("returns zeroes, null precision, empty arrays", () => {
      const result = analyzer.analyze([], makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(0);
      expect(result.totalActualReverts).toBe(0);
      expect(result.totalUnactedReverts).toBe(0);
      expect(result.revertPrecision).toBeNull();
      expect(result.topUnactedRevertBuckets).toEqual([]);
      expect(result.humansOverruledCount).toBe(0);
    });
  });

  describe("(c) no effectiveness reports", () => {
    it("advisory=0, unacted=0, precision=0", () => {
      const proposals: EnrichedProposal[] = [
        makeProposal({
          effectivenessReport: null,
          wasReverted: true,
          revertProposalId: "rev-a",
          outcome: "reverted",
        }),
        makeProposal({
          effectivenessReport: null,
          wasReverted: false,
          outcome: "applied",
        }),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(0); // no reports → no advisory reverts
      expect(result.totalActualReverts).toBe(1);   // 1 was reverted
      expect(result.totalUnactedReverts).toBe(0);
      // 0 actual reverts where advisory said revert / 1 actual = 0
      expect(result.revertPrecision).toBe(0);
      expect(result.humansOverruledCount).toBe(0);
    });
  });

  describe("(d) perfect alignment", () => {
    it("unacted=0, precision=1.0", () => {
      const proposals: EnrichedProposal[] = [
        makeSharedProposal("update_agent_card", "agent_card", "a1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s1", "revert"),
          wasReverted: true,
          revertProposalId: "rev-1",
          outcome: "reverted",
        }),
        makeSharedProposal("add_capability", "capability", "c1", "capability_gap", {
          effectivenessReport: makeEffectivenessReport("prop-s2", "revert"),
          wasReverted: true,
          revertProposalId: "rev-2",
          outcome: "reverted",
        }),
        makeSharedProposal("adjust_skill_definition", "skill", "s1", "skill_revision", {
          effectivenessReport: makeEffectivenessReport("prop-s3", "revert"),
          wasReverted: true,
          revertProposalId: "rev-3",
          outcome: "reverted",
        }),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(3);
      expect(result.totalActualReverts).toBe(3);
      expect(result.totalUnactedReverts).toBe(0);   // 3 advisory - 3 actual
      expect(result.revertPrecision).toBe(1.0);      // all actual reverts had advisory revert
      expect(result.humansOverruledCount).toBe(0);
    });
  });

  describe("(e) humans overruled", () => {
    it("detects when effectiveness=keep but wasReverted=true", () => {
      const proposals: EnrichedProposal[] = [
        makeSharedProposal("update_agent_card", "agent_card", "a1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s1", "keep"),
          wasReverted: true,
          revertProposalId: "rev-1",
          outcome: "reverted",
        }),
        makeSharedProposal("add_capability", "capability", "c1", "capability_gap", {
          effectivenessReport: makeEffectivenessReport("prop-s2", "keep"),
          wasReverted: true,
          revertProposalId: "rev-2",
          outcome: "reverted",
        }),
        makeSharedProposal("adjust_skill_definition", "skill", "s1", "skill_revision", {
          effectivenessReport: makeEffectivenessReport("prop-s3", "keep"),
          wasReverted: false,
          outcome: "applied",
        }),
        makeSharedProposal("create_agent_card", "agent_card", "a2", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s4", "revert"),
          wasReverted: true,
          revertProposalId: "rev-4",
          outcome: "reverted",
        }),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(1);   // prop-s4
      expect(result.totalActualReverts).toBe(3);      // prop-s1, prop-s2, prop-s4
      expect(result.totalUnactedReverts).toBe(0);     // max(0, 1-3) = 0
      expect(result.revertPrecision).toBeCloseTo(1 / 3, 4);
      expect(result.humansOverruledCount).toBe(2);     // prop-s1 and prop-s2
    });
  });

  describe("(f) bucket grouping — topUnactedRevertBuckets", () => {
    it("identifies buckets with the most unacted reverts across dimensions", () => {
      // Build proposals by hand so every dimension value is exactly what
      // we intend.  5 share action=update_agent_card; 3 share both
      // action=add_capability AND target=shared_target.
      // All other dimension values are unique to avoid cross-aggregation.
      const proposals = [
        ...Array.from({ length: 5 }, (_, i) => ({
          proposal: {
            id: `prop-a${i}`,
            createdAt: "2026-06-19T00:00:00.000Z",
            status: "applied" as const,
            action: "update_agent_card" as const,
            target: { kind: `tk_a_${i}` as any, id: `ida${i}` },
            payload: {},
            sourceRecommendationType: `src_a_${i}`,
            sourceConfidence: 0.85,
            evidenceFingerprints: [],
            reason: "Test",
            provenance: `prov_a_${i}` as "auto" | "manual",
          },
          effectivenessReport: makeEffectivenessReport(`prop-a${i}`, "revert"),
          wasReverted: false,
          revertProposalId: null,
          outcome: `oc_a_${i}` as EnrichedProposal["outcome"],
          timeToApprovalHours: 1.0,
          timeToApplyHours: 2.0,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          proposal: {
            id: `prop-b${i}`,
            createdAt: "2026-06-19T00:00:00.000Z",
            status: "applied" as const,
            action: "add_capability" as const,
            target: { kind: "shared_target" as any, id: `st${i}` },
            payload: {},
            sourceRecommendationType: `src_st${i}`,
            sourceConfidence: 0.85,
            evidenceFingerprints: [],
            reason: "Test",
            provenance: `prov_st${i}` as "auto" | "manual",
          },
          effectivenessReport: makeEffectivenessReport(`prop-b${i}`, "revert"),
          wasReverted: false,
          revertProposalId: null,
          outcome: `oc_st${i}` as EnrichedProposal["outcome"],
          timeToApprovalHours: 1.0,
          timeToApplyHours: 2.0,
        })),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      // Top entry: byAction=update_agent_card with count 5
      expect(result.topUnactedRevertBuckets[0]).toEqual({
        dimension: "byAction",
        value: "update_agent_card",
        count: 5,
      });

      // byTargetKind=shared_target with count 3 should be present
      expect(result.topUnactedRevertBuckets).toContainEqual({
        dimension: "byTargetKind",
        value: "shared_target",
        count: 3,
      });

      // byAction=add_capability with count 3 should be present
      expect(result.topUnactedRevertBuckets).toContainEqual({
        dimension: "byAction",
        value: "add_capability",
        count: 3,
      });
    });
  });

  describe("(g) totalUnactedReverts floored at 0", () => {
    it("returns 0 when actual reverts exceed advisory reverts", () => {
      const proposals: EnrichedProposal[] = [
        makeSharedProposal("update_agent_card", "agent_card", "a1", "agent_card_update", {
          effectivenessReport: makeEffectivenessReport("prop-s1", "revert"),
          wasReverted: true,
          revertProposalId: "rev-1",
          outcome: "reverted",
        }),
        // Actual revert with NO advisory revert (human overruled "keep")
        makeSharedProposal("add_capability", "capability", "c1", "capability_gap", {
          effectivenessReport: makeEffectivenessReport("prop-s2", "keep"),
          wasReverted: true,
          revertProposalId: "rev-2",
          outcome: "reverted",
        }),
        makeSharedProposal("adjust_skill_definition", "skill", "s1", "skill_revision", {
          effectivenessReport: makeEffectivenessReport("prop-s3", "keep"),
          wasReverted: true,
          revertProposalId: "rev-3",
          outcome: "reverted",
        }),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      expect(result.totalAdvisoryReverts).toBe(1);
      expect(result.totalActualReverts).toBe(3);
      // 1 advisory - 3 actual = -2 → floored to 0
      expect(result.totalUnactedReverts).toBe(0);
      expect(result.revertPrecision).toBeCloseTo(1 / 3, 4);
      expect(result.humansOverruledCount).toBe(2);
    });
  });

  describe("minBucketSize filter", () => {
    it("filters out buckets below the minimum size from topUnactedRevertBuckets", () => {
      // 6 proposals in the same "update_agent_card" action, only 1 unacted.
      // Keep other dimension values identical so they don't create extra entries.
      const proposals: EnrichedProposal[] = [
        ...Array.from({ length: 5 }, () =>
          makeSharedProposal(
            "update_agent_card",
            "agent_card",
            "same",
            "agent_card_update",
            {
              effectivenessReport: makeEffectivenessReport("prop-k", "keep"),
              wasReverted: false,
              outcome: "applied",
            },
          ),
        ),
        makeSharedProposal(
          "update_agent_card",
          "agent_card",
          "same",
          "agent_card_update",
          {
            effectivenessReport: makeEffectivenessReport("prop-unacted", "revert"),
            wasReverted: false,
            outcome: "applied",
          },
        ),
        // 2 proposals with a different action — bucket total size = 2
        ...Array.from({ length: 2 }, (_, i) =>
          makeSharedProposal(
            "create_agent_card",
            "agent_card",
            "small",
            "agent_card_update",
            {
              effectivenessReport: makeEffectivenessReport(
                `prop-s${i}`,
                i === 1 ? "revert" : "keep",
              ),
              wasReverted: false,
              outcome: "applied",
            },
          ),
        ),
      ];

      // All 8 proposals share target=agent_card, source=agent_card_update, outcome=applied.
      // Entries with unacted count > 0:
      //   byTargetKind=agent_card: unacted=1 (prop-unacted) + 1 (prop-s1) = 2, total=8
      //   bySourceRecommendationType=agent_card_update: 2, total=8
      //   byOutcome=applied: 2, total=8
      //   byAction=update_agent_card: 1, total=6
      //   byAction=create_agent_card: 1, total=2
      const result = analyzer.analyze(proposals, makeEmptyBucketSets(), 5);

      // create_agent_card (total=2) is excluded by minBucketSize=5.
      // byAction=update_agent_card (total=6) survives.
      const actionEntries = result.topUnactedRevertBuckets.filter(
        (b) => b.dimension === "byAction",
      );
      expect(actionEntries).toHaveLength(1);
      expect(actionEntries[0]).toEqual({
        dimension: "byAction",
        value: "update_agent_card",
        count: 1,
      });
    });
  });

  describe("byProvenance dimension", () => {
    it("groups unacted reverts by provenance (manual vs auto)", () => {
      // Use makeSharedProposal so non-provenance dimensions are identical.
      // 2 auto + 1 manual = 3 proposals total.
      const proposals: EnrichedProposal[] = [
        makeSharedProposal(
          "update_agent_card",
          "agent_card",
          "shared",
          "agent_card_update",
          {
            proposal: {
              id: "prop-auto-1",
              createdAt: "2026-06-19T00:00:00.000Z",
              status: "applied",
              action: "update_agent_card",
              target: { kind: "agent_card", id: "shared" },
              payload: {},
              sourceRecommendationType: "agent_card_update",
              sourceConfidence: 0.85,
              evidenceFingerprints: [],
              reason: "Test",
              provenance: "auto",
            },
            effectivenessReport: makeEffectivenessReport("prop-auto-1", "revert"),
            wasReverted: false,
            outcome: "applied",
          },
        ),
        makeSharedProposal(
          "update_agent_card",
          "agent_card",
          "shared",
          "agent_card_update",
          {
            proposal: {
              id: "prop-auto-2",
              createdAt: "2026-06-19T00:00:00.000Z",
              status: "applied",
              action: "update_agent_card",
              target: { kind: "agent_card", id: "shared" },
              payload: {},
              sourceRecommendationType: "agent_card_update",
              sourceConfidence: 0.85,
              evidenceFingerprints: [],
              reason: "Test",
              provenance: "auto",
            },
            effectivenessReport: makeEffectivenessReport("prop-auto-2", "revert"),
            wasReverted: false,
            outcome: "applied",
          },
        ),
        // This one has NO provenance (undefined, treated as "manual")
        makeSharedProposal(
          "update_agent_card",
          "agent_card",
          "shared",
          "agent_card_update",
          {
            effectivenessReport: makeEffectivenessReport("prop-manual", "revert"),
            wasReverted: false,
            outcome: "applied",
          },
        ),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      // All 3 share action/target/source/outcome (3 each).
      // provenance: auto=2, manual=1.
      // Top 5 will include the shared dimensions, then auto, then manual.
      const provenanceBuckets = result.topUnactedRevertBuckets.filter(
        (b) => b.dimension === "byProvenance",
      );

      // Both auto (2) and manual (1) should be present since counts 3,3,3,3,2,1 → top 5 has auto=2, not manual=1
      // With 3 shared actions/sources/targets/outcomes (3 each) + auto(2) + manual(1):
      // top 5: action(3), target(3), source(3), outcome(3), auto(2). Manual(1) is 6th.
      // So only 1 byProvenance bucket makes the top 5.
      // We verify presence (not position) for what does make it:
      expect(provenanceBuckets.length).toBeGreaterThanOrEqual(1);
      const autoBucket = provenanceBuckets.find((b) => b.value === "auto");
      expect(autoBucket).toBeDefined();
      expect(autoBucket!.count).toBe(2);
    });

    it("treats undefined provenance as 'manual'", () => {
      // Single proposal with no provenance field at all — we need this entry
      // to appear in top 5. With 1 proposal, only 5 dimensions have entries.
      const ep: EnrichedProposal = {
        proposal: {
          id: "prop-no-prov",
          createdAt: "2026-06-19T00:00:00.000Z",
          status: "applied",
          action: "update_agent_card",
          target: { kind: "agent_card", id: "a1" },
          payload: {},
          sourceRecommendationType: "src_undef",
          sourceConfidence: 0.85,
          evidenceFingerprints: [],
          reason: "Test",
          // provenance intentionally omitted
        },
        effectivenessReport: makeEffectivenessReport("prop-no-prov", "revert"),
        wasReverted: false,
        revertProposalId: null,
        outcome: "applied",
        timeToApprovalHours: 1.0,
        timeToApplyHours: 2.0,
      };

      const result = analyzer.analyze([ep], makeEmptyBucketSets());

      // Only 5 dimensions have entries (byCapability returns null),
      // all with count 1. byProvenance=manual is one of them.
      expect(result.topUnactedRevertBuckets).toContainEqual({
        dimension: "byProvenance",
        value: "manual",
        count: 1,
      });
    });
  });

  describe("byCapability dimension", () => {
    it("groups unacted reverts by capability for capability-targeted proposals", () => {
      // 4 capability proposals sharing "code_review" + source/source/outcome.
      // That gives byCapability=code_review count 4 — three other shared dims=4.
      // Top 5 will contain code_review.
      const proposals: EnrichedProposal[] = [
        ...Array.from({ length: 4 }, (_, i) =>
          makeSharedProposal(
            "add_capability",
            "capability",
            `cr${i}`,
            "capability_gap",
            {
              proposal: {
                id: `prop-cap-${i}`,
                createdAt: "2026-06-19T00:00:00.000Z",
                status: "applied",
                action: "add_capability",
                target: { kind: "capability", capability: "code_review" },
                payload: {},
                sourceRecommendationType: "capability_gap",
                sourceConfidence: 0.85,
                evidenceFingerprints: [],
                reason: "Test",
              },
              effectivenessReport: makeEffectivenessReport(`prop-cap-${i}`, "revert"),
              wasReverted: false,
              outcome: "applied",
            },
          ),
        ),
      ];

      const result = analyzer.analyze(proposals, makeEmptyBucketSets());

      // byCapability=code_review with count 4 should be among the top entries
      expect(result.topUnactedRevertBuckets).toContainEqual({
        dimension: "byCapability",
        value: "code_review",
        count: 4,
      });
    });
  });
});
