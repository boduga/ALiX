// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.3 — Counterfactual Evaluator.
 *
 * Compares historical baseline against candidate projection and produces
 * a structured CounterfactualEvaluation with per-metric outcome
 * classifications.
 *
 * Classification is policy-independent — the evaluator determines what
 * changed, not whether the change is acceptable. The word "acceptable"
 * never appears here.
 *
 * @module counterfactual-evaluator
 */

import type { ConfidenceProfile } from "../contracts/confidence-contract.js";
import type {
  CounterfactualEvaluation,
  CounterfactualMetricEvaluation,
  OutcomeClassification,
  MetricDirection,
} from "../contracts/counterfactual-contract.js";

// ---------------------------------------------------------------------------
// CounterfactualEvaluatorConfig
// ---------------------------------------------------------------------------

export interface CounterfactualEvaluatorConfig {
  /**
   * Relative change (as a fraction of baseline) above which a metric is
   * considered significantly improved or regressed. E.g. 0.05 = 5%.
   */
  significanceThreshold: number;
  /**
   * Minimum statistical confidence below which a metric is classified
   * as `insufficient` regardless of delta magnitude.
   */
  minimumConfidence: number;
  /**
   * Per-metric direction overrides. If a metric is not listed, defaults
   * to "higher_is_better".
   */
  metricDirections?: Record<string, MetricDirection>;
  /**
   * Per-metric significance threshold overrides.
   */
  metricThresholds?: Record<string, number>;
}

export const DEFAULT_COUNTERFACTUAL_CONFIG: CounterfactualEvaluatorConfig = {
  significanceThreshold: 0.05,
  minimumConfidence: 0.3,
};

// ---------------------------------------------------------------------------
// CounterfactualEvaluator
// ---------------------------------------------------------------------------

/**
 * Counterfactual comparison engine.
 *
 * @invariant Policy-independent — determines behavioral difference only.
 * @invariant Every metric in the union of baseline and candidate keys
 *            receives an outcome classification.
 * @invariant Pure — no side effects, no I/O.
 */
export class CounterfactualEvaluator {
  private readonly config: CounterfactualEvaluatorConfig;

  constructor(config?: Partial<CounterfactualEvaluatorConfig>) {
    this.config = { ...DEFAULT_COUNTERFACTUAL_CONFIG, ...config };
  }

  /**
   * Compare historical baseline against candidate projection.
   *
   * @param baselineMetrics - Metrics from historical replay.
   * @param candidateMetrics - Metrics from projected replay.
   * @param confidenceProfile - Confidence profile for this evaluation.
   * @returns Fully populated CounterfactualEvaluation.
   */
  evaluate(
    baselineMetrics: Record<string, number>,
    candidateMetrics: Record<string, number>,
    confidenceProfile: ConfidenceProfile,
  ): CounterfactualEvaluation {
    const allKeys = new Set([
      ...Object.keys(baselineMetrics),
      ...Object.keys(candidateMetrics),
    ]);

    const metricDeltas: Record<string, number> = {};
    const outcomeClassifications: CounterfactualMetricEvaluation[] = [];
    const behavioralChanges: string[] = [];

    for (const metricName of allKeys) {
      const baselineValue = baselineMetrics[metricName];
      const candidateValue = candidateMetrics[metricName];

      // Missing on one side → insufficient
      if (baselineValue === undefined || candidateValue === undefined) {
        metricDeltas[metricName] = 0;
        outcomeClassifications.push({
          metricName,
          baselineValue: baselineValue ?? 0,
          candidateValue: candidateValue ?? 0,
          delta: 0,
          threshold: this.getThreshold(metricName),
          statisticalConfidence: 0,
          direction: this.getDirection(metricName),
          classification: "insufficient",
        });
        behavioralChanges.push(`Metric ${metricName} missing on one side of comparison`);
        continue;
      }

      const delta = candidateValue - baselineValue;
      metricDeltas[metricName] = delta;

      const threshold = this.getThreshold(metricName);
      const direction = this.getDirection(metricName);
      const classification = this.classifyMetric(
        baselineValue,
        candidateValue,
        threshold,
        direction,
        confidenceProfile.overallConfidence,
      );

      outcomeClassifications.push({
        metricName,
        baselineValue,
        candidateValue,
        delta,
        threshold,
        statisticalConfidence: confidenceProfile.overallConfidence,
        direction,
        classification,
      });

      if (classification === "improvement" || classification === "regression") {
        behavioralChanges.push(
          `Metric ${metricName} ${classification}: ${baselineValue} → ${candidateValue} (delta ${delta > 0 ? "+" : ""}${delta})`,
        );
      }
    }

    return {
      baselineMetrics: { ...baselineMetrics },
      candidateMetrics: { ...candidateMetrics },
      metricDeltas,
      behavioralChanges,
      outcomeClassifications,
      confidenceProfile,
    };
  }

  /**
   * Classify a single metric delta per Section 8.2 rules.
   *
   * Policy-independent — determines behavioral difference only.
   *
   * @param baselineValue - Baseline metric value.
   * @param candidateValue - Candidate metric value.
   * @param threshold - Relative significance threshold.
   * @param direction - Whether higher or lower values are better.
   * @param statisticalConfidence - Epistemic confidence in the measurement.
   * @returns Outcome classification.
   */
  classifyMetric(
    baselineValue: number,
    candidateValue: number,
    threshold: number,
    direction: MetricDirection,
    statisticalConfidence: number,
  ): OutcomeClassification {
    // Low confidence → insufficient regardless of delta
    if (!Number.isFinite(statisticalConfidence) || statisticalConfidence < this.config.minimumConfidence) {
      return "insufficient";
    }

    // Zero baseline — cannot compute relative change
    if (baselineValue === 0) {
      if (candidateValue === 0) return "neutral";
      // Non-zero candidate from zero baseline is an infinite relative change.
      // Classify based on whether the candidate is better or worse per direction.
      const isIncrease = candidateValue > baselineValue;
      const isImprovement = direction === "higher_is_better" ? isIncrease : !isIncrease;
      return isImprovement ? "improvement" : "regression";
    }

    const relativeChange = (candidateValue - baselineValue) / Math.abs(baselineValue);
    const absChange = Math.abs(relativeChange);

    // Within tolerance → neutral
    if (absChange < threshold) {
      return "neutral";
    }

    // Determine improvement vs regression based on direction
    const isIncrease = candidateValue > baselineValue;
    const isImprovement = direction === "higher_is_better" ? isIncrease : !isIncrease;

    return isImprovement ? "improvement" : "regression";
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getDirection(metricName: string): MetricDirection {
    return this.config.metricDirections?.[metricName] ?? "higher_is_better";
  }

  private getThreshold(metricName: string): number {
    const override = this.config.metricThresholds?.[metricName];
    if (override !== undefined && Number.isFinite(override) && override >= 0) {
      return override;
    }
    return this.config.significanceThreshold;
  }
}
