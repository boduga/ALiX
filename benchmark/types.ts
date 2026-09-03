// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Benchmark harness types — history vs summary vs state vs hybrid.
 *
 * Spec: docs/ALiX-ExecutionState-Architecture.md §28-30, issue #628.
 * Maps ticket #623 prototype (same workload, same governance/budget, 4 substrates)
 * plus §28 observability and §29 projection-adequacy concerns.
 *
 * @module benchmark/types
 */

// ─── Substrates ────────────────────────────────────────────────────

/**
 * Four substrate modes run through the SAME harness on the SAME scenario/seed/environment.
 * A/B are baselines, C vs D is the primary bake-off.
 * Aligns with arch §30 (FULL_HISTORY / SUMMARY / STATE / HYBRID) and §16 hybrid.
 */
export type Substrate =
  | "A_full_history"
  | "B_summary_fixed"
  | "C_state"
  | "D_hybrid";

/** Display labels for reporting */
export const SUBSTRATE_LABELS: Record<Substrate, string> = {
  A_full_history: "A full history",
  B_summary_fixed: "B summary (fixed)",
  C_state: "C state",
  D_hybrid: "D hybrid",
};

export const ALL_SUBSTRATES: readonly Substrate[] = [
  "A_full_history",
  "B_summary_fixed",
  "C_state",
  "D_hybrid",
] as const;

// ─── Decision categories ───────────────────────────────────────────

/**
 * Three decision categories with controlled substrate sufficiency:
 *  - state-complete: answerable from bounded ExecutionState alone (C succeeds)
 *  - evidence-dependent: requires supporting evidence not in state (C fails, D retrieves)
 *  - history-dependent: requires deep historical raw detail (retroactive relevance, C fails, D targeted fetch)
 */
export type DecisionCategory = "state-complete" | "evidence-dependent" | "history-dependent";

export const DECISION_CATEGORIES: readonly DecisionCategory[] = [
  "state-complete",
  "evidence-dependent",
  "history-dependent",
] as const;

// ─── Decision point ────────────────────────────────────────────────

export type DecisionPoint = Readonly<{
  id: string;
  stepIndex: number; // 1-indexed step where decision is evaluated
  category: DecisionCategory;
  /** Ground truth — opaque token the FakeModel must reproduce when info is present */
  groundTruth: string;
  /** Which info is required */
  requiresEvidence: boolean;
  requiresHistory: boolean;
  /** For history-dependent: seq of the evidence/history event that contains the answer */
  sourceSeq?: number;
  /** For evidence-dependent: evidenceId that must be in context */
  evidenceId?: string;
}>;

// ─── Scenario ──────────────────────────────────────────────────────

export type BenchmarkScenario = Readonly<{
  scenarioId: string;
  seed: number;
  horizon: number;
  objective: string;
  /** Authoritative history — EventLog truth (never mutated by harness) */
  events: readonly BenchmarkEvent[];
  decisionPoints: readonly DecisionPoint[];
  /** Human-readable description of controlled failures/distractors injected */
  description: string;
}>;

export type BenchmarkEvent = Readonly<{
  seq: number;
  type: string;
  payload: unknown;
  id?: string;
}>;

// ─── Governance / budget (held constant across substrates) ─────────

export type GovernanceConfig = Readonly<{
  budgetTokens: number;
  allowHistoryRetrieval: boolean;
  allowEvidenceRetrieval: boolean;
}>;

export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  budgetTokens: 16000,
  allowHistoryRetrieval: true,
  allowEvidenceRetrieval: true,
};

// ─── Machine-readable result §30 + issue #628 ─────────────────────

/**
 * Machine-readable per-(scenario, seed, horizon, substrate) row.
 * Required fields from issue #628 acceptance: {scenario, seed, horizon, substrate,
 * taskSuccess, decisionAccuracy, prompt/state/evidence/historyTokens, escalations}
 * plus extended metrics per §28-30 and ticket #623.
 */
export type BenchmarkResultRow = Readonly<{
  scenario: string;
  seed: number;
  horizon: number;
  substrate: Substrate;
  // correctness group
  taskSuccess: boolean;
  decisionAccuracy: number; // 0..1
  correctDecisions: number;
  totalDecisions: number;
  // context efficiency group
  promptTokens: number;
  stateTokens: number;
  evidenceTokens: number;
  historyTokens: number;
  cumulativeTokens: number; // sum of promptTokens across decisions (harness-level)
  // adaptive group
  escalations: number;
  unnecessary_escalations: number;
  retrieval_precision: number; // 0..1 — escalations that were necessary and correct / total escalations
  state_sufficiency: number; // 0..1 — decisions correct without escalations / total (measures projection adequacy §29)
  historical_retrieval_rate: number; // escalations / totalDecisions
  // horizon group
  tokensPerStep: number; // promptTokens / horizon (boundedness indicator)
}>;

/** Full harness output for one scenario across all substrates/horizons */
export type BenchmarkReport = Readonly<{
  generatedAt: string;
  governance: GovernanceConfig;
  rows: readonly BenchmarkResultRow[];
  summary: BenchmarkSummary;
}>;

export type BenchmarkSummary = Readonly<{
  /** C horizon-invariant check: max-min promptTokens across horizons for state-complete should be bounded */
  cStateTokensBounded: boolean;
  /** C state-complete accuracy remains 1.0 at all horizons */
  cStateCompleteInvariant: boolean;
  /** D recovers evidence/history-dependent (C may fail, D retrieves) */
  dRecovers: boolean;
  /** D context bounded */
  dBounded: boolean;
  /** D retrieval precision threshold */
  dPrecisionOk: boolean;
}>;

// ─── Substrate token capture (per-decision) ────────────────────────

export type SubstrateContext = Readonly<{
  substrate: Substrate;
  state?: unknown;
  latestObservation?: unknown;
  evidence?: readonly unknown[];
  historySlice?: readonly unknown[];
  fullHistory?: readonly unknown[];
  summary?: string;
}>;

// ─── Horizon set per issue #628 ───────────────────────────────────

export const REQUIRED_HORIZONS: readonly number[] = [10, 50, 100, 500] as const;

export const ALL_HORIZONS_EXTENDED: readonly number[] = [10, 25, 50, 100, 200, 500] as const;
