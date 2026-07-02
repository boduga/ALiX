// src/planning/planning-types.ts
//
// P11.3 — Strategic Planning Engine type definitions.
//
// Consumes RootCauseAnalysis from P11.2 and produces a StrategicPlan:
// a prioritized multi-subsystem plan with ranked objectives, causal
// ordering, estimated effort, and advisory-only recommendations.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type { CausalMechanism } from "../reasoning/reasoning-types.js";

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * Estimated effort to address a planning objective.
 *
 * "low"   — Isolated investigation or minor adjustment.
 * "medium" — Cross-subsystem inspection or config change.
 * "high"   — Complex root cause requiring coordinated changes across subsystems.
 */
export type EffortEstimate = "low" | "medium" | "high";

/**
 * The breadth of downstream benefit from completing this objective.
 *
 * "direct"   — No other degraded subsystem depends on this objective's target.
 * "indirect" — Exactly one other degraded subsystem depends on this objective's target.
 * "compound" — Two or more other degraded subsystems depend on this objective's target.
 */
export type StrategicImpact = "direct" | "indirect" | "compound";

/**
 * Overall status of a StrategicPlan.
 */
export type PlanStatus =
  | "ok"                    // Normal strategic plan with objectives
  | "no_degradation"        // No subsystems degraded — no objectives needed
  | "insufficient_analysis" // RootCauseAnalysis status prevents planning
  | "no_objectives";        // Degradation exists but no actionable objectives

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface PlanningObjective {
  /** Stable objective ID, e.g. `strat-obj-{safeTimestamp}-{index}`. */
  id: string;
  /**
   * The degraded subsystem being planned for (symptom-objective model).
   * This is the primarySubsystem from the CausalFinding.
   */
  targetSubsystem: CorrelationSubsystemId;
  /** The driving metric (drift item ID) to address. Null if none. */
  targetMetric: string | null;
  /**
   * The subsystem identified as the most likely cause, if any.
   * When non-null, inspection should start here.
   */
  topCauseSubsystem: CorrelationSubsystemId | null;
  /** Current health score of the target subsystem (0–100). */
  currentScore: number;
  /**
   * Composite urgency score 0–100.
   * Higher = more urgent. Combines current score (lower is worse),
   * cause confidence, and impact breadth.
   */
  urgencyScore: number;
  /** The breadth of downstream benefit from completing this objective. */
  expectedImpact: StrategicImpact;
  /** Subsystems expected to improve as a side effect of fixing this one. */
  improvesSubsystems: CorrelationSubsystemId[];
  /** Estimated effort to address this objective. */
  estimatedEffort: EffortEstimate;
  /** Human-readable rationale for the effort estimate. */
  effortRationale: string;
  /** IDs of objectives that must be completed before this one. */
  prerequisites: string[];
  /** Confidence propagated from the top LikelyCause (0–1). Null if no cause found. */
  confidence: number | null;
  /** The causal mechanism of the top LikelyCause. Null if no cause found. */
  mechanism: CausalMechanism | null;
  /**
   * Links to the source CausalFinding's primarySubsystem.
   * Used for traceability back to the RootCauseAnalysis finding.
   */
  sourceFindingSubsystem: CorrelationSubsystemId;
  /** Human-readable rationale for inclusion and priority. */
  rationale: string;
}

export interface StrategicPlan {
  schemaVersion: "p11.3.0";
  /** Unique plan ID, e.g. `strat-{safeTimestamp}`. */
  planId: string;
  generatedAt: string;
  /** Links to the source RootCauseAnalysis that produced this plan. */
  rootCauseAnalysisId: string;
  /** Propagated from the RootCauseAnalysis for traceability. */
  correlationGraphId: string;
  /** Overall plan status. */
  status: PlanStatus;
  /** Ranked planning objectives (most urgent first). */
  objectives: PlanningObjective[];
  meta: {
    totalSubsystemsEvaluated: number;
    prioritizedObjectives: number;
    objectivesLow: number;
    objectivesMedium: number;
    objectivesHigh: number;
  };
}

export interface PlanningEngineConfig {
  /**
   * Maximum number of objectives to include in a single plan.
   * Default: 8 (covers all degraded subsystems in a healthy system).
   */
  maxObjectives: number;
  /**
   * Minimum urgency score for an objective to be included.
   * Default: 15 (filters out negligible degradations).
   */
  minUrgencyScore: number;
  /**
   * Effort overrides per causal mechanism.
   * When set, replaces the default effort mapping for that mechanism.
   */
  effortOverrides?: Partial<Record<CausalMechanism, EffortEstimate>>;
}

// ---------------------------------------------------------------------------
// Metadata (for list operations)
// ---------------------------------------------------------------------------

export interface StrategicPlanSummary {
  planId: string;
  generatedAt: string;
  status: PlanStatus;
  objectives: number;
  objectivesHigh: number;
  objectivesMedium: number;
  objectivesLow: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PlanningEngineError extends Error {
  readonly code = "PLANNING_ENGINE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "PlanningEngineError";
  }
}
