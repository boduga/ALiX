/**
 * attempts.ts — Shared helpers for reading executeWithFallback attempt lists.
 *
 * Used by every decision's shadow runner so attempt interpretation cannot
 * drift between decisions.
 */

import type { AttemptRecord } from "../../fallback.js";

/** Engine that produced the winning outcome (last successful attempt). */
export function observedEngineId(attempts: readonly AttemptRecord[], fallbackId: string): string {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index]?.ok) return attempts[index]!.engineId;
  }
  return fallbackId;
}

/** Total time spent across every attempt, including failed ones. */
export function totalLatency(attempts: readonly AttemptRecord[]): number {
  return attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
}
