/**
 * P8.0a — Learning types: signals, calibration profiles, proposals, and reports.
 *
 * Core invariant: Learning proposes. Governance approves.
 * These are data objects only — no mutation, no side effects, no store imports.
 *
 * Also contains P11.4 Learning Engine types: ObservationSignal, ConfidenceUpdate,
 * UpdatedConfidenceModel, and supporting adapter interfaces.
 *
 * @module
 */

import type { DecisionArtifact } from "../adaptation/decision-types.js";
import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type { CausalMechanism } from "../reasoning/reasoning-types.js";

// ===========================================================================
// P8.0a — Calibration types
// ===========================================================================

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

// ===========================================================================
// P11.4 — Learning Engine types
// ===========================================================================

/**
 * The type of observed outcome that triggers a confidence update
 * in the P11.4 Learning Engine.
 *
 * "score_improvement"            — Subsystem health score increased after
 *                                  objective resolution.
 * "no_action_improvement"        — Score improved even though the objective
 *                                  was not completed. Audit record only.
 * "completed_no_improvement"     — Objective was completed but score did
 *                                  not improve.
 * "deferred_recurrence"          — Reserved for future recurrence observation.
 *                                  Never emitted while
 *                                  recurrenceLearningEnabled === false.
 */
export type ObservationSignal =
  | "score_improvement"
  | "no_action_improvement"
  | "completed_no_improvement"
  | "deferred_recurrence";

/**
 * A single confidence update produced by one learning observation
 * in the P11.4 Learning Engine.
 */
export interface ConfidenceUpdate {
  /** The subsystem that was targeted by the objective. */
  targetSubsystem: CorrelationSubsystemId;
  /** The causal mechanism that was identified (if any). */
  mechanism: CausalMechanism | null;
  /** The observation signal that triggered this update. */
  signal: ObservationSignal;
  /** The observed score delta (positive = improvement). */
  scoreDelta: number;
  /** Whether the objective was completed. */
  completed: boolean;
  /** The urgency score of the objective at plan time. */
  urgencyScoreAtPlanning: number;
  /**
   * The confidence adjustment to apply.
   * Bounds: -0.05 to +0.05 per cycle.
   */
  adjustment: number;
  /**
   * Confidence after applying this adjustment.
   * Clamped to [0.05, 0.95].
   */
  resultingConfidence: number;
  /** Links to the source objective. */
  sourceObjectiveId: string;
  /** Links to the source plan. */
  sourcePlanId: string;
  /** ISO timestamp of the learning observation. */
  observedAt: string;
}

export interface UpdatedConfidenceModel {
  schemaVersion: "p11.4.0";
  /** Unique model ID, e.g. `lrn-{safeTimestamp}`. */
  modelId: string;
  generatedAt: string;
  /** Links to the source plan that produced this learning data. */
  sourcePlanId: string;
  /** Propagated from StrategicPlan for P11 chain traceability. */
  rootCauseAnalysisId: string;
  /** Propagated from StrategicPlan for P11 chain traceability. */
  correlationGraphId: string;
  /** Ordered list of confidence updates from this learning cycle. */
  updates: ConfidenceUpdate[];
  meta: {
    primarySignal: "score_improvement";
    /**
     * Plan completion is represented via the `completed` boolean on each
     * ConfidenceUpdate. It is a secondary signal (influences classification)
     * but is not emitted as a standalone confidence-changing signal.
     */
    secondarySignal: "plan_completion";
    /** Explicitly deferred. Always false in v1. */
    recurrenceLearningEnabled: false;
    /** Number of plan objectives inspected this learning cycle. */
    objectivesEvaluated: number;
    /** Number of objectives that produced a ConfidenceUpdate record. */
    objectivesWithSignals: number;
    /**
     * Number of objectives skipped due to missing current score
     * or confidence: null.
     */
    objectivesSkipped: number;
    /**
     * Number of objectives that were evaluated but produced no
     * learnable signal (e.g. no action + no improvement).
     */
    objectivesWithoutSignal: number;
    /** ISO timestamp of the earliest subsystem score used as baseline. */
    baselineTimestamp: string;
    /** ISO timestamp of the latest subsystem score used as evaluation. */
    evaluationTimestamp: string;
  };
  /**
   * Rollup summary of this learning cycle.
   * Provided for downstream consumers (P11.5 Forecasting) to quickly
   * consume the model without recomputing aggregates.
   */
  summary: {
    positiveUpdates: number;
    negativeUpdates: number;
    zeroAdjustmentUpdates: number;
    averageAdjustment: number;
  };
  /**
   * Per-mechanism adjustment rollup.
   */
  mechanismAdjustments: Array<{
    mechanism: CausalMechanism;
    samples: number;
    averageAdjustment: number;
  }>;
}

// ---------------------------------------------------------------------------
// Outcome and score adapters
// ---------------------------------------------------------------------------

/**
 * Minimal outcome record for a planning objective.
 *
 * Matching priority:
 * 1. Exact sourceObjectiveId match — always used if present.
 * 2. targetSubsystem fallback — only when exactly one objective
 *    in the plan targets that subsystem.
 * 3. No match — objective treated as incomplete.
 */
export interface LearningOutcomeRecord {
  /** Exact-match preferred. */
  sourceObjectiveId?: string;
  sourcePlanId?: string;
  /**
   * Fallback — only used when exactly one plan objective targets
   * this subsystem (avoids ambiguous attribution).
   */
  targetSubsystem?: CorrelationSubsystemId;
  /** Whether the objective was completed. */
  completed: boolean;
  completedAt?: string;
  status?: "completed" | "abandoned" | "failed" | "unknown";
}

/**
 * Explicit observation context injected into the pure function.
 *
 * All timestamps are provided by the caller (orchestrator) so the
 * pure function remains deterministic — no Date.now() internally.
 */
export interface LearningObservationContext {
  generatedAt: string;
  baselineTimestamp: string;
  evaluationTimestamp: string;
}

/**
 * Minimal outcome store adapter for the LearningEngine.
 */
export interface LearningOutcomeStore {
  list(): Promise<LearningOutcomeRecord[]>;
}

/**
 * Adapter for loading subsystem health scores at specific points in time.
 *
 * When no historical data is available, falls back to the score
 * captured in the plan objective (currentScore).
 */
export interface ScoreSnapshotProvider {
  loadScoresAt(timestamp: string): Promise<Map<CorrelationSubsystemId, number>>;
  loadCurrentScores(): Promise<Map<CorrelationSubsystemId, number>>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LearningEngineConfig {
  maxPositiveAdjustment: number;
  maxNegativeAdjustment: number;
  minConfidence: number;
  maxConfidence: number;
  minImprovementDelta: number;
  evaluationWindowMs: number;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ConfidenceModelSummary {
  modelId: string;
  generatedAt: string;
  sourcePlanId: string;
  objectivesEvaluated: number;
  objectivesWithSignals: number;
  objectivesSkipped: number;
  objectivesWithoutSignal: number;
  updates: number;
  positiveUpdates: number;
  negativeUpdates: number;
  zeroAdjustmentUpdates: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class LearningEngineError extends Error {
  readonly code = "LEARNING_ENGINE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "LearningEngineError";
  }
}
