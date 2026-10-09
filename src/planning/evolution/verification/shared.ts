// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2 — Verification Framework shared utilities.
 *
 * Extracted to avoid duplication between A2.5 (recommendation-engine) and
 * A3 (decision-engine).
 *
 * @module verification-shared
 */

import type { VerificationEvidence } from "./contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Regression inference
// ---------------------------------------------------------------------------

/**
 * Infer regression count from behavioral change descriptions.
 *
 * Matches the format produced by counterfactual-evaluator:
 * `Metric ${name} regression: ${before} → ${after} (delta ...)`
 *
 * @param behavioralChanges - Array of behavioral change descriptions.
 * @returns Count of regression-pattern changes.
 */
export function inferRegressionsFromChanges(
  behavioralChanges: readonly string[],
): number {
  return behavioralChanges.filter((c) => c.includes(" regression: ")).length;
}

/**
 * Infer regression count from VerificationEvidence.
 *
 * Pure — no side effects.
 *
 * @param evidence - Verification evidence with behavioralChanges.
 * @returns Count of regression-pattern behavioral changes.
 */
export function inferRegressions(evidence: VerificationEvidence): number {
  return inferRegressionsFromChanges(evidence.behavioralChanges);
}
