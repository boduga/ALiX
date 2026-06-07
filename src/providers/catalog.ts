/**
 * Provider catalog - shared definitions for provider selection and model listing.
 * Consolidated from src/cli.ts to avoid duplication.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  env: string;
  hint: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY", hint: "sk-ant-..." },
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", hint: "sk-..." },
  { id: "google", name: "Google Gemini", env: "GEMINI_API_KEY", hint: "AIza..." },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY", hint: "sk-or-..." },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY", hint: "gsk_..." },
  { id: "ollama", name: "Ollama", env: "OLLAMA_API_KEY", hint: "(local, may be empty)" },
  { id: "perplexity", name: "Perplexity", env: "PERPLEXITY_API_KEY", hint: "pplx-..." },
  { id: "minimax", name: "MiniMax", env: "MINIMAX_API_KEY", hint: "..." },
  { id: "zhipuai", name: "ZhipuAI", env: "ZHIPUAI_API_KEY", hint: "..." },
  { id: "grokai", name: "GrokAI", env: "GROKAI_API_KEY", hint: "..." },
  { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", hint: "sk-..." }
];

export async function listModels(providerId: string, apiKey: string): Promise<ModelInfo[]> {
  switch (providerId) {
    case "anthropic": {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name: string; max_input_tokens?: number; max_tokens?: number }> };
      return data.data.map((m) => ({
        id: m.id,
        displayName: m.display_name ?? m.id,
        maxInputTokens: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
      }));
    }
    case "openai": {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "google": {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { models: Array<{ name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number }> };
      return data.models.map((m) => ({
        id: m.name.replace("models/", ""),
        displayName: m.displayName ?? m.name,
        maxInputTokens: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit,
      }));
    }
    case "openrouter": {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/alix-cli/alix",
          "X-Title": "ALiX",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.name ?? m.id }));
    }
    case "groq": {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "ollama": {
      const base = "http://localhost:11434";
      const response = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { models: Array<{ name: string }> };
      return data.models.map((m) => ({ id: m.name, displayName: m.name }));
    }
    case "deepseek": {
      const response = await fetch("https://api.deepseek.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.id }));
    }
    case "perplexity": {
      const response = await fetch("https://api.perplexity.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "minimax": {
      const response = await fetch("https://api.minimax.chat/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "zhipuai": {
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "grokai": {
      const response = await fetch("https://api.grokai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

/**
 * Default models per provider (for `alix init` command).
 * Chosen for broad capability coverage at each provider's best price/performance tier.
 */
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  openrouter: "openrouter/auto",
  groq: "llama-3.3-70b-versatile",
  ollama: "qwen2.5-coder:7b",
  perplexity: "sonar-pro",
  minimax: "minimax-text-01",
  zhipuai: "glm-4-flash",
  grokai: "grok-2-latest",
  deepseek: "deepseek-chat",
};

/**
 * Get default model for a provider (for init command).
 */
export function getDefaultModel(providerId: string): string | undefined {
  return DEFAULT_MODELS[providerId];
}

/**
 * Detect provider from available environment variables.
 */
export function detectProvider(): { provider: string; model: string } {
  for (const p of PROVIDERS) {
    if (process.env[p.env]) {
      return { provider: p.id, model: getDefaultModel(p.id) ?? "" };
    }
  }
  // Fallback to ollama with empty model name
  return { provider: "ollama", model: "" };
}