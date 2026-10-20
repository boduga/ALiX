/**
 * cost-attribution.ts -- P4.2g Versioned Model Pricing and Cost Attribution.
 *
 * Uses a versioned pricing catalog (model-specific, effective-dated).
 * Reads model.usage events via streaming (createReadStream + readline).
 * When pricing is unknown, tokens are attributed but cost is reported as -1
 * ("unknown") -- never fabricates a cost.
 */

import { existsSync, createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

// ─── Pricing ──────────────────────────────────────────────────────────

export interface PricingEntry {
  provider: string;
  model: string;
  effectiveFrom: string; // ISO date
  inputPerMillion: number;
  outputPerMillion: number;
  currency: "USD";
}

export class PricingCatalog {
  private entries: PricingEntry[];

  constructor(entries?: PricingEntry[]) {
    this.entries = [...(entries ?? [])];
  }

  /** Register or update pricing. */
  add(entry: PricingEntry): void {
    this.entries.push(entry);
  }

  /**
   * Look up the pricing that applies at a given time.
   *
   * HISTORICAL CORRECTNESS (F1-D): an invocation must be costed at the rate in
   * effect WHEN IT RAN, not whichever rate happens to be current. The previous
   * behaviour always returned the latest entry, so replaying a run from before a
   * price change applied the new price — in a two-tier test that is a 10x error.
   *
   * `at` is an ISO timestamp or date. Entries effective AFTER `at` are excluded;
   * among those that apply, the newest wins. When no entry applies yet (the
   * invocation predates the earliest known price) this returns `undefined`, which
   * correctly surfaces as unknown cost rather than borrowing a later price.
   *
   * Omitting `at` keeps the previous "latest known price" behaviour, which is
   * only appropriate for a forward-looking estimate — never for attribution of a
   * past invocation.
   */
  lookup(provider: string, model: string, at?: string): PricingEntry | undefined {
    const cutoff = at ? Date.parse(at) : null;
    const matches = this.entries
      .filter(e => e.provider === provider && e.model === model)
      .filter(e => {
        if (cutoff === null || !Number.isFinite(cutoff)) return true;
        const from = Date.parse(e.effectiveFrom);
        // An unparseable effectiveFrom cannot be shown to apply; exclude it
        // rather than treating it as always-valid.
        return Number.isFinite(from) && from <= cutoff;
      })
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return matches[0];
  }
}

/** Built-in catalog with known model prices as of 2026-06. */
export function defaultPricingCatalog(): PricingCatalog {
  return new PricingCatalog([
    { provider: "openai", model: "gpt-4", effectiveFrom: "2025-01-01", inputPerMillion: 30, outputPerMillion: 60, currency: "USD" },
    { provider: "openai", model: "gpt-4o", effectiveFrom: "2025-01-01", inputPerMillion: 2.5, outputPerMillion: 10, currency: "USD" },
    { provider: "anthropic", model: "claude-opus-4-8", effectiveFrom: "2025-01-01", inputPerMillion: 15, outputPerMillion: 75, currency: "USD" },
    { provider: "anthropic", model: "claude-sonnet-4-6", effectiveFrom: "2025-01-01", inputPerMillion: 3, outputPerMillion: 15, currency: "USD" },
    { provider: "anthropic", model: "claude-haiku-4-5", effectiveFrom: "2025-01-01", inputPerMillion: 0.25, outputPerMillion: 1.25, currency: "USD" },
    // ollama, google, etc. omitted -- unknown pricing => cost unknown
  ]);
}

// ─── Attribution ──────────────────────────────────────────────────────

export interface ProviderCostDetail {
  tokens: number;
  cost: number; // -1 = unknown pricing
  calls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface WorkflowCostDetail {
  tokens: number;
  cost: number;
  calls: number;
}

export interface CostSummary {
  totalTokens: number;
  /**
   * Complete total cost in USD, or `-1` when it cannot be completely known.
   *
   * COMPLETENESS CONTRACT (F1-C): `-1` means at least one contributing
   * invocation had unknown pricing, so NO complete total exists. It never means
   * "zero" and must never be summed, averaged or compared as a number.
   *
   * Previously this field summed only priced providers, so a session mixing
   * priced and unpriced models produced a figure that looked complete and was
   * silently too low. Use `costCompleteness` to branch, and `knownCostSubtotal`
   * when a diagnostic partial figure is genuinely useful.
   */
  totalCost: number;
  /**
   * Whether `totalCost` is a complete figure.
   *
   * - `complete`   — every billable invocation had applicable pricing
   * - `partial`    — some invocations were unpriced; `totalCost` is `-1`
   * - `non_billable` — only non-billable providers ran; `totalCost` is `0`
   * - `none`       — no billable usage at all; `totalCost` is `0`
   */
  costCompleteness: CostCompleteness;
  /**
   * Sum of the invocations whose pricing WAS known. Diagnostic only — never a
   * total. Present for `partial` so a reader can see what is accounted for, and
   * `null` otherwise (there is nothing partial about a complete figure).
   */
  knownCostSubtotal: number | null;
  byProvider: Record<string, ProviderCostDetail>;
  byWorkflow: Record<string, WorkflowCostDetail>;
  periodStart: string;
  periodEnd: string;
  unknownPricingModels: string[];
}

/** How complete the reported `totalCost` is. See `CostSummary.costCompleteness`. */
export type CostCompleteness = "complete" | "partial" | "non_billable" | "none";

/**
 * Providers that execute locally or by script and are never billable.
 *
 * SINGLE DEFINITION (F1-C): this lives here, beside the pricing authority, so the
 * evaluator's cost correlation and this summary cannot disagree about what
 * "non-billable" means. Consumers import it rather than re-listing providers.
 */
const NON_BILLABLE_PROVIDERS: ReadonlySet<string> = new Set([
  "scripted-mock", "mock", "local-llama", "ollama", "test",
]);

export function isNonBillableProvider(provider: string): boolean {
  return NON_BILLABLE_PROVIDERS.has(provider.toLowerCase());
}

function computeCost(
  inputTokens: number,
  outputTokens: number,
  price: PricingEntry | undefined,
): number {
  if (!price) return -1;
  const inputCost = (inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * price.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export class CostAttribution {
  constructor(
    private cwd: string,
    private catalog: PricingCatalog = defaultPricingCatalog(),
  ) {}

  /**
   * Read model.usage events from a specific session directory
   * via streaming. Returns a cost summary.
   */
  async summary(sessionId?: string): Promise<CostSummary> {
    const byProvider: Record<string, ProviderCostDetail> = {};
    const byWorkflow: Record<string, WorkflowCostDetail> = {};
    const unknownPricingModels: string[] = [];
    let totalTokens = 0;
    let totalCost = 0;
    let knownCostSubtotal = 0;
    let sawBillable = false;
    let sawNonBillable = false;
    let sawUnpricedBillable = false;
    let periodStart = "";
    let periodEnd = "";

    const sessionDirs = sessionId
      ? [join(this.cwd, ".alix", "sessions", sessionId)]
      : await this.discoverSessionDirs();

    for (const dir of sessionDirs) {
      const eventsPath = join(dir, "events.jsonl");
      if (!existsSync(eventsPath)) continue;

      const rl = createInterface({
        input: createReadStream(eventsPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        try {
          const event = JSON.parse(line);
          if (event.type !== "model.usage") continue;
          const p = event.payload ?? {};
          const provider = String(p.provider ?? "unknown");
          const model = String(p.model ?? "unknown");
          const inputTokens = Number(p.inputTokens ?? 0);
          const outputTokens = Number(p.outputTokens ?? 0);
          const cachedInputTokens = Number(p.cachedInputTokens ?? 0);
          const reasoningTokens = Number(p.reasoningTokens ?? 0);
          const tokens = inputTokens + outputTokens;
          const price = this.catalog.lookup(provider, model, event.timestamp);
          const cost = computeCost(inputTokens, outputTokens, price);
          const billable = !isNonBillableProvider(provider);

          if (!price && billable) {
            const key = `${provider}/${model}`;
            if (!unknownPricingModels.includes(key)) {
              unknownPricingModels.push(key);
            }
          }
          if (!billable) sawNonBillable = true;
          if (billable) sawBillable = true;

          totalTokens += tokens;

          if (billable) {
            if (cost < 0) sawUnpricedBillable = true;
            else knownCostSubtotal += cost;
          }

          if (!byProvider[provider]) {
            byProvider[provider] = {
              tokens: 0, cost: 0, calls: 0, latencyMs: 0,
              inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0,
            };
          }
          const prov = byProvider[provider];
          prov.tokens += tokens;
          // If any call had unknown cost, the provider total is unknown
          if (cost < 0) {
            prov.cost = -1;
          } else if (prov.cost >= 0) {
            prov.cost += cost;
          }
          prov.calls++;
          prov.latencyMs += Number(p.durationMs ?? 0);
          prov.inputTokens += inputTokens;
          prov.outputTokens += outputTokens;
          prov.cachedInputTokens += cachedInputTokens;
          prov.reasoningTokens += reasoningTokens;

          const workflow = event.runId ?? event.sessionId ?? "unknown";
          if (!byWorkflow[workflow]) {
            byWorkflow[workflow] = { tokens: 0, cost: 0, calls: 0 };
          }
          const wf = byWorkflow[workflow];
          wf.tokens += tokens;
          if (cost >= 0 && wf.cost >= 0) wf.cost += cost;
          else if (cost >= 0) wf.cost = cost;
          else wf.cost = -1;
          wf.calls++;

          if (!periodStart || event.timestamp < periodStart) periodStart = event.timestamp;
          if (!periodEnd || event.timestamp > periodEnd) periodEnd = event.timestamp;
        } catch { /* skip malformed lines */ }
      }
    }

    // COMPLETENESS (F1-C): a complete total requires every BILLABLE invocation to
    // have known pricing. Reporting the priced subtotal as `totalCost` — the
    // previous behaviour — understated cost while appearing complete.
    //
    //   unpriced billable present -> -1 (partial; knownCostSubtotal carries the diagnostic)
    //   billable, all priced      -> the exact sum (complete)
    //   only non-billable         -> 0, explicitly labelled non_billable (not "unknown")
    //   no usage at all           -> 0, labelled none
    const costCompleteness: CostCompleteness =
      sawUnpricedBillable ? "partial"
        : sawBillable ? "complete"
          : sawNonBillable ? "non_billable"
            : "none";

    if (costCompleteness === "partial") {
      totalCost = -1;
    } else if (costCompleteness === "complete") {
      totalCost = Math.round(knownCostSubtotal * 1_000_000) / 1_000_000;
    } else {
      // non_billable / none: a legitimate zero, not an unknown.
      totalCost = 0;
    }

    return {
      totalTokens,
      totalCost,
      costCompleteness,
      // Diagnostic only, and only meaningful for a partial figure.
      knownCostSubtotal: costCompleteness === "partial"
        ? Math.round(knownCostSubtotal * 1_000_000) / 1_000_000
        : null,
      byProvider,
      byWorkflow,
      periodStart,
      periodEnd: periodEnd || new Date().toISOString(),
      unknownPricingModels,
    };
  }

  private async discoverSessionDirs(): Promise<string[]> {
    const base = join(this.cwd, ".alix", "sessions");
    if (!existsSync(base)) return [];
    try {
      const entries = await readdir(base, { withFileTypes: true });
      return entries.filter(d => d.isDirectory()).map(d => join(base, d.name));
    } catch {
      return [];
    }
  }
}
