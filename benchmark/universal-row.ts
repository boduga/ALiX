// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Cross-harness universal row (residual step 1).
 *
 * One common schema that the synthetic harness, the real-model runs, and the
 * live-session shadow measurement can all emit — so "synthetic benchmark"
 * and "real sessions" land in one comparable table instead of two
 * incomparable reports. `toUniversalRows` is the emission point harnesses
 * call; `measureSessionShadow` attaches its row as `report.universal`.
 *
 * Fields a harness cannot measure stay `null` (never fabricated):
 *  - live sessions have no seed/horizon and no decision accuracy (the shadow
 *    measures boundedness, not correctness); cross-source comparison is
 *    therefore boundedness-only (promptRatio) with a null accuracyDelta.
 *  - char/4 token estimates reuse the harness heuristic (`estimateTokens`);
 *    historyTokens/escalations are 0 for the shadow because it uses no
 *    history and performs no escalations — measured facts, not fill-ins.
 *
 * @module benchmark/universal-row
 */

import type { BenchmarkReport, BenchmarkResultRow, Substrate } from "./types.js";
import type { SessionShadowReport } from "./session-shadow.js";

export type UniversalRowSource = "synthetic" | "real-model" | "live-session";

export type UniversalBenchmarkRow = Readonly<{
  source: UniversalRowSource;
  /** What was measured: scenarioId (harness) or sessionId (live session). */
  subject: string;
  seed: number | null;
  horizon: number | null;
  /** Substrate for harnesses, "shadow" for the live-session measurement. */
  substrate: Substrate | "shadow";
  /** Real-model label (e.g. provider/model); null for FakeModel and shadow. */
  model: string | null;
  /** Null when the harness does not measure correctness (shadow). */
  decisionAccuracy: number | null;
  taskSuccess: boolean | null;
  promptTokens: number;
  stateTokens: number;
  evidenceTokens: number;
  historyTokens: number;
  cumulativeTokens: number | null;
  escalations: number;
  unnecessaryEscalations: number | null;
  retrievalPrecision: number | null;
  stateSufficiency: number | null;
}>;

/** Synthetic (FakeModel) harness row → universal. FakeModel only — never pass a model label here. */
export function syntheticRowToUniversal(row: BenchmarkResultRow): UniversalBenchmarkRow {
  return {
    source: "synthetic",
    subject: row.scenario,
    seed: row.seed,
    horizon: row.horizon,
    substrate: row.substrate,
    model: null,
    decisionAccuracy: row.decisionAccuracy,
    taskSuccess: row.taskSuccess,
    promptTokens: row.promptTokens,
    stateTokens: row.stateTokens,
    evidenceTokens: row.evidenceTokens,
    historyTokens: row.historyTokens,
    cumulativeTokens: row.cumulativeTokens,
    escalations: row.escalations,
    unnecessaryEscalations: row.unnecessary_escalations,
    retrievalPrecision: row.retrieval_precision,
    stateSufficiency: row.state_sufficiency,
  };
}

/** Real-model harness row → universal. Requires the model label — callers must only use this for real-model runs. */
export function realModelRowToUniversal(row: BenchmarkResultRow, model: string): UniversalBenchmarkRow {
  return { ...syntheticRowToUniversal(row), source: "real-model", model };
}

/** Whole synthetic report → universal rows (the harness emission point). */
export function toUniversalRows(report: BenchmarkReport, model: string | null = null): UniversalBenchmarkRow[] {
  return report.rows.map((row) =>
    model ? realModelRowToUniversal(row, model) : syntheticRowToUniversal(row),
  );
}

/** Live-session shadow report → universal. Accuracy stays null (boundedness only). */
export function shadowReportToUniversal(report: SessionShadowReport): UniversalBenchmarkRow {
  return {
    source: "live-session",
    subject: report.sessionId,
    seed: null,
    horizon: null,
    substrate: "shadow",
    model: null,
    decisionAccuracy: null,
    taskSuccess: null,
    promptTokens: report.shadowPromptTokens,
    stateTokens: report.sections?.stateChars != null ? Math.ceil(report.sections.stateChars / 4) : 0,
    evidenceTokens: report.sections?.evidenceChars != null ? Math.ceil(report.sections.evidenceChars / 4) : 0,
    historyTokens: 0,
    cumulativeTokens: null,
    escalations: 0,
    unnecessaryEscalations: null,
    retrievalPrecision: null,
    stateSufficiency: null,
  };
}

export type UniversalComparison = Readonly<{
  baseline: string;
  candidate: string;
  /** candidate.promptTokens / baseline.promptTokens (null when baseline is 0). */
  promptRatio: number | null;
  /** candidate − baseline accuracy; null when either side is unmeasured (cross-source). */
  accuracyDelta: number | null;
  /** True when the candidate is bounded-cheaper without losing accuracy. */
  candidateWins: boolean;
}>;

/** Side-by-side comparison of two universal rows (one table, both harnesses). */
export function compareUniversalRows(
  baseline: UniversalBenchmarkRow,
  candidate: UniversalBenchmarkRow,
): UniversalComparison {
  const promptRatio = baseline.promptTokens === 0 ? null : candidate.promptTokens / baseline.promptTokens;
  const accuracyDelta =
    baseline.decisionAccuracy === null || candidate.decisionAccuracy === null
      ? null
      : candidate.decisionAccuracy - baseline.decisionAccuracy;
  const candidateWins =
    promptRatio !== null &&
    promptRatio < 1 &&
    (accuracyDelta === null || accuracyDelta >= -1e-9);
  return {
    baseline: `${baseline.source}/${baseline.subject}/${baseline.substrate}`,
    candidate: `${candidate.source}/${candidate.subject}/${candidate.substrate}`,
    promptRatio,
    accuracyDelta,
    candidateWins,
  };
}

export type UniversalInvariants = Readonly<{
  /** Max prompt / min prompt across the given rows (boundedness). */
  promptRatio: number | null;
  bounded: boolean;
  /** Every row meets the accuracy floor (skips unmeasured rows). */
  accuracyFloor: boolean;
  /** Lowest measured retrieval precision (null when none measured). */
  minPrecision: number | null;
}>;

/**
 * Horizon-sweep invariants over a set of universal rows (mirrors
 * BenchmarkSummary for mixed sources): bounded prompt growth, accuracy
 * floor, and precision. Unmeasured fields are skipped, never defaulted.
 */
export function checkUniversalInvariants(
  rows: readonly UniversalBenchmarkRow[],
  opts?: { maxPromptRatio?: number; accuracyFloor?: number },
): UniversalInvariants {
  const maxRatio = opts?.maxPromptRatio ?? 2.0;
  const floor = opts?.accuracyFloor ?? 1.0;
  const prompts = rows.map((r) => r.promptTokens);
  const promptRatio =
    prompts.length === 0 || Math.min(...prompts) === 0
      ? null
      : Math.max(...prompts) / Math.min(...prompts);
  const measured = rows.filter((r) => r.decisionAccuracy !== null);
  const precisions = rows
    .map((r) => r.retrievalPrecision)
    .filter((v): v is number => v !== null);
  return {
    promptRatio,
    bounded: promptRatio !== null && promptRatio <= maxRatio,
    accuracyFloor: measured.every((r) => (r.decisionAccuracy as number) >= floor),
    minPrecision: precisions.length > 0 ? Math.min(...precisions) : null,
  };
}

export type LiveSendBar = Readonly<{
  pass: boolean;
  baselineAccuracy: number | null;
  candidateAccuracy: number | null;
  delta: number | null;
}>;

/**
 * Live-send accuracy bar (process gate, code-real): the candidate (state
 * prompt) must hold parity ±2pp against the baseline (transcript) on
 * measured eval rows, else revert. Null accuracies abstain (fail-closed to
 * null pass only when both sides are measured and within tolerance).
 */
export function assertLiveSendBar(
  baseline: UniversalBenchmarkRow,
  candidate: UniversalBenchmarkRow,
  tolerance = 0.02,
): LiveSendBar {
  const delta =
    baseline.decisionAccuracy === null || candidate.decisionAccuracy === null
      ? null
      : candidate.decisionAccuracy - baseline.decisionAccuracy;
  return {
    pass: delta !== null && delta >= -tolerance,
    baselineAccuracy: baseline.decisionAccuracy,
    candidateAccuracy: candidate.decisionAccuracy,
    delta,
  };
}

/** Markdown table for a set of universal rows (the "one table" goal). */
export function renderUniversalTable(rows: readonly UniversalBenchmarkRow[]): string {
  const lines = [
    "| source | subject | seed | horizon | substrate | model | acc | success | prompt | state | evidence | history | cumulative | esc | unnec | precision | sufficiency |",
    "|---|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    const cell = (v: number | string | boolean | null): string =>
      v === null || v === undefined ? "—" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v);
    lines.push(
      `| ${r.source} | ${r.subject} | ${cell(r.seed)} | ${cell(r.horizon)} | ${r.substrate} | ${cell(r.model)} | ${cell(r.decisionAccuracy)} | ${cell(r.taskSuccess)} | ${r.promptTokens} | ${r.stateTokens} | ${r.evidenceTokens} | ${r.historyTokens} | ${cell(r.cumulativeTokens)} | ${r.escalations} | ${cell(r.unnecessaryEscalations)} | ${cell(r.retrievalPrecision)} | ${cell(r.stateSufficiency)} |`,
    );
  }
  return lines.join("\n");
}
