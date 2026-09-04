// src/providers/parallel-tool-calls.ts
// T1 — canonical capability ModelCapabilities.parallelToolCalls
// Source-explicit resolution: provider + model + transport/configuration.
// No global hard-coded flag; capability is single source and fail-closed (unknown → false).

export type ParallelToolCallsInput = {
  provider: string;
  model: string;
  /** Transport/configuration signal — e.g. "jinja" for local-llama's --jinja, or http vs stdio */
  transport?: string;
  /** Whether Jinja template engine is enabled (local-llama --jinja). Explicit config source. */
  jinjaEnabled?: boolean;
  /** Whether minimax model is grounded/search-augmented variant */
  isGrounded?: boolean;
};

/**
 * Whether a minimax model is a grounded/search variant.
 * Grounded models (e.g. minimax-m3 with search/grounded) do not support parallel tool calls
 * and must fall back to serial execution.
 */
export function isMinimaxGroundedModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower.includes("grounded") || lower.includes("search");
}

/**
 * Whether a local-llama model/template is known to support parallel tool calls
 * via Jinja. Per llama.cpp docs, parallel_tool_calls verification is based on jinja template.
 * This POC uses a conservative allowlist of known Jinja-capable families; unknown → false (fail-closed).
 * Not merely "llama-server supports it" — requires model/template participation.
 */
export function isLocalLlamaJinjaTemplateParallelCapable(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  // Known families whose Jinja templates support parallel_tool_calls (POC allowlist)
  // Unknown/generic "local-model" → false (fail-closed).
  return (
    lower.includes("qwen") ||
    lower.includes("llama-3") ||
    lower.includes("llama3") ||
    lower.includes("phi-3") ||
    lower.includes("phi3") ||
    lower.includes("gemma") ||
    lower.includes("mistral") ||
    lower.includes("deepseek") ||
    lower.includes("functionary") ||
    lower.includes("hermes")
  );
}

/**
 * Single gate for whether a request should emit `parallel_tool_calls:true`.
 * Encapsulates the strict rule `tools.length > 1 && parallelToolCalls` where
 * `parallelToolCalls` is resolved source-explicit (capabilities → explicit flag → resolver, fail-closed).
 * Used by both the OpenAI-base spec (`toRequestBody`) and the unified dispatcher (`complete`/`stream`).
 */
export function shouldRequestParallelTools(input: {
  provider?: string;
  model?: string;
  tools?: { length: number } | null | undefined;
  capabilities?: { parallelToolCalls?: boolean } | null | undefined;
  parallelToolCalls?: boolean;
}): boolean {
  const tools = input.tools;
  if (!tools || tools.length <= 1) return false;
  let capable: boolean | undefined;
  if (input.capabilities && typeof input.capabilities.parallelToolCalls === "boolean") {
    capable = input.capabilities.parallelToolCalls;
  } else if (typeof input.parallelToolCalls === "boolean") {
    capable = input.parallelToolCalls;
  } else if (typeof input.provider === "string" && typeof input.model === "string") {
    try {
      capable = resolveParallelToolCalls({ provider: input.provider, model: input.model });
    } catch {
      capable = false;
    }
  } else {
    capable = false;
  }
  return capable === true;
}

export function isOpenAICapableModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  // gpt-4, gpt-4o, gpt-3.5, o1, o3, chatgpt — known OpenAI parallel-capable families (fail-closed: unknown → false)
  return lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("chatgpt");
}

export function isAnthropicCapableModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower.includes("claude");
}

export function isGoogleCapableModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower.includes("gemini") || lower.includes("gemma");
}

export function isGroqCapableModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower.includes("llama") || lower.includes("mixtral") || lower.includes("gemma") || lower.includes("qwen") || lower.includes("deepseek") || lower.includes("whisper");
}

export function isDeepSeekCapableModel(model: string): boolean {
  const lower = (model ?? "").toLowerCase();
  return lower.includes("deepseek") || lower.includes("chat");
}

export function isGenericOpenAICompatCapableModel(model: string): boolean {
  // Perplexity, ZhipuAI, GrokAI etc. — OpenAI-compatible, parallel supported for any non-empty concrete model id
  const lower = (model ?? "").toLowerCase().trim();
  if (lower.length === 0) return false;
  if (lower === "unknown" || lower === "unknown-model") return false;
  return true;
}

/**
 * Resolve parallelToolCalls capability from explicit source.
 * Returns boolean (POC) but inputs are provider+model+transport/configuration, not a global flag.
 * Fail-closed: any provider/model/transport not explicitly known-capable → false.
 */
export function resolveParallelToolCalls(input: ParallelToolCallsInput): boolean {
  const provider = (input.provider ?? "").toLowerCase();
  const model = input.model ?? "";
  const transport = (input.transport ?? "").toLowerCase();
  const jinjaEnabled = input.jinjaEnabled ?? transport === "jinja";

  // openrouter/free — all openrouter models support parallel tool calls (OpenAI-compatible)
  // Source: provider=openrouter, model=:free or any openrouter id, transport=http. Explicit true.
  if (provider === "openrouter") {
    return true;
  }

  // local-llama — requires Jinja enabled + Jinja-capable model/template (not merely server)
  // Source: provider + model + transport/configuration (jinja flag + model id)
  if (provider === "local-llama") {
    if (!jinjaEnabled) return false;
    return isLocalLlamaJinjaTemplateParallelCapable(model);
  }

  // minimax grounded — explicit false, fallback to serial even if other minimax variants later become true
  // Source: provider + model (grounded detection) — fail-closed to serial
  if (provider === "minimax" || provider === "minimax-token-plan") {
    // Grounded variant is always false; non-grounded is also false for POC (fail-closed conservative)
    // Explicitly check grounded so future non-grounded minimax could be enabled without changing call sites.
    if (isMinimaxGroundedModel(model) || input.isGrounded) return false;
    return false;
  }

  // OpenAI — gpt-4, gpt-4o, gpt-3.5, o1, o3 families support parallel_tool_calls
  if (provider === "openai") {
    return isOpenAICapableModel(model);
  }

  // Anthropic — Claude family supports parallel tool use
  if (provider === "anthropic") {
    return isAnthropicCapableModel(model);
  }

  // Google/Gemini — Gemini family supports parallel tool calls
  if (provider === "google" || provider === "gemini") {
    return isGoogleCapableModel(model);
  }

  if (provider === "groq") {
    return isGroqCapableModel(model);
  }

  if (provider === "deepseek") {
    return isDeepSeekCapableModel(model);
  }

  if (provider === "perplexity" || provider === "zhipuai" || provider === "grokai" || provider === "grok") {
    return isGenericOpenAICompatCapableModel(model);
  }

  // Fail-closed: unknown provider/model/transport → false
  return false;
}
