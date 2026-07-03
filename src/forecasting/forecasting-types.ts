// src/forecasting/forecasting-types.ts
//
// P11.5 — Forecasting Engine type definitions.
//
// Consumes StrategicPlan (P11.3), UpdatedConfidenceModel (P11.4),
// and historical score snapshots; produces HealthForecast —
// per-subsystem projected health scores with confidence intervals.
//
// All types are deterministic. No LLM, no probabilistic inference.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";

// ---------------------------------------------------------------------------
// ScoreProjection
// ---------------------------------------------------------------------------

export interface ScoreProjection {
  /** The subsystem being forecast. */
  targetSubsystem: CorrelationSubsystemId;
  /** Current health score at forecast time. */
  currentScore: number;
  /** Whether a planning objective targets this subsystem. */
  hasActiveObjective: boolean;
  /**
   * Projected score for each forward window.
   * Index 0 = next window (W1), 1 = second forward window (W2), etc.
   */
  projectedScores: number[];
  /**
   * Lower bound of the confidence interval per window.
   * Aligned with projectedScores.
   */
  lowerBound: number[];
  /**
   * Upper bound of the confidence interval per window.
   * Aligned with projectedScores.
   */
  upperBound: number[];
  /**
   * The confidence value used for this subsystem's forecast.
   * Derived from UpdatedConfidenceModel if available, else 0.5.
   */
  forecastConfidence: number;
  /**
   * Observed average score delta per window (used as trend basis).
   */
  observedDeltaPerWindow: number;
  /**
   * Number of historical data points used to compute the trend.
   */
  observationCount: number;
}

// ---------------------------------------------------------------------------
// HealthForecast
// ---------------------------------------------------------------------------

export interface HealthForecast {
  schemaVersion: "p11.5.0";
  /** Unique forecast ID, e.g. `forecast-{safeTimestamp}`. */
  forecastId: string;
  generatedAt: string;
  /** Links to the source confidence model that shaped this forecast. */
  sourceConfidenceModelId: string | null;
  /** Links to the source plan for traceability. */
  sourcePlanId: string;
  /** Propagated for P11 chain traceability. */
  rootCauseAnalysisId: string;
  /** Propagated for P11 chain traceability. */
  correlationGraphId: string;
  /** Per-subsystem projections, one entry per evaluated subsystem. */
  projections: ScoreProjection[];
  /**
   * Number of forward windows projected.
   * Default: 3. Validated [1, 3].
   */
  forecastWindows: number;
  /** Window duration in milliseconds (from ForecastingEngineConfig). */
  windowDurationMs: number;
  meta: {
    /** Number of subsystems with forecasts. */
    subsystemsForecast: number;
    highConfidenceForecasts: number;
    mediumConfidenceForecasts: number;
    lowConfidenceForecasts: number;
    /** Number of historical windows used for trend computation. */
    trendWindow: number;
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ForecastingEngineConfig {
  forecastWindows: number;
  trendWindow: number;
  dampeningFactor: number;
  windowDurationMs: number;
  highConfidenceThreshold: number;
  mediumConfidenceThreshold: number;
}

// ---------------------------------------------------------------------------
// Context (injected for determinism)
// ---------------------------------------------------------------------------

export interface ForecastingObservationContext {
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface HealthForecastSummary {
  forecastId: string;
  generatedAt: string;
  sourceConfidenceModelId: string | null;
  sourcePlanId: string;
  subsystemsForecast: number;
  highConfidenceForecasts: number;
  mediumConfidenceForecasts: number;
  lowConfidenceForecasts: number;
  forecastWindows: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ForecasterError extends Error {
  readonly code = "FORECASTER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ForecasterError";
  }
}
