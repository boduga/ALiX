import type { ModelAdapter } from "./types.js";

import { AnthropicProvider } from "./anthropic-provider.js";
import { MockProvider } from "./mock-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { OpenRouterProvider } from "./openrouter-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { PerplexityProvider } from "./perplexity-provider.js";
import { MiniMaxProvider } from "./minimax-provider.js";
import { MiniMaxTokenPlanProvider } from "./minimax-token-plan-provider.js";
import { ZhipuAIProvider } from "./zhipuai-provider.js";
import { GrokAIProvider } from "./grokai-provider.js";
import { DeepSeekProvider } from "./deepseek-provider.js";
import { lazy } from "../utils/lazy-import.js";
import { withProviderContracts } from "./provider-contract-validation.js";
import { resolveModelSelectionId } from "./model-resolver.js";
import type { ModelSelectionPolicy } from "../config/schema.js";

// Lazy-load heavy provider modules on first use
const lazyProviders = {
  anthropic: lazy(() => import("./anthropic-provider.js").then(m => m.AnthropicProvider)),
  openai: lazy(() => import("./openai-provider.js").then(m => m.OpenAIProvider)),
  google: lazy(() => import("./gemini-provider.js").then(m => m.GeminiProvider)),
  openrouter: lazy(() => import("./openrouter-provider.js").then(m => m.OpenRouterProvider)),
  groq: lazy(() => import("./groq-provider.js").then(m => m.GroqProvider)),
  ollama: lazy(() => import("./ollama-provider.js").then(m => m.OllamaProvider)),
  perplexity: lazy(() => import("./perplexity-provider.js").then(m => m.PerplexityProvider)),
  minimax: lazy(() => import("./minimax-provider.js").then(m => m.MiniMaxProvider)),
  "minimax-token-plan": lazy(() => import("./minimax-token-plan-provider.js").then(m => m.MiniMaxTokenPlanProvider)),
  zhipuai: lazy(() => import("./zhipuai-provider.js").then(m => m.ZhipuAIProvider)),
  grokai: lazy(() => import("./grokai-provider.js").then(m => m.GrokAIProvider)),
  deepseek: lazy(() => import("./deepseek-provider.js").then(m => m.DeepSeekProvider)),
  "local-llama": lazy(() => import("./local-llama-provider.js").then(m => m.LocalLlamaProvider)),
  mock: lazy(() => import("./mock-provider.js").then(m => m.MockProvider)),
  "scripted-mock": lazy(() => import("../evals/providers/scripted-mock-provider.js").then(m => m.ScriptedMockProvider)),
} as const;

type ProviderId = keyof typeof lazyProviders;

// Cache for provider instances
const providerCache = new Map<string, ModelAdapter>();

/**
 * Registry input. Accepts either a legacy `{ provider, model }` pair (used by
 * session/decision/factory, which configure an explicit concrete model) or a
 * `ModelConfig`-shape `{ provider, name, selection? }` (used by plan/runtime
 * routes and the routing adapter). When a `selection` policy is present it is
 * resolved to a concrete id via catalog discovery before construction.
 */
export type ProviderConfig = {
  provider: string;
  model?: string;
  name?: string;
  selection?: ModelSelectionPolicy;
  /** Total wall-clock timeout for a provider call (ms). Overrides the provider default. */
  timeoutMs?: number;
  /** Per-chunk idle timeout for streaming provider calls (ms). Overrides the default (60000). */
  streamIdleTimeoutMs?: number;
};

/** Default total call timeout per provider (ms). Local/hot-swapping providers get headroom. */
const DEFAULT_TIMEOUT_MS: Record<string, number> = {
  ollama: 300_000,
  "local-llama": 300_000,
};

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

export async function createProvider(config: ProviderConfig, apiKey?: string): Promise<ModelAdapter> {
  // Policy-driven selection: configuration expresses requirements, discovery
  // supplies the concrete model id. An explicit `name`/`model` is preferred
  // only when the policy is unsatisfiable (never hard-codes the free list).
  let model = config.name ?? config.model;
  if (config.selection !== undefined) {
    const resolved = await resolveModelSelectionId(config.selection, { apiKey });
    if (resolved) {
      model = resolved.id;
    } else if (!model) {
      throw new Error(
        `Model selection policy could not be satisfied: ${JSON.stringify(config.selection)}`,
      );
    }
  }

  const key = `${config.provider}:${model ?? ""}:${apiKey ?? ""}`;

  if (providerCache.has(key)) {
    return providerCache.get(key)!;
  }

  const providerId = config.provider as ProviderId;
  const loader = lazyProviders[providerId];
  if (!loader) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }

  const ProviderClass = await loader() as new (config: { apiKey?: string; model?: string }) => ModelAdapter;
  const instance = new ProviderClass({ apiKey, model });
  // 3-minute default timeout for provider calls, 60s stream idle timeout.
  // Ollama/local-llama get extra headroom (cold starts), config overrides both.
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS[config.provider] ?? 180_000;
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  const wrapped = withProviderContracts(instance, undefined, timeoutMs, streamIdleTimeoutMs);
  providerCache.set(key, wrapped);
  return wrapped;
}

export function listProviders(): Array<{ id: string; name: string; envKey: string }> {
  return [
    { id: "mock", name: "Mock", envKey: "" },
    { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
    { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
    { id: "google", name: "Google Gemini", envKey: "GEMINI_API_KEY" },
    { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
    { id: "groq", name: "Groq", envKey: "GROQ_API_KEY" },
    { id: "ollama", name: "Ollama", envKey: "OLLAMA_API_KEY" },
    { id: "perplexity", name: "Perplexity", envKey: "PERPLEXITY_API_KEY" },
    { id: "minimax", name: "MiniMax", envKey: "MINIMAX_API_KEY" },
    { id: "minimax-token-plan", name: "MiniMax (Token Plan)", envKey: "MINIMAX_TOKEN_PLAN_KEY" },
    { id: "zhipuai", name: "ZhipuAI", envKey: "ZHIPUAI_API_KEY" },
    { id: "grokai", name: "GrokAI", envKey: "GROKAI_API_KEY" },
    { id: "deepseek", name: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
    { id: "local-llama", name: "Local Llama.cpp (llama-server)", envKey: "ALIX_LLAMA_BASE_URL" },
  ];
}