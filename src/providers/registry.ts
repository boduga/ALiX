import type { ModelAdapter } from "./types.js";
import { MockProvider } from "./mock-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { GeminiProvider } from "./gemini-provider.js";

export type ProviderModelConfig = {
  provider: string;
  name?: string;
  temperature?: number;
};

export function createProvider(config: ProviderModelConfig, apiKey?: string): ModelAdapter {
  switch (config.provider) {
    case "mock":
      return new MockProvider();
    case "anthropic":
      return new AnthropicProvider({ apiKey, model: config.name, maxTokens: 8192 });
    case "openai":
      return new OpenAIProvider({ apiKey, model: config.name, maxTokens: 8192 });
    case "gemini":
      return new GeminiProvider({ apiKey, model: config.name, maxTokens: 8192 });
    default:
      throw new Error(
        `Unknown provider: ${config.provider}. Available: mock, anthropic, openai, gemini`
      );
  }
}

export function listProviders(): string[] {
  return ["mock", "anthropic", "openai", "gemini"];
}