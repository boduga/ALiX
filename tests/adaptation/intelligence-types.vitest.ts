/**
 * P5.3.1 — Intelligence types structural tests.
 *
 * Verifies that all interfaces can be constructed with valid data and that
 * defaults and constants behave as expected.  These are structural / compile-time
 * checks; runtime logic is tested by the analyzer and reporter tests.
 */

import { describe, it, expect } from "vitest";
import { MINIMUM_BUCKET_SIZE } from "../../src/adaptation/intelligence-types.js";
import type {
  EnrichedProposal,
  BucketStat,
  BucketSet,
  RevertSignalAnalysis,
  ConfidenceBucket,
  ConfidenceCalibration,
  IntelligenceReport,
  BucketReference,
} from "../../src/adaptation/intelligence-types.js";

describe("MINIMUM_BUCKET_SIZE", () => {
  it("defaults to 5", () => {
    expect(MINIMUM_BUCKET_SIZE).toBe(5);
  });
});

describe("EnrichedProposal shape", () => {
  it("can be constructed with required fields", () => {
    const ep: EnrichedProposal = {
      proposal: {
        id: "prop-test-001",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "applied",
        action: "update_agent_card",
        target: { kind: "agent_card", id: "test.agent" },
        payload: { name: "Updated" },
        sourceRecommendationType: "agent_card_update",
        sourceConfidence: 0.85,
        evidenceFingerprints: [],
        reason: "Test",
      },
      effectivenessReport: null,
      wasReverted: false,
      revertProposalId: null,
      outcome: "applied",
      timeToApprovalHours: 2.5,
      timeToApplyHours: 1.0,
    };
    expect(ep.outcome).toBe("applied");
    expect(ep.wasReverted).toBe(false);
    expect(ep.timeToApprovalHours).toBe(2.5);
  });

  it("accepts reverted outcome", () => {
    const ep: EnrichedProposal = {
      proposal: {
        id: "prop-test-002",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "applied",
        action: "update_agent_card",
        target: { kind: "agent_card", id: "test.agent" },
        payload: {},
        sourceRecommendationType: "agent_card_update",
        sourceConfidence: 0.9,
        evidenceFingerprints: [],
        reason: "Test",
      },
      effectivenessReport: null,
      wasReverted: true,
      revertProposalId: "prop-revert-001",
      outcome: "reverted",
      timeToApprovalHours: null,
      timeToApplyHours: null,
    };
    expect(ep.outcome).toBe("reverted");
    expect(ep.wasReverted).toBe(true);
    expect(ep.revertProposalId).toBe("prop-revert-001");
  });
});

describe("BucketStat", () => {
  it("has insufficientData when below threshold", () => {
    const stat: BucketStat = {
      value: "update_agent_card",
      totalProposals: 3,
      insufficientData: true,
    };
    expect(stat.insufficientData).toBe(true);
    expect(stat.keepRate).toBeUndefined();
  });

  it("has metrics when sufficient data", () => {
    const stat: BucketStat = {
      value: "update_agent_card",
      totalProposals: 10,
      insufficientData: false,
      keepCount: 8,
      keepRate: 0.8,
      advisoryRevertCount: 1,
      advisoryRevertRate: 0.1,
      applyFailureCount: 1,
      applyFailureRate: 0.1,
      approvalRate: 0.9,
      meanSourceConfidence: 0.85,
      humansOverruledCount: 0,
    };
    expect(stat.keepRate).toBe(0.8);
    expect(stat.advisoryRevertRate).toBe(0.1);
    expect(stat.humansOverruledCount).toBe(0);
  });
});

describe("BucketSet", () => {
  it("aggregates bucket metadata", () => {
    const set: BucketSet = {
      dimension: "byAction",
      buckets: [
        { value: "update_agent_card", totalProposals: 10, insufficientData: false },
        { value: "create_agent_card", totalProposals: 3, insufficientData: true },
      ],
      totalInDimension: 13,
      insufficientDataCount: 1,
    };
    expect(set.dimension).toBe("byAction");
    expect(set.buckets).toHaveLength(2);
    expect(set.insufficientDataCount).toBe(1);
  });
});

describe("RevertSignalAnalysis", () => {
  it("can be constructed", () => {
    const rsa: RevertSignalAnalysis = {
      totalAdvisoryReverts: 5,
      totalActualReverts: 3,
      totalUnactedReverts: 2,
      revertPrecision: 0.6,
      topUnactedRevertBuckets: [
        { dimension: "byAction", value: "update_agent_card", count: 1 },
      ],
      humansOverruledCount: 1,
    };
    expect(rsa.totalUnactedReverts).toBe(2);
    expect(rsa.revertPrecision).toBe(0.6);
    expect(rsa.topUnactedRevertBuckets).toHaveLength(1);
  });

  it("revertPrecision can be null when there are no actual reverts", () => {
    const rsa: RevertSignalAnalysis = {
      totalAdvisoryReverts: 3,
      totalActualReverts: 0,
      totalUnactedReverts: 3,
      revertPrecision: null,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    };
    expect(rsa.revertPrecision).toBeNull();
  });
});

describe("ConfidenceBucket + ConfidenceCalibration", () => {
  it("constructs a confidence bucket", () => {
    const cb: ConfidenceBucket = {
      range: "0.9-1.0",
      rangeLow: 0.9,
      rangeHigh: 1.0,
      totalProposals: 20,
      insufficientData: false,
      keepCount: 18,
      keepRate: 0.9,
    };
    expect(cb.range).toBe("0.9-1.0");
    expect(cb.keepRate).toBe(0.9);
  });

  it("constructs a calibration with null correlation", () => {
    const cc: ConfidenceCalibration = {
      buckets: [],
      totalAssessed: 5,
      confidenceOutcomeCorrelation: null,
    };
    expect(cc.totalAssessed).toBe(5);
    expect(cc.confidenceOutcomeCorrelation).toBeNull();
  });
});

describe("IntelligenceReport shape", () => {
  it("constructs with all required fields", () => {
    const makeEmptyBucketSet = (dimension: string): BucketSet => ({
      dimension,
      buckets: [],
      totalInDimension: 0,
      insufficientDataCount: 0,
    });

    const report: IntelligenceReport = {
      generatedAt: "2026-06-19T23:00:00.000Z",
      totalProposalsAnalyzed: 47,
      dataWindow: {
        oldestProposalCreatedAt: "2026-06-01T00:00:00.000Z",
        newestProposalCreatedAt: "2026-06-19T23:00:00.000Z",
        oldestEffectivenessAssessedAt: null,
      },
      executiveSummary: "Early data — most buckets are below the minimum threshold.",
      buckets: {
        byAction: makeEmptyBucketSet("byAction"),
        byTargetKind: makeEmptyBucketSet("byTargetKind"),
        bySourceRecommendationType: makeEmptyBucketSet("bySourceRecommendationType"),
        byProvenance: makeEmptyBucketSet("byProvenance"),
        byCapability: makeEmptyBucketSet("byCapability"),
        byOutcome: makeEmptyBucketSet("byOutcome"),
      },
      confidenceCalibration: {
        buckets: [],
        totalAssessed: 0,
        confidenceOutcomeCorrelation: null,
      },
      revertSignalAnalysis: {
        totalAdvisoryReverts: 0,
        totalActualReverts: 0,
        totalUnactedReverts: 0,
        revertPrecision: null,
        topUnactedRevertBuckets: [],
        humansOverruledCount: 0,
      },
      topPerforming: [],
      lowestPerforming: [],
    };
    expect(report.totalProposalsAnalyzed).toBe(47);
    expect(report.buckets.byAction.dimension).toBe("byAction");
    expect(report.confidenceCalibration.totalAssessed).toBe(0);
    expect(report.revertSignalAnalysis.revertPrecision).toBeNull();
  });
});

describe("BucketReference", () => {
  it("can be constructed", () => {
    const ref: BucketReference = {
      dimension: "byAction",
      value: "update_agent_card",
      keepRate: 0.83,
      total: 18,
    };
    expect(ref.dimension).toBe("byAction");
    expect(ref.keepRate).toBe(0.83);
  });
});
