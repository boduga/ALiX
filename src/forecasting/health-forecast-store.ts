// src/forecasting/health-forecast-store.ts
//
// P11.5 — Append-only JSONL persistence store for HealthForecast objects.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  HealthForecast,
  HealthForecastSummary,
} from "./forecasting-types.js";
import { ForecasterError } from "./forecasting-types.js";

// Re-export for consumer convenience.
export type { HealthForecastSummary };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORECASTS_FILE = "health-forecasts.jsonl";

const VALID_SUBSYSTEMS = new Set([
  "memory",
  "workflow",
  "skills",
  "agents",
  "tools",
  "security",
  "governance",
  "adaptation",
]);

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class HealthForecastStore {
  constructor(private readonly dir: string) {}

  async save(forecast: HealthForecast): Promise<void> {
    validateForecast(forecast);

    const filePath = join(this.dir, FORECASTS_FILE);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    appendFileSync(filePath, JSON.stringify(forecast) + "\n", "utf-8");
  }

  async loadLatest(): Promise<HealthForecast | null> {
    const filePath = join(this.dir, FORECASTS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content
      .split("\n")
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) return null;

    try {
      const parsed = JSON.parse(lines[lines.length - 1]);
      return validateForecast(parsed);
    } catch {
      return null;
    }
  }

  async loadById(id: string): Promise<HealthForecast | null> {
    const filePath = join(this.dir, FORECASTS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.forecastId === id
        ) {
          return validateForecast(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return null;
  }

  async list(): Promise<HealthForecastSummary[]> {
    const filePath = join(this.dir, FORECASTS_FILE);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const summaries: HealthForecastSummary[] = [];

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        const forecast = validateForecast(parsed);
        summaries.push({
          forecastId: forecast.forecastId,
          generatedAt: forecast.generatedAt,
          sourceConfidenceModelId: forecast.sourceConfidenceModelId,
          sourcePlanId: forecast.sourcePlanId,
          subsystemsForecast: forecast.meta.subsystemsForecast,
          highConfidenceForecasts: forecast.meta.highConfidenceForecasts,
          mediumConfidenceForecasts: forecast.meta.mediumConfidenceForecasts,
          lowConfidenceForecasts: forecast.meta.lowConfidenceForecasts,
          forecastWindows: forecast.forecastWindows,
        });
      } catch {
        // Skip malformed lines
      }
    }

    return summaries;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateForecast(raw: unknown): HealthForecast {
  if (raw === null || typeof raw !== "object") {
    throw new ForecasterError("HealthForecast must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;

  // -- Schema version -----------------------------------
  if (obj.schemaVersion !== "p11.5.0") {
    throw new ForecasterError(
      `Invalid schemaVersion: expected "p11.5.0", got ${JSON.stringify(obj.schemaVersion)}`,
    );
  }

  // -- ID fields ---------------------------------------
  if (typeof obj.forecastId !== "string" || obj.forecastId.length === 0) {
    throw new ForecasterError("forecastId must be a non-empty string");
  }

  if (typeof obj.sourcePlanId !== "string" || obj.sourcePlanId.length === 0) {
    throw new ForecasterError("sourcePlanId must be a non-empty string");
  }

  if (typeof obj.rootCauseAnalysisId !== "string" || obj.rootCauseAnalysisId.length === 0) {
    throw new ForecasterError("rootCauseAnalysisId must be a non-empty string");
  }

  if (typeof obj.correlationGraphId !== "string" || obj.correlationGraphId.length === 0) {
    throw new ForecasterError("correlationGraphId must be a non-empty string");
  }

  // sourceConfidenceModelId is nullable
  if (
    obj.sourceConfidenceModelId !== null &&
    obj.sourceConfidenceModelId !== undefined &&
    (typeof obj.sourceConfidenceModelId !== "string" ||
      obj.sourceConfidenceModelId.length === 0)
  ) {
    throw new ForecasterError(
      "sourceConfidenceModelId must be null or a non-empty string",
    );
  }

  // -- Timestamp validation ----------------------------
  if (typeof obj.generatedAt !== "string" || !isValidIso(obj.generatedAt)) {
    throw new ForecasterError("generatedAt must be a valid ISO 8601 timestamp");
  }

  // -- forecastWindows & windowDurationMs --------------
  if (
    typeof obj.forecastWindows !== "number" ||
    obj.forecastWindows < 1 ||
    obj.forecastWindows > 3
  ) {
    throw new ForecasterError("forecastWindows must be between 1 and 3");
  }

  if (typeof obj.windowDurationMs !== "number" || obj.windowDurationMs <= 0) {
    throw new ForecasterError("windowDurationMs must be > 0");
  }

  // -- Projections array -------------------------------
  if (!Array.isArray(obj.projections)) {
    throw new ForecasterError("projections must be an array");
  }

  // Empty projections are valid
  const fw = obj.forecastWindows as number;

  for (let i = 0; i < obj.projections.length; i++) {
    const p = obj.projections[i];
    if (!p || typeof p !== "object") {
      throw new ForecasterError(`projections[${i}] must be a non-null object`);
    }

    const proj = p as Record<string, unknown>;

    if (!VALID_SUBSYSTEMS.has(String(proj.targetSubsystem))) {
      throw new ForecasterError(
        `projections[${i}].targetSubsystem must be a valid CorrelationSubsystemId`,
      );
    }

    if (typeof proj.currentScore !== "number" || proj.currentScore < 0 || proj.currentScore > 100) {
      throw new ForecasterError(
        `projections[${i}].currentScore must be between 0 and 100`,
      );
    }

    if (typeof proj.forecastConfidence !== "number" || proj.forecastConfidence < 0 || proj.forecastConfidence > 1) {
      throw new ForecasterError(
        `projections[${i}].forecastConfidence must be between 0 and 1`,
      );
    }

    if (typeof proj.observedDeltaPerWindow !== "number" || !Number.isFinite(proj.observedDeltaPerWindow as number)) {
      throw new ForecasterError(
        `projections[${i}].observedDeltaPerWindow must be a finite number`,
      );
    }

    if (typeof proj.observationCount !== "number" || proj.observationCount < 0) {
      throw new ForecasterError(
        `projections[${i}].observationCount must be >= 0`,
      );
    }

    if (typeof proj.hasActiveObjective !== "boolean") {
      throw new ForecasterError(
        `projections[${i}].hasActiveObjective must be a boolean`,
      );
    }

    if (
      !Array.isArray(proj.projectedScores) ||
      proj.projectedScores.length !== fw
    ) {
      throw new ForecasterError(
        `projections[${i}].projectedScores must be an array of length ${fw}`,
      );
    }

    if (!Array.isArray(proj.lowerBound) || proj.lowerBound.length !== fw) {
      throw new ForecasterError(
        `projections[${i}].lowerBound must be an array of length ${fw}`,
      );
    }

    if (!Array.isArray(proj.upperBound) || proj.upperBound.length !== fw) {
      throw new ForecasterError(
        `projections[${i}].upperBound must be an array of length ${fw}`,
      );
    }
  }

  return obj as unknown as HealthForecast;
}

function isValidIso(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}
