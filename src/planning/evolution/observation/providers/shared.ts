// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Shared observation provider helpers.
 *
 * Utility functions shared across observation providers to avoid
 * duplicating result construction logic.
 *
 * @module observation-provider-shared
 */

import type { Observation, ObservationResult } from "../contracts/observation-contract.js";

/**
 * Build a standard success/reality-capture ObservationResult.
 *
 * Computes status based on whether expected is provided:
 * - expected !== undefined → compare observed === expected → pass/fail
 * - expected === undefined → reality capture → always pass
 *
 * @param observation - The originating observation (provides observationId and expected).
 * @param observed - The measured value.
 * @param evidence - Provider-specific raw evidence artifacts.
 * @returns Standardized ObservationResult with confidence: 1.0.
 */
export function buildObservationResult(
  observation: Observation,
  observed: unknown,
  evidence: Record<string, unknown>,
): ObservationResult {
  const expected = observation.expected;
  let status: "pass" | "fail" | "error" | "inconclusive";

  if (expected !== undefined) {
    status = observed === expected ? "pass" : "fail";
  } else {
    status = "pass";
  }

  return {
    observationId: observation.observationId,
    status,
    confidence: 1.0,
    observedAt: new Date().toISOString(),
    expected,
    observed,
    evidence,
  };
}
