/**
 * P11.4 — Executive confidence-model CLI handler.
 *
 * Handles `alix executive confidence-model [--json] [--latest]`.
 * Runs the LearningEngine to produce an UpdatedConfidenceModel and displays
 * a summary or full JSON output. The `--latest` flag loads the last saved
 * model without re-running.
 *
 * @module
 */

import { join } from "node:path";
import { StrategicPlanStore } from "../../planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "../../learning/confidence-model-store.js";
import { LearningEngine } from "../../learning/learning-engine.js";
import { DEFAULT_LEARNING_CONFIG } from "../../learning/learning-config.js";
import type { UpdatedConfidenceModel } from "../../learning/learning-types.js";
import { LearningEngineError } from "../../learning/learning-types.js";
import type { LearningOutcomeRecord, LearningOutcomeStore } from "../../learning/learning-types.js";
import type { ScoreSnapshotProvider } from "../../learning/learning-types.js";
import type { CorrelationSubsystemId } from "../../correlation/correlation-types.js";

export async function handleConfidenceModelCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const planningDir = join(cwd, ".alix", "planning");
  const learningDir = join(cwd, ".alix", "learning");
  const isJson = args.includes("--json");
  const isLatest = args.includes("--latest");

  try {
    if (isLatest) {
      const store = new ConfidenceModelStore(learningDir);
      const model = await store.loadLatest();
      if (!model) { console.log("No saved confidence model found."); return; }
      printSummary(model, isJson);
      return;
    }

    const strategicPlanStore = new StrategicPlanStore(planningDir);
    const confidenceModelStore = new ConfidenceModelStore(learningDir);
    const outcomeStore: LearningOutcomeStore = {
      list: async () => [] as LearningOutcomeRecord[],
    };
    const scoreSnapshotProvider: ScoreSnapshotProvider = {
      loadScoresAt: async () => new Map<CorrelationSubsystemId, number>(),
      loadCurrentScores: async () => new Map<CorrelationSubsystemId, number>(),
    };

    const engine = new LearningEngine(
      strategicPlanStore,
      confidenceModelStore,
      outcomeStore,
      scoreSnapshotProvider,
      DEFAULT_LEARNING_CONFIG,
    );
    const model = await engine.run();
    printSummary(model, isJson);
  } catch (err: unknown) {
    if (err instanceof LearningEngineError) {
      console.error(`Learning engine error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Learning error: ${err.message}`);
    } else {
      console.error("Unknown learning error");
    }
    process.exit(1);
  }
}

function printSummary(model: UpdatedConfidenceModel, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(model, null, 2));
    return;
  }
  console.log(`Confidence Model`);
  console.log(`Model: ${model.modelId}`);
  console.log(`Source plan: ${model.sourcePlanId}`);
  console.log(`Objectives evaluated: ${model.meta.objectivesEvaluated}`);
  console.log(`Signals: score_improvement (primary), completed (secondary)`);

  if (model.updates.length > 0) {
    console.log();
    console.log(`${"Target subsystem".padEnd(18)} ${"Score Δ".padEnd(8)} ${"Completed".padEnd(10)} ${"Signal".padEnd(30)} ${"Adjustment".padEnd(12)}`);
    console.log(`${"".padEnd(18, "-")} ${"".padEnd(8, "-")} ${"".padEnd(10, "-")} ${"".padEnd(30, "-")} ${"".padEnd(12, "-")}`);
    for (const u of model.updates) {
      const completed = u.completed ? "yes" : "no";
      console.log(
        `${u.targetSubsystem.padEnd(18)} ` +
        `${String(u.scoreDelta).padEnd(8)} ` +
        `${completed.padEnd(10)} ` +
        `${u.signal.padEnd(30)} ` +
        `${String(u.adjustment).padEnd(12)}`,
      );
    }
  }

  if (model.meta.objectivesEvaluated === 0) {
    console.log(`\nNote: No objectives evaluated. Run 'alix executive strategic-plan' to produce a plan first.`);
  } else if (model.updates.length === 0) {
    console.log(`\nNote: No learnable signals from current data.`);
  }
}
