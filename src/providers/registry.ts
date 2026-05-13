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
import type { ModelAdapter } from "./types.js";

export function createProvider(config: { provider: string; model?: string }, apiKey?: string): ModelAdapter {
  switch (config.provider) {
    case "mock": return new MockProvider();
    case "anthropic": return new AnthropicProvider({ apiKey, model: config.model });
    case "openai": return new OpenAIProvider({ apiKey, model: config.model });
    case "google": return new GeminiProvider({ apiKey, model: config.model });
    case "openrouter": return new OpenRouterProvider({ apiKey, model: config.model });
    case "groq": return new GroqProvider({ apiKey, model: config.model });
    case "ollama": return new OllamaProvider({ apiKey, model: config.model });
    case "perplexity": return new PerplexityProvider({ apiKey, model: config.model });
    case "minimax": return new MiniMaxProvider({ apiKey, model: config.model });
    case "zhipuai": return new ZhipuAIProvider({ apiKey, model: config.model });
    case "grokai": return new GrokAIProvider({ apiKey, model: config.model });
    case "deepseek": return new DeepSeekProvider({ apiKey, model: config.model });
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
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