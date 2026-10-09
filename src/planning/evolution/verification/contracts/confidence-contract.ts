// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.0 — Verification Confidence Contract Types.
 *
 * Defines the confidence model for verification evidence: ConfidenceProfile,
 * HistoricalSimilarityAssessment, and the confidence computation formula.
 *
 * Confidence is epistemic — it represents how trustworthy a projection is,
 * not the probability that a proposal succeeds.
 *
 * @module confidence-contract
 */

// ---------------------------------------------------------------------------
// Confidence Profile (Section 9)
// ---------------------------------------------------------------------------

/**
 * Confidence profile for a verification evidence artifact.
 *
 * Formula:
 *   overallConfidence = min(replayFidelity, coverage, determinism) × historicalSimilarity
 *
 * @invariant All numeric fields are in [0, 1].
 * @invariant overallConfidence follows the formula above — non-compensatory,
 *            multiplicative with historical similarity.
 */
export interface ConfidenceProfile {
  /** How faithfully replay reproduced execution context (0–1). */
  replayFidelity: number;
  /** Proportion of relevant historical scenarios exercised (0–1). */
  coverage: number;
  /** How verifiably deterministic the run was (0–1). */
  determinism: number;
  /** Overall similarity between replay conditions and current production (0–1). */
  historicalSimilarity: number;
  /** Computed overall confidence per the formula above (0–1). */
  overallConfidence: number;
}

// ---------------------------------------------------------------------------
// Historical Similarity Assessment (Section 10)
// ---------------------------------------------------------------------------

/**
 * Multi-dimensional assessment of how representative a replay dataset is
 * of current production conditions.
 */
export interface HistoricalSimilarityAssessment {
  /** Similarity of workload distribution (0–1). */
  workloadSimilarity: number;
  /** Similarity of system topology (0–1). */
  topologySimilarity: number;
  /** Similarity of active policy versions (0–1). */
  policySimilarity: number;
  /** Similarity of resource utilization patterns (0–1). */
  resourceSimilarity: number;
  /** Similarity of agent composition (0–1). */
  agentCompositionSimilarity: number;
  /** Similarity of request/traffic distribution (0–1). */
  trafficSimilarity: number;
  /** Similarity of failure patterns (0–1). */
  failurePatternSimilarity: number;
  /** Derived overall similarity from all dimensions (0–1). */
  overallSimilarity: number;
  /** Dimensions that could not be compared. */
  coverageGaps: readonly string[];
}

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isInRange(v: number, min: number, max: number): boolean {
  return !Number.isNaN(v) && v >= min && v <= max;
}

/**
 * Validate a ConfidenceProfile structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateConfidenceProfile(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ConfidenceProfile must be an object"] };
  }

  const v = value as Record<string, number>;

  const fields: (keyof ConfidenceProfile)[] = [
    "replayFidelity",
    "coverage",
    "determinism",
    "historicalSimilarity",
    "overallConfidence",
  ];

  for (const field of fields) {
    if (typeof v[field] !== "number" || !isInRange(v[field], 0, 1)) {
      errors.push(`${field} required and must be between 0 and 1`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a HistoricalSimilarityAssessment structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateHistoricalSimilarityAssessment(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["HistoricalSimilarityAssessment must be an object"] };
  }

  const v = value as Record<string, unknown>;

  const fields = [
    "workloadSimilarity",
    "topologySimilarity",
    "policySimilarity",
    "resourceSimilarity",
    "agentCompositionSimilarity",
    "trafficSimilarity",
    "failurePatternSimilarity",
    "overallSimilarity",
  ];

  for (const field of fields) {
    if (typeof (v as Record<string, unknown>)[field] !== "number" ||
        !isInRange((v as Record<string, number>)[field], 0, 1)) {
      errors.push(`${field} required and must be between 0 and 1`);
    }
  }

  if (!Array.isArray(v.coverageGaps)) {
    errors.push("coverageGaps required and must be an array");
  }

  return { valid: errors.length === 0, errors };
}
