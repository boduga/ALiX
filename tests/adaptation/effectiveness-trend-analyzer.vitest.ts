import { describe, it, expect } from "vitest";
import { EffectivenessTrendAnalyzer } from "../../src/adaptation/effectiveness-trend-analyzer.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import type { ReflectionMetrics } from "../../src/reflection/reflection-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyMetrics: ReflectionMetrics = {
  workflowsCompleted: 0,
  workflowsAborted: 0,
  workflowsBlocked: 0,
  capabilitiesRequested: 0,
  unresolvedCapabilities: 0,
  reviewApprovalRate: 0,
};

let idCounter = 0;
function nextId(): string {
  return `prop-2026-06-19-${String(++idCounter).padStart(3, "0")}`;
}

function proposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: nextId(),
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "applied",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "x" },
    payload: {},
    sourceRecommendationType: "agent_card_update",
    sourceConfidence: 0.8,
    evidenceFingerprints: [],
    reason: "test proposal",
    ...overrides,
  };
}

function effectiveness(overrides: Partial<ProposalEffectivenessReport> = {}): ProposalEffectivenessReport {
  return {
    proposalId: nextId(),
    assessedAt: "2026-06-19T12:00:00.000Z",
    appliedAt: "2026-06-19T00:00:00.000Z",
    windowDays: 7,
    metricsBefore: emptyMetrics,
    metricsAfter: emptyMetrics,
    primary: null,
    dataSufficient: true,
    recommendation: "keep",
    reason: "test",
    ...overrides,
  };
}

function enriched(overrides: Partial<EnrichedProposal> = {}): EnrichedProposal {
  const p = proposal(overrides.proposal as Partial<AdaptationProposal> | undefined);
  const eff = effectiveness(overrides.effectivenessReport as Partial<ProposalEffectivenessReport> | undefined);
  return {
    proposal: p,
    effectivenessReport: eff,
    wasReverted: false,
    revertProposalId: null,
    outcome: "applied",
    timeToApprovalHours: 24,
    timeToApplyHours: 48,
    ...overrides,
    // Let explicit overrides win over the defaults
}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EffectivenessTrendAnalyzer", () => {
  const analyzer = new EffectivenessTrendAnalyzer();

  // (a) All-keep bucket
  it("all-keep bucket returns keepRate=1.0 and advisoryRevertRate=0", () => {
    const proposals = Array.from({ length: 10 }, () =>
      enriched({
        effectivenessReport: effectiveness({ recommendation: "keep" }),
      }),
    );
    const result = analyzer.analyze(proposals);
    expect(result.value).toBe("");
    expect(result.totalProposals).toBe(10);
    expect(result.insufficientData).toBe(false);
    expect(result.keepCount).toBe(10);
    expect(result.keepRate).toBe(1.0);
    expect(result.advisoryRevertCount).toBe(0);
    expect(result.advisoryRevertRate).toBe(0);
    expect(result.investigateCount).toBe(0);
    expect(result.investigateRate).toBe(0);
  });

  // (b) Mixed bucket
  it("mixed bucket returns correct rates", () => {
    const proposals: EnrichedProposal[] = [];
    // 7 keep
    for (let i = 0; i < 7; i++) {
      proposals.push(enriched({ effectivenessReport: effectiveness({ recommendation: "keep" }) }));
    }
    // 2 revert
    for (let i = 0; i < 2; i++) {
      proposals.push(enriched({ effectivenessReport: effectiveness({ recommendation: "revert" }) }));
    }
    // 1 investigate
    proposals.push(enriched({ effectivenessReport: effectiveness({ recommendation: "investigate" }) }));

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(10);
    expect(result.insufficientData).toBe(false);
    expect(result.keepCount).toBe(7);
    expect(result.keepRate).toBe(0.7);
    expect(result.advisoryRevertCount).toBe(2);
    expect(result.advisoryRevertRate).toBe(0.2);
    expect(result.investigateCount).toBe(1);
    expect(result.investigateRate).toBe(0.1);
  });

  // (c) Insufficient data
  it("returns insufficientData=true and undefined metric fields with 3 proposals", () => {
    const proposals = Array.from({ length: 3 }, () => enriched());
    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(3);
    expect(result.insufficientData).toBe(true);
    expect(result.keepCount).toBeUndefined();
    expect(result.keepRate).toBeUndefined();
    expect(result.advisoryRevertCount).toBeUndefined();
    expect(result.advisoryRevertRate).toBeUndefined();
    expect(result.investigateCount).toBeUndefined();
    expect(result.investigateRate).toBeUndefined();
  });

  // (d) Some assessed, some not
  it("bucket with 6 assessed and 4 not assessed returns notAssessedRate=0.4", () => {
    const proposals: EnrichedProposal[] = [];
    // 6 with reports
    for (let i = 0; i < 6; i++) {
      proposals.push(enriched({ effectivenessReport: effectiveness({ recommendation: "keep" }) }));
    }
    // 4 without reports
    for (let i = 0; i < 4; i++) {
      const p = proposal();
      proposals.push({
        proposal: p,
        effectivenessReport: null,
        wasReverted: false,
        revertProposalId: null,
        outcome: "applied",
        timeToApprovalHours: 24,
        timeToApplyHours: 48,
      });
    }

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(10);
    expect(result.insufficientData).toBe(false);
    expect(result.notAssessedCount).toBe(4);
    expect(result.notAssessedRate).toBe(0.4);
    expect(result.keepCount).toBe(6);
    expect(result.keepRate).toBe(0.6);
  });

  // (e) Bucket with a failed proposal
  it("bucket with 1 failed proposal returns applyFailureRate=0.1", () => {
    const proposals: EnrichedProposal[] = [];
    // 9 applied
    for (let i = 0; i < 9; i++) {
      proposals.push(enriched());
    }
    // 1 failed
    proposals.push(enriched({ proposal: proposal({ status: "failed" }) }));

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(10);
    expect(result.insufficientData).toBe(false);
    expect(result.applyFailureCount).toBe(1);
    expect(result.applyFailureRate).toBe(0.1);
  });

  // (f) Empty proposals list
  it("empty list returns insufficientData=true", () => {
    const result = analyzer.analyze([]);
    expect(result.totalProposals).toBe(0);
    expect(result.insufficientData).toBe(true);
    expect(result.keepCount).toBeUndefined();
    expect(result.keepRate).toBeUndefined();
  });

  // (g) Time metrics: median computed correctly
  it("computes median approval and apply times correctly", () => {
    const proposals: EnrichedProposal[] = [];
    // 5 proposals with varying approval times
    const approvalTimes = [1, 5, 10, 20, 100]; // median = 10
    const applyTimes = [2, 3, 7, 11, 13]; // median = 7
    for (let i = 0; i < 5; i++) {
      proposals.push(
        enriched({
          timeToApprovalHours: approvalTimes[i],
          timeToApplyHours: applyTimes[i],
        }),
      );
    }

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(5);
    expect(result.insufficientData).toBe(false);
    expect(result.medianTimeToApprovalHours).toBe(10);
    expect(result.medianTimeToApplyHours).toBe(7);
  });

  it("computes median for even number of values correctly", () => {
    const proposals: EnrichedProposal[] = [];
    // 6 proposals — median should be average of 3rd and 4th sorted values
    const times = [1, 3, 7, 11, 13, 17]; // sorted: 1,3,7,11,13,17 → median (7+11)/2 = 9
    for (const t of times) {
      proposals.push(enriched({ timeToApprovalHours: t }));
    }

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(6);
    expect(result.insufficientData).toBe(false);
    expect(result.medianTimeToApprovalHours).toBe(9);
  });

  // (h) Single proposal bucket — still below minBucketSize threshold (default 5)
  it("single proposal bucket returns insufficientData=true (below default threshold)", () => {
    const result = analyzer.analyze([enriched()]);
    expect(result.totalProposals).toBe(1);
    expect(result.insufficientData).toBe(true);
    expect(result.keepCount).toBeUndefined();
  });

  // (i) Custom minBucketSize override
  it("custom minBucketSize=3 makes 3 proposals sufficient", () => {
    const proposals = Array.from({ length: 3 }, () =>
      enriched({ effectivenessReport: effectiveness({ recommendation: "keep" }) }),
    );
    const result = analyzer.analyze(proposals, 3);
    expect(result.totalProposals).toBe(3);
    expect(result.insufficientData).toBe(false);
    expect(result.keepCount).toBe(3);
    expect(result.keepRate).toBe(1.0);
  });

  it("custom minBucketSize=3 makes 2 proposals insufficient", () => {
    const proposals = Array.from({ length: 2 }, () => enriched());
    const result = analyzer.analyze(proposals, 3);
    expect(result.totalProposals).toBe(2);
    expect(result.insufficientData).toBe(true);
    expect(result.keepCount).toBeUndefined();
  });

  // (j) Approval rate: pending proposals excluded from denominator
  it("excludes pending proposals from approval rate denominator", () => {
    const proposals: EnrichedProposal[] = [];
    // 4 approved
    for (let i = 0; i < 4; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "approved" }) }));
    }
    // 3 applied
    for (let i = 0; i < 3; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "applied" }) }));
    }
    // 2 rejected
    for (let i = 0; i < 2; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "rejected" }) }));
    }
    // 1 failed
    proposals.push(enriched({ proposal: proposal({ status: "failed" }) }));
    // 5 pending (excluded from denominator)
    for (let i = 0; i < 5; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "pending" }) }));
    }

    // Total = 15. Acted on (non-pending) = 10. Approved or applied = 7.
    // approvalRate = 7 / 10 = 0.7
    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(15);
    expect(result.insufficientData).toBe(false);
    expect(result.approvalRate).toBeCloseTo(0.7, 5);
  });

  it("approval rate is 0 when all proposals are pending", () => {
    const proposals = Array.from({ length: 10 }, () =>
      enriched({ proposal: proposal({ status: "pending" }) }),
    );
    const result = analyzer.analyze(proposals);
    expect(result.insufficientData).toBe(false);
    expect(result.approvalRate).toBe(0);
  });

  // (k) Humans overruled
  it("counts proposals where effectiveness=keep but wasReverted=true", () => {
    const proposals: EnrichedProposal[] = [];
    // 5 keep + wasReverted=false (not overruled)
    for (let i = 0; i < 5; i++) {
      proposals.push(
        enriched({
          effectivenessReport: effectiveness({ recommendation: "keep" }),
          wasReverted: false,
        }),
      );
    }
    // 2 keep + wasReverted=true (overruled!)
    for (let i = 0; i < 2; i++) {
      proposals.push(
        enriched({
          effectivenessReport: effectiveness({ recommendation: "keep" }),
          wasReverted: true,
        }),
      );
    }
    // 3 revert (not overruled regardless of wasReverted)
    for (let i = 0; i < 3; i++) {
      proposals.push(
        enriched({
          effectivenessReport: effectiveness({ recommendation: "revert" }),
          wasReverted: true,
        }),
      );
    }

    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(10);
    expect(result.insufficientData).toBe(false);
    expect(result.keepCount).toBe(7);
    expect(result.humansOverruledCount).toBe(2);
    expect(result.actualRevertCount).toBe(5); // 2 keep-reverted + 3 revert-reverted
  });

  // Additional edge cases

  it("meanSourceConfidence is correct", () => {
    const proposals: EnrichedProposal[] = [];
    const confidences = [0.5, 0.7, 0.9, 0.3, 0.6]; // mean = 0.6
    for (const c of confidences) {
      proposals.push(enriched({ proposal: proposal({ sourceConfidence: c }) }));
    }
    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(5);
    expect(result.insufficientData).toBe(false);
    expect(result.meanSourceConfidence).toBeCloseTo(0.6, 10);
  });

  it("medianTimeToApprovalHours is undefined when no proposals have approval times", () => {
    const proposals = Array.from({ length: 5 }, () =>
      enriched({ timeToApprovalHours: null }),
    );
    const result = analyzer.analyze(proposals);
    expect(result.insufficientData).toBe(false);
    expect(result.medianTimeToApprovalHours).toBeUndefined();
  });

  it("meanSourceConfidence is undefined for empty arrays (insufficient data)", () => {
    // Since empty array triggers insufficientData, we use minBucketSize=0 to force metrics.
    const result = analyzer.analyze([], 0);
    expect(result.insufficientData).toBe(false);
    expect(result.meanSourceConfidence).toBeUndefined();
  });

  it("rejection counts are correct", () => {
    const proposals: EnrichedProposal[] = [];
    for (let i = 0; i < 5; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "applied" }) }));
    }
    for (let i = 0; i < 3; i++) {
      proposals.push(enriched({ proposal: proposal({ status: "rejected" }) }));
    }
    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(8);
    expect(result.rejectionCount).toBe(3);
    expect(result.rejectionRate).toBe(3 / 8);
  });

  it("actualRevertRate is correct when some proposals were reverted", () => {
    const proposals: EnrichedProposal[] = [];
    for (let i = 0; i < 8; i++) {
      proposals.push(enriched({ wasReverted: false }));
    }
    for (let i = 0; i < 2; i++) {
      proposals.push(enriched({ wasReverted: true }));
    }
    const result = analyzer.analyze(proposals);
    expect(result.totalProposals).toBe(10);
    expect(result.actualRevertCount).toBe(2);
    expect(result.actualRevertRate).toBe(0.2);
  });
});
