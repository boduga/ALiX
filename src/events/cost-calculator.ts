// src/events/cost-calculator.ts
// Cost per million tokens (input/output) from provider pricing pages
const PROVIDER_RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  "google":    { inputPerM: 0.15,  outputPerM: 0.60 },
  "deepseek":  { inputPerM: 0.014, outputPerM: 0.028 },
  "openai":    { inputPerM: 2.50,  outputPerM: 10.00 },
  "anthropic": { inputPerM: 3.00,  outputPerM: 15.00 },
  "groq":      { inputPerM: 0.59,  outputPerM: 0.79 },
  "ollama":    { inputPerM: 0,     outputPerM: 0 },    // free (local)
  "local-llama": { inputPerM: 0,   outputPerM: 0 },
};

export type CostResult = { inputCost: number; outputCost: number; totalCost: number };

export function computeCost(provider: string, inputTokens: number, outputTokens: number): CostResult {
  const rate = PROVIDER_RATES[provider] ?? { inputPerM: 0, outputPerM: 0 };
  return {
    inputCost: (inputTokens / 1_000_000) * rate.inputPerM,
    outputCost: (outputTokens / 1_000_000) * rate.outputPerM,
    totalCost: ((inputTokens / 1_000_000) * rate.inputPerM) + ((outputTokens / 1_000_000) * rate.outputPerM),
  };
}

export function formatCost(cost: number): string {
  if (cost <= 0) return "free";
  if (cost < 0.001) return "< $0.001";
  return `$${cost.toFixed(4)}`;
}
