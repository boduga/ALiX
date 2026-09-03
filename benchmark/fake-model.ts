// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * FakeModel — fails when required info missing, tests substrate not model.
 *
 * Deterministic, no LLM, no randomness. Decision correctness reflects state adequacy (§29: projection_adequacy)
 * not model intelligence. This isolates the substrate variable (C vs D bake-off, A/B controls).
 *
 * Rule table:
 *  - state-complete: correct iff state OR summary OR fullHistory present (state-complete is in bounded state)
 *  - evidence-dependent: correct iff evidence containing evidenceId present OR fullHistory present
 *  - history-dependent: correct iff historySlice containing sourceSeq present OR fullHistory present
 *
 * Summary (B) is modeled as lossy: it retains state-complete info but drops evidence/history raw details,
 * so B succeeds on state-complete only — mirroring arch §9 "summarization is not a substitute for structured state".
 *
 * @module benchmark/fake-model
 */

import type { DecisionPoint, SubstrateContext } from "./types.js";

export type ModelDecision = Readonly<{
  correct: boolean;
  answer: string | null;
  reason: string;
  /** Whether the model would have needed to escalate (asked for missing info) */
  needsEscalation: boolean;
}>;

export class FakeModel {
  /**
   * Deterministic decision — correct only when required info is in context.
   * No intelligence; purely checks presence of required artifact in the assembled context.
   */
  decide(context: SubstrateContext, point: DecisionPoint): ModelDecision {
    const category = point.category;

    if (category === "state-complete") {
      // State-complete is answerable from bounded state OR summary OR history
      const hasState = context.state != null;
      const hasSummary = typeof context.summary === "string" && context.summary.length > 0;
      const hasHistory = (context.fullHistory?.length ?? 0) > 0;
      const present = hasState || hasSummary || hasHistory;
      if (present) {
        return { correct: true, answer: point.groundTruth, reason: "state-complete: info in state/summary/history", needsEscalation: false };
      }
      return { correct: false, answer: null, reason: "state-complete: missing state — substrate insufficient", needsEscalation: true };
    }

    if (category === "evidence-dependent") {
      // Needs evidenceId in evidence slice OR full history
      const hasFullHistory = (context.fullHistory?.length ?? 0) > 0;
      if (hasFullHistory) {
        // Full history contains everything (A)
        const found = context.fullHistory!.some(
          (e: unknown) =>
            typeof e === "object" &&
            e !== null &&
            (e as Record<string, unknown>).type === "evidence.observation" &&
            ((e as Record<string, unknown>).payload as Record<string, unknown>)?.evidenceId === point.evidenceId,
        );
        if (found) return { correct: true, answer: point.groundTruth, reason: "evidence-dependent: found in fullHistory", needsEscalation: false };
        // Even if not found by scan, we treat full history as containing it (deterministic harness guarantee)
        return { correct: true, answer: point.groundTruth, reason: "evidence-dependent: fullHistory authoritative", needsEscalation: false };
      }

      // For hybrid/state paths, check targeted evidence slice
      const evList = context.evidence ?? [];
      const found = evList.some(
        (e: unknown) =>
          typeof e === "object" &&
          e !== null &&
          ((e as Record<string, unknown>).payload as Record<string, unknown>)?.evidenceId === point.evidenceId,
      );
      if (found) {
        return { correct: true, answer: point.groundTruth, reason: "evidence-dependent: found in evidence", needsEscalation: false };
      }

      // Summary (B) is lossy and does NOT retain evidence raw detail per design
      if (typeof context.summary === "string") {
        const retained = context.summary.includes(String(point.evidenceId ?? "")) || context.summary.includes(String(point.groundTruth));
        if (retained) {
          return { correct: true, answer: point.groundTruth, reason: "evidence-dependent: summary retained", needsEscalation: false };
        }
        return { correct: false, answer: null, reason: "evidence-dependent: summary dropped evidence", needsEscalation: true };
      }

      return { correct: false, answer: null, reason: "evidence-dependent: missing evidence — needs escalation", needsEscalation: true };
    }

    // history-dependent
    const hasFullHistory = (context.fullHistory?.length ?? 0) > 0;
    if (hasFullHistory) {
      return { correct: true, answer: point.groundTruth, reason: "history-dependent: fullHistory authoritative", needsEscalation: false };
    }
    const slice = context.historySlice ?? [];
    const found = slice.some(
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        ((e as Record<string, unknown>).seq === point.sourceSeq ||
          ((e as Record<string, unknown>).payload as Record<string, unknown>)?.groundTruth === point.groundTruth),
    );
    if (found) {
      return { correct: true, answer: point.groundTruth, reason: "history-dependent: found in historySlice", needsEscalation: false };
    }
    if (typeof context.summary === "string") {
      const retained = context.summary.includes(String(point.groundTruth));
      if (retained) return { correct: true, answer: point.groundTruth, reason: "history-dependent: summary retained", needsEscalation: false };
      return { correct: false, answer: null, reason: "history-dependent: summary dropped raw history", needsEscalation: true };
    }
    return { correct: false, answer: null, reason: "history-dependent: missing history — needs escalation", needsEscalation: true };
  }
}
