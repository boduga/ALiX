/**
 * P5.3 — Intelligence types: report schema for cross-proposal effectiveness analysis.
 *
 * These types describe the output of the ProposalEffectivenessAgent pipeline.
 * Every component in the pipeline produces or consumes one or more of these interfaces.
 *
 * @module
 */

import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";

// ---------------------------------------------------------------------------
// Enriched proposal — base unit of analysis
// ---------------------------------------------------------------------------

/**
 * A proposal enriched with its effectiveness assessment, revert status, and
 * derived lifecycle metrics.  This is the primary data unit consumed by all
 * analyzers in the P5.3 pipeline.
 */
export interface EnrichedProposal {
  proposal: AdaptationProposal;
  /** The effectiveness report for this proposal, if one exists. */
  effectivenessReport: ProposalEffectivenessReport | null;
  /** Whether a revert_proposal targeting this proposal was applied. */
  wasReverted: boolean;
  /** The revert proposal ID if one exists and was applied, else null. */
  revertProposalId: string | null;
  /**
   * Derived terminal outcome.  "reverted" overrides the stored proposal status
   * when a revert_proposal targeting this proposal was applied.
   */
  outcome: "applied" | "rejected" | "failed" | "reverted" | "pending" | "approved";
  /** Hours from createdAt to approvedAt (null if never approved). */
  timeToApprovalHours: number | null;
  /** Hours from approvedAt to appliedAt (null if never applied). */
  timeToApplyHours: number | null;
}

// ---------------------------------------------------------------------------
// Per-bucket statistics
// ---------------------------------------------------------------------------

/** Default minimum proposals before a bucket reports per-bucket metrics. */
export const MINIMUM_BUCKET_SIZE = 5;

/**
 * Aggregated statistics for a single bucket value within a dimension
 * (e.g. bucket value "update_agent_card" within dimension "byAction").
 *
 * When `insufficientData` is true, all metric fields are undefined because
 * the bucket contains too few proposals for reliable statistics.
 */
export interface BucketStat {
  /** The bucket value (e.g. "update_agent_card", "agent_card", "manual"). */
  value: string;
  /** Total proposals in this bucket. */
  totalProposals: number;
  /** True when totalProposals < MINIMUM_BUCKET_SIZE. */
  insufficientData: boolean;

  // Metrics — only populated when insufficientData is false
  keepCount?: number;
  keepRate?: number;                 // 0-1
  advisoryRevertCount?: number;
  advisoryRevertRate?: number;       // 0-1
  investigateCount?: number;
  investigateRate?: number;          // 0-1
  notAssessedCount?: number;
  notAssessedRate?: number;          // 0-1
  applyFailureCount?: number;
  applyFailureRate?: number;         // 0-1
  rejectionCount?: number;
  rejectionRate?: number;            // 0-1
  approvalRate?: number;             // 0-1
  actualRevertCount?: number;
  actualRevertRate?: number;         // 0-1
  medianTimeToApprovalHours?: number;
  medianTimeToApplyHours?: number;
  meanSourceConfidence?: number;
  /** Proposals where effectiveness said "keep" but the human reverted them. */
  humansOverruledCount?: number;
}

/** A set of buckets for a single dimension. */
export interface BucketSet {
  dimension: string;
  buckets: BucketStat[];
  /** Total proposals across all buckets in this dimension. */
  totalInDimension: number;
  /** Count of buckets below the minimum size threshold. */
  insufficientDataCount: number;
}

// ---------------------------------------------------------------------------
// Revert signal analysis (top-level, not per-bucket)
// ---------------------------------------------------------------------------

export interface RevertSignalAnalysis {
  /** Proposals where effectiveness report recommended "revert". */
  totalAdvisoryReverts: number;
  /** Proposals that were actually reverted (revert_proposal applied). */
  totalActualReverts: number;
  /** Advisory reverts that were NOT acted on (advisory - actual, floored at 0). */
  totalUnactedReverts: number;
  /**
   * Fraction of actual reverts where effectiveness also recommended "revert".
   * Null when there are no actual reverts (division by zero).
   */
  revertPrecision: number | null;
  /** Top 5 buckets (across all dimensions) with the most unacted reverts. */
  topUnactedRevertBuckets: Array<{ dimension: string; value: string; count: number }>;
  /** Proposals where effectiveness said "keep" but the human still reverted. */
  humansOverruledCount: number;
}

// ---------------------------------------------------------------------------
// Confidence calibration — sourceConfidence → outcome
// ---------------------------------------------------------------------------

/** A single confidence bucket (e.g. 0.8-0.9). */
export interface ConfidenceBucket {
  /** Human-readable range label e.g. "0.9-1.0", "0.8-0.9". */
  range: string;
  /** Lower bound inclusive. */
  rangeLow: number;
  /** Upper bound (exclusive for all except 1.0 which is inclusive). */
  rangeHigh: number;
  totalProposals: number;
  insufficientData: boolean;
  keepCount?: number;
  keepRate?: number;
  advisoryRevertCount?: number;
  advisoryRevertRate?: number;
  applyFailureCount?: number;
  applyFailureRate?: number;
  actualRevertCount?: number;
  actualRevertRate?: number;
}

/** Complete confidence calibration across all confidence ranges. */
export interface ConfidenceCalibration {
  buckets: ConfidenceBucket[];
  /** Total proposals used in calibration. */
  totalAssessed: number;
  /**
   * Spearman rank correlation between sourceConfidence and keep outcome.
   * Null when there are fewer than 10 data points or all values fall into a single bucket.
   */
  confidenceOutcomeCorrelation: number | null;
}

// ---------------------------------------------------------------------------
// IntelligenceReport — final output
// ---------------------------------------------------------------------------

/** Top/bottom performing bucket reference. */
export interface BucketReference {
  dimension: string;
  value: string;
  keepRate: number;
  total: number;
}

/** Data window of proposals analyzed. */
export interface DataWindow {
  oldestProposalCreatedAt: string;
  newestProposalCreatedAt: string;
  oldestEffectivenessAssessedAt: string | null;
}

/**
 * The full intelligence report — the output of `alix adaptation intelligence`.
 *
 * Contains per-dimension bucket analysis, revert signal analysis, and confidence
 * calibration.  Persisted as JSON under `.alix/adaptation/intelligence/`.
 */
export interface IntelligenceReport {
  /** ISO 8601 when this report was generated. */
  generatedAt: string;
  /** Total proposals considered across all buckets. */
  totalProposalsAnalyzed: number;
  /** Date range of the proposals analyzed. */
  dataWindow: DataWindow;
  /** Natural-language executive summary (3-5 sentences, template-driven). */
  executiveSummary: string;
  /** Per-dimension bucket sets. */
  buckets: {
    byAction: BucketSet;
    byTargetKind: BucketSet;
    bySourceRecommendationType: BucketSet;
    byProvenance: BucketSet;
    byCapability: BucketSet;
    byOutcome: BucketSet;
  };
  /** Confidence calibration — maps sourceConfidence ranges to outcome rates. */
  confidenceCalibration: ConfidenceCalibration;
  /** Revert signal analysis (top-level, not per-bucket). */
  revertSignalAnalysis: RevertSignalAnalysis;
  /** Top 5 performing buckets by keep rate (excluding insufficient-data buckets). */
  topPerforming: BucketReference[];
  /** Bottom 5 performing buckets by keep rate (excluding insufficient-data buckets). */
  lowestPerforming: BucketReference[];
}

// ---------------------------------------------------------------------------
// Options / config
// ---------------------------------------------------------------------------

export interface IntelligenceOptions {
  since?: string;
  until?: string;
  minConfidence?: number;
  minBucketSize?: number;
}
