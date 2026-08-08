/**
 * ContextBudget factory + pure preflight gate (B).
 *
 * Derives an immutable per-turn budget from a {@link ModelDescriptor} and
 * proves an assembled request fits before it is sent. Preflight is pure and
 * deterministic — no mutation, truncation, eviction, compaction, digest,
 * provider call, retry, or hidden fallback. An irreducible case (the mandatory
 * core alone exceeds available input) raises a typed
 * {@link ContextBudgetOverflowError} so callers never retry an impossible
 * request forever.
 */

import type { ModelDescriptor } from "./context-limits.js";

/** Six-tier context category taxonomy (spec D). Shared by preflight, T3's
 * selector, and T6's observability. */
export type ContextCategory =
  | "mandatory_system_governance"
  | "current_task"
  | "current_execution_state"
  | "recent_conversation"
  | "recent_tool_results"
  | "older_context";

/** All categories in tier (priority) order. */
export const CONTEXT_CATEGORIES: readonly ContextCategory[] = [
  "mandatory_system_governance",
  "current_task",
  "current_execution_state",
  "recent_conversation",
  "recent_tool_results",
  "older_context",
];

/** Mandatory core = Tier 1 (system/governance) + Tier 2 (current task). If
 * these alone exceed available input the overflow is irreducible (B). */
export const MANDATORY_CATEGORIES: readonly ContextCategory[] = [
  "mandatory_system_governance",
  "current_task",
];

// Shipped reservation defaults (B): 0.20 / 4,096 / 32,768 — all config-overridable.
export const DEFAULT_OUTPUT_RATIO = 0.2;
export const DEFAULT_OUTPUT_FLOOR = 4_096;
export const DEFAULT_OUTPUT_CAP = 32_768;

/** Config surface for the reservation ratio / floor / cap (B). Wired into
 * `ContextConfig.context.budget` — the one config integration point for C0/C1. */
export interface ContextBudgetConfig {
  /** Fraction of the window reserved for output (default 0.20). */
  outputRatio?: number;
  /** Minimum reserved output tokens (default 4,096). */
  outputFloor?: number;
  /** Maximum reserved output tokens (default 32,768). */
  outputCap?: number;
  /** §5: requested max output tokens sent to the provider (clamped ≤
   *  budgetReservation). Defaults to budgetReservation (behavior preserved). */
  maxOutputTokens?: number;
}

/** Options for {@link createContextBudget}: the config knobs plus the optional
 * provider-reported max output tokens used for the
 * `min(policyReservation, outputTokenLimit)` clamp (B). */
export interface ContextBudgetOptions extends ContextBudgetConfig {
  outputTokenLimit?: number;
  /** Per-provider admission safety factor (spec §1). UNSET this cycle — full
   * wiring into the reserved math is deferred until calibration burn-in data
   * lands; callers still see the SAFETY_FACTOR (1.2) default behavior. */
  safetyFactor?: number;
}

/**
 * Immutable per-turn budget derived from a ModelDescriptor (B).
 *
 * Consumers receive the budget object, never a raw window number — no
 * downstream half-window math can resurrect under another name. Capacity /
 * reservation / ceiling are fixed; assembly consumes the remaining
 * `availableInputTokens` as it adds items. The object never mutates.
 */
export interface ContextBudget {
  readonly contextWindowTokens: number;
  /** Safety-margin reservation: availableInputTokens = window − budgetReservation. */
  readonly budgetReservation: number;
  /** maxOutputTokens sent to the provider (≤ budgetReservation invariant). */
  readonly requestedMaxOutputTokens: number;
  readonly availableInputTokens: number;
  readonly policyReservation: number;
}

/**
 * Derive the authoritative per-turn budget:
 * ```
 * policyReservation    = clamp(floor(window × ratio), floor, cap)
 * budgetReservation    = min(policyReservation, outputTokenLimit)  // when known
 * availableInputTokens = window − budgetReservation
 * requestedMaxOutputTokens = clamp(maxOutputTokens, ≤ budgetReservation) // §5
 * ```
 * `budgetReservation` (the safety margin feeding `availableInputTokens`) is
 * decoupled from `requestedMaxOutputTokens` (the `maxOutputTokens` sent to the
 * provider): tuning output length no longer changes the input budget. The
 * `requestedMaxOutputTokens ≤ budgetReservation` invariant is asserted at
 * construction. The returned object is frozen: the budget never mutates.
 */
export function createContextBudget(
  descriptor: Pick<ModelDescriptor, "contextWindowTokens">,
  options: ContextBudgetOptions = {}
): ContextBudget {
  const ratio = options.outputRatio ?? DEFAULT_OUTPUT_RATIO;
  const floor = options.outputFloor ?? DEFAULT_OUTPUT_FLOOR;
  const cap = options.outputCap ?? DEFAULT_OUTPUT_CAP;
  const contextWindowTokens = descriptor.contextWindowTokens;
  const policyReservation = Math.min(
    Math.max(Math.floor(contextWindowTokens * ratio), floor),
    cap
  );
  const budgetReservation = Math.min(
    options.outputTokenLimit === undefined
      ? policyReservation
      : Math.min(policyReservation, options.outputTokenLimit),
    contextWindowTokens,
  );
  const requestedMaxOutputTokens = Math.min(
    options.maxOutputTokens ?? budgetReservation,
    budgetReservation, // invariant: never exceeds the reservation (can't cause overflow)
  );
  return Object.freeze({
    contextWindowTokens,
    budgetReservation,
    requestedMaxOutputTokens,
    availableInputTokens: contextWindowTokens - budgetReservation,
    policyReservation,
  });
}

/** A single assembled item: its category and padded token cost (budget
 * admission estimate, E1). */
export interface BudgetedContextItem {
  readonly category: ContextCategory;
  readonly tokens: number;
}

/** Pure deterministic preflight answer (B):
 * - `{ fits: true }` — the assembled request fits the authoritative budget.
 * - `{ fits: false; overflow: { overageTokens, byCategory } }` — it does not;
 *   `byCategory` lets reduction answer "we're N over — where can that come
 *   from?" without independently re-deriving it. */
export type PreflightResult =
  | { fits: true }
  | { fits: false; overflow: { overageTokens: number; byCategory: Record<ContextCategory, number> } };

function emptyByCategory(): Record<ContextCategory, number> {
  return {
    mandatory_system_governance: 0,
    current_task: 0,
    current_execution_state: 0,
    recent_conversation: 0,
    recent_tool_results: 0,
    older_context: 0,
  };
}

function tally(items: ReadonlyArray<BudgetedContextItem>): {
  total: number;
  mandatory: number;
  byCategory: Record<ContextCategory, number>;
} {
  const byCategory = emptyByCategory();
  let total = 0;
  let mandatory = 0;
  for (const item of items) {
    total += item.tokens;
    if (MANDATORY_CATEGORIES.includes(item.category)) mandatory += item.tokens;
    // `?? 0` guards against an unknown category string at runtime (a JS
    // consumer or deserialized payload) producing NaN that would otherwise
    // propagate into preflight totals and overflow payloads.
    byCategory[item.category] = (byCategory[item.category] ?? 0) + item.tokens;
  }
  return { total, mandatory, byCategory };
}

/**
 * Pure deterministic preflight gate: does this assembled request fit the
 * authoritative budget? Never mutates input, never truncates, never evicts,
 * never compacts, never digests, never calls a provider, never retries, never
 * falls back.
 */
export function preflight(
  budget: ContextBudget,
  items: ReadonlyArray<BudgetedContextItem>
): PreflightResult {
  const { total, byCategory } = tally(items);
  if (total <= budget.availableInputTokens) return { fits: true };
  return {
    fits: false,
    overflow: { overageTokens: total - budget.availableInputTokens, byCategory },
  };
}

/** Overflow classification (B): `fits` (no overflow), `reducible` (the
 * mandatory core fits — dropping optional tiers can fit), or `irreducible`
 * (the mandatory core alone exceeds available input — retrying can never
 * succeed). */
export type OverflowClassification = "fits" | "reducible" | "irreducible";

/** Pure classifier a reduction loop uses to decide "keep reducing or give up". */
export function classifyOverflow(
  budget: ContextBudget,
  items: ReadonlyArray<BudgetedContextItem>
): OverflowClassification {
  const { total, mandatory } = tally(items);
  if (total <= budget.availableInputTokens) return "fits";
  return mandatory > budget.availableInputTokens ? "irreducible" : "reducible";
}

/**
 * Typed overflow error (B): `kind: "context_budget_overflow"`, with the overage
 * and per-category breakdown, distinguishing *reducible* from *irreducible* so
 * callers never retry an impossible request forever.
 */
export class ContextBudgetOverflowError extends Error {
  readonly kind = "context_budget_overflow" as const;
  readonly reducible: boolean;
  readonly overageTokens: number;
  readonly byCategory: Record<ContextCategory, number>;
  readonly availableInputTokens: number;
  readonly mandatoryTokens: number;
  readonly contextWindowTokens: number;

  constructor(params: {
    reducible: boolean;
    overageTokens: number;
    byCategory: Record<ContextCategory, number>;
    availableInputTokens: number;
    mandatoryTokens: number;
    contextWindowTokens: number;
    message?: string;
  }) {
    super(
      params.message ??
        `Context budget overflow (${params.reducible ? "reducible" : "irreducible"}): ` +
          `${params.overageTokens} tokens over ${params.availableInputTokens} available input ` +
          `(mandatory core ${params.mandatoryTokens})`
    );
    this.name = "ContextBudgetOverflowError";
    this.reducible = params.reducible;
    this.overageTokens = params.overageTokens;
    this.byCategory = params.byCategory;
    this.availableInputTokens = params.availableInputTokens;
    this.mandatoryTokens = params.mandatoryTokens;
    this.contextWindowTokens = params.contextWindowTokens;
  }
}

/**
 * Send-boundary preflight gate: like {@link preflight}, but raises a typed
 * {@link ContextBudgetOverflowError} when the overflow is *irreducible* (the
 * mandatory core alone exceeds available input) so callers never retry an
 * impossible request forever. Reducible overflows are returned as
 * `{ fits: false, overflow }` for the reduction loop to act on.
 */
export function assertFits(
  budget: ContextBudget,
  items: ReadonlyArray<BudgetedContextItem>
): PreflightResult {
  const result = preflight(budget, items);
  if (result.fits) return result;
  const { mandatory } = tally(items);
  if (mandatory > budget.availableInputTokens) {
    throw new ContextBudgetOverflowError({
      reducible: false,
      overageTokens: result.overflow.overageTokens,
      byCategory: result.overflow.byCategory,
      availableInputTokens: budget.availableInputTokens,
      mandatoryTokens: mandatory,
      contextWindowTokens: budget.contextWindowTokens,
    });
  }
  return result;
}
