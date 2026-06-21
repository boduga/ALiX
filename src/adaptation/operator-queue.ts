/**
 * P6.2 — OperatorQueue: pure sorting class.
 *
 * Takes pre-built QueueInput[] and returns sorted QueueItem[].
 * No store access, no builder imports, no evaluation logic.
 * Deterministic: same inputs in any order → same outputs.
 *
 * @module
 */

import type { SourceArtifact } from "./decision-types.js";
import type { QueueInput, QueueItem, QueueItemOrdering } from "./operator-queue-types.js";
import { RECOMMENDATION_RANK, type RecommendationPriority } from "./operator-queue-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RECOMMENDATION_RANK = 0;
const MISSING_RISK = 0;
const OUTCOME_QUEUED = "queued";

// ---------------------------------------------------------------------------
// OperatorQueue
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Return only the top N items after sorting. Applied AFTER sort. */
  limit?: number;
  /** Override generatedAt for deterministic testing. Defaults to Date.now(). */
  generatedAt?: string;
}

export class OperatorQueue {
  /**
   * Sort QueueInput[] into a prioritized QueueItem[].
   *
   * Sort order (deterministic):
   *   1. RiskScore.overallRisk descending   (primary)
   *   2. RecommendationPriority rank desc   (secondary)
   *   3. DecisionContext.ageDays descending  (tertiary)
   *   4. proposalId ascending                (final tiebreaker)
   *
   * @param inputs - Pre-assembled decision artifacts per pending proposal
   * @param options - Optional limit after sorting
   * @returns Sorted QueueItem[] with 1-indexed positions
   */
  build(inputs: QueueInput[], options?: BuildOptions): QueueItem[] {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    const items: QueueItem[] = inputs.map(({ ctx, riskScore, recommendation }) => {
      const recommendationRank = this.recommendationRank(riskScore, recommendation);
      const ordering: QueueItemOrdering = {
        risk: riskScore?.overallRisk ?? MISSING_RISK,
        recommendationRank,
        ageDays: ctx.ageDays,
      };

      return {
        id: `queue:${ctx.proposalId}:${generatedAt}`,
        subject: `Queue position for ${ctx.proposalId}`,
        outcome: OUTCOME_QUEUED,
        confidence: recommendation?.confidence ?? 0,
        recommendation: recommendation?.recommendation ?? undefined,
        reasons: this.buildReasons(ordering, riskScore, recommendation),
        evidenceRefs: [ctx.id, riskScore?.id ?? "", recommendation?.id ?? ""].filter(Boolean),
        generatedAt,
        proposalId: ctx.proposalId,
        position: 0, // assigned after sort
        recommendationId: recommendation?.id,
        riskScoreId: riskScore?.id,
        ordering,
        sourceArtifacts: [
          { type: "context", id: ctx.id, timestamp: ctx.generatedAt },
          ...(riskScore ? [{ type: "risk" as const, id: riskScore.id, timestamp: riskScore.generatedAt }] : []),
          ...(recommendation ? [{ type: "recommendation" as const, id: recommendation.id, timestamp: recommendation.generatedAt }] : []),
        ],
      };
    });

    // Sort by the four-tier rule
    items.sort((a, b) => {
      // 1. Risk descending
      if (b.ordering.risk !== a.ordering.risk) return b.ordering.risk - a.ordering.risk;
      // 2. Recommendation rank descending
      if (b.ordering.recommendationRank !== a.ordering.recommendationRank)
        return b.ordering.recommendationRank - a.ordering.recommendationRank;
      // 3. Age descending
      if (b.ordering.ageDays !== a.ordering.ageDays) return b.ordering.ageDays - a.ordering.ageDays;
      // 4. ProposalId ascending (final tiebreaker)
      return a.proposalId.localeCompare(b.proposalId);
    });

    // Assign 1-indexed positions
    items.forEach((item, index) => { item.position = index + 1; });

    // Apply limit after sort
    if (options?.limit !== undefined && options.limit >= 0) {
      return items.slice(0, options.limit);
    }

    return items;
  }

  // ---- private helpers ----

  /**
   * Determine the recommendation rank for sorting.
   * Missing recommendation → 0 (below all known ranks).
   */
  private recommendationRank(riskScore: QueueInput["riskScore"], recommendation: QueueInput["recommendation"]): number {
    const priority = recommendation?.recommendation as RecommendationPriority | undefined;
    if (priority && priority in RECOMMENDATION_RANK) {
      return RECOMMENDATION_RANK[priority];
    }
    return DEFAULT_RECOMMENDATION_RANK;
  }

  /**
   * Build ordering-rationale reasons.
   * Explains WHY the item is positioned where it is, not just echoing inputs.
   * No "approve because" or "reject because" — that would leak into Recommendation's domain.
   */
  private buildReasons(
    ordering: QueueItemOrdering,
    riskScore: QueueInput["riskScore"],
    recommendation: QueueInput["recommendation"],
  ): string[] {
    const reasons: string[] = [];

    if (riskScore?.overallRisk !== undefined) {
      reasons.push(`Risk contribution: ${riskScore.overallRisk.toFixed(2)}`);
    } else {
      reasons.push("No risk score — treated as lowest priority");
    }

    if (recommendation?.recommendation) {
      reasons.push(`Recommendation rank: ${recommendation.recommendation}`);
    } else {
      reasons.push("No recommendation available — treated as lowest priority");
    }

    if (ordering.ageDays > 0) {
      reasons.push(`Age: ${ordering.ageDays} day(s)`);
    }

    return reasons;
  }
}
