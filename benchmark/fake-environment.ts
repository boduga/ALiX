// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * FakeExecutionEnvironment — deterministic tools for the harness.
 *
 * No LLM, no I/O. Provides:
 *  - full authoritative EventLog (events)
 *  - deterministic state projection helpers (defer to real projector if desired, but not required)
 *  - targeted evidence/history retrieval (selective fetch, not wholesale dump)
 *
 * Spec: harness runs same scenario/seed/environment/governance/budget for A/B/C/D (§30 benchmark)
 *
 * @module benchmark/fake-environment
 */

import type { BenchmarkScenario, BenchmarkEvent, GovernanceConfig } from "./types.js";
import { DEFAULT_GOVERNANCE } from "./types.js";

export class FakeExecutionEnvironment {
  readonly scenario: BenchmarkScenario;
  readonly governance: GovernanceConfig;

  constructor(scenario: BenchmarkScenario, governance: GovernanceConfig = DEFAULT_GOVERNANCE) {
    // Defensive copy — never mutate authoritative history
    this.scenario = {
      ...scenario,
      events: Object.freeze([...scenario.events]),
      decisionPoints: Object.freeze([...scenario.decisionPoints]),
    };
    this.governance = { ...governance };
  }

  /** Authoritative history — full EventLog (immutable truth, §13) */
  getFullHistory(): readonly BenchmarkEvent[] {
    return this.scenario.events;
  }

  /** Latest observation: the last event's payload (transient O per §21) */
  getLatestObservation(): unknown {
    const last = this.scenario.events[this.scenario.events.length - 1];
    return last ? last.payload : null;
  }

  /** Slice of evidence events (type == evidence.observation) that carry evidenceId/detail */
  getEvidenceById(evidenceId: string): BenchmarkEvent | undefined {
    return this.scenario.events.find(
      e => e.type === "evidence.observation" && (e.payload as Record<string, unknown>)?.evidenceId === evidenceId,
    );
  }

  /** Targeted history slice for retroactive retrieval — by seq (bounded targeted fetch, not dump) */
  getHistorySlice(seq: number): BenchmarkEvent | undefined {
    return this.scenario.events.find(e => e.seq === seq);
  }

  /** Targeted evidence list for a decision (bounded) */
  getEvidenceForDecision(evidenceId?: string): readonly BenchmarkEvent[] {
    if (!evidenceId) return [];
    const ev = this.getEvidenceById(evidenceId);
    return ev ? [ev] : [];
  }

  /** Summary stub: fixed-budget truncation of full history (B baseline — lossy, bounded) */
  getSummaryFixed(budgetChars = 3200): string {
    // Simulate fixed summary: take first 500 chars of stringified head + tail truncation
    // Intentionally drop evidence/history-dependent raw details (lossy compression per arch §9)
    const head = JSON.stringify(this.scenario.events.slice(0, 3));
    const tail = JSON.stringify(this.scenario.events.slice(-2));
    const combined = `SUMMARY(${this.scenario.objective}): ${head} ... ${tail}`;
    if (combined.length <= budgetChars) return combined;
    return combined.slice(0, budgetChars);
  }

  /** ExecutionState view — computed deterministically from state-affecting events */
  getProjectedStateView(): unknown {
    // Minimal bounded state view sufficient for state-complete decisions.
    // We avoid importing ExecutionState contract to keep harness independently testable,
    // but shape mirrors the 8-field minimal for token estimation.
    const stateAffecting = this.scenario.events.filter(e => e.type.startsWith("execution."));
    const last = stateAffecting[stateAffecting.length - 1];
    return {
      executionId: (this.scenario.events[0].payload as Record<string, unknown>).executionId,
      objective: this.scenario.objective,
      step: this.scenario.horizon,
      status: "running",
      pendingActions: [],
      activeCapabilities: [],
      // Note: deliberately does NOT embed evidence/raw history details — those are out-of-state
      evidenceHint: null,
      rawHistoryHint: null,
      version: stateAffecting.length,
      latestSeq: last?.seq ?? 0,
    };
  }

  /** Deterministic "tool" — reconcile_check returns synthetic observation */
  toolReconcileCheck(step: number): { ok: boolean; detail: string } {
    const ok = step % 5 !== 0;
    return { ok, detail: ok ? `reconciled-${step}` : `drift-${step}` };
  }
}
