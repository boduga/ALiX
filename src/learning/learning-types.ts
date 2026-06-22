/**
 * P8.0a — Learning types: signals, calibration profiles, proposals, and reports.
 *
 * Core invariant: Learning proposes. Governance approves.
 * These are data objects only — no mutation, no side effects, no store imports.
 *
 * @module
 */

import type { DecisionArtifact } from "../adaptation/decision-types.js";

// ---------------------------------------------------------------------------
// LearningSignal
// ---------------------------------------------------------------------------

export type LearningSignalType =
  | "overconfidence"
  | "underconfidence"
  | "risk_dimension_overfire"
  | "risk_dimension_miss"
  | "risk_dimension_ignored"
  | "lens_high_predictive_value"
  | "lens_low_predictive_value"
  | "lens_high_false_positive"
  | "lens_high_miss_rate"
  | "routing_quality_good"
  | "routing_quality_poor"
  | "routing_cost_efficient"
  | "routing_cost_inefficient"
  | "routing_latency_concern";

export interface LearningSignal extends DecisionArtifact {
  /** Source report that produced this signal. */
  sourceReportId: string;

  /** Classification of the signal. */
  signalType: LearningSignalType;

  /** How strong the signal is (0–1). Higher = more evidence. */
  strength: number;

  /** Confidence in the signal itself (0–1). */
  confidence: number;

  /** Human-readable summary of what was observed. */
  summary: string;

  /** Evidence references pointing to P7 artifacts. */
  evidenceRefs: string[];

  /** Quantitative delta: expected vs observed. */
  delta?: {
    expected: number;
    observed: number;
    unit: string;
  };
}

// ---------------------------------------------------------------------------
// CalibrationProfile
// ---------------------------------------------------------------------------

export type CalibrationTarget =
  | "recommendation_confidence_multiplier"
  | "risk_dimension_weight"
  | "governance_lens_weight"
  | "routing_model_preference";

export interface CalibrationProfile extends DecisionArtifact {
  /** What is being calibrated. */
  target: CalibrationTarget;

  /** Human-readable name of the specific target. */
  targetName: string;

  /** Current value before adjustment. */
  previousValue: number;

  /** Suggested new value. */
  suggestedValue: number;

  /** Confidence in this calibration suggestion (0–1). */
  confidence: number;

  /** Reason for the suggested change. */
  reason: string;

  /** Evidence references supporting this calibration. */
  evidenceRefs: string[];

  /** Source LearningSignal IDs that drove this profile. */
  sourceSignalIds: string[];
}

// ---------------------------------------------------------------------------
// LearningProposal
// ---------------------------------------------------------------------------

export type LearningProposalType =
  | "recommendation_calibration"
  | "risk_calibration"
  | "governance_calibration"
  | "routing_calibration";

export interface LearningProposal extends DecisionArtifact {
  /** What kind of learning adjustment. */
  proposalType: LearningProposalType;

  /** The calibration profiles this proposal would apply. */
  profiles: CalibrationProfile[];

  /** Expected benefit if applied. */
  expectedBenefit: string;

  /** Risk estimate if applied incorrectly. */
  riskEstimate: string;

  /** Source LearningSignal IDs. */
  sourceSignalIds: string[];

  /** Whether human approval is required (always true in P8). */
  requiresApproval: true;
}

// ---------------------------------------------------------------------------
// LearningReport
// ---------------------------------------------------------------------------

export interface LearningReportSection {
  title: string;
  summary: string;
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
  recommendation: string;
}

export interface LearningPattern {
  description: string;
  affectedSignals: string[];
  recurrenceCount: number;
  severity: "info" | "warning" | "significant";
}

export interface LearningReport extends DecisionArtifact {
  /** Time window in days. */
  windowDays: number;

  /** ISO 8601 range. */
  windowStart: string;
  windowEnd: string;

  /** All signals in the window. */
  signals: LearningSignal[];

  /** Calibration profiles generated from signals. */
  profiles: CalibrationProfile[];

  /** Summary sections, one per signal type group. */
  sections: LearningReportSection[];

  /** Cross-cutting patterns found. */
  patterns?: LearningPattern[];
}
