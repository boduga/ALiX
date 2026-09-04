/**
 * Hardening: model capability catalog accuracy (issue #642)
 *
 * Tracer bullet — ensure parallelToolCalls catalog stays accurate as providers/models change.
 * - Resolver covers openrouter/free, local-llama Jinja, minimax grounded, and new providers (each tested)
 * - Fail-closed unknown → false, no global hard-coded flag
 * - Tests prove capability is source-explicit (provider+model+transport)
 *
 * Constraint: Do NOT touch real EventLog, retrieval, observability — only capability catalog.
 */

import { describe, it, expect } from "vitest";
import {
  resolveParallelToolCalls,
  shouldRequestParallelTools,
  isMinimaxGroundedModel,
  isLocalLlamaJinjaTemplateParallelCapable,
  isOpenAICapableModel,
  isAnthropicCapableModel,
  isGoogleCapableModel,
  isGroqCapableModel,
  isDeepSeekCapableModel,
  isOllamaCapableModel,
  isGenericOpenAICompatCapableModel,
} from "../../src/providers/parallel-tool-calls.js";

describe("parallel-tool-calls catalog hardening (#642)", () => {
  // ── openrouter/free ────────────────────────────────────────────────────
  describe("openrouter/free — provider=openrouter true for any model (including :free)", () => {
    it("openrouter/free model is parallel-capable", () => {
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "openrouter/free" })).toBe(true);
    });
    it("openrouter :free suffix is parallel-capable", () => {
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "meta-llama/llama-3.1-8b:free" })).toBe(true);
    });
    it("openrouter any concrete model is parallel-capable (OpenAI-compatible)", () => {
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "anthropic/claude-3.5-sonnet" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "openai/gpt-4o" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "google/gemini-2.5-flash" })).toBe(true);
    });
    it("openrouter source-explicit: transport variation does not affect true (still provider=openrouter)", () => {
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "any", transport: "http" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "any", transport: "jinja" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "any", transport: "" })).toBe(true);
    });
    it("non-openrouter provider with :free model is NOT auto-true (source-explicit provider matters)", () => {
      expect(resolveParallelToolCalls({ provider: "openai", model: "meta-llama/llama-3.1-8b:free" })).toBe(false);
      // openai provider checks isOpenAICapableModel which requires gpt/o1/o3/chatgpt
      expect(resolveParallelToolCalls({ provider: "anthropic", model: "openrouter/free" })).toBe(false);
    });
  });

  // ── local-llama Jinja ──────────────────────────────────────────────────
  describe("local-llama Jinja — provider+model+transport (jinja flag)", () => {
    it("jinjaEnabled true + known family → true", () => {
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b-instruct-q4_K_M.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "Llama-3.1-8B-Instruct.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "phi-3-mini-4k-instruct-q4_K_M.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "gemma-2-9b-it.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "mistral-7b-instruct.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "deepseek-coder-6.7b.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "functionary-medium-v3.2.gguf", jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "hermes-2-pro-llama-3-8b.gguf", jinjaEnabled: true })).toBe(true);
    });
    it("transport jinja string also enables (alternate transport signal)", () => {
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", transport: "jinja" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", transport: "JINJA" })).toBe(true);
    });
    it("jinjaEnabled false → false even with known family (not merely server)", () => {
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", jinjaEnabled: false })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", transport: "http" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf" })).toBe(false); // no jinja flag defaults false
    });
    it("unknown template → false even with jinja true (fail-closed)", () => {
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "local-model", jinjaEnabled: true })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "my-custom-unknown-model.gguf", jinjaEnabled: true })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "unknown-model", transport: "jinja" })).toBe(false);
    });
    it("isLocalLlamaJinjaTemplateParallelCapable allowlist is fail-closed", () => {
      expect(isLocalLlamaJinjaTemplateParallelCapable("qwen2.5-7b")).toBe(true);
      expect(isLocalLlamaJinjaTemplateParallelCapable("local-model")).toBe(false);
      expect(isLocalLlamaJinjaTemplateParallelCapable("")).toBe(false);
      expect(isLocalLlamaJinjaTemplateParallelCapable("random-model-xyz")).toBe(false);
    });
    it("source-explicit: same model with jinja true vs false yields different capability", () => {
      const model = "qwen2.5-7b-instruct.gguf";
      expect(resolveParallelToolCalls({ provider: "local-llama", model, jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model, jinjaEnabled: false })).toBe(false);
    });
  });

  // ── minimax grounded ───────────────────────────────────────────────────
  describe("minimax grounded — provider+model grounded detection → false serial fallback", () => {
    it("isMinimaxGroundedModel detects grounded/search", () => {
      expect(isMinimaxGroundedModel("minimax-m3-grounded")).toBe(true);
      expect(isMinimaxGroundedModel("MiniMax-M3-search")).toBe(true);
      expect(isMinimaxGroundedModel("minimax-text-01")).toBe(false);
      expect(isMinimaxGroundedModel("abab6.5s-chat")).toBe(false);
    });
    it("minimax grounded model → false", () => {
      expect(resolveParallelToolCalls({ provider: "minimax", model: "minimax-m3-grounded" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax", model: "minimax-text-01-search" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax", model: "minimax-m3-grounded", isGrounded: true })).toBe(false);
    });
    it("minimax non-grounded also false for POC (fail-closed conservative)", () => {
      expect(resolveParallelToolCalls({ provider: "minimax", model: "minimax-text-01" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax", model: "abab6.5s-chat" })).toBe(false);
    });
    it("minimax-token-plan grounded → false (both minimax providers)", () => {
      expect(resolveParallelToolCalls({ provider: "minimax-token-plan", model: "MiniMax-M3-grounded" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax-token-plan", model: "MiniMax-M3" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax-token-plan", model: "any", isGrounded: true })).toBe(false);
    });
    it("minimax source-explicit: isGrounded flag also forces false even with generic model", () => {
      expect(resolveParallelToolCalls({ provider: "minimax", model: "any-model", isGrounded: true })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax", model: "any-model", isGrounded: false })).toBe(false); // still false POC
    });
  });

  // ── new providers ──────────────────────────────────────────────────────
  describe("new providers — each has explicit test (added for hardening)", () => {
    it("openai — gpt/o1/o3/chatgpt families true, unknown → false", () => {
      expect(isOpenAICapableModel("gpt-4o")).toBe(true);
      expect(isOpenAICapableModel("gpt-4o-mini")).toBe(true);
      expect(isOpenAICapableModel("gpt-3.5-turbo")).toBe(true);
      expect(isOpenAICapableModel("o1-preview")).toBe(true);
      expect(isOpenAICapableModel("o3-mini")).toBe(true);
      expect(isOpenAICapableModel("chatgpt-4o-latest")).toBe(true);
      expect(isOpenAICapableModel("davinci-003")).toBe(false);
      expect(isOpenAICapableModel("unknown-model")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "openai", model: "gpt-4o" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openai", model: "davinci-003" })).toBe(false);
    });
    it("anthropic — claude family true, unknown → false", () => {
      expect(isAnthropicCapableModel("claude-sonnet-4-6")).toBe(true);
      expect(isAnthropicCapableModel("claude-3-5-haiku")).toBe(true);
      expect(isAnthropicCapableModel("gpt-4o")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "anthropic", model: "claude-sonnet-4-6" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "anthropic", model: "gpt-4o" })).toBe(false);
    });
    it("google/gemini — gemini/gemma true, unknown → false", () => {
      expect(isGoogleCapableModel("gemini-2.5-flash")).toBe(true);
      expect(isGoogleCapableModel("gemma-3-27b")).toBe(true);
      expect(isGoogleCapableModel("gpt-4o")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "google", model: "gemini-2.5-flash" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "gemini", model: "gemini-2.0-flash" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "google", model: "unknown-model" })).toBe(false);
    });
    it("groq — llama/mixtral/gemma/qwen/deepseek/whisper true, unknown → false", () => {
      expect(isGroqCapableModel("llama-3.3-70b-versatile")).toBe(true);
      expect(isGroqCapableModel("mixtral-8x7b-32768")).toBe(true);
      expect(isGroqCapableModel("qwen-2.5-32b")).toBe(true);
      expect(isGroqCapableModel("whisper-large-v3")).toBe(true);
      expect(isGroqCapableModel("random-xyz")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "groq", model: "llama-3.3-70b-versatile" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "groq", model: "unknown-model-xyz" })).toBe(false);
    });
    it("deepseek — deepseek/chat true, unknown → false", () => {
      expect(isDeepSeekCapableModel("deepseek-chat")).toBe(true);
      expect(isDeepSeekCapableModel("deepseek-reasoner")).toBe(true);
      expect(isDeepSeekCapableModel("deepseek-coder")).toBe(true);
      expect(isDeepSeekCapableModel("random-model")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "deepseek", model: "deepseek-chat" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "deepseek", model: "unknown-xyz" })).toBe(false);
    });
    it("ollama — allowlist true, unknown → false (new provider hardening)", () => {
      expect(isOllamaCapableModel("llama3.2")).toBe(true);
      expect(isOllamaCapableModel("qwen2.5-coder:7b")).toBe(true);
      expect(isOllamaCapableModel("mistral:7b")).toBe(true);
      expect(isOllamaCapableModel("gemma2:9b")).toBe(true);
      expect(isOllamaCapableModel("deepseek-r1:8b")).toBe(true);
      expect(isOllamaCapableModel("phi3:mini")).toBe(true);
      expect(isOllamaCapableModel("hermes3:8b")).toBe(true);
      expect(isOllamaCapableModel("unknown-custom-model-xyz")).toBe(false);
      expect(isOllamaCapableModel("")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "ollama", model: "llama3.2" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "ollama", model: "qwen2.5-coder:7b" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "ollama", model: "unknown-model-xyz" })).toBe(false);
    });
    it("perplexity — generic OpenAI-compat true for non-empty, false for empty/unknown", () => {
      expect(isGenericOpenAICompatCapableModel("sonar-pro")).toBe(true);
      expect(isGenericOpenAICompatCapableModel("sonar")).toBe(true);
      expect(isGenericOpenAICompatCapableModel("")).toBe(false);
      expect(isGenericOpenAICompatCapableModel("unknown")).toBe(false);
      expect(isGenericOpenAICompatCapableModel("unknown-model")).toBe(false);
      expect(resolveParallelToolCalls({ provider: "perplexity", model: "sonar-pro" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "perplexity", model: "" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "perplexity", model: "unknown" })).toBe(false);
    });
    it("zhipuai — generic true for concrete model, false for empty", () => {
      expect(resolveParallelToolCalls({ provider: "zhipuai", model: "glm-4-flash" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "zhipuai", model: "" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "zhipuai", model: "unknown" })).toBe(false);
    });
    it("grokai/grok — generic true for concrete model", () => {
      expect(resolveParallelToolCalls({ provider: "grokai", model: "grok-2-latest" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "grok", model: "grok-2-latest" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "grokai", model: "unknown" })).toBe(false);
    });
  });

  // ── fail-closed unknown → false ────────────────────────────────────────
  describe("fail-closed unknown → false", () => {
    it("unknown provider → false regardless of model", () => {
      expect(resolveParallelToolCalls({ provider: "mock", model: "mock-model" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "unknown-provider", model: "gpt-4o" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "fake", model: "any" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "", model: "gpt-4o" })).toBe(false);
    });
    it("unknown model for known provider → false (except openrouter/generic which is intentionally true for any concrete)", () => {
      expect(resolveParallelToolCalls({ provider: "openai", model: "unknown-model-xyz" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "anthropic", model: "unknown-model-xyz" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "google", model: "unknown-model-xyz" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "groq", model: "unknown-model-xyz" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "deepseek", model: "unknown-model-xyz" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "ollama", model: "unknown-model-xyz" })).toBe(false);
    });
    it("empty provider/model → false", () => {
      expect(resolveParallelToolCalls({ provider: "", model: "" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "openai", model: "" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "", model: "gpt-4o" })).toBe(false);
    });
    it("shouldRequestParallelTools fail-closed when provider/model missing", () => {
      expect(shouldRequestParallelTools({ tools: { length: 2 } })).toBe(false);
      expect(shouldRequestParallelTools({ provider: "mock", model: "mock-model", tools: { length: 2 } })).toBe(false);
      expect(shouldRequestParallelTools({ provider: "openai", model: "unknown-model-xyz", tools: { length: 2 } })).toBe(false);
    });
  });

  // ── no global hard-coded flag ──────────────────────────────────────────
  describe("no global hard-coded flag — capability is per-source, not singleton", () => {
    it("same model string yields different result for different provider", () => {
      const model = "gpt-4o";
      expect(resolveParallelToolCalls({ provider: "openai", model })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "anthropic", model })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "mock", model })).toBe(false);
    });
    it("same model with different provider for generic vs allowlist", () => {
      // sonar-pro is generic-capable for perplexity but not for openai (needs gpt substring)
      expect(resolveParallelToolCalls({ provider: "perplexity", model: "sonar-pro" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "openai", model: "sonar-pro" })).toBe(false);
    });
    it("changing transport changes local-llama result (no global flag)", () => {
      const model = "qwen2.5-7b.gguf";
      expect(resolveParallelToolCalls({ provider: "local-llama", model, transport: "jinja" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model, transport: "http" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model, jinjaEnabled: true })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "local-llama", model, jinjaEnabled: false })).toBe(false);
    });
    it("no single boolean governs all providers — each branch explicit", () => {
      // Proof: openrouter true, mock false, minimax false, local-llama false without jinja — not uniform
      expect(resolveParallelToolCalls({ provider: "openrouter", model: "any" })).toBe(true);
      expect(resolveParallelToolCalls({ provider: "mock", model: "any" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "minimax", model: "any" })).toBe(false);
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf" })).toBe(false);
    });
  });

  // ── source-explicit (provider+model+transport) ─────────────────────────
  describe("source-explicit capability (provider+model+transport)", () => {
    it("resolver inputs are provider+model+transport — all three participate", () => {
      // provider matters
      expect(resolveParallelToolCalls({ provider: "openai", model: "gpt-4o" })).not.toBe(
        resolveParallelToolCalls({ provider: "anthropic", model: "gpt-4o" }),
      );
      // model matters
      expect(resolveParallelToolCalls({ provider: "openai", model: "gpt-4o" })).not.toBe(
        resolveParallelToolCalls({ provider: "openai", model: "unknown-xyz" }),
      );
      // transport matters for local-llama
      expect(resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", transport: "jinja" })).not.toBe(
        resolveParallelToolCalls({ provider: "local-llama", model: "qwen2.5-7b.gguf", transport: "http" }),
      );
    });
    it("isGrounded transport-equivalent for minimax is source-explicit", () => {
      expect(resolveParallelToolCalls({ provider: "minimax", model: "minimax-m3", isGrounded: true })).toBe(false);
      // same provider+model without grounded flag also false for POC, but path is explicit (checked via isMinimaxGroundedModel)
      expect(isMinimaxGroundedModel("minimax-m3-grounded")).toBe(true);
      expect(isMinimaxGroundedModel("minimax-text-01")).toBe(false);
    });
    it("shouldRequestParallelTools is source-explicit via capabilities → explicit flag → resolver", () => {
      // capabilities true overrides resolver
      expect(
        shouldRequestParallelTools({
          provider: "mock",
          model: "mock-model",
          tools: { length: 2 },
          capabilities: { parallelToolCalls: true },
        }),
      ).toBe(true);
      expect(
        shouldRequestParallelTools({
          provider: "mock",
          model: "mock-model",
          tools: { length: 2 },
          capabilities: { parallelToolCalls: false },
        }),
      ).toBe(false);
      // explicit flag
      expect(
        shouldRequestParallelTools({ provider: "mock", model: "mock-model", tools: { length: 2 }, parallelToolCalls: true }),
      ).toBe(true);
      // resolver fallback (source-explicit)
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: { length: 2 } })).toBe(true);
      expect(shouldRequestParallelTools({ provider: "mock", model: "mock-model", tools: { length: 2 } })).toBe(false);
    });
    it("shouldRequestParallelTools requires tools.length > 1 (no parallel for 0/1)", () => {
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: { length: 0 } })).toBe(false);
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: { length: 1 } })).toBe(false);
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: { length: 2 } })).toBe(true);
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: null })).toBe(false);
      expect(shouldRequestParallelTools({ provider: "openrouter", model: "any", tools: undefined })).toBe(false);
    });
    it("shouldRequestParallelTools ignores provider when capabilities explicitly set (capabilities is single source)", () => {
      // Even though openrouter resolver says true, explicit capabilities false wins
      expect(
        shouldRequestParallelTools({
          provider: "openrouter",
          model: "any",
          tools: { length: 2 },
          capabilities: { parallelToolCalls: false },
        }),
      ).toBe(false);
      // And mock with explicit true wins even though resolver false
      expect(
        shouldRequestParallelTools({
          provider: "mock",
          model: "mock-model",
          tools: { length: 2 },
          capabilities: { parallelToolCalls: true },
        }),
      ).toBe(true);
    });
  });
});
