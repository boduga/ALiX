/**
 * P10.10 — Health Score engine.
 *
 * Pure function that converts drift items into a normalized 0–100 score
 * with an interpretable status band.
 *
 * Framework-owned — providers never compute their own scores.
 *
 * @module
 */

import type { DriftItem, HealthStatus } from "./baseline-types.js";

// ---------------------------------------------------------------------------
// Status band thresholds
// ---------------------------------------------------------------------------

const EXCELLENT_MIN = 90;
const HEALTHY_MIN = 70;
const WARNING_MIN = 40;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a normalized health score from drift items.
 *
 * Scoring formula (equal-weight by default):
 *   1. For each drift item: 1 - min(|delta| / max(baseline, current), 1)
 *   2. Clamp each to [0, 1]
 *   3. Average across items (weighted if `weights` provided)
 *   4. Multiply by 100, round to integer
 *
 * @param drift     — drift items to score
 * @param weights   — optional per-metric weights by metric name
 * @returns score 0–100 and status band
 */
export function computeHealthScore(
  drift: DriftItem[],
  weights?: Record<string, number>,
): { score: number; status: HealthStatus } {
  if (drift.length === 0) {
    return { score: 100, status: "excellent" };
  }

  // Compute per-item scores
  const itemScores = drift.map((item) => {
    const max = Math.max(item.baselineValue, item.currentValue);
    if (max === 0) return 0;
    const raw = 1 - Math.min(Math.abs(item.delta) / max, 1);
    return Math.max(0, raw); // clamp to [0, 1]
  });

  // Apply weights
  const totalWeight = drift.reduce((sum, item) => {
    return sum + (weights?.[item.metric] ?? 1);
  }, 0);

  const weightedSum = drift.reduce((sum, item, idx) => {
    return sum + itemScores[idx] * (weights?.[item.metric] ?? 1);
  }, 0);

  const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Scale to 0–100
  const score = Math.round(avg * 100);
  const clamped = Math.max(0, Math.min(100, score));

  return { score: clamped, status: statusForScore(clamped) };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function statusForScore(score: number): HealthStatus {
  if (score >= EXCELLENT_MIN) return "excellent";
  if (score >= HEALTHY_MIN) return "healthy";
  if (score >= WARNING_MIN) return "warning";
  return "critical";
}
