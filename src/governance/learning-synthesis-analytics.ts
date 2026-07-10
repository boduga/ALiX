/**
 * P27.2 — Drift Outcome Correlation Analytics.
 *
 * Pure correlation analytics over DriftOutcomeTrace[]. No I/O, no side effects.
 * Descriptive governance intelligence only — no causation claims, no reviewer
 * ranking, no predictive scores.
 *
 * Primary invariant: computeCorrelationAnalytics(traces) → DriftCorrelationAnalytics
 * Produces outcome distributions by signalKind and severity, time statistics,
 * repeated drift patterns, and trace completeness.
 */

import type {
  DriftOutcomeTrace,
  DriftCorrelationAnalytics,
} from "./learning-synthesis-types.js";

/**
 * Compute descriptive correlation analytics from an array of DriftOutcomeTrace.
 *
 * @param traces - Array of correlated drift outcome traces
 * @returns DriftCorrelationAnalytics with distributions and statistics
 */
export function computeCorrelationAnalytics(
  traces: DriftOutcomeTrace[],
): DriftCorrelationAnalytics {
  const outcomeBySignalKind: Record<string, Record<string, number>> = {};
  const outcomeBySeverity: Record<string, Record<string, number>> = {};
  const kindWindowMap = new Map<string, Set<string>>();
  let totalReviewDays = 0;
  let totalOutcomeDays = 0;

  for (const trace of traces) {
    // Outcome by signal kind
    if (!outcomeBySignalKind[trace.signalKind]) {
      outcomeBySignalKind[trace.signalKind] = {};
    }
    outcomeBySignalKind[trace.signalKind]![trace.outcomeType] =
      (outcomeBySignalKind[trace.signalKind]![trace.outcomeType] ?? 0) + 1;

    // Outcome by severity
    if (!outcomeBySeverity[trace.signalSeverity]) {
      outcomeBySeverity[trace.signalSeverity] = {};
    }
    outcomeBySeverity[trace.signalSeverity]![trace.outcomeType] =
      (outcomeBySeverity[trace.signalSeverity]![trace.outcomeType] ?? 0) + 1;

    // Time stats
    totalReviewDays += trace.timeToReviewDays;
    totalOutcomeDays += trace.timeToOutcomeDays;

    // Repeated drift: track signalKind × windowStart pairs
    if (trace.windowStart) {
      if (!kindWindowMap.has(trace.signalKind)) {
        kindWindowMap.set(trace.signalKind, new Set());
      }
      kindWindowMap.get(trace.signalKind)!.add(trace.windowStart);
    }
  }

  // Repeated patterns: signalKind appearing in 2+ distinct windows
  const repeatedPatterns: string[] = [];
  for (const [kind, windows] of kindWindowMap) {
    if (windows.size >= 2) {
      repeatedPatterns.push(kind);
    }
  }
  repeatedPatterns.sort();

  // Trace completeness
  const uniqueCandidateIds = new Set(traces.map(t => t.candidateId));
  const traceCompleteness = uniqueCandidateIds.size > 0
    ? Math.round((traces.length / uniqueCandidateIds.size) * 100) / 100
    : 0;

  // Time statistics
  const n = traces.length;
  const timeStats = {
    avgTimeToReviewDays: n > 0 ? Math.round((totalReviewDays / n) * 100) / 100 : 0,
    avgTimeToOutcomeDays: n > 0 ? Math.round((totalOutcomeDays / n) * 100) / 100 : 0,
  };

  return {
    totalOutcomes: traces.length,
    outcomeBySignalKind,
    outcomeBySeverity,
    timeStats,
    repeatedPatterns,
    traceCompleteness,
    missingOutcomes: 0,
  };
}
