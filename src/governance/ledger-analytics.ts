/**
 * P13.1 — Governance run ledger analytics.
 *
 * Pure analysis module that reads LedgerEntry data and computes aggregate metrics.
 * Core invariant: analyse and recommend — never mutate governance state.
 * All functions are pure (no side effects, no I/O).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { LedgerEntry, LedgerOutcome } from "./run-ledger.js";
import type { RiskLevel } from "./risk-scoring.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendDirection = "improving" | "stable" | "degrading";

export interface LedgerAnalytics {
  totalRuns: number;
  byOutcome: Record<LedgerOutcome, number>;
  byRiskLevel: Record<RiskLevel, number>;
  approvalRate: number;
  averageRiskScore: number;
  timeframeDays: number;
  trendDirection: TrendDirection;
}

export interface PeriodRollup {
  date: string;
  runs: number;
  failures: number;
  denied: number;
  avgRiskScore: number;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isFullyApproved(entry: LedgerEntry): boolean {
  if (entry.approvals.length === 0) return false;
  return entry.approvals.every((a) => a.status === "approved");
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function computeTimeframeDays(entries: LedgerEntry[]): number {
  if (entries.length === 0) return 0;
  let minTs = entries[0]!.timestamp;
  let maxTs = entries[0]!.timestamp;
  for (let i = 1; i < entries.length; i++) {
    const ts = entries[i]!.timestamp;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  const diffMs = new Date(maxTs).getTime() - new Date(minTs).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function detectTrend(entries: LedgerEntry[]): TrendDirection {
  if (entries.length < 4) return "stable";

  const sorted = [...entries].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp),
  );
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const badRate = (slice: LedgerEntry[]): number => {
    if (slice.length === 0) return 0;
    const bad = slice.filter(
      (e) => e.outcome === "failed" || e.outcome === "denied",
    ).length;
    return bad / slice.length;
  };

  const riskAvg = (slice: LedgerEntry[]): number => {
    if (slice.length === 0) return 0;
    const sum = slice.reduce((acc, e) => acc + e.riskScore.score, 0);
    return sum / slice.length;
  };

  const firstBadRate = badRate(firstHalf);
  const secondBadRate = badRate(secondHalf);
  const firstRiskAvg = riskAvg(firstHalf);
  const secondRiskAvg = riskAvg(secondHalf);

  const badRateDecreased = secondBadRate < firstBadRate;
  const riskAvgIncrease = secondRiskAvg - firstRiskAvg;

  if (badRateDecreased && riskAvgIncrease <= 5) return "improving";
  if (!badRateDecreased || riskAvgIncrease > 5) return "degrading";
  return "stable";
}

export function computePeriodRollups(entries: LedgerEntry[]): PeriodRollup[] {
  const groups = new Map<string, LedgerEntry[]>();

  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 10);
    const group = groups.get(date);
    if (group) {
      group.push(entry);
    } else {
      groups.set(date, [entry]);
    }
  }

  const rollups: PeriodRollup[] = [];
  for (const [date, group] of groups) {
    const runs = group.length;
    const failures = group.filter((e) => e.outcome === "failed").length;
    const denied = group.filter((e) => e.outcome === "denied").length;
    const avgRiskScore =
      group.reduce((acc, e) => acc + e.riskScore.score, 0) / runs;
    rollups.push({ date, runs, failures, denied, avgRiskScore });
  }

  rollups.sort((a, b) => a.date.localeCompare(b.date));
  return rollups;
}

export function computeAnalytics(
  entries: LedgerEntry[],
  windowDays: number,
): LedgerAnalytics {
  const totalRuns = entries.length;

  // byOutcome
  const byOutcome: Record<LedgerOutcome, number> = {
    completed: 0,
    failed: 0,
    cancelled: 0,
    denied: 0,
  };
  for (const entry of entries) {
    byOutcome[entry.outcome]++;
  }

  // byRiskLevel
  const byRiskLevel: Record<RiskLevel, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const entry of entries) {
    byRiskLevel[entry.riskScore.level]++;
  }

  // approvalRate
  const runsWithApprovals = entries.filter(
    (e) => e.approvals.length > 0,
  ).length;
  const fullyApproved = entries.filter(isFullyApproved).length;
  const approvalRate =
    runsWithApprovals > 0 ? fullyApproved / runsWithApprovals : 0;

  // averageRiskScore
  const averageRiskScore =
    totalRuns > 0
      ? entries.reduce((acc, e) => acc + e.riskScore.score, 0) / totalRuns
      : 0;

  // timeframeDays
  const timeframeDays = Math.max(windowDays, computeTimeframeDays(entries));

  // trendDirection
  const trendDirection = detectTrend(entries);

  return {
    totalRuns,
    byOutcome,
    byRiskLevel,
    approvalRate,
    averageRiskScore,
    timeframeDays,
    trendDirection,
  };
}
