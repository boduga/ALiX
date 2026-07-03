// src/forecasting/build-health-forecast.ts
//
// P11.5 — Pure function that transforms plan + confidence model +
// score history into a HealthForecast with per-subsystem projections.
//
// Pure function — no I/O, no side effects, no Date.now(), no Math.random().
// Fully deterministic.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type { StrategicPlan } from "../planning/planning-types.js";
import type { UpdatedConfidenceModel } from "../learning/learning-types.js";
import type {
  HealthForecast,
  ScoreProjection,
  ForecastingEngineConfig,
  ForecastingObservationContext,
} from "./forecasting-types.js";
import { ForecasterError } from "./forecasting-types.js";
import { DEFAULT_FORECASTING_CONFIG } from "./forecasting-config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PLAN_SCHEMA = "p11.3.0";
const DEFAULT_MEAN_SCORE = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[^a-zA-Z0-9]/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isValidIso(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

function validateConfig(config: ForecastingEngineConfig): void {
  if (
    typeof config.forecastWindows !== "number" ||
    !Number.isFinite(config.forecastWindows) ||
    config.forecastWindows < 1 ||
    config.forecastWindows > 3
  ) {
    throw new ForecasterError(
      `forecastWindows must be between 1 and 3, got ${config.forecastWindows}`,
    );
  }
  if (
    typeof config.trendWindow !== "number" ||
    config.trendWindow < 2
  ) {
    throw new ForecasterError(
      `trendWindow must be >= 2, got ${config.trendWindow}`,
    );
  }
  if (
    typeof config.dampeningFactor !== "number" ||
    config.dampeningFactor < 0 ||
    config.dampeningFactor > 1
  ) {
    throw new ForecasterError(
      `dampeningFactor must be between 0 and 1, got ${config.dampeningFactor}`,
    );
  }
  if (
    typeof config.windowDurationMs !== "number" ||
    config.windowDurationMs <= 0
  ) {
    throw new ForecasterError(
      `windowDurationMs must be > 0, got ${config.windowDurationMs}`,
    );
  }
  if (
    typeof config.highConfidenceThreshold !== "number" ||
    typeof config.mediumConfidenceThreshold !== "number" ||
    config.highConfidenceThreshold <= config.mediumConfidenceThreshold ||
    config.highConfidenceThreshold < 0 ||
    config.highConfidenceThreshold > 1 ||
    config.mediumConfidenceThreshold < 0 ||
    config.mediumConfidenceThreshold > 1
  ) {
    throw new ForecasterError(
      `Confidence thresholds must be 0-1 with highConfidenceThreshold > mediumConfidenceThreshold`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function buildHealthForecast(
  plan: StrategicPlan,
  confidenceModel: UpdatedConfidenceModel | null,
  scoreHistory: Map<CorrelationSubsystemId, number[]>,
  currentScores: Map<CorrelationSubsystemId, number>,
  context: ForecastingObservationContext,
  config: ForecastingEngineConfig = DEFAULT_FORECASTING_CONFIG,
): HealthForecast {
  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  if (plan.schemaVersion !== VALID_PLAN_SCHEMA) {
    throw new ForecasterError(
      `Invalid plan schema version: expected "${VALID_PLAN_SCHEMA}", got "${plan.schemaVersion}"`,
    );
  }

  if (!plan.planId || !plan.generatedAt) {
    throw new ForecasterError("Plan must have non-empty planId and generatedAt");
  }

  if (!isValidIso(context.generatedAt)) {
    throw new ForecasterError(
      `context.generatedAt must be a valid ISO 8601 timestamp, got "${context.generatedAt}"`,
    );
  }

  validateConfig(config);

  // Handle model/plan mismatch: ignore confidence model if it doesn't match
  if (
    confidenceModel !== null &&
    confidenceModel.sourcePlanId !== plan.planId
  ) {
    console.warn(
      `Confidence model "${confidenceModel.modelId}" (plan: ${confidenceModel.sourcePlanId}) does not match current plan "${plan.planId}" — using default confidence 0.5`,
    );
  }
  const effectiveConfidenceModel =
    confidenceModel?.sourcePlanId === plan.planId ? confidenceModel : null;

  // -----------------------------------------------------------------------
  // Step 1 — Collect subsystems and resolve current scores
  // -----------------------------------------------------------------------

  const subsystemSet = new Set<CorrelationSubsystemId>();

  // From plan objectives
  for (const obj of plan.objectives) {
    subsystemSet.add(obj.targetSubsystem);
  }

  // From confidence model updates
  if (effectiveConfidenceModel) {
    for (const update of effectiveConfidenceModel.updates) {
      subsystemSet.add(update.targetSubsystem);
    }
  }

  // From current scores
  for (const key of currentScores.keys()) {
    subsystemSet.add(key);
  }

  // Build current score lookup with fallback chain
  const subsystemCurrentScores = new Map<CorrelationSubsystemId, number>();
  const subsystemHasActiveObjective = new Set<CorrelationSubsystemId>();

  for (const obj of plan.objectives) {
    subsystemHasActiveObjective.add(obj.targetSubsystem);
  }

  for (const subsystem of subsystemSet) {
    // currentScores -> scoreHistory last -> active plan objective.currentScore -> skip
    if (currentScores.has(subsystem)) {
      subsystemCurrentScores.set(subsystem, currentScores.get(subsystem)!);
      continue;
    }

    const history = scoreHistory.get(subsystem);
    if (history && history.length > 0) {
      subsystemCurrentScores.set(subsystem, history[history.length - 1]);
      continue;
    }

    const activeObj = plan.objectives.find(
      (o) => o.targetSubsystem === subsystem,
    );
    if (activeObj !== undefined) {
      subsystemCurrentScores.set(subsystem, activeObj.currentScore);
      continue;
    }

    // No current score available — skip this subsystem
  }

  if (subsystemCurrentScores.size === 0) {
    // No subsystems to forecast
    return buildEmptyForecast(plan, effectiveConfidenceModel, context, config);
  }

  // -----------------------------------------------------------------------
  // Step 2 — Compute trend per subsystem
  // -----------------------------------------------------------------------

  interface TrendData {
    deltaPerWindow: number;
    observationCount: number;
  }

  const trendData = new Map<CorrelationSubsystemId, TrendData>();

  for (const subsystem of subsystemCurrentScores.keys()) {
    const rawHistory = scoreHistory.get(subsystem) ?? [];
    // Slice to last trendWindow entries
    const history = rawHistory.slice(-config.trendWindow);

    let deltaPerWindow = 0;
    const obsCount = history.length;

    if (history.length >= 2) {
      const totalDelta = history[history.length - 1] - history[0];
      deltaPerWindow = totalDelta / (history.length - 1);
    }

    trendData.set(subsystem, { deltaPerWindow, observationCount: obsCount });
  }

  // -----------------------------------------------------------------------
  // Step 3 — Determine forecast confidence per subsystem
  // -----------------------------------------------------------------------

  const forecastConfidence = new Map<CorrelationSubsystemId, number>();

  for (const subsystem of subsystemCurrentScores.keys()) {
    if (effectiveConfidenceModel) {
      const matching = effectiveConfidenceModel.updates.filter(
        (u) => u.targetSubsystem === subsystem,
      );
      if (matching.length > 0) {
        const valid = matching.filter((u) =>
          Number.isFinite(u.resultingConfidence),
        );
        const avg =
          valid.length > 0
            ? valid.reduce((sum, u) => sum + u.resultingConfidence, 0) /
              valid.length
            : 0.5;
        forecastConfidence.set(subsystem, roundTo3(avg));
        continue;
      }
    }
    // Default confidence
    forecastConfidence.set(subsystem, 0.5);
  }

  // -----------------------------------------------------------------------
  // Step 4-5 — Project scores and compute confidence intervals
  // -----------------------------------------------------------------------

  const projections: ScoreProjection[] = [];

  for (const subsystem of subsystemCurrentScores.keys()) {
    const currentScore = subsystemCurrentScores.get(subsystem)!;
    const trend = trendData.get(subsystem)!;
    const fc = forecastConfidence.get(subsystem)!;
    const activeObj = subsystemHasActiveObjective.has(subsystem);

    const projectedScores: number[] = [];
    const lowerBounds: number[] = [];
    const upperBounds: number[] = [];

    const spread = (1 - fc) * 15;

    for (let w = 0; w < config.forecastWindows; w++) {
      // Base projection from trend
      const baseProjected = currentScore + trend.deltaPerWindow * (w + 1);

      // Dampening toward mean score
      const dampFactor = (config.dampeningFactor * (w + 1)) / config.forecastWindows;
      const projected = clamp(
        baseProjected * (1 - dampFactor) +
          DEFAULT_MEAN_SCORE * dampFactor,
        0,
        100,
      );

      projectedScores.push(projected);

      // Confidence interval — grows with each forward window
      const intervalSpread = spread * (1 + w * 0.2);
      lowerBounds.push(clamp(projected - intervalSpread, 0, 100));
      upperBounds.push(clamp(projected + intervalSpread, 0, 100));
    }

    projections.push({
      targetSubsystem: subsystem,
      currentScore,
      hasActiveObjective: activeObj,
      projectedScores,
      lowerBound: lowerBounds,
      upperBound: upperBounds,
      forecastConfidence: fc,
      observedDeltaPerWindow: roundTo3(trend.deltaPerWindow),
      observationCount: trend.observationCount,
    });
  }

  // -----------------------------------------------------------------------
  // Step 6 — Build meta and return
  // -----------------------------------------------------------------------

  return {
    schemaVersion: "p11.5.0",
    forecastId: "forecast-" + sanitizeTimestamp(context.generatedAt),
    generatedAt: context.generatedAt,
    sourceConfidenceModelId: effectiveConfidenceModel?.modelId ?? null,
    sourcePlanId: plan.planId,
    rootCauseAnalysisId: plan.rootCauseAnalysisId,
    correlationGraphId: plan.correlationGraphId,
    projections,
    forecastWindows: config.forecastWindows,
    windowDurationMs: config.windowDurationMs,
    meta: {
      subsystemsForecast: projections.length,
      highConfidenceForecasts: projections.filter(
        (p) =>
          Number.isFinite(p.forecastConfidence) &&
          p.forecastConfidence >= config.highConfidenceThreshold,
      ).length,
      mediumConfidenceForecasts: projections.filter(
        (p) =>
          Number.isFinite(p.forecastConfidence) &&
          p.forecastConfidence >= config.mediumConfidenceThreshold &&
          p.forecastConfidence < config.highConfidenceThreshold,
      ).length,
      lowConfidenceForecasts: projections.filter(
        (p) =>
          Number.isFinite(p.forecastConfidence) &&
          p.forecastConfidence < config.mediumConfidenceThreshold,
      ).length,
      trendWindow: config.trendWindow,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildEmptyForecast(
  plan: StrategicPlan,
  effectiveConfidenceModel: UpdatedConfidenceModel | null,
  context: ForecastingObservationContext,
  config: ForecastingEngineConfig,
): HealthForecast {
  return {
    schemaVersion: "p11.5.0",
    forecastId: "forecast-" + sanitizeTimestamp(context.generatedAt),
    generatedAt: context.generatedAt,
    sourceConfidenceModelId: effectiveConfidenceModel?.modelId ?? null,
    sourcePlanId: plan.planId,
    rootCauseAnalysisId: plan.rootCauseAnalysisId,
    correlationGraphId: plan.correlationGraphId,
    projections: [],
    forecastWindows: config.forecastWindows,
    windowDurationMs: config.windowDurationMs,
    meta: {
      subsystemsForecast: 0,
      highConfidenceForecasts: 0,
      mediumConfidenceForecasts: 0,
      lowConfidenceForecasts: 0,
      trendWindow: config.trendWindow,
    },
  };
}
