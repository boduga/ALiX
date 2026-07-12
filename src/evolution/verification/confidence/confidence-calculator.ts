// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.0 — Confidence Calculator.
 *
 * Computes the overall confidence score for verification evidence using
 * the non-compensatory multiplicative formula from the A2 specification.
 *
 * Confidence is epistemic — it represents how trustworthy a projection is,
 * not the probability that a proposal succeeds.
 *
 * @module confidence-calculator
 */

import type { ConfidenceProfile, HistoricalSimilarityAssessment } from "../contracts/confidence-contract.js";

// ---------------------------------------------------------------------------
// ConfidenceInput
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  /** How faithfully replay reproduced execution context (0–1). */
  replayFidelity: number;
  /** Proportion of relevant historical scenarios exercised (0–1). */
  coverage: number;
  /** How verifiably deterministic the run was (0–1). */
  determinism: number;
  /** Overall historical similarity between replay and current production (0–1). */
  historicalSimilarity: number;
}

// ---------------------------------------------------------------------------
// computeOverallConfidence
// ---------------------------------------------------------------------------

/**
 * Compute the overall confidence for a verification run.
 *
 * Formula:
 *   overall = min(replayFidelity, coverage, determinism) × historicalSimilarity
 *
 * The formula is non-compensatory — a low score in any of the first three
 * dimensions cannot be offset by high scores in others. Historical similarity
 * acts as a multiplicative cap on the final confidence.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param input - Confidence inputs, each in [0, 1].
 * @returns The computed ConfidenceProfile with all dimensions populated.
 */
export function computeOverallConfidence(input: ConfidenceInput): ConfidenceProfile {
  const safe = (v: number): number =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

  const replayFidelity = safe(input.replayFidelity);
  const coverage = safe(input.coverage);
  const determinism = safe(input.determinism);
  const historicalSimilarity = safe(input.historicalSimilarity);

  const minFactor = Math.min(replayFidelity, coverage, determinism);
  const overallConfidence = Math.max(0, Math.min(1, minFactor * historicalSimilarity));

  return {
    replayFidelity,
    coverage,
    determinism,
    historicalSimilarity,
    overallConfidence,
  };
}

// ---------------------------------------------------------------------------
// computeHistoricalSimilarity
// ---------------------------------------------------------------------------

/**
 * Derive the overall similarity score from a HistoricalSimilarityAssessment.
 *
 * Uses the mean of all provided dimension scores. Any dimension not comparable
 * (identifiable by entry in coverageGaps) is excluded from the mean.
 *
 * Pure — no side effects, no I/O, no store access.
 */
/**
 * Map of coverage gap prefixes to the dimension field they exclude.
 */
const GAP_TO_FIELD: Record<string, keyof HistoricalSimilarityAssessment> = {
  "evidence_count_zero": "workloadSimilarity",
  "runtime_version_mismatch": "topologySimilarity",
  "policy_version_mismatch": "policySimilarity",
  "metric_gap": "resourceSimilarity",
  "agent_gap": "agentCompositionSimilarity",
  "strategy_mismatch": "trafficSimilarity",
  "failure_pattern": "failurePatternSimilarity",
};

function getExcludedFields(gaps: readonly string[]): Set<string> {
  const excluded = new Set<string>();
  for (const gap of gaps) {
    for (const [prefix, field] of Object.entries(GAP_TO_FIELD)) {
      if (gap.startsWith(prefix)) {
        excluded.add(field);
        break;
      }
    }
  }
  return excluded;
}

const SIMILARITY_FIELDS: Array<keyof HistoricalSimilarityAssessment> = [
  "workloadSimilarity",
  "topologySimilarity",
  "policySimilarity",
  "resourceSimilarity",
  "agentCompositionSimilarity",
  "trafficSimilarity",
  "failurePatternSimilarity",
];

/**
 * Derive the overall similarity score from a HistoricalSimilarityAssessment.
 *
 * Uses the mean of all provided dimension scores. Any dimension not comparable
 * (identifiable by entry in coverageGaps) is excluded from the mean.
 *
 * Pure — no side effects, no I/O, no store access.
 */
export function computeOverallSimilarity(
  assessment: HistoricalSimilarityAssessment,
): number {
  const excluded = getExcludedFields(assessment.coverageGaps);

  const dimensions = SIMILARITY_FIELDS
    .filter((field) => !excluded.has(field))
    .map((field) => assessment[field] as number)
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);

  if (dimensions.length === 0) return 0;

  const mean = dimensions.reduce((sum, v) => sum + v, 0) / dimensions.length;
  return Math.max(0, Math.min(1, mean));
}
