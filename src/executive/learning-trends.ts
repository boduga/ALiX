/**
 * P10.6 — Learning Engine.
 *
 * Pure aggregation function that computes cross-plan trend analytics from
 * persisted outcome evaluation reports.
 *
 * @module
 */

import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubsystemTrend {
  subsystem: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export interface ObjectiveTrend {
  objectiveType: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export const TREND_OK = "ok";
export const TREND_INSUFFICIENT_DATA = "insufficient_data";

export interface TrendResult {
  trendStatus: typeof TREND_OK | typeof TREND_INSUFFICIENT_DATA;
  generatedAt: string;
  requestedWindow: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  totalImproved: number;
  totalMixed: number;
  totalDegraded: number;
  totalUnchanged: number;
  subsystemTrends: SubsystemTrend[];
  objectiveTrends: ObjectiveTrend[];
  warnings: string[];        // analytical warnings from the learning engine
  loadWarnings: string[];    // integrity/load problems from report loading
}

type OutcomeClass = "improved" | "degraded" | "unchanged" | "mixed";

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

export function computeLearningTrends(
  reports: ExecutiveOutcomeEvaluationReport[],
  requestedWindow: number = reports.length,
  generatedAt: string = new Date().toISOString(),
): TrendResult {

  if (reports.length === 0) {
    return {
      trendStatus: TREND_INSUFFICIENT_DATA,
      generatedAt,
      requestedWindow,
      inputReportCount: 0,
      analyzedReportCount: 0,
      skippedReportCount: 0,
      totalImproved: 0,
      totalMixed: 0,
      totalDegraded: 0,
      totalUnchanged: 0,
      subsystemTrends: [],
      objectiveTrends: [],
      warnings: [],
      loadWarnings: [],
    };
  }

  const completedReports = reports.filter(
    r => r.evaluationStatus === "completed",
  );
  const skipped = reports.length - completedReports.length;

  if (completedReports.length === 0) {
    return {
      trendStatus: TREND_INSUFFICIENT_DATA,
      generatedAt,
      requestedWindow,
      inputReportCount: reports.length,
      analyzedReportCount: 0,
      skippedReportCount: skipped,
      totalImproved: 0,
      totalMixed: 0,
      totalDegraded: 0,
      totalUnchanged: 0,
      subsystemTrends: [],
      objectiveTrends: [],
      warnings: [],
      loadWarnings: [],
    };
  }

  // Collect all contributions (flatten objectives across all completed reports)
  const subsystemContribs = new Map<string, number[]>();
  const subsystemOutcomes = new Map<string, OutcomeClass[]>();
  const objectiveContribs = new Map<string, number[]>();
  const objectiveOutcomes = new Map<string, OutcomeClass[]>();
  const totals = { improved: 0, mixed: 0, degraded: 0, unchanged: 0 };

  for (const report of completedReports) {
    for (const obj of report.objectives) {
      const {
        objectiveType,
        outcome,
        aggregateDelta,
        subsystemDeltas = [],
      } = obj;

      // Objective dimension
      const oList = objectiveContribs.get(objectiveType) ?? [];
      oList.push(aggregateDelta);
      objectiveContribs.set(objectiveType, oList);
      const oOut = objectiveOutcomes.get(objectiveType) ?? [];
      oOut.push(outcome);
      objectiveOutcomes.set(objectiveType, oOut);
      incrementTotal(totals, outcome);

      // Subsystem dimension (per subsystem within each objective)
      for (const sd of subsystemDeltas) {
        const sList = subsystemContribs.get(sd.subsystem) ?? [];
        sList.push(sd.delta);
        subsystemContribs.set(sd.subsystem, sList);
        const sOut = subsystemOutcomes.get(sd.subsystem) ?? [];
        sOut.push(outcome);
        subsystemOutcomes.set(sd.subsystem, sOut);
      }
    }
  }

  const subsystemTrends: SubsystemTrend[] = [];
  for (const [subsystem, deltas] of subsystemContribs) {
    const outcomes = subsystemOutcomes.get(subsystem)!;
    subsystemTrends.push({
      subsystem,
      occurrenceCount: deltas.length,
      ...summarizeOutcomes(outcomes),
      averageDelta: round1(mean(deltas)),
    });
  }

  const objectiveTrends: ObjectiveTrend[] = [];
  for (const [objectiveType, deltas] of objectiveContribs) {
    const outcomes = objectiveOutcomes.get(objectiveType)!;
    objectiveTrends.push({
      objectiveType,
      occurrenceCount: deltas.length,
      ...summarizeOutcomes(outcomes),
      averageDelta: round1(mean(deltas)),
    });
  }

  // Sort: averageDelta desc → occurrenceCount desc → name asc
  subsystemTrends.sort(compareSubsystemTrend);
  objectiveTrends.sort(compareObjectiveTrend);

  return {
    trendStatus: TREND_OK,
    generatedAt,
    requestedWindow,
    inputReportCount: reports.length,
    analyzedReportCount: completedReports.length,
    skippedReportCount: skipped,
    totalImproved: totals.improved,
    totalMixed: totals.mixed,
    totalDegraded: totals.degraded,
    totalUnchanged: totals.unchanged,
    subsystemTrends,
    objectiveTrends,
    warnings: [],
    loadWarnings: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function compareSubsystemTrend(a: SubsystemTrend, b: SubsystemTrend): number {
  if (b.averageDelta !== a.averageDelta) return b.averageDelta - a.averageDelta;
  if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
  return a.subsystem.localeCompare(b.subsystem);
}

function compareObjectiveTrend(a: ObjectiveTrend, b: ObjectiveTrend): number {
  if (b.averageDelta !== a.averageDelta) return b.averageDelta - a.averageDelta;
  if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
  return a.objectiveType.localeCompare(b.objectiveType);
}

function incrementTotal(
  t: { improved: number; mixed: number; degraded: number; unchanged: number },
  outcome: OutcomeClass,
): void {
  if (outcome === "improved") t.improved++;
  else if (outcome === "mixed") t.mixed++;
  else if (outcome === "degraded") t.degraded++;
  else t.unchanged++;
}

function summarizeOutcomes(outcomes: OutcomeClass[]): {
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
} {
  const total = outcomes.length || 1;
  return {
    successRate: outcomes.filter(o => o === "improved").length / total,
    mixedRate: outcomes.filter(o => o === "mixed").length / total,
    degradationRate: outcomes.filter(o => o === "degraded").length / total,
    unchangedRate: outcomes.filter(o => o === "unchanged").length / total,
  };
}
