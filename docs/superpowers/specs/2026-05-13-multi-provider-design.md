# Multi-Provider Support Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new provider adapters (OpenAI, Google Gemini, OpenRouter, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, DeepSeek) alongside the existing Anthropic and Mock providers, wired through a shared registry factory, with updated config schema and CLI set-key prompt.

**Architecture:** Each provider implements the `ModelAdapter` interface via a shared `BaseProvider` class that handles HTTP calls, API key resolution, base URLs, and error handling. Provider-specific quirks (tool name formats, system prompt placement, tool call parsing, streaming) live in each adapter class. The registry factory (`createProvider`) is the single entry point called from `run.ts`.

**Tech Stack:** TypeScript, native `fetch`, no external HTTP client. All providers use the OpenAI-compatible `/v1/chat/completions` format except Gemini, ZhipuAI, MiniMax, and GrokAI which have custom formats.

---

## 1. Shared Base Class

**File:** `src/providers/base.ts`

`BaseProvider` contains all shared logic:

```typescript
export abstract class BaseProvider implements ModelAdapter {
  protected _apiKey: string;
  protected _model: string;
  protected _baseUrl: string;
  protected _timeoutMs: number;

  constructor(options: { apiKey: string; model: string; baseUrl: string; timeoutMs?: number }) {
    this._apiKey = options.apiKey ?? "";
    this._model = options.model;
    this._baseUrl = options.baseUrl;
    this._timeoutMs = options.timeoutMs ?? 120_000;
  }

  protected async post(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${this._baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
        ...this.extraHeaders()
      },
      body: JSON.stringify({ model: this._model, ...body }),
      signal: AbortSignal.timeout(this._timeoutMs)
    });
  }

  protected extraHeaders(): Record<string, string> {
    return {};
  }

  protected parseToolCalls(block: Record<string, unknown>): ToolCall[] {
    // Override in subclass if provider uses different format
    return [];
  }

  abstract get capabilities(): ModelCapabilities;
  abstract editFormatPreference: EditFormat;
  abstract longContextStrategy: "expanded_context" | "trimmed_context";
  abstract complete(request: NormalizedRequest): Promise<NormalizedResponse>;
}
```

`extraHeaders()` returns provider-specific headers (e.g., `X-Title` for OpenRouter).

---

## 2. Provider Adapters

Each provider is one file in `src/providers/`:

### 2a. OpenAI Provider — `openai-provider.ts`

- Extends `BaseProvider`
- Base URL: `https://api.openai.com`
- Model default: `gpt-4o`
- Environment key: `OPENAI_API_KEY`
- Tool call format: OpenAI function_call blocks (rename `name` → `alix_*` prefix via `TOOL_NAME_MAP`)
- Streaming: parse `delta` chunks for text and function_call
- `supportsStructuredOutput`: true
- `supportsVision`: true
- Token limits: input 128k, output 16k

### 2b. Google Gemini Provider — `gemini-provider.ts`

- **Does NOT extend BaseProvider** — uses `@google/gemini-api` or direct REST API
- Base URL: `https://generativelanguage.googleapis.com/v1beta`
- Model default: `gemini-2.0-flash`
- Environment key: `GEMINI_API_KEY`
- Auth: `key` query param (not Bearer header)
- System instructions: passed as top-level `system_instruction` field (not in messages)
- Tool call format: `function_call` parts — name and args are separate
- `editFormatPreference`: `search_replace`
- `longContextStrategy`: `expanded_context`
- Responses can mix text and function calls in same content parts
- Streaming: parse `chunk` events for text and function call deltas
- Token limits: input 1M, output 8k

### 2c. OpenRouter Provider — `openrouter-provider.ts`

- Extends `BaseProvider`
- Base URL: `https://openrouter.ai/api`
- Model default: `anthropic/claude-3.5-sonnet`
- Environment key: `OPENROUTER_API_KEY`
- Extra headers: `HTTP-Referer: https://github.com/alix-cli` and `X-Title: ALiX`
- Capabilities vary by upstream model — use conservative defaults
- Token limits: input 200k, output 8k (conservative)
- `supportsTools`: true (depends on model but assume true for defaults)

### 2d. Groq Provider — `groq-provider.ts`

- Extends `BaseProvider`
- Base URL: `https://api.groq.com/openai/v1`
- Model default: `llama-3.3-70b-versatile`
- Environment key: `GROQ_API_KEY`
- Ultra-low latency focus
- Token limits: input 128k, output 8k

### 2e. Ollama Provider — `ollama-provider.ts`

- Extends `BaseProvider`
- Base URL: configurable (default `http://localhost:11434`)
- Model default: `llama3`
- Environment key: `OLLAMA_API_KEY` (optional — local usually has no key)
- **No API key required** — skip auth header if key is empty
- Tool calling: many Ollama models don't support native tools — if no tool_calls in response, agent should fallback to text-mediated requests
- `supportsTools`: detect from model metadata or assume false
- `editFormatPreference`: `search_replace`
- `longContextStrategy`: `trimmed_context`
- Token limits: input 8k–128k depending on model

### 2f. Perplexity Provider — `perplexity-provider.ts`

- Extends `BaseProvider`
- Base URL: `https://api.perplexity.ai`
- Model default: `llama-3.1-sonar-small-128k-online`
- Environment key: `PERPLEXITY_API_KEY`
- Responses may include `citations` metadata
- Token limits: input 128k, output 8k

### 2g. MiniMax Provider — `minimax-provider.ts`

- **Custom format** (not OpenAI-compatible)
- Base URL: `https://api.minimax.chat`
- Model default: `MiniMax-Text-01`
- Environment key: `MINIMAX_API_KEY`
- Auth: `Authorization: Bearer {key}` header with Group ID in body
- Tool call format: MiniMax function call format (different from OpenAI)
- Streaming: SSE with MiniMax-specific chunk format
- Token limits: input 100k, output 8k

### 2h. ZhipuAI Provider — `zhipuai-provider.ts`

- **Custom format** (not OpenAI-compatible)
- Base URL: `https://open.bigmodel.cn/api/paas/v4`
- Model default: `glm-4-flash`
- Environment key: `ZHIPUAI_API_KEY`
- Auth: `Authorization: Bearer {key}` header
- Tool call format: Zhipu function call format (different from OpenAI)
- Streaming: SSE with Zhipu-specific chunk format
- Token limits: input 128k, output 8k

### 2i. GrokAI Provider — `grokai-provider.ts`

- **Custom format** (not OpenAI-compatible)
- Base URL: `https://api.grok.ai/v1`
- Model default: `grok-2`
- Environment key: `GROKAI_API_KEY`
- Auth: `Authorization: Bearer {key}` header
- Tool call format: Grok function call format
- Token limits: input 131k, output 32k

### 2j. DeepSeek Provider — `deepseek-provider.ts`

- Extends `BaseProvider`
- Base URL: `https://api.deepseek.com`
- Model default: `deepseek-chat`
- Environment key: `DEEPSEEK_API_KEY`
- Tool call format: OpenAI-compatible function_call
- Lower cost profile
- `supportsStructuredOutput`: true
- Token limits: input 64k, output 8k

---

## 3. Registry Factory

**File:** `src/providers/registry.ts`

```typescript
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
```

---

## 4. Config Schema Updates

**File:** `src/config/schema.ts`

Update `ModelConfig.provider`:

```typescript
type ModelConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek" | "local";
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
};
```

Add provider defaults to `src/config/defaults.ts`:

```typescript
model: {
  provider: "anthropic",
  name: "claude-sonnet-4-6-20250514",
  temperature: 0.2
}
```

Each provider can override via `.alix/config.json`:
```json
{ "model": { "provider": "openai", "name": "gpt-4o" } }
```

---

## 5. CLI Updates

**File:** `src/cli.ts`

Replace `PROVIDERS` with `listProviders()` from registry, add provider hints:

```typescript
const PROVIDERS = [
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
```

---

## 6. Edit Format Policy

**File:** `src/patch/edit-format-policy.ts`

Update `defaultEditFormatForProvider`:

```typescript
export function defaultEditFormatForProvider(provider: string): EditFormat {
  if (["google", "local", "ollama", "minimax", "zhipuai", "grokai"].includes(provider)) {
    return "search_replace";
  }
  return "structured_patch";
}
```

---

## 7. Run.ts Integration

**File:** `src/run.ts`

Replace the hardcoded provider selection with `createProvider`:

```typescript
import { createProvider } from "./providers/registry.js";

const provider = createProvider(
  { provider: config.model.provider, model: config.model.name },
  process.env[`${config.model.provider.toUpperCase()}_API_KEY`]
);
```

---

## 8. Tests

**File:** `tests/providers.test.ts`

- Test each provider's `capabilities` shape
- Test that each provider requires its API key (throws when missing)
- Test that each provider accepts config overrides (apiKey, model)
- Use `nock` or mock `fetch` per provider to test request shape
- Test tool call parsing for each provider's format
- Test streaming chunk normalization (where supported)
- Test registry factory throws for unknown provider

---

## Acceptance Criteria

- [ ] `createProvider` from registry produces correct provider for all 10 provider IDs
- [ ] Each provider's `complete()` method sends a well-formed API request
- [ ] Each provider correctly parses tool calls in its native format into `ToolCall[]`
- [ ] Provider throws when API key is missing and tools are requested
- [ ] `alix config set-key` lists all 11 providers with correct env var names
- [ ] Config schema accepts all 12 provider values in `model.provider`
- [ ] Edit format policy returns correct default per provider
- [ ] All existing tests continue to pass
- [ ] Each new provider has at least 3 unit tests