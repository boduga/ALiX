/**
 * P6.2 — Operator Queue type definitions.
 *
 * QueueItem output artifact. QueueInput CLI assembles
 * pure OperatorQueue builder.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { RiskScore } from "./risk-score-types.js";
import type { ApprovalRecommendation } from "./recommendation-types.js";
import type { DecisionContext } from "./decision-types.js";
import type { GovernanceReview, GovernanceVerdict } from "./governance-review-types.js";

// ---------------------------------------------------------------------------
// Recommendation Priority — tiebreaker secondary sort key
// ---------------------------------------------------------------------------

export type RecommendationPriority = "investigate" | "reject" | "defer" | "approve";

/** investigate (4) highest operator attention, approve (1) = lowest. */
export const RECOMMENDATION_RANK: Record<RecommendationPriority, number> = {
  investigate: 4,
  reject: 3,
  defer: 2,
  approve: 1,
};

// ---------------------------------------------------------------------------
// QueueInput CLI pending proposal
// ---------------------------------------------------------------------------

export interface QueueInput {
  ctx: DecisionContext;
  /** Missing risk score → treated as risk=0 (lowest priority). */
  riskScore?: RiskScore;
  /** Missing recommendation → treated as rank=0 (below approve). */
  recommendation?: ApprovalRecommendation;
  /** Governance review verdict — optional. Missing → severity 0 (no sort impact). */
  governanceReview?: GovernanceReview;
}

// ---------------------------------------------------------------------------
// QueueItemOrdering — sort key provenance
// ---------------------------------------------------------------------------

export interface QueueItemOrdering {
  /** RiskScore.overallRisk (0-1) — primary sort key. */
  risk: number;
  /** RECOMMENDATION_RANK value — secondary sort key. */
  recommendationRank: number;
  /** DecisionContext.ageDays — tertiary sort key. */
  ageDays: number;
  /** GovernanceReview verdict severity — quaternary sort key. */
  reviewSeverity: number;
}

// ---------------------------------------------------------------------------
// QueueItem — the output artifact
// ---------------------------------------------------------------------------

export interface QueueItem extends DecisionArtifact {
  proposalId: string;
  /** 1-indexed position in the sorted queue. */
  position: number;
  /** Explicit recommendation enum — NOT parsed from reasons. */
  recommendation?: RecommendationPriority;
  /** Link to the source ApprovalRecommendation. */
  recommendationId?: string;
  /** Link to the source RiskScore. */
  riskScoreId?: string;
  /** Link to the source GovernanceReview. */
  governanceReviewId?: string;
  /** Governance verdict applied by the council. */
  governanceVerdict?: GovernanceVerdict;
  /** The sort keys that determined this position. */
  ordering: QueueItemOrdering;

  /**
   * Forwarded from ApprovalRecommendation.confidence.
   * Queue does NOT compute or adjust confidence.
   * Only 0 when no recommendation is available.
   */
  confidence: number;

  /** Source artifacts: DecisionContext, RiskScore, ApprovalRecommendation, GovernanceReview. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "queued"
}
