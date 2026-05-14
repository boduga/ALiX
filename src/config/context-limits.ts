export type EncodingName = "cl100k_base" | "o200k_base" | "char4";

type ContextResult = { maxTokens: number; encoding: EncodingName };

// Hardcoded provider defaults (used when API lookup fails or is unavailable)
const PROVIDER_DEFAULTS: Record<string, ContextResult> = {
  anthropic:  { maxTokens: 200_000,  encoding: "cl100k_base" },
  openai:     { maxTokens: 128_000,  encoding: "cl100k_base" },
  openrouter: { maxTokens: 64_000,   encoding: "cl100k_base" },
  groq:       { maxTokens: 128_000,  encoding: "cl100k_base" },
  perplexity: { maxTokens: 128_000,  encoding: "cl100k_base" },
  minimax:    { maxTokens: 64_000,   encoding: "cl100k_base" },
  google:     { maxTokens: 1_000_000, encoding: "o200k_base" },
  deepseek:   { maxTokens: 64_000,   encoding: "cl100k_base" },
  ollama:     { maxTokens: 64_000,   encoding: "cl100k_base" },
  grokkai:    { maxTokens: 131_000,  encoding: "cl100k_base" },
  zhipuai:    { maxTokens: 64_000,   encoding: "cl100k_base" },
  local:      { maxTokens: 64_000,   encoding: "cl100k_base" },
  mock:       { maxTokens: 100_000,  encoding: "char4" },
};

// Known exact model overrides
const MODEL_OVERRIDES: Record<string, ContextResult> = {
  "claude-opus-4-7":    { maxTokens: 1_000_000, encoding: "cl100k_base" },
  "claude-sonnet-4-6":  { maxTokens: 1_000_000, encoding: "cl100k_base" },
  "claude-haiku-4-5":   { maxTokens: 200_000,  encoding: "cl100k_base" },
  "gemini-2.5-pro":    { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gemini-2.0-flash":  { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gemini-1.5-pro":    { maxTokens: 2_000_000, encoding: "o200k_base" },
  "gemini-1.5-flash":  { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gpt-4o":            { maxTokens: 128_000,  encoding: "cl100k_base" },
  "gpt-4-turbo":       { maxTokens: 128_000,  encoding: "cl100k_base" },
};

/**
 * Resolve context limit for a model using a tiered approach:
 * 1. Exact model override (MODEL_OVERRIDES)
 * 2. API lookup (Anthropic models.list() — context_window field)
 * 3. Provider default (PROVIDER_DEFAULTS)
 */
export async function resolveContextLimit(
  provider: string,
  modelName: string,
  apiKeys?: Record<string, string>
): Promise<ContextResult> {
  // 1. Exact model override
  if (modelName && MODEL_OVERRIDES[modelName]) {
    return MODEL_OVERRIDES[modelName];
  }

  // 2. API lookup (Anthropic — context_window exposed in models.list())
  if (provider === "anthropic" && apiKeys?.anthropic) {
    try {
      const result = await fetchAnthropicModels(apiKeys.anthropic, modelName);
      if (result) return result;
    } catch (err) {
      console.warn(`[context-limits] Anthropic API lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Provider default
  return PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS["local"];
}

async function fetchAnthropicModels(apiKey: string, targetModel: string): Promise<ContextResult | null> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json() as { data: Array<{ id: string; context_window?: number }> };
  const model = data.data.find(m => m.id === targetModel || m.id.includes(targetModel.split("-").slice(-1)[0]));
  if (model?.context_window) {
    return { maxTokens: model.context_window, encoding: "cl100k_base" };
  }
  return null;
}

/**
 * Get the tiktoken encoding name for a provider.
 */
export function getEncoding(provider: string): EncodingName {
  if (provider === "google") return "o200k_base";
  if (provider === "mock") return "char4";
  return "cl100k_base";
}
