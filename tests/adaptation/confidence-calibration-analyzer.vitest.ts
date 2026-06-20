/**
 * P5.3.6 — ConfidenceCalibrationAnalyzer tests.
 *
 * Covers all 8 behavioral requirements:
 *   (a) Uniform high confidence
 *   (b) Wide confidence spread
 *   (c) All proposals in insufficient data buckets
 *   (d) Single assessed proposal → correlation=null
 *   (e) Correlation with small dataset (<10)
 *   (f) Larger dataset → positive correlation
 *   (g) Boundary values
 *   (h) No assessed proposals
 */

import { describe, it, expect } from "vitest";
import { ConfidenceCalibrationAnalyzer } from "../../src/adaptation/confidence-calibration-analyzer.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import type { ReflectionMetrics } from "../../src/reflection/reflection-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_METRICS: ReflectionMetrics = {
  workflowsCompleted: 10,
  workflowsBlocked: 2,
  workflowsAborted: 1,
  capabilitiesRequested: 5,
  unresolvedCapabilities: 3,
  reviewApprovalRate: 0.8,
};

let proposalCounter = 0;
let reportCounter = 0;

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  const id = overrides.id ?? `prop-2026-06-19-${String(++proposalCounter).padStart(3, "0")}`;
  return {
    id,
    createdAt: overrides.createdAt ?? "2026-06-19T00:00:00Z",
    status: overrides.status ?? "applied",
    action: overrides.action ?? "update_agent_card",
    target: overrides.target ?? { kind: "agent_card", id: "test-agent" },
    payload: overrides.payload ?? {},
    sourceRecommendationType: overrides.sourceRecommendationType ?? "agent_card_update",
    sourceConfidence: overrides.sourceConfidence ?? 0.7,
    evidenceFingerprints: overrides.evidenceFingerprints ?? ["fp-1"],
    reason: overrides.reason ?? "Test proposal",
    ...overrides,
  };
}

function makeEffectivenessReport(
  proposalId: string,
  overrides: Partial<ProposalEffectivenessReport> = {},
): ProposalEffectivenessReport {
  return {
    proposalId,
    assessedAt: "2026-06-20T00:00:00Z",
    appliedAt: "2026-06-19T00:00:00Z",
    windowDays: 1,
    metricsBefore: BASE_METRICS,
    metricsAfter: BASE_METRICS,
    primary: null,
    dataSufficient: true,
    recommendation: "keep",
    reason: "Test reason",
    ...overrides,
  };
}

function makeEnriched(
  proposal: AdaptationProposal,
  effectiveness: ProposalEffectivenessReport | null,
  wasReverted = false,
): EnrichedProposal {
  return {
    proposal,
    effectivenessReport: effectiveness,
    wasReverted,
    revertProposalId: wasReverted ? "prop-revert" : null,
    outcome: wasReverted ? "reverted" : proposal.status === "failed" ? "failed" : "applied",
    timeToApprovalHours: 1.5,
    timeToApplyHours: 0.5,
  };
}

// Shorthand: build N proposals with ascending IDs, same confidence, same recommendation
function buildAssessedSet(
  count: number,
  confidence: number,
  recommendation: "keep" | "revert" | "investigate" = "keep",
  opts?: { status?: AdaptationProposal["status"]; wasReverted?: boolean },
): EnrichedProposal[] {
  const enriched: EnrichedProposal[] = [];
  for (let i = 0; i < count; i++) {
    const prop = makeProposal({
      id: `prop-c${Math.round(confidence * 100)}-${i}`,
      sourceConfidence: confidence,
      status: opts?.status ?? "applied",
    });
    const report = makeEffectivenessReport(prop.id, { recommendation });
    enriched.push(makeEnriched(prop, report, opts?.wasReverted ?? false));
  }
  return enriched;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfidenceCalibrationAnalyzer", () => {
  const analyzer = new ConfidenceCalibrationAnalyzer();

  // -----------------------------------------------------------------------
  // (a) Uniform high confidence
  // -----------------------------------------------------------------------

  it("(a) Uniform high confidence: proposals 0.9+ with most kept → bucket 0.9-1.0 shows high keep rate", () => {
    const proposals: EnrichedProposal[] = [
      ...buildAssessedSet(8, 0.95, "keep"),
      ...buildAssessedSet(2, 0.92, "keep"),
    ];

    const result = analyzer.analyze(proposals);

    // The 0.9-1.0 bucket should have all 10 proposals
    const topBucket = result.buckets[9];
    expect(topBucket.range).toBe("0.9-1.0");
    expect(topBucket.totalProposals).toBe(10);
    expect(topBucket.insufficientData).toBe(false);
    expect(topBucket.keepCount).toBe(10);
    expect(topBucket.keepRate).toBeCloseTo(1.0);
    expect(topBucket.advisoryRevertRate).toBe(0);
    expect(topBucket.actualRevertRate).toBe(0);

    // All 10 assessed
    expect(result.totalAssessed).toBe(10);

    // But correlation is null because all in one bucket
    expect(result.confidenceOutcomeCorrelation).toBeNull();
  });

  // -----------------------------------------------------------------------
  // (b) Wide confidence spread
  // -----------------------------------------------------------------------

  it("(b) Wide confidence spread: proposals at 0.6, 0.7, 0.8, 0.9 → multiple buckets populated", () => {
    const proposals: EnrichedProposal[] = [
      ...buildAssessedSet(5, 0.65, "keep"),
      ...buildAssessedSet(5, 0.75, "keep"),
      ...buildAssessedSet(5, 0.85, "keep"),
      ...buildAssessedSet(5, 0.95, "keep"),
    ];

    const result = analyzer.analyze(proposals);

    // Buckets 6, 7, 8, 9 should be populated
    expect(result.buckets[6].totalProposals).toBe(5);
    expect(result.buckets[6].range).toBe("0.6-0.7");
    expect(result.buckets[6].insufficientData).toBe(false);

    expect(result.buckets[7].totalProposals).toBe(5);
    expect(result.buckets[7].range).toBe("0.7-0.8");
    expect(result.buckets[7].insufficientData).toBe(false);

    expect(result.buckets[8].totalProposals).toBe(5);
    expect(result.buckets[8].range).toBe("0.8-0.9");
    expect(result.buckets[8].insufficientData).toBe(false);

    expect(result.buckets[9].totalProposals).toBe(5);
    expect(result.buckets[9].range).toBe("0.9-1.0");
    expect(result.buckets[9].insufficientData).toBe(false);

    // Other buckets should be empty (and insufficient)
    for (let i = 0; i < 6; i++) {
      expect(result.buckets[i].totalProposals).toBe(0);
    }

    expect(result.totalAssessed).toBe(20);
  });

  // -----------------------------------------------------------------------
  // (c) All proposals in insufficient data buckets
  // -----------------------------------------------------------------------

  it("(c) All proposals in insufficient data buckets (minBucketSize=5, only 3 assessed) → all buckets flagged insufficient", () => {
    const proposals: EnrichedProposal[] = buildAssessedSet(3, 0.75, "keep");

    const result = analyzer.analyze(proposals, 5);

    // The 0.7-0.8 bucket has 3 proposals but needs 5 → insufficient
    expect(result.buckets[7].totalProposals).toBe(3);
    expect(result.buckets[7].insufficientData).toBe(true);
    // Metrics should be undefined
    expect(result.buckets[7].keepRate).toBeUndefined();

    // All other buckets are empty → insufficient
    for (let i = 0; i < 10; i++) {
      if (i !== 7) {
        expect(result.buckets[i].totalProposals).toBe(0);
        expect(result.buckets[i].insufficientData).toBe(true);
      }
    }

    expect(result.totalAssessed).toBe(3);
    expect(result.confidenceOutcomeCorrelation).toBeNull(); // < 10 data points
  });

  // -----------------------------------------------------------------------
  // (d) Single assessed proposal → correlation=null
  // -----------------------------------------------------------------------

  it("(d) Single assessed proposal → confidenceOutcomeCorrelation=null", () => {
    const proposals: EnrichedProposal[] = buildAssessedSet(1, 0.6, "keep");

    const result = analyzer.analyze(proposals);

    expect(result.totalAssessed).toBe(1);
    expect(result.confidenceOutcomeCorrelation).toBeNull();
  });

  // -----------------------------------------------------------------------
  // (e) Correlation with small dataset (<10 proposals) → null
  // -----------------------------------------------------------------------

  it("(e) Correlation with small dataset (<10 proposals) → null", () => {
    const proposals: EnrichedProposal[] = [
      ...buildAssessedSet(3, 0.6, "keep"),
      ...buildAssessedSet(3, 0.8, "keep"),
      ...buildAssessedSet(3, 0.9, "keep"),
    ];

    const result = analyzer.analyze(proposals);

    // 9 assessed — below 10 threshold
    expect(result.totalAssessed).toBe(9);
    expect(result.confidenceOutcomeCorrelation).toBeNull();
  });

  // -----------------------------------------------------------------------
  // (f) Larger dataset where high confidence → higher keep rate
  // -----------------------------------------------------------------------

  it("(f) Correlation with larger dataset where high confidence → higher keep rate → positive correlation", () => {
    const proposals: EnrichedProposal[] = [
      // Low confidence: mostly not keep
      ...buildAssessedSet(3, 0.15, "revert"),
      ...buildAssessedSet(2, 0.15, "keep"),
      ...buildAssessedSet(3, 0.25, "revert"),
      ...buildAssessedSet(2, 0.25, "keep"),
      // High confidence: mostly keep
      ...buildAssessedSet(1, 0.85, "revert"),
      ...buildAssessedSet(4, 0.85, "keep"),
      ...buildAssessedSet(1, 0.95, "revert"),
      ...buildAssessedSet(4, 0.95, "keep"),
    ];

    const result = analyzer.analyze(proposals);

    // 20 assessed, across multiple buckets
    expect(result.totalAssessed).toBe(20);
    // Correlation should be positive
    expect(result.confidenceOutcomeCorrelation).not.toBeNull();
    expect(result.confidenceOutcomeCorrelation!).toBeGreaterThan(0);

    // Verify bucket metrics
    const bucketLow = result.buckets[1]; // 0.1-0.2
    expect(bucketLow.totalProposals).toBe(5);
    expect(bucketLow.insufficientData).toBe(false);
    expect(bucketLow.keepRate!).toBeCloseTo(2 / 5); // 2 keep out of 5

    const bucketHigh = result.buckets[9]; // 0.9-1.0
    expect(bucketHigh.totalProposals).toBe(5);
    expect(bucketHigh.insufficientData).toBe(false);
    expect(bucketHigh.keepRate!).toBeCloseTo(4 / 5); // 4 keep out of 5
  });

  // -----------------------------------------------------------------------
  // (g) Boundary values
  // -----------------------------------------------------------------------

  it("(g) Boundary values: 0.0, 0.1, 0.5, 0.9, 1.0 placed in correct buckets", () => {
    const proposals: EnrichedProposal[] = [
      ...buildAssessedSet(5, 0.0, "keep"),
      ...buildAssessedSet(5, 0.1, "keep"),
      ...buildAssessedSet(5, 0.5, "keep"),
      ...buildAssessedSet(5, 0.9, "keep"),
      ...buildAssessedSet(5, 1.0, "keep"),
    ];

    const result = analyzer.analyze(proposals);

    // 0.0 → bucket 0.0-0.1
    expect(result.buckets[0].totalProposals).toBe(5);
    expect(result.buckets[0].range).toBe("0.0-0.1");
    expect(result.buckets[0].insufficientData).toBe(false);

    // 0.1 → bucket 0.1-0.2 (rangeLow inclusive, rangeHigh exclusive for 0.0-0.1)
    expect(result.buckets[1].totalProposals).toBe(5);
    expect(result.buckets[1].range).toBe("0.1-0.2");
    expect(result.buckets[1].insufficientData).toBe(false);

    // 0.5 → bucket 0.5-0.6
    expect(result.buckets[5].totalProposals).toBe(5);
    expect(result.buckets[5].range).toBe("0.5-0.6");
    expect(result.buckets[5].insufficientData).toBe(false);

    // 0.9 → bucket 0.9-1.0 (rangeLow inclusive)
    expect(result.buckets[9].totalProposals).toBe(10); // 5 from 0.9 + 5 from 1.0
    expect(result.buckets[9].range).toBe("0.9-1.0");
    expect(result.buckets[9].insufficientData).toBe(false);

    // 1.0 → also bucket 0.9-1.0 (inclusive on both ends)
    // Already counted above

    expect(result.totalAssessed).toBe(25);
  });

  // -----------------------------------------------------------------------
  // (h) No assessed proposals
  // -----------------------------------------------------------------------

  it("(h) No assessed proposals → empty buckets, totalAssessed=0, correlation=null", () => {
    // Create proposals with no effectiveness report
    const proposals: EnrichedProposal[] = [
      makeEnriched(makeProposal({ id: "prop-nr-0", sourceConfidence: 0.5 }), null),
      makeEnriched(makeProposal({ id: "prop-nr-1", sourceConfidence: 0.7 }), null),
    ];

    const result = analyzer.analyze(proposals);

    expect(result.totalAssessed).toBe(0);

    // All buckets empty and insufficient
    for (const bucket of result.buckets) {
      expect(bucket.totalProposals).toBe(0);
      expect(bucket.insufficientData).toBe(true);
      expect(bucket.keepRate).toBeUndefined();
    }

    expect(result.confidenceOutcomeCorrelation).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Edge case: mixed assessed and unassessed proposals
  // -----------------------------------------------------------------------

  it("filters out unassessed proposals and only counts assessed ones", () => {
    const assessed1 = buildAssessedSet(5, 0.5, "keep");
    const unassessed: EnrichedProposal[] = [
      makeEnriched(makeProposal({ id: "prop-ua-0", sourceConfidence: 0.5 }), null),
      makeEnriched(makeProposal({ id: "prop-ua-1", sourceConfidence: 0.9 }), null),
    ];
    const assessed2 = buildAssessedSet(5, 0.5, "keep");

    const allProposals = [...assessed1, ...unassessed, ...assessed2];
    const result = analyzer.analyze(allProposals);

    // Only 10 assessed, not 12
    expect(result.totalAssessed).toBe(10);

    const bucket = result.buckets[5]; // 0.5-0.6
    expect(bucket.totalProposals).toBe(10);
    expect(bucket.insufficientData).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Edge case: failure and revert metrics
  // -----------------------------------------------------------------------

  it("correctly computes failure and revert rates in a populated bucket", () => {
    const proposals: EnrichedProposal[] = [
      // 2 keep, 2 revert (advisory), 1 failed, 1 wasReverted=true
      ...buildAssessedSet(2, 0.6, "keep"),
      ...buildAssessedSet(2, 0.6, "revert"),
      makeEnriched(
        makeProposal({ id: "prop-fail-0", sourceConfidence: 0.65, status: "failed" }),
        makeEffectivenessReport("prop-fail-0", { recommendation: "keep" }),
        false,
      ),
      makeEnriched(
        makeProposal({ id: "prop-rev-0", sourceConfidence: 0.65 }),
        makeEffectivenessReport("prop-rev-0", { recommendation: "keep" }),
        true, // wasReverted
      ),
    ];

    const result = analyzer.analyze(proposals);

    const bucket = result.buckets[6]; // 0.6-0.7
    expect(bucket.totalProposals).toBe(6);
    expect(bucket.insufficientData).toBe(false);

    // 2 from buildAssessedSet keep + 1 failed + 1 reverted → 4 total keep
    expect(bucket.keepCount).toBe(4);
    expect(bucket.keepRate).toBeCloseTo(4 / 6);
    expect(bucket.advisoryRevertCount).toBe(2);
    expect(bucket.advisoryRevertRate).toBeCloseTo(2 / 6);
    expect(bucket.applyFailureCount).toBe(1);
    expect(bucket.applyFailureRate).toBeCloseTo(1 / 6);
    expect(bucket.actualRevertCount).toBe(1);
    expect(bucket.actualRevertRate).toBeCloseTo(1 / 6);
  });

  // -----------------------------------------------------------------------
  // Edge case: varying minBucketSize
  // -----------------------------------------------------------------------

  it("respects custom minBucketSize", () => {
    const proposals: EnrichedProposal[] = buildAssessedSet(3, 0.6, "keep");

    // Default minBucketSize=5 → insufficient
    const resultDefault = analyzer.analyze(proposals);
    expect(resultDefault.buckets[6].insufficientData).toBe(true);

    // Custom minBucketSize=2 → sufficient
    const resultCustom = analyzer.analyze(proposals, 2);
    expect(resultCustom.buckets[6].insufficientData).toBe(false);
    expect(resultCustom.buckets[6].keepRate).toBeCloseTo(1.0);
  });
});
