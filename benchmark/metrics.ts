// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * MetricsCollector — 4-group metrics per §28-30 plus retrieval_precision, state_sufficiency.
 *
 * Groups:
 *  - correctness: taskSuccess, decisionAccuracy, correct/total, per-category accuracy
 *  - context efficiency: prompt/state/evidence/historyTokens, cumulativeTokens, tokensSaved vs A, tokensPerStep
 *  - adaptive: escalations, unnecessary_escalations, retrieval_precision, historical_retrieval_rate, state_sufficiency
 *  - horizon: delegated to harness-level summary (invariants 10→500), but per-row tokensPerStep included
 *
 * @module benchmark/metrics
 */

import type { BenchmarkResultRow, Substrate, DecisionCategory } from "./types.js";

export type PerDecisionRecord = Readonly<{
  pointId: string;
  category: DecisionCategory;
  correct: boolean;
  escalated: boolean;
  wasNecessaryEscalation: boolean; // escalated && category != state-complete
  wasUnnecessaryEscalation: boolean; // escalated && category == state-complete
  promptTokens: number;
  stateTokens: number;
  evidenceTokens: number;
  historyTokens: number;
}>;

export class MetricsCollector {
  private records: PerDecisionRecord[] = [];
  private cumulativePromptTokens = 0;

  add(record: PerDecisionRecord): void {
    this.records.push(record);
    this.cumulativePromptTokens += record.promptTokens;
  }

  getRecords(): readonly PerDecisionRecord[] {
    return this.records;
  }

  buildRow(args: {
    scenario: string;
    seed: number;
    horizon: number;
    substrate: Substrate;
  }): BenchmarkResultRow {
    const total = this.records.length;
    const correct = this.records.filter(r => r.correct).length;
    const decisionAccuracy = total === 0 ? 0 : correct / total;
    // Task success: all decisions correct (strict) — reflects deterministic workload
    const taskSuccess = total > 0 && correct === total;

    // Token aggregates — for per-row we use avg promptTokens / cumulative / per-step
    // PromptTokens in row is the maximum (peak) prompt for horizon-invariance, but we also store cumulative
    const maxPromptTokens = this.records.reduce((m, r) => Math.max(m, r.promptTokens), 0);
    const avgPromptTokens = total === 0 ? 0 : Math.round(this.cumulativePromptTokens / total);
    // For row's promptTokens we expose peak (boundedness) — avg is more stable but peak shows O(T) for A
    // Use max for correctness of horizon growth assertion
    const promptTokens = maxPromptTokens || avgPromptTokens;

    const stateTokens = this.records.reduce((m, r) => Math.max(m, r.stateTokens), 0);
    const evidenceTokens = this.records.reduce((s, r) => s + r.evidenceTokens, 0);
    const historyTokens = this.records.reduce((m, r) => Math.max(m, r.historyTokens), 0);

    const escalations = this.records.filter(r => r.escalated).length;
    const unnecessary_escalations = this.records.filter(r => r.wasUnnecessaryEscalation).length;
    const necessaryEscalations = this.records.filter(r => r.wasNecessaryEscalation).length;

    // retrieval_precision: escalations that were necessary and led to correct decision / total escalations
    // For deterministic harness, necessary escalations are exactly those on evidence/history that succeed after escalation
    const preciseEscalations = this.records.filter(r => r.wasNecessaryEscalation && r.correct).length;
    const retrieval_precision = escalations === 0 ? 1 : preciseEscalations / escalations;

    // historical_retrieval_rate
    const historical_retrieval_rate = total === 0 ? 0 : escalations / total;

    // state_sufficiency: decisions correct WITHOUT escalation / total (projection adequacy §29)
    const sufficientCorrect = this.records.filter(r => r.correct && !r.escalated).length;
    const state_sufficiency = total === 0 ? 0 : sufficientCorrect / total;

    const tokensPerStep = args.horizon === 0 ? 0 : Math.round((promptTokens / args.horizon) * 100) / 100;
    const cumulativeTokens = this.cumulativePromptTokens;

    return {
      scenario: args.scenario,
      seed: args.seed,
      horizon: args.horizon,
      substrate: args.substrate,
      taskSuccess,
      decisionAccuracy: Math.round(decisionAccuracy * 1000) / 1000,
      correctDecisions: correct,
      totalDecisions: total,
      promptTokens,
      stateTokens,
      evidenceTokens,
      historyTokens,
      cumulativeTokens,
      escalations,
      unnecessary_escalations,
      retrieval_precision: Math.round(retrieval_precision * 1000) / 1000,
      state_sufficiency: Math.round(state_sufficiency * 1000) / 1000,
      historical_retrieval_rate: Math.round(historical_retrieval_rate * 1000) / 1000,
      tokensPerStep,
    };
  }

  /** Per-category accuracy helper for assertions */
  accuracyForCategory(cat: DecisionCategory): number {
    const subset = this.records.filter(r => r.category === cat);
    if (subset.length === 0) return 1;
    return subset.filter(r => r.correct).length / subset.length;
  }
}
