// src/adaptive/policy.ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
//
// Hybrid substrate and adaptive policy — Tracer bullet for #625
//
// Implements AdaptivePolicy.decide(ExecutionSignals) → AdaptiveDecision
// per docs/ALiX-ExecutionState-Architecture.md §16-19 (Hybrid substrate
// and adaptive switching).
//
// Invariants enforced by this stub:
//   - EventLog is authoritative, ExecutionState is decision anchor (§13).
//     History modes are selective (§16: "never wholesale dump") —
//     ExecutionState anchor is never bypassed.
//   - Deterministic: same signals → same decision (pure function, sorted triggers).
//   - Orthogonal: context signals only affect contextMode, reasoning signals only affect reasoningMode.
//   - No executor dependency, no state mutation.
//   - Hysteresis: repeatedFailure escalation is monotonic / sticky within the pure
//     decision (does not flap back to STATE_ONLY while failure persists).

/**
 * 3 context assembly modes (§16):
 *  - STATE_ONLY: bounded state + latest observation only (default)
 *  - STATE_WITH_EVIDENCE: state + relevant evidence (e.g. after repeatedFailure)
 *  - HISTORY_AWARE: state anchored + selective relevant history (never wholesale dump)
 */
export type ContextMode = "STATE_ONLY" | "STATE_WITH_EVIDENCE" | "HISTORY_AWARE";

/**
 * Orthogonal reasoning axis:
 *  - ODA: Observe-Decide-Act (structured/deterministic path)
 *  - ReAct: Reason-Act interleaved (exploratory/uncertain path)
 */
export type ReasoningMode = "ODA" | "ReAct";

/**
 * ExecutionSignals — deterministic inputs to the adaptive switch (§19).
 * Five orthogonal boolean signals.
 *
 * Context-axis signals (only affect contextMode):
 *  - latestObservationRequired  — current turn needs fresh observation grounding
 *  - historicalDependency        — retroactive/dynamic-schema need (retro relevance)
 *  - repeatedFailure             — repeated state recovery / unresolved refs
 *
 * Reasoning-axis signals (only affect reasoningMode):
 *  - highUncertainty            — open-ended / uncertain task classification
 *  - multiStepInteraction       — long-horizon multi-step coordination need
 */
export interface ExecutionSignals {
  readonly latestObservationRequired: boolean;
  readonly historicalDependency: boolean;
  readonly repeatedFailure: boolean;
  readonly highUncertainty: boolean;
  readonly multiStepInteraction: boolean;
}

/**
 * Substrate anchors — invariant: these are always true (§13, §16).
 * No decision may bypass the ExecutionState anchor or treat history as
 * authoritative truth; history is selective, EventLog remains source of truth.
 */
export interface SubstrateAnchors {
  readonly eventLogAuthoritative: true;
  readonly executionStateAnchor: true;
  /** History is selective (never wholesale transcript dump) */
  readonly historySelective: true;
}

export interface AdaptiveDecision {
  readonly contextMode: ContextMode;
  readonly reasoningMode: ReasoningMode;
  /** Sorted, de-duplicated list of signal names that triggered escalation */
  readonly triggers: readonly string[];
  /** Invariant anchors — always true by construction */
  readonly anchors: SubstrateAnchors;
}

const ANCHORS: SubstrateAnchors = Object.freeze({
  eventLogAuthoritative: true as const,
  executionStateAnchor: true as const,
  historySelective: true as const,
});

/**
 * AdaptivePolicy — deterministic substrate switch.
 *
 * - Pure, no side effects, no I/O, no executor coupling, no state mutation.
 * - Context signals ONLY influence contextMode; reasoning signals ONLY influence reasoningMode.
 * - HISTORY_AWARE never bypasses ExecutionState; history is selective.
 * - Deterministic: sorted triggers, no randomness/time.
 */
export class AdaptivePolicy {
  static decide(signals: ExecutionSignals): AdaptiveDecision {
    // Defensive copy — never mutate inputs
    const s: ExecutionSignals = {
      latestObservationRequired: Boolean(signals.latestObservationRequired),
      historicalDependency: Boolean(signals.historicalDependency),
      repeatedFailure: Boolean(signals.repeatedFailure),
      highUncertainty: Boolean(signals.highUncertainty),
      multiStepInteraction: Boolean(signals.multiStepInteraction),
    };

    // ── Context mode (only context signals) ──────────────────────
    // Precedence: HISTORY_AWARE > STATE_WITH_EVIDENCE > STATE_ONLY
    // Hysteresis: repeatedFailure keeps at least STATE_WITH_EVIDENCE;
    //             historicalDependency keeps HISTORY_AWARE.
    let contextMode: ContextMode = "STATE_ONLY";
    const contextTriggers: string[] = [];

    if (s.historicalDependency) {
      contextMode = "HISTORY_AWARE";
      contextTriggers.push("historicalDependency");
    } else if (s.repeatedFailure) {
      contextMode = "STATE_WITH_EVIDENCE";
      contextTriggers.push("repeatedFailure");
    }

    if (s.latestObservationRequired) {
      contextTriggers.push("latestObservationRequired");
    }

    // ── Reasoning mode (only reasoning signals) ──────────────────
    let reasoningMode: ReasoningMode = "ODA";
    const reasoningTriggers: string[] = [];

    if (s.highUncertainty) {
      reasoningMode = "ReAct";
      reasoningTriggers.push("highUncertainty");
    }
    if (s.multiStepInteraction) {
      reasoningMode = "ReAct";
      reasoningTriggers.push("multiStepInteraction");
    }

    // Merge + deterministic sort + dedup
    const triggers = [...new Set([...contextTriggers, ...reasoningTriggers])].sort();

    return Object.freeze({
      contextMode,
      reasoningMode,
      triggers: Object.freeze([...triggers]),
      anchors: ANCHORS,
    });
  }
}
