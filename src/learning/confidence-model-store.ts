// src/learning/confidence-model-store.ts
//
// P11.4 — Append-only JSONL persistence store for UpdatedConfidenceModel objects.
//
// Provides save/load/list operations with on-read validation as the primary
// defense against corrupted JSONL data. Writes are validated before flush.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  UpdatedConfidenceModel,
  ConfidenceModelSummary,
  ObservationSignal,
} from "./learning-types.js";
import { LearningEngineError } from "./learning-types.js";

// Re-export for consumer convenience.
export type { ConfidenceModelSummary };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_OBSERVATION_SIGNALS: readonly ObservationSignal[] = [
  "score_improvement",
  "no_action_improvement",
  "completed_no_improvement",
  "deferred_recurrence",
] as const;

const CONFIDENCE_MODELS_FILE = "confidence-models.jsonl";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ConfidenceModelStore {
  constructor(private readonly dir: string) {}

  /**
   * Persist a validated confidence model to the JSONL store.
   * Validates before writing to catch programmer errors early.
   * Creates the storage directory if it does not exist.
   */
  async save(model: UpdatedConfidenceModel): Promise<void> {
    validateConfidenceModel(model);

    const filePath = join(this.dir, CONFIDENCE_MODELS_FILE);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    appendFileSync(filePath, JSON.stringify(model) + "\n", "utf-8");
  }

  /**
   * Load the most recently written confidence model from the store.
   * Returns null when the file does not exist, is empty, or the last
   * line fails validation.
   */
  async loadLatest(): Promise<UpdatedConfidenceModel | null> {
    const filePath = join(this.dir, CONFIDENCE_MODELS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content
      .split("\n")
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) return null;

    try {
      const parsed = JSON.parse(lines[lines.length - 1]);
      return validateConfidenceModel(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Find the first confidence model whose modelId matches the given id.
   * Silently skips blank and malformed lines.  Returns null when no
   * match exists.
   */
  async loadById(id: string): Promise<UpdatedConfidenceModel | null> {
    const filePath = join(this.dir, CONFIDENCE_MODELS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && parsed.modelId === id) {
          return validateConfidenceModel(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return null;
  }

  /**
   * Return metadata summaries for every confidence model in the store,
   * in write order.  Returns an empty array when the file does not exist
   * or contains no valid entries.  Malformed lines are silently skipped.
   */
  async list(): Promise<ConfidenceModelSummary[]> {
    const filePath = join(this.dir, CONFIDENCE_MODELS_FILE);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const summaries: ConfidenceModelSummary[] = [];

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        const model = validateConfidenceModel(parsed);
        summaries.push({
          modelId: model.modelId,
          generatedAt: model.generatedAt,
          sourcePlanId: model.sourcePlanId,
          objectivesEvaluated: model.meta.objectivesEvaluated,
          objectivesWithSignals: model.meta.objectivesWithSignals,
          objectivesSkipped: model.meta.objectivesSkipped,
          objectivesWithoutSignal: model.meta.objectivesWithoutSignal,
          updates: model.updates.length,
          positiveUpdates: model.summary.positiveUpdates,
          negativeUpdates: model.summary.negativeUpdates,
          zeroAdjustmentUpdates: model.summary.zeroAdjustmentUpdates,
        });
      } catch {
        // Skip malformed or invalid lines
      }
    }

    return summaries;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value as a well-formed UpdatedConfidenceModel.
 *
 * Throws LearningEngineError with a descriptive message on every
 * violation (fail-closed).  Used on both reads (defence against
 * corrupted JSONL) and writes (defence against programmer error).
 */
export function validateConfidenceModel(raw: unknown): UpdatedConfidenceModel {
  if (raw === null || typeof raw !== "object") {
    throw new LearningEngineError(
      "UpdatedConfidenceModel must be a non-null object",
    );
  }

  const obj = raw as Record<string, unknown>;

  // -- Model-level fields ------------------------------------------------

  if (obj.schemaVersion !== "p11.4.0") {
    throw new LearningEngineError(
      `Invalid schemaVersion: expected "p11.4.0", got ${JSON.stringify(obj.schemaVersion)}`,
    );
  }

  if (typeof obj.modelId !== "string" || obj.modelId.length === 0) {
    throw new LearningEngineError("modelId must be a non-empty string");
  }

  if (typeof obj.generatedAt !== "string" || obj.generatedAt.length === 0) {
    throw new LearningEngineError("generatedAt must be a non-empty string");
  }

  if (typeof obj.sourcePlanId !== "string" || obj.sourcePlanId.length === 0) {
    throw new LearningEngineError("sourcePlanId must be a non-empty string");
  }

  if (
    typeof obj.rootCauseAnalysisId !== "string" ||
    obj.rootCauseAnalysisId.length === 0
  ) {
    throw new LearningEngineError(
      "rootCauseAnalysisId must be a non-empty string",
    );
  }

  if (
    typeof obj.correlationGraphId !== "string" ||
    obj.correlationGraphId.length === 0
  ) {
    throw new LearningEngineError(
      "correlationGraphId must be a non-empty string",
    );
  }

  // -- updates array ----------------------------------------------------

  if (!Array.isArray(obj.updates)) {
    throw new LearningEngineError("updates must be an array");
  }

  for (let i = 0; i < obj.updates.length; i++) {
    const u = obj.updates[i];

    if (!u || typeof u !== "object") {
      throw new LearningEngineError(
        `updates[${i}] must be a non-null object`,
      );
    }

    const update = u as Record<string, unknown>;

    if (
      typeof update.targetSubsystem !== "string" ||
      update.targetSubsystem.length === 0
    ) {
      throw new LearningEngineError(
        `updates[${i}].targetSubsystem must be a non-empty string`,
      );
    }

    if (
      typeof update.sourceObjectiveId !== "string" ||
      update.sourceObjectiveId.length === 0
    ) {
      throw new LearningEngineError(
        `updates[${i}].sourceObjectiveId must be a non-empty string`,
      );
    }

    if (
      typeof update.sourcePlanId !== "string" ||
      update.sourcePlanId.length === 0
    ) {
      throw new LearningEngineError(
        `updates[${i}].sourcePlanId must be a non-empty string`,
      );
    }

    if (
      typeof update.observedAt !== "string" ||
      update.observedAt.length === 0
    ) {
      throw new LearningEngineError(
        `updates[${i}].observedAt must be a non-empty string`,
      );
    }

    if (!VALID_OBSERVATION_SIGNALS.includes(update.signal as ObservationSignal)) {
      throw new LearningEngineError(
        `updates[${i}].signal must be one of ${VALID_OBSERVATION_SIGNALS.join(", ")}, got ${JSON.stringify(update.signal)}`,
      );
    }

    if (
      typeof update.adjustment !== "number" ||
      (update.adjustment as number) < -0.05 ||
      (update.adjustment as number) > 0.05
    ) {
      throw new LearningEngineError(
        `updates[${i}].adjustment must be a number within [-0.05, 0.05]`,
      );
    }

    if (
      typeof update.resultingConfidence !== "number" ||
      (update.resultingConfidence as number) < 0.05 ||
      (update.resultingConfidence as number) > 0.95
    ) {
      throw new LearningEngineError(
        `updates[${i}].resultingConfidence must be a number within [0.05, 0.95]`,
      );
    }
  }

  // -- meta -------------------------------------------------------------

  if (!obj.meta || typeof obj.meta !== "object") {
    throw new LearningEngineError("meta must be a non-null object");
  }

  const meta = obj.meta as Record<string, unknown>;

  if (meta.recurrenceLearningEnabled !== false) {
    throw new LearningEngineError(
      "meta.recurrenceLearningEnabled must be false",
    );
  }

  if (
    typeof meta.baselineTimestamp !== "string" ||
    meta.baselineTimestamp.length === 0
  ) {
    throw new LearningEngineError(
      "meta.baselineTimestamp must be a non-empty string",
    );
  }

  if (
    typeof meta.evaluationTimestamp !== "string" ||
    meta.evaluationTimestamp.length === 0
  ) {
    throw new LearningEngineError(
      "meta.evaluationTimestamp must be a non-empty string",
    );
  }

  // -- summary ----------------------------------------------------------

  if (!obj.summary || typeof obj.summary !== "object") {
    throw new LearningEngineError("summary must be a non-null object");
  }

  const summary = obj.summary as Record<string, unknown>;

  // -- Cross-field consistency checks -----------------------------------

  // No update uses signal "deferred_recurrence"
  for (let i = 0; i < obj.updates.length; i++) {
    const update = obj.updates[i] as Record<string, unknown>;
    if (update.signal === "deferred_recurrence") {
      throw new LearningEngineError(
        `updates[${i}].signal must not be "deferred_recurrence" while recurrenceLearningEnabled is false`,
      );
    }
  }

  // Every update.sourcePlanId === model.sourcePlanId
  for (let i = 0; i < obj.updates.length; i++) {
    const update = obj.updates[i] as Record<string, unknown>;
    if (update.sourcePlanId !== obj.sourcePlanId) {
      throw new LearningEngineError(
        `updates[${i}].sourcePlanId must equal model sourcePlanId (${JSON.stringify(obj.sourcePlanId)}), got ${JSON.stringify(update.sourcePlanId)}`,
      );
    }
  }

  // summary.positiveUpdates + summary.negativeUpdates + summary.zeroAdjustmentUpdates === updates.length
  const positiveUpdates =
    typeof summary.positiveUpdates === "number" ? summary.positiveUpdates : 0;
  const negativeUpdates =
    typeof summary.negativeUpdates === "number" ? summary.negativeUpdates : 0;
  const zeroAdjustmentUpdates =
    typeof summary.zeroAdjustmentUpdates === "number"
      ? summary.zeroAdjustmentUpdates
      : 0;

  if (positiveUpdates + negativeUpdates + zeroAdjustmentUpdates !== obj.updates.length) {
    throw new LearningEngineError(
      `summary.positiveUpdates (${positiveUpdates}) + summary.negativeUpdates (${negativeUpdates}) + summary.zeroAdjustmentUpdates (${zeroAdjustmentUpdates}) must equal updates.length (${obj.updates.length})`,
    );
  }

  // meta.objectivesWithSignals === updates.length
  const objectivesWithSignals =
    typeof meta.objectivesWithSignals === "number"
      ? meta.objectivesWithSignals
      : 0;
  if (objectivesWithSignals !== obj.updates.length) {
    throw new LearningEngineError(
      `meta.objectivesWithSignals (${objectivesWithSignals}) must equal updates.length (${obj.updates.length})`,
    );
  }

  // meta.objectivesEvaluated >= meta.objectivesWithSignals + meta.objectivesSkipped
  const objectivesEvaluated =
    typeof meta.objectivesEvaluated === "number"
      ? meta.objectivesEvaluated
      : 0;
  const objectivesSkipped =
    typeof meta.objectivesSkipped === "number" ? meta.objectivesSkipped : 0;
  if (objectivesEvaluated < objectivesWithSignals + objectivesSkipped) {
    throw new LearningEngineError(
      `meta.objectivesEvaluated (${objectivesEvaluated}) must be >= meta.objectivesWithSignals (${objectivesWithSignals}) + meta.objectivesSkipped (${objectivesSkipped}) (${objectivesWithSignals + objectivesSkipped})`,
    );
  }

  // All adjustment/resultingConfidence values are finite numbers
  for (let i = 0; i < obj.updates.length; i++) {
    const update = obj.updates[i] as Record<string, unknown>;
    if (
      typeof update.adjustment !== "number" ||
      !Number.isFinite(update.adjustment as number)
    ) {
      throw new LearningEngineError(
        `updates[${i}].adjustment must be a finite number`,
      );
    }
    if (
      typeof update.resultingConfidence !== "number" ||
      !Number.isFinite(update.resultingConfidence as number)
    ) {
      throw new LearningEngineError(
        `updates[${i}].resultingConfidence must be a finite number`,
      );
    }
  }

  return obj as unknown as UpdatedConfidenceModel;
}
