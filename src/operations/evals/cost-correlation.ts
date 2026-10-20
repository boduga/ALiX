/**
 * cost-correlation.ts — correlate a run to usage, pricing and a cost figure.
 *
 * ADDITIVE CORRELATION ONLY. This does not calculate prices and does not add a
 * second cost authority: it consumes the existing `PricingCatalog` and the
 * `model.usage` records the runtime already emits, and it reports what it can
 * prove.
 *
 * THE RULE THAT MATTERS MOST: a partial sum must never be presented as a total.
 * The existing `CostAttribution.summary()` accumulates `totalCost` from priced
 * providers only, so a run that used one priced and one unpriced model reports a
 * number that LOOKS complete and is silently too low. This module instead
 * returns `null` for the whole figure when any contributing invocation lacks
 * pricing, and names exactly which model blocked it.
 *
 * Correlation chain (operator-approved):
 *
 *   runId → model invocation(s) → usage → pricing → cost
 *
 * Each hop is checked; a break in any hop yields `null` with the reason rather
 * than a shorter chain returning a smaller number.
 *
 * @module
 */

import type { PricingEntry } from "../../operations/observability/cost-attribution.js";

/** One model invocation observed in the event stream. */
export type RunInvocation = {
  eventId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the invocation came from a scripted/mock provider. */
  nonBillable: boolean;
};

/** Why a cost figure is absent. */
export type CostGapReason =
  | "no-invocations"        // the run emitted no model.usage at all
  | "no-run-id"             // usage events carried no runId to correlate
  | "unknown-pricing"       // at least one invocation has no pricing entry
  | "non-billable"          // scripted provider: cost is not applicable
  | "missing-usage";        // an invocation has no numeric token counts

/** Result of correlating one run. */
export type RunCostCorrelation = {
  runId: string;
  /** Total cost in USD. `null` whenever it cannot be completely proven. */
  observedCostUsd: number | null;
  /** Tokens are still reported even when cost is not — different dimensions. */
  inputTokens: number | null;
  outputTokens: number | null;
  invocationCount: number;
  /** Models whose pricing blocked the figure. Empty when a figure exists. */
  unpricedModels: string[];
  /** Present only when `observedCostUsd === null`. */
  gap: CostGapReason | null;
  /** Human-readable evidence chain, so the figure is auditable. */
  evidence: string[];
};

/** Providers that execute locally or by script and are never billable. */
const NON_BILLABLE_PROVIDERS = new Set([
  "scripted-mock", "mock", "local-llama", "ollama", "test",
]);

export function isNonBillableProvider(provider: string): boolean {
  return NON_BILLABLE_PROVIDERS.has(provider.toLowerCase());
}

/** Structural shape of the usage-bearing event this module reads. */
export type UsageEvent = {
  id: string;
  type: string;
  timestamp: string;
  runId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

/**
 * Extract billable invocations for one run.
 *
 * Only `model.usage` events are considered. An event whose `runId` does not
 * match is excluded — a session can host several runs, and charging them all to
 * one would over-attribute.
 */
export function invocationsForRun(events: readonly UsageEvent[], runId: string): RunInvocation[] {
  const invocations: RunInvocation[] = [];
  for (const event of events) {
    if (event.type !== "model.usage") continue;
    if (event.runId !== runId) continue;

    const p = event.payload ?? {};
    const provider = typeof p.provider === "string" ? p.provider : "unknown";
    const model = typeof p.model === "string" ? p.model : "unknown";
    const inputTokens = typeof p.inputTokens === "number" ? p.inputTokens : null;
    const outputTokens = typeof p.outputTokens === "number" ? p.outputTokens : null;

    if (inputTokens === null || outputTokens === null) {
      // Keep the invocation so the caller can report a missing-usage gap rather
      // than silently dropping this cost contribution.
      invocations.push({
        eventId: event.id, provider, model,
        inputTokens: Number.NaN, outputTokens: Number.NaN,
        nonBillable: isNonBillableProvider(provider),
      });
      continue;
    }

    invocations.push({
      eventId: event.id, provider, model, inputTokens, outputTokens,
      nonBillable: isNonBillableProvider(provider),
    });
  }
  return invocations;
}

/** Minimal catalog port; matches `PricingCatalog.lookup`. */
export type PricingLookup = {
  lookup(provider: string, model: string): PricingEntry | undefined;
};

function computeFromPricing(inv: RunInvocation, price: PricingEntry): number {
  const inputCost = (inv.inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCost = (inv.outputTokens / 1_000_000) * price.outputPerMillion;
  // Match the existing calculator's rounding so figures are comparable.
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Correlate one run's cost.
 *
 * Returns `null` cost — never a partial sum — whenever the chain is incomplete.
 * Concurrent workers are aggregated by summing their invocations exactly once:
 * each `model.usage` event belongs to exactly one run, and an event is counted
 * once because it is visited once.
 */
export function correlateRunCost(
  events: readonly UsageEvent[],
  runId: string,
  catalog: PricingLookup,
): RunCostCorrelation {
  const evidence: string[] = [`run=${runId}`];

  if (!runId) {
    return {
      runId, observedCostUsd: null, inputTokens: null, outputTokens: null,
      invocationCount: 0, unpricedModels: [], gap: "no-run-id",
      evidence: ["model.usage events carried no runId to correlate against"],
    };
  }

  const invocations = invocationsForRun(events, runId);
  if (invocations.length === 0) {
    const anyUsage = events.some(e => e.type === "model.usage");
    return {
      runId, observedCostUsd: null, inputTokens: null, outputTokens: null,
      invocationCount: 0, unpricedModels: [],
      gap: anyUsage ? "no-invocations" : "no-invocations",
      evidence: [
        ...evidence,
        anyUsage
          ? "model.usage events exist in this session but none carry this runId"
          : "no model.usage events in this session",
      ],
    };
  }

  evidence.push(`invocations=${invocations.length}`);

  // A scripted/mock invocation means the run is not a billable baseline. Reported
  // explicitly so it can never be mistaken for a $0 real-model run.
  if (invocations.some(i => i.nonBillable)) {
    const providers = [...new Set(invocations.filter(i => i.nonBillable).map(i => i.provider))];
    return {
      runId, observedCostUsd: null,
      inputTokens: sumOrNull(invocations.map(i => i.inputTokens)),
      outputTokens: sumOrNull(invocations.map(i => i.outputTokens)),
      invocationCount: invocations.length, unpricedModels: [], gap: "non-billable",
      evidence: [...evidence, `non-billable provider(s): ${providers.join(", ")} — cost is not applicable, not zero`],
    };
  }

  // Missing numeric usage blocks the figure: tokens are a different dimension
  // from cost, but a cost cannot be computed without them.
  const malformed = invocations.filter(i => !Number.isFinite(i.inputTokens) || !Number.isFinite(i.outputTokens));
  if (malformed.length > 0) {
    return {
      runId, observedCostUsd: null, inputTokens: null, outputTokens: null,
      invocationCount: invocations.length, unpricedModels: [], gap: "missing-usage",
      evidence: [...evidence, `${malformed.length} invocation(s) lacked numeric inputTokens/outputTokens`],
    };
  }

  const unpriced: string[] = [];
  let total = 0;
  for (const inv of invocations) {
    const price = catalog.lookup(inv.provider, inv.model);
    if (!price) {
      unpriced.push(`${inv.provider}/${inv.model}`);
      continue;
    }
    total += computeFromPricing(inv, price);
    evidence.push(
      `${inv.eventId}: ${inv.provider}/${inv.model} ` +
      `in=${inv.inputTokens} out=${inv.outputTokens} ` +
      `@ $${price.inputPerMillion}/$${price.outputPerMillion} per Mtok ` +
      `(effective ${price.effectiveFrom})`,
    );
  }

  if (unpriced.length > 0) {
    // THE CRITICAL CASE: do not return the partial total. A number here would be
    // indistinguishable from a complete figure and would understate cost.
    const unique = [...new Set(unpriced)];
    return {
      runId, observedCostUsd: null,
      inputTokens: sumOrNull(invocations.map(i => i.inputTokens)),
      outputTokens: sumOrNull(invocations.map(i => i.outputTokens)),
      invocationCount: invocations.length, unpricedModels: unique, gap: "unknown-pricing",
      evidence: [
        ...evidence,
        `partial sum withheld: ${unique.join(", ")} have no pricing entry`,
      ],
    };
  }

  return {
    runId,
    observedCostUsd: Math.round(total * 1_000_000) / 1_000_000,
    inputTokens: sumOrNull(invocations.map(i => i.inputTokens)),
    outputTokens: sumOrNull(invocations.map(i => i.outputTokens)),
    invocationCount: invocations.length,
    unpricedModels: [],
    gap: null,
    evidence,
  };
}

function sumOrNull(values: number[]): number | null {
  if (values.some(v => !Number.isFinite(v))) return null;
  return values.reduce((s, v) => s + v, 0);
}
