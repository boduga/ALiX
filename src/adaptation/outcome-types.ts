/**
 * P7a — Outcome tracking types for the decision outcome framework.
 *
 * Records whether decisions were correct after reality unfolded.
 * Pure data types with no storage dependencies.
 *
 * @module
 */

import type { DecisionArtifact } from "./decision-types.js";
import type { LensName } from "./governance-review-types.js";

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

// ---------------------------------------------------------------------------
// RecommendationAccuracyReport — P7b
// ---------------------------------------------------------------------------

/**
 * Accuracy report computed from outcome records over a time window.
 *
 * Measures how often decisions and recommendations produced successful
 * outcomes. Accuracy is computed from known (non-unknown) outcomes only,
 * so the denominator excludes "unknown" records that haven't yet resolved.
 *
 * Pure data type — no storage dependencies.
 */
export interface RecommendationAccuracyReport {
  /** Observation window in days. */
  windowDays: number;
  /** ISO timestamp when this report was generated. */
  generatedAt: string;
  /** Total outcomes in the window (includes unknown). */
  totalOutcomes: number;
  /** Distribution across all five outcome values. */
  outcomeDistribution: Record<OutcomeValue, number>;
  /**
   * Accuracy metrics computed from known outcomes only.
   * unknown records are excluded from the denominator, so
   * successRate + partialSuccessRate + failureRate + neutralRatio <= 1.
   * When knownOutcomes === 0, all rates are 0.
   */
  accuracy: {
    /** Number of outcomes with a definitive value (totalOutcomes - unknown). */
    knownOutcomes: number;
    /** Fraction of known outcomes that were success. */
    successRate: number;
    /** Fraction of known outcomes that were partial_success. */
    partialSuccessRate: number;
    /** Fraction of known outcomes that were failure. */
    failureRate: number;
  };
}

// ---------------------------------------------------------------------------
// LensCalibrationEntry / LensCalibrationReport — P7c
// ---------------------------------------------------------------------------

/**
 * Per-lens calibration metrics computed from observed outcomes.
 *
 * Measures reviewer quality: which governance lenses produce useful signals
 * vs. noise. P7c observes only — it does NOT change lens weights, modify
 * council voting, or auto-disable lenses.
 */
export interface LensCalibrationEntry {
  /** Number of observations for this lens. */
  reviewsAnalyzed: number;
  /** Total concerns raised across observations where lens warned (verdict !== "agree"). */
  concernsRaised: number;
  /** Sum of concerns raised where lens warned AND outcome was failure. */
  concernsValidated: number;
  /** Count of observations where lens warned AND outcome was success or partial_success. */
  falseAlarms: number;
  /** Count of observations where lens did NOT warn (agree or insufficient_information) AND outcome was failure. */
  missedFailures: number;
  /** validatedConcerns / concernsRaised, or 0 if concernsRaised is 0. */
  predictiveValue: number;
  /** Calibration tier based on predictiveValue thresholds. */
  calibration: "strong" | "moderate" | "weak" | "insufficient_data";
}

/**
 * Calibration report for all four governance lenses over a time window.
 *
 * Extends DecisionArtifact so it participates in the governance pipeline
 * (provenance, lineage, evidence refs) without breaking existing consumers.
 */
export interface LensCalibrationReport extends DecisionArtifact {
  /** Observation window in days. */
  windowDays: number;
  /** Per-lens calibration entries. */
  lenses: Record<LensName, LensCalibrationEntry>;
}
