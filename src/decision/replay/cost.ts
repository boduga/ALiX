/**
 * cost.ts — Decision cost model (J5 task 32).
 *
 * Estimates are NOT measurements: the harness records latency, not tokens.
 * Vendor pricing is a compile-time constant with its source precisely so a
 * pricing change is a one-line, reviewable diff — never a silent drift.
 */

import type { DecisionUsage } from "../contracts.js";
import type { ReplayFixture } from "./fixtures.js";
import { JEV_ENGINE_ID } from "../engines/jev.js";
import { LOCAL_ENGINE_ID } from "../engines/local.js";

/** TypeSafe Jev: $0.042 / MTok input, output free (research doc §4, primary sources). */
export const JEV_PRICE_PER_MTOK_USD = 0.042;

/**
 * Token estimate from text length. Same char≈token*4 heuristic the repo's
 * context budgeting uses (`src/runtime/context/AGENTS.md`).
 */
export function estimateInputTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Estimated USD cost of replaying one fixture on an engine. Local engines
 * cost 0. Unknown engine ids throw — a cost must never be silently understated.
 */
export function estimateFixtureCostUsd(
  fixture: ReplayFixture,
  engineId: string,
): number {
  if (engineId === LOCAL_ENGINE_ID) return 0;
  if (engineId === JEV_ENGINE_ID) {
    const tokens = estimateInputTokens(JSON.stringify(fixture.sealed.payload));
    return (tokens / 1_000_000) * JEV_PRICE_PER_MTOK_USD;
  }
  throw new Error(`No cost model for engine: ${engineId}`);
}

/** Sum of estimated costs over a set of fixtures. */
export function estimateSuiteCostUsd(
  fixtures: readonly ReplayFixture[],
  engineId: string,
): number {
  return fixtures.reduce((sum, fixture) => sum + estimateFixtureCostUsd(fixture, engineId), 0);
}

/**
 * Exact cost from provider-reported usage. Preferred over the estimate whenever
 * the engine reports tokens — the estimate only exists for engines that don't.
 */
export function costFromUsage(engineId: string, usage: DecisionUsage): number {
  if (engineId === LOCAL_ENGINE_ID) return 0;
  if (engineId === JEV_ENGINE_ID) {
    return (usage.inputTokens / 1_000_000) * JEV_PRICE_PER_MTOK_USD;
  }
  throw new Error(`No cost model for engine: ${engineId}`);
}

/**
 * Cost for one replayed call: reported usage when available, else the
 * fixture-content estimate.
 */
export function costForRun(
  fixture: ReplayFixture,
  engineId: string,
  usage?: DecisionUsage,
): number {
  return usage !== undefined ? costFromUsage(engineId, usage) : estimateFixtureCostUsd(fixture, engineId);
}
