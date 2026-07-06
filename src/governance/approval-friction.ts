/**
 * P13.4 — Governance approval friction analysis.
 *
 * Reads the P12.4 run ledger and analyses where approval gates cause the most
 * friction. Simple aggregation — no heuristics, no cross-store joins, no ML.
 *
 * Invariant: Analyse friction, don't change approval configuration.
 *
 * All functions pure (no I/O, no side effects, no Date.now / Math.random).
 * All ratio calculations are division-guarded. All sort orders deterministic.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { ApprovalGateName } from "./approval-workflow.js";
import type { LedgerEntry } from "./run-ledger.js";
import { clamp, round2 } from "./policy-suggestions.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ApprovalFriction {
  gate: ApprovalGateName;
  totalOccurrences: number;
  deniedCount: number;
  pendingCount: number;
  approvedCount: number;
  averageTimeToApprove: null;
  frictionScore: number;
}

export interface FrictionReport {
  gates: ApprovalFriction[];
  highestFrictionGate: ApprovalGateName | null;
  totalApprovalsRequested: number;
  overallFrictionScore: number;
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/**
 * All known approval gate names in deterministic order.
 */
export const ALL_GATE_NAMES: readonly ApprovalGateName[] = [
  "proposal",
  "file_scope",
  "verification",
  "pr",
  "merge",
] as const;

// ---------------------------------------------------------------------------
// Exported pure functions
// ---------------------------------------------------------------------------

/**
 * Compute the weighted friction score for a single gate.
 *
 * Formula: `denyRate * 0.6 + pendingRate * 0.4`
 * - Denies contribute more weight (0.6) than pendings (0.4) — a denied gate is
 *   a stronger friction signal than a pending one.
 * - Result clamped to [0, 1], rounded to 2 decimals.
 * - Division-guarded: zero totalOccurrences produces rate 0.
 *
 * @param gate - The gate metric (only count fields are read).
 * @returns Friction score in [0, 1].
 */
export function computeFrictionScore(gate: ApprovalFriction): number {
  const denyRate =
    gate.totalOccurrences > 0 ? gate.deniedCount / gate.totalOccurrences : 0;
  const pendingRate =
    gate.totalOccurrences > 0 ? gate.pendingCount / gate.totalOccurrences : 0;
  return round2(clamp(denyRate * 0.6 + pendingRate * 0.4, 0, 1));
}

/**
 * Aggregate ledger entries into a gate-level friction report.
 *
 * Counts every approval gate occurrence across all ledger entries and computes
 * per-gate friction scores. All 5 gate names always appear in the output even
 * when they have zero occurrences.
 *
 * Deterministic: identical inputs produce identical outputs.
 *
 * @param entries - Ledger entries to analyse.
 * @returns Friction report with sorted gates and aggregate metrics.
 */
export function computeFrictionReport(entries: LedgerEntry[]): FrictionReport {
  // Initialise counters for all 5 gates
  const counts = new Map<
    ApprovalGateName,
    { total: number; denied: number; pending: number; approved: number }
  >();

  for (const name of ALL_GATE_NAMES) {
    counts.set(name, { total: 0, denied: 0, pending: 0, approved: 0 });
  }

  // Tally every approval gate across all entries
  for (const entry of entries) {
    for (const gate of entry.approvals) {
      const c = counts.get(gate.gate);
      if (!c) continue;
      c.total += 1;
      if (gate.status === "denied") c.denied += 1;
      else if (gate.status === "pending") c.pending += 1;
      else if (gate.status === "approved") c.approved += 1;
    }
  }

  // Build friction metrics for each gate
  const gates: ApprovalFriction[] = [];

  for (const name of ALL_GATE_NAMES) {
    const c = counts.get(name)!;
    const totalOccurrences = c.total;
    const deniedCount = c.denied;
    const pendingCount = c.pending;
    const approvedCount = c.approved;

    const gateMetric: ApprovalFriction = {
      gate: name,
      totalOccurrences,
      deniedCount,
      pendingCount,
      approvedCount,
      averageTimeToApprove: null,
      frictionScore: 0,
    };
    gateMetric.frictionScore = computeFrictionScore(gateMetric);
    gates.push(gateMetric);
  }

  // Sort: frictionScore descending, gate name ascending for tie-breaks
  gates.sort((a, b) => {
    if (b.frictionScore !== a.frictionScore) {
      return b.frictionScore - a.frictionScore;
    }
    return a.gate.localeCompare(b.gate);
  });

  const totalApprovalsRequested = gates.reduce(
    (sum, g) => sum + g.totalOccurrences,
    0,
  );

  // occurrence-weighted: totalDenied/total * 0.6 + totalPending/total * 0.4
  const overallFrictionScore =
    totalApprovalsRequested > 0
      ? (() => {
          const totalDenied = gates.reduce((s, g) => s + g.deniedCount, 0);
          const totalPending = gates.reduce((s, g) => s + g.pendingCount, 0);
          const denyRate = totalDenied / totalApprovalsRequested;
          const pendingRate = totalPending / totalApprovalsRequested;
          return round2(clamp(denyRate * 0.6 + pendingRate * 0.4, 0, 1));
        })()
      : 0;

  return {
    gates,
    highestFrictionGate: gates[0]?.gate ?? null,
    totalApprovalsRequested,
    overallFrictionScore,
  };
}
