/**
 * P5.4.2 — ProposalScorer: score pending proposals using historical intelligence.
 *
 * Combines source confidence, historical keep/approval/revert rates from the
 * IntelligenceReport, and proposal age into a single priority score (0-1).
 * Produces a ranked ProposalPriorityReport persisted via PriorityStore.
 *
 * P5.4 prioritizes. P5.4 does NOT mutate. No proposals created, no evidence
 * written, no approvals/applies.
 *
 * @module
 */

import type { AdaptationProposal } from "./adaptation-types.js";
import type {
  BucketSet,
  BucketStat,
  IntelligenceReport,
} from "./intelligence-types.js";
import { IntelligenceStore } from "./intelligence-store.js";
import type {
  PrioritizeOptions,
  ProposalPriorityReport,
  ScoredProposal,
} from "./priority-types.js";
import { SCORING_VERSION } from "./priority-types.js";
import { PriorityStore } from "./priority-store.js";
import { ProposalStore } from "./proposal-store.js";

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

/** Weights for the base score formula. Must sum to 1.0. */
const WEIGHT_CONFIDENCE = 0.3;
const WEIGHT_HISTORICAL_SUCCESS = 0.3;
const WEIGHT_APPROVAL = 0.15;
const WEIGHT_REVERT_PENALTY = 0.15;

/** Default revert penalty when no historical data is available. */
const DEFAULT_REVERT_PENALTY = 0.5;

/** Decile bins for score distribution. */
const DECILES = [
  "0.0-0.1", "0.1-0.2", "0.2-0.3", "0.3-0.4", "0.4-0.5",
  "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0",
];

// ---------------------------------------------------------------------------
// ProposalScorer
// ---------------------------------------------------------------------------

export class ProposalScorer {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly intelligenceStore: IntelligenceStore,
    private readonly priorityStore: PriorityStore,
  ) {}

  /**
   * Generate a full priority report for all pending proposals.
   *
   * Loads pending proposals and the latest IntelligenceReport, scores each
   * proposal, assembles the ranked report, persists it, and returns it.
   */
  async generateReport(opts?: PrioritizeOptions): Promise<ProposalPriorityReport> {
    const generatedAt = new Date().toISOString();

    // 1. Load all pending proposals
    const allPending = await this.proposalStore.list("pending");

    // 2. Load latest IntelligenceReport (can be null — graceful degradation)
    const intelligenceReport = await this.intelligenceStore.loadLatest();

    // 3. Score each pending proposal
    const scored: ScoredProposal[] = allPending.map((proposal) =>
      this.#scoreProposal(proposal, intelligenceReport),
    );

    // 4. Sort by priorityScore descending
    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    // 5. Apply top/minScore filters (applied to the ranked list only; totals are unfiltered)
    let ranked = scored;
    if (opts?.minScore !== undefined) {
      ranked = ranked.filter((s) => s.priorityScore >= opts.minScore!);
    }
    if (opts?.top !== undefined) {
      ranked = ranked.slice(0, opts.top);
    }

    // 6. Compute summary statistics (based on all scored, not filtered)
    const totalLowConfidence = scored.filter((s) => s.confidence === "LOW").length;
    const scoreDistribution = this.#computeDistribution(scored);

    // 7. Assemble report
    const report: ProposalPriorityReport = {
      generatedAt,
      scoringVersion: SCORING_VERSION,
      intelligenceReportDate: intelligenceReport?.generatedAt ?? null,
      totalPending: allPending.length,
      totalScored: scored.length,
      totalLowConfidence,
      scoreDistribution,
      executiveSummary: this.#buildExecutiveSummary(scored),
      ranked,
    };

    // 8. Save via PriorityStore
    await this.priorityStore.save(report);

    return report;
  }

  // ---- private helpers ---------------------------------------------------

  /** Score a single proposal against an optional IntelligenceReport. */
  #scoreProposal(
    proposal: AdaptationProposal,
    report: IntelligenceReport | null,
  ): ScoredProposal {
    // Determine bucket dimensions → matching BucketStats
    const matchingBuckets = report
      ? this.#findMatchingBuckets(proposal, report)
      : [];

    const sufficientBuckets = matchingBuckets.filter((b) => !b.insufficientData);

    // Confidence tier
    let confidence: "HIGH" | "MEDIUM" | "LOW";
    if (sufficientBuckets.length >= 2) {
      confidence = "HIGH";
    } else if (sufficientBuckets.length === 1) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }

    // Best metrics across matching dimensions
    const historicalSuccessWeight = sufficientBuckets.length > 0
      ? Math.max(...sufficientBuckets.map((b) => b.keepRate ?? 0))
      : 0;

    const approvalWeight = sufficientBuckets.length > 0
      ? Math.max(...sufficientBuckets.map((b) => b.approvalRate ?? 0))
      : 0;

    let revertPenalty: number;
    if (sufficientBuckets.length > 0) {
      const bestAdvisoryRevert = Math.min(
        ...sufficientBuckets.map((b) => b.advisoryRevertRate ?? 1),
      );
      const bestActualRevert = Math.min(
        ...sufficientBuckets.map((b) => b.actualRevertRate ?? 1),
      );
      revertPenalty = 1 - Math.max(bestAdvisoryRevert, bestActualRevert);
    } else {
      revertPenalty = DEFAULT_REVERT_PENALTY;
    }

    const ageMultiplier = computeAgeMultiplier(proposal.createdAt);

    const baseScore =
      WEIGHT_CONFIDENCE * proposal.sourceConfidence +
      WEIGHT_HISTORICAL_SUCCESS * historicalSuccessWeight +
      WEIGHT_APPROVAL * approvalWeight +
      WEIGHT_REVERT_PENALTY * revertPenalty;

    const priorityScore = Math.min(baseScore * ageMultiplier, 1.0);

    const rationale = this.#buildRationale(
      proposal,
      confidence,
      historicalSuccessWeight,
      sufficientBuckets,
      revertPenalty,
    );

    return {
      proposalId: proposal.id,
      priorityScore,
      confidence,
      components: {
        confidenceWeight: proposal.sourceConfidence,
        historicalSuccessWeight,
        approvalWeight,
        revertPenalty,
        ageMultiplier,
      },
      rationale,
      proposal,
    };
  }

  /**
   * Find matching BucketStats across all relevant dimensions.
   *
   * Dimensions mapped:
   *   proposal.action           → report.buckets.byAction
   *   proposal.target.kind      → report.buckets.byTargetKind
   *   proposal.sourceRecommendationType → report.buckets.bySourceRecommendationType
   *   proposal.provenance       → report.buckets.byProvenance
   *   proposal.target.capability → report.buckets.byCapability (only when target.kind === "capability")
   */
  #findMatchingBuckets(
    proposal: AdaptationProposal,
    report: IntelligenceReport,
  ): BucketStat[] {
    const results: BucketStat[] = [];

    const lookups: Array<{ bucketSet: BucketSet; value: string }> = [
      { bucketSet: report.buckets.byAction, value: proposal.action },
      { bucketSet: report.buckets.byTargetKind, value: proposal.target.kind },
      {
        bucketSet: report.buckets.bySourceRecommendationType,
        value: proposal.sourceRecommendationType,
      },
      { bucketSet: report.buckets.byProvenance, value: proposal.provenance ?? "manual" },
    ];

    // Include byCapability only when the target has a capability field
    if (proposal.target.kind === "capability") {
      lookups.push({
        bucketSet: report.buckets.byCapability,
        value: proposal.target.capability,
      });
    }

    for (const { bucketSet, value } of lookups) {
      const match = bucketSet.buckets.find((b) => b.value === value);
      if (match) {
        results.push(match);
      }
    }

    return results;
  }

  /** Build a human-readable rationale string for a scored proposal. */
  #buildRationale(
    proposal: AdaptationProposal,
    confidence: string,
    historicalSuccessWeight: number,
    sufficientBuckets: BucketStat[],
    revertPenalty: number,
  ): string {
    const parts: string[] = [];

    // Source confidence
    parts.push(
      `Source confidence ${proposal.sourceConfidence.toFixed(2)}.`,
    );

    // Key bucketing signal
    if (sufficientBuckets.length > 0) {
      // Find the bucket with the highest keepRate to use as the "key signal"
      const bestBucket = sufficientBuckets.reduce((best, b) =>
        (b.keepRate ?? 0) > (best.keepRate ?? 0) ? b : best,
      );
      parts.push(
        `"${bestBucket.value}" proposals keep ${((bestBucket.keepRate ?? 0) * 100).toFixed(0)}% of the time.`,
      );
    } else {
      parts.push("Insufficient historical data for bucketed metrics.");
    }

    // Revert risk
    if (revertPenalty >= 0.9) {
      parts.push("Very low revert risk.");
    } else if (revertPenalty >= 0.7) {
      parts.push("Low revert risk.");
    } else if (revertPenalty >= 0.5) {
      parts.push("Moderate revert risk.");
    } else {
      parts.push("High revert risk.");
    }

    // Age
    const ageDays = daysSince(proposal.createdAt);
    if (ageDays < 1) {
      parts.push("Created today.");
    } else if (ageDays === 1) {
      parts.push("Pending 1 day.");
    } else {
      parts.push(`Pending ${Math.round(ageDays)} days.`);
    }

    return parts.join(" ");
  }

  /** Build the executive summary for the report. */
  #buildExecutiveSummary(scored: ScoredProposal[]): string {
    const totalPending = scored.length;
    if (totalPending === 0) {
      return "No pending proposals to prioritize.";
    }

    const highScoreCount = scored.filter((s) => s.priorityScore >= 0.85).length;
    const lowConfidenceCount = scored.filter((s) => s.confidence === "LOW").length;

    let summary = `${totalPending} pending proposal${totalPending === 1 ? "" : "s"} ranked.`;

    if (highScoreCount > 0) {
      summary += ` Top ${highScoreCount} have scores ≥ 0.85.`;
    }

    if (lowConfidenceCount > 0) {
      summary += ` ${lowConfidenceCount} proposal${lowConfidenceCount === 1 ? "" : "s"} with insufficient historical data.`;
    }

    return summary;
  }

  /** Compute score distribution across 10 deciles. */
  #computeDistribution(scored: ScoredProposal[]): Array<{ decile: string; count: number }> {
    const bins = new Map<string, number>();
    for (const decile of DECILES) {
      bins.set(decile, 0);
    }

    for (const s of scored) {
      const idx = Math.min(Math.floor(s.priorityScore * 10), 9);
      const decile = DECILES[idx];
      bins.set(decile, (bins.get(decile) ?? 0) + 1);
    }

    return DECILES.map((decile) => ({ decile, count: bins.get(decile) ?? 0 }));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Compute the age multiplier for a proposal based on its createdAt timestamp. */
export function computeAgeMultiplier(createdAt: string): number {
  const days = daysSince(createdAt);
  if (days < 7) return 1.0;
  if (days < 30) return 1.05;
  if (days < 90) return 1.1;
  return 1.15;
}

/** Calculate the number of days since a given ISO 8601 timestamp. */
function daysSince(isoTimestamp: string): number {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 86_400_000;
}
