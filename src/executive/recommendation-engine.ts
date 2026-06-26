/**
 * P10.7a — Recommendation Engine.
 *
 * Pure function that turns a P10.6 TrendResult into actionable per-subsystem
 * recommendation drafts. Detects a small set of signals (degrading, improving,
 * persistent instability, low confidence) via lightweight heuristics, assigns a
 * severity and a bounded, two-decimal confidence, and returns them sorted.
 *
 * Read-only and side-effect-free: no disk, no proposals, no engine hooks.
 *
 * @module
 */

import type { TrendResult, SubsystemTrend } from "./learning-engine.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecommendationSignal =
  | "degrading_trend"
  | "persistent_instability"
  | "improving_trend"
  | "low_confidence";

export type RecommendationSeverity = "info" | "low" | "medium" | "high";

export interface RecommendationDraft {
  subsystem: string;
  signal: RecommendationSignal;
  severity: RecommendationSeverity;
  recommendation: string;
  confidence: number;
  occurrenceCount: number;
  averageDelta: number;
  evidenceReportIds?: string[];
}

export const RECOMMENDATION_OK = "ok";
export const RECOMMENDATION_INSUFFICIENT_DATA = "insufficient_data";

export interface RecommendationResult {
  recommendationStatus: typeof RECOMMENDATION_OK | typeof RECOMMENDATION_INSUFFICIENT_DATA;
  generatedAt: string;
  requestedWindow: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  subsystemRecommendations: RecommendationDraft[];
  warnings: string[];       // recommendation/analysis warnings
  loadWarnings: string[];   // corrupt or failed outcome-report loads from the CLI pipeline
}

// ---------------------------------------------------------------------------
// Threshold constants
// ---------------------------------------------------------------------------

const DELTA_DEGRADE = -1;        // averageDelta strictly less than this → degrading candidate
const DELTA_IMPROVE = 1;         // averageDelta strictly greater than this → improving candidate
const DELTA_HIGH_SEVERITY = -3;  // degrading_trend is "high" below this, else "medium"
const DEGRADATION_RATE_THRESHOLD = 0.3;
const SUCCESS_RATE_THRESHOLD = 0.5;
const MIXED_RATE_THRESHOLD = 0.4;
const LOW_CONFIDENCE_OCCURRENCE = 2;   // occurrenceCount <= this → low_confidence (precedence winner)
const INSTABILITY_MIN_OCCURRENCE = 3;  // persistent_instability requires this many occurrences

const CAP_HIGH = 0.95;   // degrading & improving confidence cap
const CAP_INSTABILITY = 0.9;
const CAP_LOW = 0.3;

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Compute actionable recommendation drafts from a P10.6 TrendResult.
 *
 * @param trends      Required. Signal detection reads subsystem trends and the
 *                    overall trend status. When `trendStatus` is
 *                    `"insufficient_data"`, the result mirrors it with empty
 *                    recommendations.
 * @param reports     Reserved for P10.7b evidence enrichment (exemplar report
 *                    IDs). Not read in P10.7a.
 * @param generatedAt Injectable timestamp for deterministic output; defaults to
 *                    `new Date().toISOString()`.
 */
export function computeRecommendations(
  trends: TrendResult,
  _reports?: ExecutiveOutcomeEvaluationReport[],
  generatedAt: string = new Date().toISOString(),
): RecommendationResult {
  const base = {
    generatedAt,
    requestedWindow: trends.requestedWindow,
    inputReportCount: trends.inputReportCount,
    analyzedReportCount: trends.analyzedReportCount,
    skippedReportCount: trends.skippedReportCount,
    loadWarnings: [...trends.loadWarnings],
    warnings: [] as string[],
  };

  if (trends.trendStatus === "insufficient_data") {
    return {
      ...base,
      recommendationStatus: RECOMMENDATION_INSUFFICIENT_DATA,
      subsystemRecommendations: [],
    };
  }

  const drafts: RecommendationDraft[] = [];
  for (const trend of trends.subsystemTrends) {
    const draft = classifySubsystem(trend);
    if (draft) drafts.push(draft);
  }

  drafts.sort(compareRecommendation);

  return {
    ...base,
    recommendationStatus: RECOMMENDATION_OK,
    subsystemRecommendations: drafts,
  };
}

// ---------------------------------------------------------------------------
// Classification (precedence: low_confidence → degrading → instability → improving → none)
// ---------------------------------------------------------------------------

function classifySubsystem(trend: SubsystemTrend): RecommendationDraft | null {
  const { subsystem, occurrenceCount, averageDelta, degradationRate, successRate, mixedRate } = trend;

  // 1. low_confidence — too little data to claim anything stronger
  if (occurrenceCount <= LOW_CONFIDENCE_OCCURRENCE) {
    return {
      subsystem,
      signal: "low_confidence",
      severity: "low",
      recommendation: `Collect more data on ${subsystem} before acting`,
      confidence: round2(Math.min(CAP_LOW, occurrenceCount * 0.1)),
      occurrenceCount,
      averageDelta,
    };
  }

  // 2. degrading_trend
  if (averageDelta < DELTA_DEGRADE && degradationRate > DEGRADATION_RATE_THRESHOLD) {
    const severity: RecommendationSeverity = averageDelta < DELTA_HIGH_SEVERITY ? "high" : "medium";
    return {
      subsystem,
      signal: "degrading_trend",
      severity,
      recommendation: severity === "high"
        ? `Investigate ${subsystem} regressions`
        : `Monitor ${subsystem} for continued degradation`,
      confidence: round2(Math.min(
        CAP_HIGH,
        Math.abs(averageDelta) * 0.15 + degradationRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 3. persistent_instability
  if (mixedRate > MIXED_RATE_THRESHOLD && occurrenceCount >= INSTABILITY_MIN_OCCURRENCE) {
    return {
      subsystem,
      signal: "persistent_instability",
      severity: "medium",
      recommendation: `Review ${subsystem} for stability improvements`,
      confidence: round2(Math.min(
        CAP_INSTABILITY,
        mixedRate * 0.5 + Math.min(occurrenceCount / 10, 0.3),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 4. improving_trend
  if (averageDelta > DELTA_IMPROVE && successRate > SUCCESS_RATE_THRESHOLD) {
    return {
      subsystem,
      signal: "improving_trend",
      severity: "info",
      recommendation: `Continue current ${subsystem} optimizations`,
      confidence: round2(Math.min(
        CAP_HIGH,
        averageDelta * 0.1 + successRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 5. no actionable signal
  return null;
}

// ---------------------------------------------------------------------------
// Sort + helpers
// ---------------------------------------------------------------------------

function compareRecommendation(a: RecommendationDraft, b: RecommendationDraft): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const aAbs = Math.abs(a.averageDelta);
  const bAbs = Math.abs(b.averageDelta);
  if (bAbs !== aAbs) return bAbs - aAbs;
  return a.subsystem.localeCompare(b.subsystem);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
