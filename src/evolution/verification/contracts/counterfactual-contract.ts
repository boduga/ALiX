// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.3 — Counterfactual Evaluation Contract.
 *
 * Defines the counterfactual evaluation output types: the outcome
 * classification taxonomy and the per-metric evaluation structure.
 *
 * Classification is policy-independent — A2 determines behavioral
 * difference, A3 determines acceptability.
 *
 * @module counterfactual-contract
 */

import type { ConfidenceProfile } from "./confidence-contract.js";
import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Outcome Classification (Section 8.2)
// ---------------------------------------------------------------------------

/**
 * Per-metric outcome classification.
 *
 * - `improvement`: Projected behavior exceeds baseline within acceptance criteria.
 * - `neutral`: Projected behavior is statistically equivalent or within tolerance.
 * - `regression`: Projected behavior violates expected thresholds or degrades baseline.
 * - `insufficient`: Evidence coverage is insufficient to determine impact.
 *
 * @invariant Classification is policy-independent. A2 determines what changed;
 *            A3 determines whether the change is acceptable.
 */
export type OutcomeClassification =
  | "improvement"
  | "neutral"
  | "regression"
  | "insufficient";

export const OUTCOME_CLASSIFICATIONS: readonly OutcomeClassification[] = [
  "improvement",
  "neutral",
  "regression",
  "insufficient",
];

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

/**
 * Direction of a metric delta.
 *
 * - `higher_is_better`: Increases are improvements (e.g. success rate).
 * - `lower_is_better`: Decreases are improvements (e.g. latency).
 */
export type MetricDirection = "higher_is_better" | "lower_is_better";

// ---------------------------------------------------------------------------
// CounterfactualMetricEvaluation
// ---------------------------------------------------------------------------

/**
 * Per-metric counterfactual evaluation.
 */
export interface CounterfactualMetricEvaluation {
  /** Name of the metric. */
  metricName: string;
  /** Baseline value from historical replay. */
  baselineValue: number;
  /** Candidate value from projected replay. */
  candidateValue: number;
  /** Delta (candidate - baseline). */
  delta: number;
  /** Relative threshold used for classification. */
  threshold: number;
  /** Statistical confidence in the measurement (0–1, epistemic). */
  statisticalConfidence: number;
  /** Direction of the metric. */
  direction: MetricDirection;
  /** Outcome classification per Section 8.2. */
  classification: OutcomeClassification;
}

// ---------------------------------------------------------------------------
// CounterfactualEvaluation
// ---------------------------------------------------------------------------

/**
 * Counterfactual evaluation output (Section 8.1).
 *
 * The full comparison between baseline (historical reality) and candidate
 * (projected alternate reality).
 */
export interface CounterfactualEvaluation {
  /** Baseline metrics from historical replay. */
  baselineMetrics: Record<string, number>;
  /** Candidate metrics from projected replay. */
  candidateMetrics: Record<string, number>;
  /** Per-metric deltas (candidate - baseline). */
  metricDeltas: Record<string, number>;
  /** Descriptions of behavioural changes detected. */
  behavioralChanges: string[];
  /** Per-metric outcome classifications. */
  outcomeClassifications: CounterfactualMetricEvaluation[];
  /** Confidence profile for this evaluation. */
  confidenceProfile: ConfidenceProfile;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isInRange(v: number, min: number, max: number): boolean {
  return !Number.isNaN(v) && v >= min && v <= max;
}

export function isValidOutcomeClassification(v: string): v is OutcomeClassification {
  return (OUTCOME_CLASSIFICATIONS as readonly string[]).includes(v);
}

/**
 * Validate a CounterfactualMetricEvaluation structure.
 */
export function validateCounterfactualMetricEvaluation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["CounterfactualMetricEvaluation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.metricName)) errors.push("metricName required and must be non-empty");
  if (typeof v.baselineValue !== "number") errors.push("baselineValue required and must be a number");
  if (typeof v.candidateValue !== "number") errors.push("candidateValue required and must be a number");
  if (typeof v.delta !== "number") errors.push("delta required and must be a number");
  if (typeof v.threshold !== "number" || (v.threshold as number) < 0) {
    errors.push("threshold required and must be non-negative");
  }
  if (typeof v.statisticalConfidence !== "number" || !isInRange(v.statisticalConfidence as number, 0, 1)) {
    errors.push("statisticalConfidence required and must be between 0 and 1");
  }
  if (v.direction !== "higher_is_better" && v.direction !== "lower_is_better") {
    errors.push("direction must be 'higher_is_better' or 'lower_is_better'");
  }
  if (typeof v.classification !== "string" || !isValidOutcomeClassification(v.classification as string)) {
    errors.push(`classification must be one of: ${OUTCOME_CLASSIFICATIONS.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}
