/**
 * P7a — Outcome tracking types for the decision outcome framework.
 *
 * Records whether decisions were correct after reality unfolded.
 * Pure data types with no storage dependencies.
 *
 * @module
 */

import type { DecisionArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// OutcomeValue
// ---------------------------------------------------------------------------

/**
 * Classification for the outcome of a decision or action.
 * - "success": decision produced the desired result
 * - "partial_success": decision partially achieved the goal
 * - "neutral": no meaningful effect observed
 * - "failure": decision did not achieve the goal or caused harm
 * - "unknown": outcome has not yet been determined (observation window open)
 */
export type OutcomeValue =
  | "success"
  | "partial_success"
  | "neutral"
  | "failure"
  | "unknown";

// ---------------------------------------------------------------------------
// OutcomeRecord
// ---------------------------------------------------------------------------

/**
 * Record of a single decision outcome, extending the base DecisionArtifact.
 *
 * Links an outcome observation back to the original decision, recommendation,
 * or governance review that produced it. The outcome field is narrowed from
 * the base string type to the OutcomeValue union.
 */
export interface OutcomeRecord extends DecisionArtifact {
  /** Identifier of the subject that was acted upon */
  subjectId: string;
  /** Type of the subject (e.g., "proposal", "capability", "agent") */
  subjectType: string;
  /** Reference to the P6 DecisionArtifact that produced this outcome */
  decisionId?: string;
  /** Reference to the originating recommendation */
  recommendationId?: string;
  /** Reference to the P6.5b governance review (always null for now — reviews are ephemeral) */
  governanceReviewId?: string;
  /** Description of what action was taken */
  actionTaken: string;
  /** Outcome classification */
  outcome: OutcomeValue;
  /** Observation window in days over which the outcome was assessed */
  observationWindowDays: number;
}

// ---------------------------------------------------------------------------
// OutcomeEvidence
// ---------------------------------------------------------------------------

/**
 * Lightweight evidence attachment for an outcome record.
 *
 * Each piece of evidence links a measurable observation to an outcome,
 * providing the factual basis for the outcome classification.
 */
export interface OutcomeEvidence {
  id: string;
  /** The outcome record this evidence supports */
  outcomeId: string;
  /** Type/category of evidence (e.g., "metric", "observation", "report") */
  evidenceType: string;
  /** Source of the evidence (e.g., "effectiveness_store", "user_report") */
  source: string;
  /** Human-readable summary of the evidence */
  summary: string;
  /** When this evidence was collected */
  timestamp: string;
  /** Confidence in this evidence (0–1) */
  confidence: number;
}
