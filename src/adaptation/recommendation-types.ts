/**
 * P6.1 — ApprovalRecommendation types.
 *
 * ApprovalRecommendation is a deterministic, read-only recommendation computed
 * from DecisionContext + RiskScore. It answers "What appears reasonable?"
 * without making decisions.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact, EnrichedWarning } from "./decision-types.js";
import type { RiskItem } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type Recommendation = "approve" | "reject" | "defer" | "investigate";

// ---------------------------------------------------------------------------
// ApprovalRecommendation
// ---------------------------------------------------------------------------

export interface ApprovalRecommendation extends DecisionArtifact {
  /** One outcome — "What appears reasonable?" */
  recommendation: Recommendation;

  /** Proposal recommendation addresses. */
  proposalId: string;

  /** Reference RiskScore used (if any). */
  riskScoreId?: string;

  /** Human-readable rationale — per-rule justifications. */
  reasons: string[];

  /** RiskScore dimensions forwarded for operator convenience. */
  risks?: RiskItem[];

  /** Preserves evidence chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
