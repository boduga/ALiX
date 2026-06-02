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
import { ZhipuAIProvider } from "./zhipuai-provider.js";
import { GrokAIProvider } from "./grokai-provider.js";
import { DeepSeekProvider } from "./deepseek-provider.js";
import { lazy } from "../utils/lazy-import.js";

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
  zhipuai: lazy(() => import("./zhipuai-provider.js").then(m => m.ZhipuAIProvider)),
  grokai: lazy(() => import("./grokai-provider.js").then(m => m.GrokAIProvider)),
  deepseek: lazy(() => import("./deepseek-provider.js").then(m => m.DeepSeekProvider)),
  mock: lazy(() => import("./mock-provider.js").then(m => m.MockProvider)),
} as const;

type ProviderId = keyof typeof lazyProviders;

// Cache for provider instances
const providerCache = new Map<string, ModelAdapter>();

export async function createProvider(config: { provider: string; model?: string }, apiKey?: string): Promise<ModelAdapter> {
  const key = `${config.provider}:${config.model ?? ""}:${apiKey ?? ""}`;

  if (providerCache.has(key)) {
    return providerCache.get(key)!;
  }

  const providerId = config.provider as ProviderId;
  const loader = lazyProviders[providerId];
  if (!loader) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }

  const ProviderClass = await loader() as new (config: { apiKey?: string; model?: string }) => ModelAdapter;
  const instance = new ProviderClass({ apiKey, model: config.model });
  providerCache.set(key, instance);
  return instance;
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
    { id: "zhipuai", name: "ZhipuAI", envKey: "ZHIPUAI_API_KEY" },
    { id: "grokai", name: "GrokAI", envKey: "GROKAI_API_KEY" },
    { id: "deepseek", name: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
  ];
}