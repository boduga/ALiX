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
   * Look up the latest pricing for a (provider, model) combination.
   * Returns undefined if no pricing exists.
   */
  lookup(provider: string, model: string): PricingEntry | undefined {
    const matches = this.entries
      .filter(e => e.provider === provider && e.model === model)
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
  totalCost: number;
  byProvider: Record<string, ProviderCostDetail>;
  byWorkflow: Record<string, WorkflowCostDetail>;
  periodStart: string;
  periodEnd: string;
  unknownPricingModels: string[];
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
          const price = this.catalog.lookup(provider, model);
          const cost = computeCost(inputTokens, outputTokens, price);

          if (!price) {
            const key = `${provider}/${model}`;
            if (!unknownPricingModels.includes(key)) {
              unknownPricingModels.push(key);
            }
          }

          totalTokens += tokens;

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
          if (cost >= 0) wf.cost += cost;
          else wf.cost = -1;
          wf.calls++;

          if (!periodStart || event.timestamp < periodStart) periodStart = event.timestamp;
          if (!periodEnd || event.timestamp > periodEnd) periodEnd = event.timestamp;
        } catch { /* skip malformed lines */ }
      }
    }

    // Sum total cost from providers (ignoring unknowns)
    for (const p of Object.values(byProvider)) {
      if (p.cost >= 0) totalCost += p.cost;
    }

    return {
      totalTokens,
      totalCost,
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
