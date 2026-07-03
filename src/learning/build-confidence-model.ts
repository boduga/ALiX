// src/learning/build-confidence-model.ts
//
// P11.4 — Pure function that builds a confidence model from plan objectives
// and learning outcomes.
//
// Consumes StrategicPlan (P11.3), matches against LearningOutcomeRecords,
// and produces an UpdatedConfidenceModel with per-objective confidence
// adjustments based on observed score deltas.
//
// Pure function — no I/O, no side effects, no Date.now(), no Math.random().
// Fully deterministic.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type { CausalMechanism } from "../reasoning/reasoning-types.js";
import type {
  ObservationSignal,
  ConfidenceUpdate,
  UpdatedConfidenceModel,
  LearningOutcomeRecord,
  LearningObservationContext,
  LearningEngineConfig,
} from "./learning-types.js";
import type { StrategicPlan } from "../planning/planning-types.js";
import { DEFAULT_LEARNING_CONFIG } from "./learning-config.js";
import { LearningEngineError } from "./learning-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip non-alphanumeric characters to produce a safe timestamp for IDs.
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Clamp a value within [min, max] bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round a number to 3 decimal places.
 */
function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Build an UpdatedConfidenceModel by matching plan objectives against
 * learning outcomes and computing per-objective confidence adjustments.
 *
 * **6-step algorithm:**
 *   1. Input validation
 *   2. Outcome matching (exact by sourceObjectiveId, fallback by targetSubsystem)
 *   3. Score delta computation (baseline vs current)
 *   4. Signal classification (score_improvement / completed_no_improvement / no_action_improvement)
 *   5. Adjustment computation (bounded per config)
 *   6. Confidence bounds (null guard, clamping)
 *
 * Pure function — no I/O, no side effects.
 */
export function buildConfidenceModel(
  plan: StrategicPlan,
  outcomes: LearningOutcomeRecord[],
  baselineScores: Map<CorrelationSubsystemId, number>,
  currentScores: Map<CorrelationSubsystemId, number>,
  context: LearningObservationContext,
  config: LearningEngineConfig = DEFAULT_LEARNING_CONFIG,
): UpdatedConfidenceModel {
  const { generatedAt, baselineTimestamp, evaluationTimestamp } = context;

  // -----------------------------------------------------------------------
  // Step 1 — Input validation
  // -----------------------------------------------------------------------

  if (plan.schemaVersion !== "p11.3.0") {
    throw new LearningEngineError(
      `Invalid plan schema version: expected "p11.3.0", got "${plan.schemaVersion}"`,
    );
  }

  if (!plan.planId) {
    throw new LearningEngineError("Plan must have a non-empty planId");
  }

  if (!plan.generatedAt) {
    throw new LearningEngineError("Plan must have a non-empty generatedAt");
  }

  if (baselineTimestamp > evaluationTimestamp) {
    throw new LearningEngineError(
      `baselineTimestamp (${baselineTimestamp}) must not be after evaluationTimestamp (${evaluationTimestamp})`,
    );
  }

  if (generatedAt > evaluationTimestamp) {
    throw new LearningEngineError(
      `generatedAt (${generatedAt}) must not be after evaluationTimestamp (${evaluationTimestamp})`,
    );
  }

  // Empty plan early return
  if (plan.objectives.length === 0) {
    return buildEmptyModel(plan, context);
  }

  // -----------------------------------------------------------------------
  // Step 2 — Outcome matching
  // -----------------------------------------------------------------------

  // Keep only outcomes that belong to this plan.
  // If sourcePlanId is undefined (not set), allow through — it's not
  // explicitly assigned to a different plan.
  const planOutcomes = outcomes.filter(
    (o) => o.sourcePlanId === undefined || o.sourcePlanId === plan.planId,
  );

  // Count how many plan objectives target each subsystem (for fallback guard)
  const subsystemCount = new Map<CorrelationSubsystemId, number>();
  for (const obj of plan.objectives) {
    subsystemCount.set(
      obj.targetSubsystem,
      (subsystemCount.get(obj.targetSubsystem) ?? 0) + 1,
    );
  }

  const updates: ConfidenceUpdate[] = [];
  let skippedCount = 0;

  for (const objective of plan.objectives) {
    // -- Step 2a: Exact sourceObjectiveId match --
    const byId = planOutcomes.filter(
      (o) => o.sourceObjectiveId === objective.id,
    );
    let matchedOutcome: LearningOutcomeRecord | undefined;

    if (byId.length > 0) {
      // Latest completedAt wins; ties resolved by last in array order
      matchedOutcome = byId.reduce((best, curr) =>
        isLaterOutcome(best, curr) ? curr : best,
      );
    } else if (subsystemCount.get(objective.targetSubsystem) === 1) {
      // -- Step 2b: Fallback by targetSubsystem --
      // Only when exactly one plan objective targets this subsystem
      const bySubsystem = planOutcomes.filter(
        (o) => o.targetSubsystem === objective.targetSubsystem,
      );
      if (bySubsystem.length > 0) {
        matchedOutcome = bySubsystem.reduce((best, curr) =>
          isLaterOutcome(best, curr) ? curr : best,
        );
      }
    }

    const completed = matchedOutcome?.completed ?? false;

    // ---------------------------------------------------------------------
    // Step 3 — Score delta
    // ---------------------------------------------------------------------

    const currentScore = currentScores.get(objective.targetSubsystem);
    if (currentScore === undefined) {
      skippedCount++;
      continue;
    }

    const baselineScore =
      baselineScores.get(objective.targetSubsystem) ?? objective.currentScore;
    const scoreDelta = currentScore - baselineScore;
    const improved = scoreDelta >= config.minImprovementDelta;

    // ---------------------------------------------------------------------
    // Step 4 — Signal classification
    //
    // V1 never emits "deferred_recurrence". The four-way classification
    // based on completed + improved:
    //   completed + improved        → score_improvement
    //   completed + !improved       → completed_no_improvement
    //   !completed + improved       → no_action_improvement
    //   !completed + !improved      → no update (skip, counted as
    //                                 objectivesWithoutSignal in meta)
    // ---------------------------------------------------------------------

    if (!completed && !improved) {
      // No learnable signal — falls into objectivesWithoutSignal
      continue;
    }

    let signal: ObservationSignal;
    if (completed && improved) {
      signal = "score_improvement";
    } else if (completed && !improved) {
      signal = "completed_no_improvement";
    } else {
      // !completed && improved
      signal = "no_action_improvement";
    }

    // ---------------------------------------------------------------------
    // Step 6 — Confidence bounds (null guard)
    //
    // Checked before adjustment computation so we don't compute a value
    // that would be discarded. This objective counts as skipped.
    // ---------------------------------------------------------------------

    if (objective.confidence === null) {
      skippedCount++;
      continue;
    }

    // ---------------------------------------------------------------------
    // Step 5 — Adjustment computation
    // ---------------------------------------------------------------------

    let adjustment: number;
    switch (signal) {
      case "score_improvement":
        adjustment =
          config.maxPositiveAdjustment * Math.min(scoreDelta / 10, 1);
        break;
      case "completed_no_improvement":
        adjustment = -config.maxNegativeAdjustment;
        break;
      case "no_action_improvement":
        adjustment = 0;
        break;
      default: {
        // Exhaustiveness guard — deferred_recurrence is never emitted while
        // recurrenceLearningEnabled === false
        const _exhaustive: never = signal;
        void _exhaustive;
        adjustment = 0;
      }
    }

    // Clamp adjustment to [-maxNegativeAdjustment, +maxPositiveAdjustment]
    adjustment = clamp(
      adjustment,
      -config.maxNegativeAdjustment,
      config.maxPositiveAdjustment,
    );

    // ---------------------------------------------------------------------
    // Step 6 — Confidence bounds (apply adjustment)
    // ---------------------------------------------------------------------

    const resultingConfidence = clamp(
      objective.confidence + adjustment,
      config.minConfidence,
      config.maxConfidence,
    );

    const update: ConfidenceUpdate = {
      targetSubsystem: objective.targetSubsystem,
      mechanism: objective.mechanism,
      signal,
      scoreDelta,
      completed,
      urgencyScoreAtPlanning: objective.urgencyScore,
      adjustment: roundTo3(adjustment),
      resultingConfidence: roundTo3(resultingConfidence),
      sourceObjectiveId: objective.id,
      sourcePlanId: plan.planId,
      observedAt: generatedAt,
    };

    updates.push(update);
  }

  // -----------------------------------------------------------------------
  // Assemble meta
  // -----------------------------------------------------------------------

  const objectivesEvaluated = plan.objectives.length;
  const objectivesWithSignals = updates.length;
  const objectivesSkipped = skippedCount;
  const objectivesWithoutSignal =
    objectivesEvaluated - objectivesWithSignals - objectivesSkipped;

  // -----------------------------------------------------------------------
  // Compute summary
  // -----------------------------------------------------------------------

  const positiveUpdates = updates.filter((u) => u.adjustment > 0).length;
  const negativeUpdates = updates.filter((u) => u.adjustment < 0).length;
  const zeroAdjustmentUpdates = updates.filter(
    (u) => u.adjustment === 0,
  ).length;
  const averageAdjustment =
    updates.length > 0
      ? roundTo3(
          updates.reduce((sum, u) => sum + u.adjustment, 0) / updates.length,
        )
      : 0;

  // -----------------------------------------------------------------------
  // Compute mechanism adjustments
  // -----------------------------------------------------------------------

  const mechanismData = new Map<
    string,
    { mechanism: CausalMechanism; samples: number; totalAdjustment: number }
  >();

  for (const update of updates) {
    if (update.mechanism === null) continue;
    const mech = update.mechanism;
    const entry = mechanismData.get(mech);
    if (entry) {
      entry.samples++;
      entry.totalAdjustment += update.adjustment;
    } else {
      mechanismData.set(mech, {
        mechanism: mech,
        samples: 1,
        totalAdjustment: update.adjustment,
      });
    }
  }

  const mechanismAdjustments = Array.from(mechanismData.values())
    .map((entry) => ({
      mechanism: entry.mechanism,
      samples: entry.samples,
      averageAdjustment: roundTo3(entry.totalAdjustment / entry.samples),
    }))
    .sort((a, b) => b.samples - a.samples); // Most common mechanism first

  // -----------------------------------------------------------------------
  // Assemble model
  // -----------------------------------------------------------------------

  const modelId = "lrn-" + sanitizeTimestamp(generatedAt);

  return {
    schemaVersion: "p11.4.0",
    modelId,
    generatedAt,
    sourcePlanId: plan.planId,
    rootCauseAnalysisId: plan.rootCauseAnalysisId,
    correlationGraphId: plan.correlationGraphId,
    updates,
    meta: {
      primarySignal: "score_improvement",
      secondarySignal: "plan_completion",
      recurrenceLearningEnabled: false,
      objectivesEvaluated,
      objectivesWithSignals,
      objectivesSkipped,
      objectivesWithoutSignal,
      baselineTimestamp,
      evaluationTimestamp,
    },
    summary: {
      positiveUpdates,
      negativeUpdates,
      zeroAdjustmentUpdates,
      averageAdjustment,
    },
    mechanismAdjustments,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compare two LearningOutcomeRecords and return true if `b` is a "later"
 * outcome than `a`. Later means:
 *   - Later completedAt date (lexicographic ISO comparison)
 *   - If same completedAt or both undefined: later in array order (b wins)
 *   - If one has completedAt and the other doesn't: the one with a date wins
 */
function isLaterOutcome(
  a: LearningOutcomeRecord,
  b: LearningOutcomeRecord,
): boolean {
  if (b.completedAt && a.completedAt) {
    if (b.completedAt !== a.completedAt) {
      return b.completedAt > a.completedAt;
    }
    // Same completedAt — last in array order wins
    return true;
  }
  // One or both lack completedAt
  if (b.completedAt && !a.completedAt) return true; // b has date
  if (!b.completedAt && a.completedAt) return false; // a has date
  return true; // Both null — last in array wins
}

/**
 * Build an empty UpdatedConfidenceModel for plans with zero objectives.
 */
export function buildEmptyModel(
  plan: StrategicPlan,
  context: LearningObservationContext,
): UpdatedConfidenceModel {
  return {
    schemaVersion: "p11.4.0",
    modelId: "lrn-" + sanitizeTimestamp(context.generatedAt),
    generatedAt: context.generatedAt,
    sourcePlanId: plan.planId,
    rootCauseAnalysisId: plan.rootCauseAnalysisId,
    correlationGraphId: plan.correlationGraphId,
    updates: [],
    meta: {
      primarySignal: "score_improvement",
      secondarySignal: "plan_completion",
      recurrenceLearningEnabled: false,
      objectivesEvaluated: 0,
      objectivesWithSignals: 0,
      objectivesSkipped: 0,
      objectivesWithoutSignal: 0,
      baselineTimestamp: context.baselineTimestamp,
      evaluationTimestamp: context.evaluationTimestamp,
    },
    summary: {
      positiveUpdates: 0,
      negativeUpdates: 0,
      zeroAdjustmentUpdates: 0,
      averageAdjustment: 0,
    },
    mechanismAdjustments: [],
  };
}
