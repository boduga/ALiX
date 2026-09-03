// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Deterministic token estimation for the harness.
 *
 * Uses character-based heuristic (JSON length / 4) — deterministic, no external service,
 * sufficient to measure relative substrate efficiency and boundedness invariants.
 * Mirrors §28 observability (prompt/state/evidence/history tokens, context_tokens_saved).
 *
 * @module benchmark/tokens
 */

export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  let str: string;
  if (typeof value === "string") str = value;
  else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  if (!str) return 0;
  // ~4 chars per token (standard heuristic), minimum 1 for non-empty
  return Math.max(1, Math.ceil(str.length / 4));
}

export function estimateTokensForEvents(events: readonly unknown[]): number {
  return estimateTokens(events);
}
