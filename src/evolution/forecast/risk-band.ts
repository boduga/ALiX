/**
 * A9 — Risk band projection (Slice 1, Phase 3).
 *
 * Projects an internal risk score in [0,1] onto the locked A6 RiskBand via the
 * locked thresholds. Do NOT introduce alternate thresholds.
 *
 *   [0.0, 0.3)   low
 *   [0.3, 0.6)   medium
 *   [0.6, 0.85)  high
 *   [0.85, 1.0]  critical
 *
 * Invalid scores (non-number, NaN, ±Infinity, outside [0,1]) are handled
 * deterministically by THROWING a RangeError. This is the documented choice:
 * a malformed score is a programming error that must surface loudly, not be
 * silently projected (fail-closed would mask bugs and break determinism
 * guarantees downstream). Boundary tests are mandatory (see
 * tests/evolution/a9-risk-band.vitest.ts).
 *
 * @module evolution/forecast/risk-band
 */

import type { RiskBand } from "./contracts/contract.js";

/** The locked A6 thresholds, exported for tests and documentation. */
export const RISK_BAND_THRESHOLDS = {
  low: { minInclusive: 0.0, maxExclusive: 0.3 },
  medium: { minInclusive: 0.3, maxExclusive: 0.6 },
  high: { minInclusive: 0.6, maxExclusive: 0.85 },
  critical: { minInclusive: 0.85, maxInclusive: 1.0 },
} as const;

/**
 * Project a validated internal risk score onto the locked RiskBand.
 *
 * @throws {RangeError} when `score` is not a finite number in [0,1].
 */
export function internalScoreToBand(score: number): RiskBand {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(
      `internalScoreToBand: score must be a finite number in [0, 1]; received ${String(score)}`,
    );
  }
  if (score < RISK_BAND_THRESHOLDS.low.maxExclusive) return "low";
  if (score < RISK_BAND_THRESHOLDS.medium.maxExclusive) return "medium";
  if (score < RISK_BAND_THRESHOLDS.high.maxExclusive) return "high";
  return "critical";
}
