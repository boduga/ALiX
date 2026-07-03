// src/learning/learning-engine.ts
//
// P11.4 — LearningEngine orchestrator.
//
// Wires together StrategicPlanStore, LearningOutcomeStore,
// ScoreSnapshotProvider, and the pure buildConfidenceModel function:
//   load plan + outcomes + scores -> pure function -> save -> return

import type { StrategicPlan } from "../planning/planning-types.js";
import { StrategicPlanStore } from "../planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "./confidence-model-store.js";
import { buildConfidenceModel } from "./build-confidence-model.js";
import type { UpdatedConfidenceModel, LearningEngineConfig, LearningObservationContext } from "./learning-types.js";
import type { LearningOutcomeStore, ScoreSnapshotProvider } from "./learning-types.js";
import { LearningEngineError } from "./learning-types.js";
import { DEFAULT_LEARNING_CONFIG } from "./learning-config.js";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LearningEngine {
  constructor(
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly confidenceModelStore: ConfidenceModelStore,
    private readonly outcomeStore: LearningOutcomeStore,
    private readonly scoreSnapshotProvider: ScoreSnapshotProvider,
    private readonly config: LearningEngineConfig = DEFAULT_LEARNING_CONFIG,
  ) {}

  /**
   * Run the full learning pipeline:
   *   1. Load the latest StrategicPlan.
   *   2. Load outcome records and score snapshots.
   *   3. Compute UpdatedConfidenceModel via the pure function.
   *   4. Persist the model.
   *   5. Return the model.
   *
   * Throws LearningEngineError when no strategic plan is available.
   */
  async run(): Promise<UpdatedConfidenceModel> {
    const plan: StrategicPlan | null =
      await this.strategicPlanStore.loadLatest();

    if (plan === null) {
      throw new LearningEngineError(
        "No strategic plan available. Run 'alix executive strategic-plan' first.",
      );
    }

    if (plan.objectives.length === 0) {
      // Nothing to learn from — return empty model
      const generatedAt = new Date().toISOString();
      return {
        schemaVersion: "p11.4.0",
        modelId: "lrn-" + sanitizeTimestamp(generatedAt),
        generatedAt,
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
          baselineTimestamp: generatedAt,
          evaluationTimestamp: generatedAt,
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

    const outcomes = await this.outcomeStore.list();

    const baselineScores = await this.scoreSnapshotProvider.loadScoresAt(
      plan.generatedAt,
    );
    const currentScores = await this.scoreSnapshotProvider.loadCurrentScores();

    const generatedAt = new Date().toISOString();
    const context: LearningObservationContext = {
      generatedAt,
      baselineTimestamp: plan.generatedAt,
      evaluationTimestamp: generatedAt,
    };

    const model = buildConfidenceModel(
      plan,
      outcomes,
      baselineScores,
      currentScores,
      context,
      this.config,
    );

    await this.confidenceModelStore.save(model);

    return model;
  }

  /**
   * Load the most recently persisted confidence model.
   * Returns null when no model has been saved yet.
   */
  async loadLatestModel(): Promise<UpdatedConfidenceModel | null> {
    return this.confidenceModelStore.loadLatest();
  }
}

/**
 * Strip non-alphanumeric characters to produce a safe timestamp for IDs.
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[^a-zA-Z0-9]/g, "");
}
