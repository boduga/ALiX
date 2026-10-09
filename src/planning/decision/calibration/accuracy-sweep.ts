/**
 * accuracy-sweep.ts — Threshold accuracy sweep for scoreless engines (J4).
 *
 * `computeReliability` bins a native score, so it refuses samples that carry
 * none (the local baseline emits no confidence — JEV-9). For a decision whose
 * threshold parameter IS the calibration knob (claim-verification's
 * support-overlap), accuracy is measured by re-running the classifier at each
 * candidate threshold over a labeled case set, then selecting the LOWEST
 * threshold meeting the target — the same least-restrictive rule as
 * `suggestThreshold`.
 *
 * Divergence from `suggestThreshold`: when no grid point meets the target the
 * sweep still returns the fully-closed threshold (1) with the accuracy
 * actually measured at 1, never a fabricated 0 — every point on the curve is
 * a real measurement over the case set.
 *
 * Decision-neutral on purpose: this module must not import any decision
 * folder (claim-verification's thresholds already import calibration; a
 * back-edge would cycle the graph).
 */

import { CalibrationValidationError } from "./reliability.js";

export type AccuracySweepCase = {
  id: string;
  expected: string;
  verdictAt(threshold: number): string;
};

export type AccuracySweepPoint = {
  threshold: number;
  accuracy: number;
};

export type AccuracySweepResult = {
  /** Selected (lowest meeting, else fully closed) threshold. */
  threshold: number;
  /** Measured accuracy at `threshold`. */
  accuracy: number;
  sampleCount: number;
  /** Full grid curve, ascending threshold. */
  points: AccuracySweepPoint[];
};

export const DEFAULT_ACCURACY_SWEEP_BINS = 10;

/**
 * Evaluate `verdictAt` on the grid `i / bins` for `i = 0..bins` (inclusive of
 * both 0 and 1) and pick the first point whose accuracy meets the target.
 * Throws `CalibrationValidationError` on empty cases, a non-positive-integer
 * `bins`, or a target outside (0, 1].
 */
export function sweepAccuracy(
  cases: readonly AccuracySweepCase[],
  opts: { targetAccuracy: number; bins?: number },
): AccuracySweepResult {
  if (cases.length === 0) {
    throw new CalibrationValidationError("no cases to accuracy-sweep");
  }
  const bins = opts.bins ?? DEFAULT_ACCURACY_SWEEP_BINS;
  if (!Number.isInteger(bins) || bins <= 0) {
    throw new CalibrationValidationError(`bins must be a positive integer, got ${String(bins)}`);
  }
  const target = opts.targetAccuracy;
  if (!Number.isFinite(target) || target <= 0 || target > 1) {
    throw new CalibrationValidationError(`targetAccuracy must be in (0, 1], got ${String(target)}`);
  }

  const sampleCount = cases.length;
  const points: AccuracySweepPoint[] = [];
  for (let i = 0; i <= bins; i += 1) {
    const threshold = i / bins;
    let correct = 0;
    for (const entry of cases) {
      if (entry.verdictAt(threshold) === entry.expected) correct += 1;
    }
    points.push({ threshold, accuracy: correct / sampleCount });
  }

  const selected =
    points.find((point) => point.accuracy >= target) ?? points[points.length - 1];
  return {
    threshold: selected.threshold,
    accuracy: selected.accuracy,
    sampleCount,
    points,
  };
}
