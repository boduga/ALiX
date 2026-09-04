// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Hardening: prompt-contract — no full-history regression (#644)
 *
 * Tracer bullet that prevents future changes from accidentally reintroducing
 * full-history context into the prompt. Guards three invariants:
 *
 *  1. History is opt-in only — buildExecutionContext never includes full
 *     history unless opts.history explicitly passed (historyIncluded false
 *     by default).
 *  2. Prompt remains bounded O(|P|+|Σ|+|O|) for a 500-step horizon —
 *     state is capped (~65 lines / ~2k chars) while wholesale history would
 *     be ~27k chars. Prompt length must be constant regardless of horizon.
 *  3. Wholesale history dump fails the contract — default prompt must not
 *     contain history contents; any reintroduction of EventLog dump without
 *     explicit opt-in is a test failure.
 *
 * Uses src/runtime/context/context-builder.ts (pure mechanical builder).
 */

import { describe, it, expect } from "vitest";
import {
  buildExecutionContext,
  MAX_PENDING_RENDER,
  type EvidenceInput,
  type ToolInput,
} from "../../src/runtime/context/context-builder.js";
import {
  EXECUTION_STATE_SCHEMA_VERSION,
  type ExecutionState,
} from "../../src/runtime/execution-state/execution-state.js";

// ─── Helpers ───────────────────────────────────────────────────────────

function makeState(
  step: number,
  overrides: Partial<ExecutionState> = {},
): ExecutionState {
  return {
    executionId: "exec-prompt-contract",
    schemaVersion: EXECUTION_STATE_SCHEMA_VERSION,
    version: step,
    step,
    objective: "Implement feature X",
    status: "running",
    intent: { intentId: "intent-1" },
    pendingActions: [],
    activeCapabilities: [{ capabilityId: "cap.test", version: "1.0.0", availability: "available" }],
    constraints: [],
    artifacts: [],
    ...overrides,
  } as ExecutionState;
}

function makeHistory(size: number): readonly string[] {
  // Each entry ~54 chars → 500 * 54 ≈ 27_000 (matches issue: history 27002)
  return Array.from({ length: size }, (_, i) => {
    const pad = String(i).padStart(3, "0");
    // ~54 chars per entry (deterministic, no randomness)
    return `step-${pad}: action completed — result ok — filler ${pad}..`;
  });
}

const SKILL = "You are ALiX. Follow the skill spec.";
const OBSERVATION = "latest tool output: ok";
const EVIDENCE: readonly EvidenceInput[] = [
  { id: "ev-1", content: "evidence record 1: relevant file src/foo.ts" },
  { id: "ev-2", content: "evidence record 2: test output passed" },
];
const TOOLS: readonly ToolInput[] = [
  { name: "read_file", description: "read a file" },
  { name: "write_file", description: "write a file" },
];

// ─── Suite ─────────────────────────────────────────────────────────────

describe("Hardening: prompt-contract — no full-history regression (#644)", () => {
  // ── 1. History opt-in — default false ─────────────────────────────────

  describe("history opt-in — historyIncluded false by default", () => {
    it("never includes history when opts omitted", () => {
      const ctx = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS);
      expect(ctx.metadata.historyIncluded).toBe(false);
      expect(ctx.sections.history).toBeUndefined();
      expect(ctx.prompt).not.toContain("<history>");
      expect(ctx.prompt).not.toContain("</history>");
    });

    it("never includes history when opts.history is undefined", () => {
      const ctx = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS, {
        history: undefined,
      });
      expect(ctx.metadata.historyIncluded).toBe(false);
      expect(ctx.sections.history).toBeUndefined();
      expect(ctx.prompt).not.toContain("<history>");
    });

    it("never includes history when opts.history is null", () => {
      const ctx = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS, {
        history: null,
      } as any);
      expect(ctx.metadata.historyIncluded).toBe(false);
      expect(ctx.sections.history).toBeUndefined();
      expect(ctx.prompt).not.toContain("<history>");
    });

    it("never includes history when opts.history is empty array", () => {
      const ctx = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS, {
        history: [],
      });
      expect(ctx.metadata.historyIncluded).toBe(false);
      expect(ctx.sections.history).toBeUndefined();
      expect(ctx.prompt).not.toContain("<history>");
    });

    it("includes history only when non-empty opts.history explicitly passed", () => {
      const history = ["step-001: hello", "step-002: world"];
      const ctx = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS, {
        history,
      });
      expect(ctx.metadata.historyIncluded).toBe(true);
      expect(ctx.sections.history).toBeDefined();
      expect(ctx.prompt).toContain("<history>");
      expect(ctx.prompt).toContain("step-001: hello");
      expect(ctx.prompt).toContain("step-002: world");
    });

    it("opts without history does not leak history via other fields", () => {
      // Even though a caller might have a 500-step history available, unless
      // it is passed via opts.history the builder must not pull it in.
      const history = makeHistory(500);
      const ctx = buildExecutionContext(SKILL, makeState(500), OBSERVATION, EVIDENCE, TOOLS);
      for (const entry of history.slice(0, 5)) {
        expect(ctx.prompt).not.toContain(entry);
      }
      expect(ctx.metadata.historyIncluded).toBe(false);
    });
  });

  // ── 2. Bounded O(|P|+|Σ|+|O|) for 500-step horizon ───────────────────

  describe("bounded prompt O(|P|+|Σ|+|O|) — 500-step horizon (state 65 vs history 27002)", () => {
    it("prompt remains bounded regardless of horizon — 10 vs 500 steps delta < 2k chars", () => {
      const state10 = makeState(10);
      const state500 = makeState(500);

      const ctx10 = buildExecutionContext(SKILL, state10, OBSERVATION, EVIDENCE, TOOLS);
      const ctx500 = buildExecutionContext(SKILL, state500, OBSERVATION, EVIDENCE, TOOLS);

      // State rendering itself is bounded (compact <execution_state>, not raw history)
      // Both prompts should be small and nearly identical — O(|P|+|Σ|+|O|) constant.
      const delta = Math.abs(ctx500.prompt.length - ctx10.prompt.length);
      // Step number changes a few chars; no linear growth with horizon.
      expect(delta).toBeLessThan(2_000);

      // Prompt is bounded: even with 500 pendingActions the renderer caps at 20
      const bigPending = Array.from({ length: 500 }, (_, i) => ({
        actionId: `act-${String(i).padStart(3, "0")}`,
        kind: "tool",
        description: `pending action ${i}`,
      }));
      const stateWith500Pending = makeState(500, { pendingActions: bigPending });
      const ctxCapped = buildExecutionContext(SKILL, stateWith500Pending, OBSERVATION, EVIDENCE, TOOLS);
      // Capped state should still be bounded — not 500 * rendering
      const cappedDelta = Math.abs(ctxCapped.prompt.length - ctx10.prompt.length);
      expect(cappedDelta).toBeLessThan(2_000);
      // Must indicate truncation (20 rendered + overflow marker)
      expect(ctxCapped.sections.executionState).toContain(`+${500 - MAX_PENDING_RENDER} more`);
    });

    it("state chars << history chars — history 500*~54 ≈ 27k, prompt stays O(Σ)", () => {
      const history = makeHistory(500);
      const historyChars = history.reduce((s, e) => s + e.length, 0);

      // Issue reference: history ~27002 chars for 500 steps
      expect(historyChars).toBeGreaterThan(20_000);
      expect(historyChars).toBeGreaterThan(25_000);
      expect(historyChars).toBeLessThan(35_000);

      const ctxWithoutHistory = buildExecutionContext(
        SKILL,
        makeState(500),
        OBSERVATION,
        EVIDENCE,
        TOOLS,
      );
      const ctxWithHistory = buildExecutionContext(
        SKILL,
        makeState(500),
        OBSERVATION,
        EVIDENCE,
        TOOLS,
        { history },
      );

      // Without history: prompt is bounded and far smaller than wholesale history
      expect(ctxWithoutHistory.metadata.historyIncluded).toBe(false);
      expect(ctxWithoutHistory.prompt.length).toBeLessThan(historyChars);
      // With history: prompt grows by ~history size (explicit opt-in)
      expect(ctxWithHistory.metadata.historyIncluded).toBe(true);
      expect(ctxWithHistory.prompt.length).toBeGreaterThan(ctxWithoutHistory.prompt.length + historyChars * 0.8);

      // State itself stays small (~65 lines → ~2k chars) even at horizon 500
      const stateChars = ctxWithoutHistory.metadata.stateChars;
      expect(stateChars).toBeLessThan(8_000);
      expect(stateChars).toBeGreaterThan(100);
      // Prompt bounded: skill + state + observation + evidence ≈ O(|P|+|Σ|+|O|)
      expect(ctxWithoutHistory.prompt.length).toBeLessThan(30_000);
      expect(ctxWithoutHistory.metadata.bounded).toBe(true);
    });

    it("history opt-in adds O(|history|) — without it prompt is horizon-independent", () => {
      const history10 = makeHistory(10);
      const history500 = makeHistory(500);

      const ctx10NoHist = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS);
      const ctx500NoHist = buildExecutionContext(SKILL, makeState(500), OBSERVATION, EVIDENCE, TOOLS);
      const ctx500WithHist = buildExecutionContext(SKILL, makeState(500), OBSERVATION, EVIDENCE, TOOLS, {
        history: history500,
      });
      const ctx10WithHist = buildExecutionContext(SKILL, makeState(10), OBSERVATION, EVIDENCE, TOOLS, {
        history: history10,
      });

      // Without history: 10 vs 500 horizon almost identical
      expect(Math.abs(ctx500NoHist.prompt.length - ctx10NoHist.prompt.length)).toBeLessThan(2_000);
      // With history: 500-step history dominates 10-step history
      expect(ctx500WithHist.prompt.length - ctx10WithHist.prompt.length).toBeGreaterThan(15_000);
    });
  });

  // ── 3. Wholesale dump guard — fails if builder reintroduces history ──

  describe("wholesale history dump guard — fails if builder reintroduces full history", () => {
    it("default prompt contains no history sentinel content", () => {
      const sentinel = "HISTORY_SENTINEL_DO_NOT_INCLUDE_42f7b9c1";
      const historyContainingSentinel = [
        `step-001: ${sentinel} — this must not appear by default`,
        `step-002: another entry with ${sentinel}`,
      ];
      // Intentionally NOT passing history — builder must not have pulled it from elsewhere
      const ctx = buildExecutionContext(SKILL, makeState(100), OBSERVATION, EVIDENCE, TOOLS);
      expect(ctx.prompt).not.toContain(sentinel);
      expect(ctx.prompt).not.toContain(historyContainingSentinel[0]);
      expect(ctx.sections.history).toBeUndefined();

      // When explicitly passed, sentinel DOES appear — proving the only path is opt-in
      const ctxWith = buildExecutionContext(SKILL, makeState(100), OBSERVATION, EVIDENCE, TOOLS, {
        history: historyContainingSentinel,
      });
      expect(ctxWith.prompt).toContain(sentinel);
      expect(ctxWith.sections.history).toBeDefined();
    });

    it("prompt sections never include <history> unless explicitly requested", () => {
      const history = makeHistory(100);
      const ctxDefault = buildExecutionContext(SKILL, makeState(100), OBSERVATION, EVIDENCE, TOOLS);
      expect(Object.keys(ctxDefault.sections)).not.toContain("history");
      expect(ctxDefault.prompt).not.toMatch(/<history>/);

      const ctxExplicit = buildExecutionContext(SKILL, makeState(100), OBSERVATION, EVIDENCE, TOOLS, {
        history,
      });
      expect(Object.keys(ctxExplicit.sections)).toContain("history");
      expect(ctxExplicit.prompt).toMatch(/<history>/);
      expect(ctxExplicit.sections.history).toContain("<history>");
    });

    it("regression: EventLog / history-like content in observation/evidence does not auto-promote to <history>", () => {
      // A future change that concatenates EventLog into the prompt would be caught
      // because we assert <history> is absent even when observation/evidence are large.
      const largeObservation = "obs: " + "x".repeat(7_000);
      const largeEvidence: readonly EvidenceInput[] = Array.from({ length: 8 }, (_, i) => ({
        id: `ev-${i}`,
        content: `evidence ${i}: ` + "y".repeat(1_500),
      }));
      const ctx = buildExecutionContext(SKILL, makeState(200), largeObservation, largeEvidence, TOOLS);
      expect(ctx.metadata.historyIncluded).toBe(false);
      expect(ctx.prompt).not.toContain("<history>");
      expect(ctx.sections.history).toBeUndefined();
      // Large observation/evidence are bounded by their own caps, not promoted to history
      expect(ctx.metadata.bounded).toBe(true);
    });
  });
});
