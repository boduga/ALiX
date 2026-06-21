/**
 * P6.5 — Governance Review Council type definitions.
 *
 * GovernanceReview is an LLM-augmented critique artifact between
 * Recommendation and Queue. It answers "What might the deterministic
 * governance layer be missing?" without making decisions.
 *
 * Pure data types with no storage dependencies.
 * No approve/reject fields. No decision authority.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { ApprovalRecommendation } from "./recommendation-types.js";
import type { DecisionContext } from "./decision-types.js";
import type { RiskScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// GovernanceVerdict
// ---------------------------------------------------------------------------

export type GovernanceVerdict =
  | "agree"
  | "agree_with_concerns"
  | "challenge"
  | "insufficient_information";

export const GOVERNANCE_VERDICT_SEVERITY: Record<GovernanceVerdict, number> = {
  agree: 0,
  agree_with_concerns: 1,
  challenge: 2,
  insufficient_information: 3,
};

// ---------------------------------------------------------------------------
// LensScore — individual lens output
// ---------------------------------------------------------------------------

export type LensName = "red_team" | "historian" | "policy_auditor" | "confidence_critic";

export interface LensScore {
  lens: LensName;
  recommendedVerdict: GovernanceVerdict;
  confidence: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// CouncilVote — aggregation result
// ---------------------------------------------------------------------------

export interface CouncilVote {
  agree: number;
  agreeWithConcerns: number;
  challenge: number;
  insufficientInformation: number;
}

// ---------------------------------------------------------------------------
// GovernanceReviewInput — context assembled by CLI for each lens
// ---------------------------------------------------------------------------

export interface GovernanceReviewInput {
  recommendation: ApprovalRecommendation;
  decisionContext: DecisionContext;
  riskScore?: RiskScore;
  historicalSummary?: string;
  governanceRules?: string;
}

// ---------------------------------------------------------------------------
// GovernanceReview — output artifact
// ---------------------------------------------------------------------------

export interface GovernanceReview extends DecisionArtifact {
  /** The recommendation this review critiques. */
  recommendationId: string;
  /** Proposal being reviewed. */
  proposalId: string;
  /** Council verdict — NOT a decision. */
  verdict: GovernanceVerdict;
  /** Specific concerns raised by the council. */
  concerns: string[];
  /** Blind spots the review identified. */
  blindSpots: string[];
  /** Historical analogs surfaced (from Historian lens). */
  historicalAnalogies: string[];
  /** Per-lens scores (each lens contributes independently). */
  lensScores: LensScore[];
  /** Council aggregation (how the verdict was reached). */
  councilVote: CouncilVote;
  /** Source artifacts consumed. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "reviewed"
}
