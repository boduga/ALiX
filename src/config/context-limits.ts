/**
 * ModelDescriptor resolver + provider/model context defaults.
 *
 * Resolves a model's context window and tokenizer into a single
 * authoritative, cached {@link ModelDescriptor} — the C0/C1 Context Budget's
 * deterministic answer to "what is this model's window and how do we count
 * tokens against it". One correctly-tagged answer per provider/model, resolved
 * once per process per model (E3).
 */

export type TokenizerName = "cl100k_base" | "o200k_base";

/** Padding applied to base tokenizer estimates to produce the budget-admission
 * estimate (E1: `ceil(base × SAFETY_FACTOR)`). 1.20 deliberately exceeds the
 * measured ~14.5% code under-count for engineering margin. */
export const SAFETY_FACTOR = 1.2;

/** Authoritative per-model context resolution (E3). */
export interface ModelDescriptor {
  provider: string;
  model: string;
  contextWindowTokens: number;
  tokenizer: TokenizerName;
  safetyFactor: number;
}

type ProviderDefault = { contextWindowTokens: number; tokenizer: TokenizerName };

// Hardcoded provider defaults (used when API lookup fails or is unavailable).
// Base tokenizer is o200k_base for the OpenAI family and cl100k_base for all
// other providers (E1); char/4 is no longer an admission estimator.
const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
  anthropic:  { contextWindowTokens: 200_000,  tokenizer: "cl100k_base" },
  openai:     { contextWindowTokens: 128_000,  tokenizer: "o200k_base" },
  openrouter: { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  groq:       { contextWindowTokens: 128_000,  tokenizer: "cl100k_base" },
  perplexity: { contextWindowTokens: 128_000,  tokenizer: "cl100k_base" },
  minimax:    { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  "minimax-token-plan": { contextWindowTokens: 1_048_576, tokenizer: "cl100k_base" },
  google:     { contextWindowTokens: 1_000_000, tokenizer: "o200k_base" },
  deepseek:   { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  ollama:     { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  grokai:     { contextWindowTokens: 131_000,  tokenizer: "cl100k_base" },
  zhipuai:    { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  local:      { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  mock:       { contextWindowTokens: 100_000,  tokenizer: "cl100k_base" },
};

// Known exact model overrides
const MODEL_OVERRIDES: Record<string, ProviderDefault> = {
  "claude-opus-4-7":    { contextWindowTokens: 1_000_000, tokenizer: "cl100k_base" },
  "claude-sonnet-4-6":  { contextWindowTokens: 1_000_000, tokenizer: "cl100k_base" },
  "claude-haiku-4-5":   { contextWindowTokens: 200_000,  tokenizer: "cl100k_base" },
  "gemini-2.5-pro":    { contextWindowTokens: 1_000_000, tokenizer: "o200k_base" },
  "gemini-3.5-flash": { contextWindowTokens: 1_000_000, tokenizer: "o200k_base" },
  "gpt-4o":            { contextWindowTokens: 128_000,  tokenizer: "o200k_base" },
  "gpt-4-turbo":       { contextWindowTokens: 128_000,  tokenizer: "o200k_base" },
  "deepseek-chat":     { contextWindowTokens: 64_000,   tokenizer: "cl100k_base" },
  "deepseek-v4-flash": { contextWindowTokens: 1_000_000, tokenizer: "cl100k_base" },
};

/** Process-wide cache: `provider:model` → resolved descriptor (E3: resolved
 * once per process per model; a model change = a different key = fresh
 * resolution). */
const descriptorCache = new Map<string, ModelDescriptor>();

/** Drop all cached descriptors (explicit invalidation, e.g. on provider
 * fallback / model re-selection). */
export function clearModelDescriptorCache(): void {
  descriptorCache.clear();
}

/**
 * Resolve the authoritative ModelDescriptor for a model using a tiered
 * approach:
 * 1. Exact model override (MODEL_OVERRIDES)
 * 2. API lookup (Anthropic models.list() — context_window field)
 * 3. Provider default (PROVIDER_DEFAULTS)
 *
 * Result is cached per `provider:model` for the process lifetime.
 */
export async function resolveModelDescriptor(
  provider: string,
  modelName: string,
  apiKeys?: Record<string, string>
): Promise<ModelDescriptor> {
  const cacheKey = `${provider}:${modelName}`;
  const cached = descriptorCache.get(cacheKey);
  if (cached) return cached;

  const override = MODEL_OVERRIDES[modelName];
  let windowTokens: number;
  let tokenizer: TokenizerName;

  if (override) {
    windowTokens = override.contextWindowTokens;
    tokenizer = override.tokenizer;
  } else if (provider === "anthropic" && apiKeys?.anthropic) {
    try {
      const apiResult = await fetchAnthropicModels(apiKeys.anthropic, modelName);
      if (apiResult) {
        windowTokens = apiResult.contextWindowTokens;
        tokenizer = apiResult.tokenizer;
      } else {
        windowTokens = PROVIDER_DEFAULTS.anthropic.contextWindowTokens;
        tokenizer = PROVIDER_DEFAULTS.anthropic.tokenizer;
      }
    } catch (err) {
      console.warn(`[context-limits] Anthropic API lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      windowTokens = PROVIDER_DEFAULTS.anthropic.contextWindowTokens;
      tokenizer = PROVIDER_DEFAULTS.anthropic.tokenizer;
    }
  } else {
    const fallback = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.local;
    windowTokens = fallback.contextWindowTokens;
    tokenizer = fallback.tokenizer;
  }

  const descriptor: ModelDescriptor = {
    provider,
    model: modelName,
    contextWindowTokens: windowTokens,
    tokenizer,
    safetyFactor: SAFETY_FACTOR,
  };
  descriptorCache.set(cacheKey, descriptor);
  return descriptor;
}

async function fetchAnthropicModels(apiKey: string, targetModel: string): Promise<ProviderDefault | null> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json() as { data: Array<{ id: string; context_window?: number }> };
  const model = data.data.find(m => m.id === targetModel || m.id.includes(targetModel.split("-").slice(-1)[0]));
  if (model?.context_window) {
    return { contextWindowTokens: model.context_window, tokenizer: "cl100k_base" };
  }
  return null;
}

/**
 * Get the tiktoken tokenizer name for a provider. Deterministic per provider
 * (from PROVIDER_DEFAULTS); never returns the removed char/4 estimator. Used
 * when a caller overrides the window but still needs the provider's tokenizer.
 */
export function getEncoding(provider: string): TokenizerName {
  return PROVIDER_DEFAULTS[provider]?.tokenizer ?? PROVIDER_DEFAULTS.local.tokenizer;
}
