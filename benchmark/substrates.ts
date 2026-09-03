// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Substrate context assemblers — same scenario, different prompt construction.
 *
 * Four modes through the SAME harness:
 *  A full history  — prompt = all history tokens (O(T), cumulative O(T²), succeeds everywhere)
 *  B summary fixed — prompt = fixed summary tokens (bounded but lossy: only state-complete succeeds)
 *  C state         — prompt = state + latest observation only (bounded, fails evidence/history)
 *  D hybrid        — prompt = C base + targeted evidence/history slice ONLY when required (bounded + recovers)
 *
 * Arch §30 / §16 / §20 context builder pattern. D is state-anchored and never wholesale dumps history.
 *
 * @module benchmark/substrates
 */

import type { Substrate, SubstrateContext, DecisionPoint } from "./types.js";
import type { FakeExecutionEnvironment } from "./fake-environment.js";
import { estimateTokens } from "./tokens.js";

export type AssembledContext = Readonly<{
  modelContext: SubstrateContext;
  stateTokens: number;
  evidenceTokens: number;
  historyTokens: number;
  promptTokens: number;
}>;

/**
 * Assemble context for a single decision point under the given substrate.
 * For D hybrid, `includeEvidence`/`includeHistory` control whether targeted slices are included
 * (harness escalates only when FakeModel says needsEscalation and decision requires it).
 */
export function assembleContext(
  substrate: Substrate,
  env: FakeExecutionEnvironment,
  point: DecisionPoint,
  opts: { includeEvidence?: boolean; includeHistory?: boolean } = {},
): AssembledContext {
  const stateView = env.getProjectedStateView();
  const latestObservation = env.getLatestObservation();
  const obsTokens = estimateTokens(latestObservation);

  switch (substrate) {
    case "A_full_history": {
      const fullHistory = env.getFullHistory();
      const historyTokens = estimateTokens(fullHistory);
      const stateTokens = 0; // state not separately counted — history contains everything
      const evidenceTokens = 0;
      const promptTokens = historyTokens + obsTokens;
      const modelContext: SubstrateContext = {
        substrate,
        fullHistory,
        latestObservation,
        state: stateView, // also available but history is authoritative
      };
      return { modelContext, stateTokens, evidenceTokens, historyTokens, promptTokens };
    }

    case "B_summary_fixed": {
      const summary = env.getSummaryFixed(3200); // fixed budget ~800 tokens
      const promptTokens = estimateTokens(summary) + obsTokens;
      // B's historyTokens reflects authoritative history size (for comparison), but prompt is bounded
      const historyTokens = estimateTokens(env.getFullHistory());
      const modelContext: SubstrateContext = {
        substrate,
        summary,
        latestObservation,
      };
      // summary tokens counted as prompt; no separate evidence/history in prompt
      return { modelContext, stateTokens: 0, evidenceTokens: 0, historyTokens, promptTokens };
    }

    case "C_state": {
      const stateTokens = estimateTokens(stateView);
      const promptTokens = stateTokens + obsTokens;
      const modelContext: SubstrateContext = {
        substrate,
        state: stateView,
        latestObservation,
      };
      // C never includes evidence/history — bounded but incomplete
      return { modelContext, stateTokens, evidenceTokens: 0, historyTokens: 0, promptTokens };
    }

    case "D_hybrid": {
      const stateTokens = estimateTokens(stateView);
      let evidenceTokens = 0;
      let historyTokens = 0;
      let evidence: readonly unknown[] | undefined;
      let historySlice: readonly unknown[] | undefined;

      if (opts.includeEvidence && point.evidenceId) {
        const ev = env.getEvidenceForDecision(point.evidenceId);
        evidence = ev;
        evidenceTokens = estimateTokens(ev);
      }
      if (opts.includeHistory && point.sourceSeq != null) {
        const slice = env.getHistorySlice(point.sourceSeq);
        historySlice = slice ? [slice] : [];
        historyTokens = estimateTokens(historySlice);
      }

      const promptTokens = stateTokens + evidenceTokens + historyTokens + obsTokens;
      const modelContext: SubstrateContext = {
        substrate,
        state: stateView,
        latestObservation,
        ...(evidence ? { evidence } : {}),
        ...(historySlice ? { historySlice } : {}),
      };
      return { modelContext, stateTokens, evidenceTokens, historyTokens, promptTokens };
    }

    default:
      throw new Error(`Unknown substrate ${String(substrate)}`);
  }
}
