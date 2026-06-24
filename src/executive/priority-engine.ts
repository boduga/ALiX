/**
 * P10.1 -- Weighted Priority Engine.
 *
 * Transforms P10.0 health scores into weighted executive priority scores.
 * Uses an extensible PriorityFactor[] model: priorityScore = (weight x value).
 *
 * @module
 */

import type { ExecutiveHealthReport, ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREND_SENSITIVITY = 5;

const BLAST_RADIUS: Record<ExecutiveSubsystemName, number> = {
  governance: 100,
  security:    90,
  learning:    75,
  memory:      70,
  adaptation:  65,
  workflow:    60,
  agents:      50,
  tools:       40,
};

const P10_1_FACTORS: PriorityFactorDef[] = [
  { name: "Health Deficit", weight: 0.60 },
  { name: "Trend",          weight: 0.25 },
  { name: "Blast Radius",   weight: 0.15 },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PriorityFactorDef {
  /** Human-readable factor name. */
  name: string;
  /** Relative weight in composite. All factor weights sum to 1.0. */
  weight: number;
}

export interface ComputedPriorityFactor {
  name: string;
  weight: number;
  /** Computed 0..100 value for this factor. */
  value: number;
}

export interface ExecutivePriorityEntry {
  subsystem: ExecutiveSubsystemName;
  /** 0..100, from P10.0 health report. */
  healthScore: number;
  /** 100 - healthScore. */
  healthDeficit: number;
  /** 0..100, derived from trend delta. */
  trendScore: number;
  /** 0..100, from BLAST_RADIUS table. */
  blastRadius: number;
  /**
   * Weighted composite: (weight x value) across all registered factors.
   * Weighted by P10_1_FACTORS. Higher = higher priority.
   */
  priorityScore: number;
  /** Per-factor breakdown for display. */
  factorBreakdown: ComputedPriorityFactor[];
  /** One-line summary. */
  summary: string;
}

export interface ExecutivePriorityReport {
  schemaVersion: "p10.1.0";
  generatedAt: string;
  windowDays: number;
  /** Sorted descending by priorityScore (highest priority first). */
  priorities: ExecutivePriorityEntry[];
}

// ---------------------------------------------------------------------------
// Priority engine
// ---------------------------------------------------------------------------

/**
 * Pure function: compute a single priority score from its three factors.
 * Factory pattern: given input values, returns the weighted composite.
 * P10.1 uses the standard factor list but P10.2+ may register custom factors.
 */
export function computePriorityScore(
  healthDeficit: number,
  trendScore: number,
  blastRadius: number,
): number {
  const values = [healthDeficit, trendScore, blastRadius];
  let composite = 0;
  for (let i = 0; i < P10_1_FACTORS.length; i++) {
    composite += P10_1_FACTORS[i].weight * values[i];
  }
  return composite;
}

/**
 * Derive trendScore from a prior snapshot delta.
 * If no prior snapshot, trendScore defaults to 25 (neutral-low).
 */
export function computeTrendScore(
  currentScore: number,
  priorScore: number | undefined,
): number {
  if (priorScore === undefined) return 25;
  const delta = currentScore - priorScore;
  return clampValue(50 - delta * TREND_SENSITIVITY);
}

/**
 * Build the full ExecutivePriorityReport from a P10.0 health report
 * and an optional prior trend snapshot.
 */
export function buildPriorityReport(
  healthReport: ExecutiveHealthReport,
  priorSnapshot: ExecutiveTrendSnapshot | null,
): ExecutivePriorityReport {
  const generatedAt = new Date().toISOString();
  const entries: ExecutivePriorityEntry[] = healthReport.rankedSubsystems.map((sub) => {
    const healthDeficit = 100 - sub.score;
    const priorScore = priorSnapshot?.subsystemScores[sub.subsystem];
    const trendScore = computeTrendScore(sub.score, priorScore);
    const blastRadius = BLAST_RADIUS[sub.subsystem];
    const priorityScore = computePriorityScore(healthDeficit, trendScore, blastRadius);

    return {
      subsystem: sub.subsystem,
      healthScore: sub.score,
      healthDeficit,
      trendScore,
      blastRadius,
      priorityScore,
      factorBreakdown: [
        { name: "Health Deficit", weight: 0.60, value: healthDeficit },
        { name: "Trend",          weight: 0.25, value: trendScore },
        { name: "Blast Radius",   weight: 0.15, value: blastRadius },
      ],
      summary: `${sub.subsystem} score ${sub.score}, priority ${priorityScore.toFixed(1)}`,
    };
  });

  // Sort descending by priorityScore (highest priority first)
  entries.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    schemaVersion: "p10.1.0",
    generatedAt,
    windowDays: healthReport.windowDays,
    priorities: entries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampValue(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
