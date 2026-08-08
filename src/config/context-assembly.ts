/**
 * Deterministic 6-tier priority-first greedy selector (spec D).
 *
 * Turns a candidate snapshot + budget into an admitted/dropped selection,
 * reproducible across runs and retries. The deliberately dumb selector: it
 * classifies the *kind* of context (the tier category), not why items were
 * appended, and admits whole items in tier order with skip-and-continue.
 *
 * Three-region contract:
 * - **mandatory** (Tier 1 + Tier 2): must all fit or the typed irreducible
 *   {@link ContextBudgetOverflowError} is raised — callers never retry an
 *   impossible request forever.
 * - **protected** (Tier 3, current execution state: digest + ledger): kept as
 *   a single atomic unit and fully token-accounted; the whole unit is admitted
 *   or the whole unit is dropped. Unifying digest+ledger into one projection
 *   later must not change the Tier-3 semantic contract.
 * - **best-effort** (Tiers 4–6): progressively omitted as the budget is
 *   exhausted; when the next whole item does not fit it is skipped and
 *   assembly continues within the same tier (never drops the rest of that
 *   tier; never size-aware — a later smaller item is not preferred over a
 *   large earlier one).
 *
 * Assembly is ONE deterministic pass over the candidate. Preflight (B) remains
 * the final safety gate — the selector never calls it and never re-enters an
 * assemble→preflight→evict→assemble loop. The budget is immutable: the
 * selector consumes its own `remaining` ledger and never mutates the budget
 * object.
 */

import {
  CONTEXT_CATEGORIES,
  MANDATORY_CATEGORIES,
  ContextBudgetOverflowError,
  type ContextBudget,
  type ContextCategory,
} from "./context-budget.js";

export { ContextBudgetOverflowError };
export type { ContextBudget, ContextCategory } from "./context-budget.js";

/** Provenance metadata that rides along with every item (D: "Same tier ≠ same
 * metadata"). Telemetry for C1/C2 first — the admission policy must NOT depend
 * on it. */
export interface ContextItemProvenance {
  readonly category: ContextCategory;
  /** Concrete kind, e.g. `repair_prompt`, `user_turn`, `digest`, `ledger`. */
  readonly kind: string;
  readonly createdAt: number;
  readonly source: string;
}

/** A candidate context item the selector may admit or drop. The policy reads
 * only `category` (tier) + `tokens` (padded budget-admission estimate) +
 * source order; `id`/`kind`/`provenance` are carried through untouched. */
export interface CandidateContextItem {
  readonly id: string;
  readonly kind: string;
  readonly category: ContextCategory;
  /** Padded budget-admission token cost (E1: ceil(base × 1.20)). */
  readonly tokens: number;
  readonly provenance: ContextItemProvenance;
}

/** Why an item was dropped (feeds `context.assembled.droppedReasons`, spec G). */
export type DropReason =
  /** Best-effort item did not fit the remaining budget (skip-and-continue). */
  | "budget_exhausted"
  /** The whole Tier-3 protected unit did not fit; all its items were dropped. */
  | "protected_unit_exceeded_budget";

export interface DroppedContextItem {
  readonly item: CandidateContextItem;
  readonly reason: DropReason;
}

/** Result of the deterministic assembly — what was admitted and dropped, with
 * token totals and the remaining ledger. */
export interface AssembledContext {
  readonly admitted: readonly CandidateContextItem[];
  readonly dropped: readonly DroppedContextItem[];
  readonly admittedTokens: number;
  readonly droppedTokens: number;
  /** Admitted mandatory core (Tier 1 + Tier 2) — always ALL mandatory items
   * (an irreducible error is raised before any admission when they cannot all
   * fit). */
  readonly mandatoryTokens: number;
  /** Admitted Tier-3 protected unit tokens (0 when the unit was dropped). */
  readonly protectedTokens: number;
  /** budget.availableInputTokens − admittedTokens (≥ 0 by construction). */
  readonly remainingTokens: number;
}

function sumTokens(items: readonly CandidateContextItem[]): number {
  let total = 0;
  for (const item of items) total += item.tokens;
  return total;
}

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

function tallyByCategory(items: readonly CandidateContextItem[]): Record<ContextCategory, number> {
  const byCategory = emptyByCategory();
  for (const item of items) byCategory[item.category] += item.tokens;
  return byCategory;
}

/**
 * Deterministic priority-first greedy assembly (D).
 *
 * One pass over the candidate, grouped by tier in `CONTEXT_CATEGORIES` order,
 * source order preserved within each tier, whole items only. Throws the typed
 * {@link ContextBudgetOverflowError} (irreducible) when the mandatory core
 * (Tier 1 + Tier 2) alone exceeds the budget's available input.
 *
 * Never mutates `candidate` or `budget`. Admitted tokens always ≤
 * budget.availableInputTokens by construction; {@link preflight} remains the
 * final safety gate.
 */
export function assembleContext(
  candidate: readonly CandidateContextItem[],
  budget: ContextBudget
): AssembledContext {
  // Group by tier once, preserving source order within each bucket.
  const byTier = new Map<ContextCategory, CandidateContextItem[]>();
  for (const category of CONTEXT_CATEGORIES) byTier.set(category, []);
  for (const item of candidate) {
    const bucket = byTier.get(item.category);
    if (bucket) bucket.push(item);
  }

  // Mandatory core = Tier 1 + Tier 2 (spec B: "the mandatory core (system +
  // current task) itself exceeds availableInputTokens").
  const mandatoryItems = [
    ...(byTier.get("mandatory_system_governance") ?? []),
    ...(byTier.get("current_task") ?? []),
  ];
  const mandatoryTokens = sumTokens(mandatoryItems);
  if (mandatoryTokens > budget.availableInputTokens) {
    throw new ContextBudgetOverflowError({
      reducible: false,
      overageTokens: mandatoryTokens - budget.availableInputTokens,
      byCategory: tallyByCategory(mandatoryItems),
      availableInputTokens: budget.availableInputTokens,
      mandatoryTokens,
      contextWindowTokens: budget.contextWindowTokens,
    });
  }

  const admitted: CandidateContextItem[] = [];
  const dropped: DroppedContextItem[] = [];
  let remaining = budget.availableInputTokens;
  let protectedTokens = 0;

  // Admit the entire mandatory core (it fits by construction).
  for (const item of mandatoryItems) admitted.push(item);
  remaining -= mandatoryTokens;

  // Best-effort + protected tiers, in tier order (skip the already-admitted
  // mandatory tiers).
  for (const category of CONTEXT_CATEGORIES) {
    if (MANDATORY_CATEGORIES.includes(category)) continue;
    const items = byTier.get(category) ?? [];
    if (items.length === 0) continue;

    if (category === "current_execution_state") {
      // Tier 3 protected unit: all-or-nothing, fully token-accounted.
      const tierTokens = sumTokens(items);
      if (tierTokens <= remaining) {
        for (const item of items) admitted.push(item);
        remaining -= tierTokens;
        protectedTokens = tierTokens;
      } else {
        for (const item of items) dropped.push({ item, reason: "protected_unit_exceeded_budget" });
      }
      continue;
    }

    // Tiers 4–6 best-effort: skip-and-continue within the tier.
    for (const item of items) {
      if (item.tokens <= remaining) {
        admitted.push(item);
        remaining -= item.tokens;
      } else {
        dropped.push({ item, reason: "budget_exhausted" });
      }
    }
  }

  const admittedTokens = sumTokens(admitted);
  const droppedTokens = sumTokens(dropped.map((d) => d.item));

  return Object.freeze({
    admitted: Object.freeze(admitted),
    dropped: Object.freeze(dropped),
    admittedTokens,
    droppedTokens,
    mandatoryTokens,
    protectedTokens,
    remainingTokens: remaining,
  });
}
