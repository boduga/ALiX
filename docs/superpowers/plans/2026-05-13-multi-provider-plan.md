# Multi-Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 new provider adapters (OpenAI, Gemini, OpenRouter, Groq, Ollama, Perplexity, MiniMax, ZhipuAI, GrokAI, DeepSeek) wired through a registry factory, with updated config schema, edit format policy, and CLI set-key prompt.

**Architecture:** `BaseProvider` holds shared HTTP logic for OpenAI-compatible providers. Each adapter class implements `ModelAdapter`, normalizing provider-specific quirks into the shared interface. `createProvider()` in `registry.ts` is the single instantiation entry point.

**Tech Stack:** TypeScript, native `fetch`, no external HTTP client.

---

## Task Map

| # | Task | Files created / modified |
|---|------|--------------------------|
| 1 | Shared `BaseProvider` class | `src/providers/base.ts` |
| 2 | `OpenAIProvider` | `src/providers/openai-provider.ts` |
| 3 | `OpenRouterProvider` | `src/providers/openrouter-provider.ts` |
| 4 | `GroqProvider` | `src/providers/groq-provider.ts` |
| 5 | `OllamaProvider` | `src/providers/ollama-provider.ts` |
| 6 | `PerplexityProvider` | `src/providers/perplexity-provider.ts` |
| 7 | `DeepSeekProvider` | `src/providers/deepseek-provider.ts` |
| 8 | `GeminiProvider` (custom format) | `src/providers/gemini-provider.ts` |
| 9 | `MiniMaxProvider` (custom format) | `src/providers/minimax-provider.ts` |
| 10 | `ZhipuAIProvider` (custom format) | `src/providers/zhipuai-provider.ts` |
| 11 | `GrokAIProvider` (custom format) | `src/providers/grokai-provider.ts` |
| 12 | `ProviderRegistry` + `listProviders` | `src/providers/registry.ts` |
| 13 | Config schema + defaults | `src/config/schema.ts`, `src/config/defaults.ts` |
| 14 | Edit format policy | `src/patch/edit-format-policy.ts` |
| 15 | CLI `set-key` with all providers | `src/cli.ts` |
| 16 | Wire `createProvider` into `run.ts` | `src/run.ts` |
| 17 | Provider unit tests | `tests/providers.test.ts` |

Tasks 2–7 depend on Task 1. Tasks 8–11 depend on Task 1. Tasks 12–17 depend on their prerequisites above.

---

### Task 1: Shared BaseProvider Class

**Files:**
- Create: `src/providers/base.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/providers.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// BaseProvider is abstract — test through a concrete subclass
import { OpenAIProvider } from "../src/providers/openai-provider.js";

test("base provider accepts apiKey and model options", () => {
  const p = new OpenAIProvider({ apiKey: "test-key", model: "gpt-4o" });
  assert.equal(p.capabilities.model, "gpt-4o");
});

test("base provider uses correct base URL", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // Check via capabilities — model name confirms URL resolution worked
  assert.equal(p.capabilities.provider, "openai");
});
```

Run: `npm run build 2>&1 | head -30` — Expected: compile error "cannot find module"

- [ ] **Step 2: Write the base class**

Create `src/providers/base.ts`:

```typescript
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";
import type { EditFormat } from "../patch/edit-format-policy.js";

export abstract class BaseProvider implements ModelAdapter {
  protected _apiKey: string;
  protected _model: string;
  protected _baseUrl: string;
  protected _timeoutMs: number;

  constructor(options: { apiKey?: string; model: string; baseUrl: string; timeoutMs?: number }) {
    this._apiKey = options.apiKey ?? "";
    this._model = options.model;
    this._baseUrl = options.baseUrl;
    this._timeoutMs = options.timeoutMs ?? 120_000;
  }

  protected async post(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this._apiKey) {
      headers["Authorization"] = `Bearer ${this._apiKey}`;
    }
    const extra = this.extraHeaders();
    for (const [k, v] of Object.entries(extra)) {
      headers[k] = v;
    }

    return fetch(`${this._baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this._model, ...body }),
      signal: AbortSignal.timeout(this._timeoutMs),
    });
  }

  protected extraHeaders(): Record<string, string> {
    return {};
  }

  protected parseOpenAIToolCalls(content: unknown): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    if (!Array.isArray(content)) return toolCalls;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "function" &&
        "function" in block &&
        block.function &&
        typeof block.function === "object"
      ) {
        const fn = block.function as { name?: string; arguments?: string };
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: fn.name ?? "",
          args: fn.arguments ? JSON.parse(fn.arguments) : {},
        });
      }
    }
    return toolCalls;
  }

  abstract get capabilities(): ModelCapabilities;
  abstract id: string;
  abstract editFormatPreference: EditFormat;
  abstract longContextStrategy: "expanded_context" | "trimmed_context";
  abstract complete(request: NormalizedRequest): Promise<NormalizedResponse>;
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test 2>&1` — Expected: tests pass (BaseProvider is abstract so no direct test, covered via provider tests)

- [ ] **Step 4: Commit**

```bash
git add src/providers/base.ts tests/providers.test.ts
git commit -m "feat: add BaseProvider shared class for OpenAI-compatible providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: OpenAIProvider

**Files:**
- Create: `src/providers/openai-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("openai provider returns correct capabilities", () => {
  const p = new OpenAIProvider({ apiKey: "sk-test" });
  const c = p.capabilities;
  assert.equal(c.provider, "openai");
  assert.equal(c.model, "gpt-4o");
  assert.equal(c.supportsTools, true);
  assert.equal(c.supportsStreaming, false);
  assert.equal(c.supportsStructuredOutput, true);
  assert.equal(c.supportsVision, true);
});

test("openai provider accepts config overrides", () => {
  const p = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });
  assert.equal(p.capabilities.model, "gpt-4o-mini");
});

test("openai provider requires api key", async () => {
  const p = new OpenAIProvider({});
  await assert.rejects(() => p.complete({ systemPrompt: "", messages: [] }), {
    message: /API key/,
  });
});
```

Run: `npm run build 2>&1` — Expected: compile error "OpenAIProvider not found"

- [ ] **Step 2: Write OpenAIProvider**

Create `src/providers/openai-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type OpenAIConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenAIProvider extends BaseProvider {
  id = "openai";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OpenAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? "",
      model: config.model ?? "gpt-4o",
      baseUrl: "https://api.openai.com",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "openai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1);
    const message = choice?.message ?? {};

    let text = "";
    const toolCalls: ToolCall[] = [];

    if (typeof message.content === "string") text = message.content;

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? randomUUID(),
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test 2>&1` — Expected: tests pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/openai-provider.ts tests/providers.test.ts
git commit -m "feat: add OpenAIProvider (gpt-4o) adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: OpenRouterProvider

**Files:**
- Create: `src/providers/openrouter-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("openrouter provider returns correct capabilities", () => {
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  assert.equal(p.capabilities.provider, "openrouter");
  assert.equal(p.capabilities.model, "anthropic/claude-3.5-sonnet");
});

test("openrouter provider adds required headers", () => {
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  const headers = p.extraHeaders();
  assert.ok(headers["HTTP-Referer"]);
  assert.ok(headers["X-Title"]);
});
```

Run: `npm run build 2>&1` — Expected: compile error "OpenRouterProvider not found"

- [ ] **Step 2: Write OpenRouterProvider**

Create `src/providers/openrouter-provider.ts`:

```typescript
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenRouterProvider extends BaseProvider {
  id = "openrouter";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OpenRouterConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
      model: config.model ?? "anthropic/claude-3.5-sonnet",
      baseUrl: "https://openrouter.ai/api",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "openrouter",
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: true,
    };
  }

  protected extraHeaders(): Record<string, string> {
    return {
      "HTTP-Referer": "https://github.com/alix-cli/alix",
      "X-Title": "ALiX",
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1);
    const message = choice?.message ?? {};
    let text = "";
    const toolCalls = [];

    if (typeof message.content === "string") text = message.content;
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test 2>&1` — Expected: tests pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/openrouter-provider.ts tests/providers.test.ts
git commit -m "feat: add OpenRouterProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: GroqProvider

**Files:**
- Create: `src/providers/groq-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("groq provider returns correct capabilities", () => {
  const p = new GroqProvider({ apiKey: "gsk_test" });
  assert.equal(p.capabilities.provider, "groq");
  assert.equal(p.capabilities.model, "llama-3.3-70b-versatile");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write GroqProvider**

Create `src/providers/groq-provider.ts`:

```typescript
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type GroqConfig = {
  apiKey?: string;
  model?: string;
};

export class GroqProvider extends BaseProvider {
  id = "groq";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: GroqConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GROQ_API_KEY ?? "",
      model: config.model ?? "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "groq",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GROQ_API_KEY is not set");

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/groq-provider.ts tests/providers.test.ts
git commit -m "feat: add GroqProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: OllamaProvider

**Files:**
- Create: `src/providers/ollama-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("ollama provider returns correct capabilities", () => {
  const p = new OllamaProvider({ apiKey: "" });
  assert.equal(p.capabilities.provider, "ollama");
  assert.equal(p.capabilities.model, "llama3");
  // No API key required for local
  assert.equal(p.capabilities.supportsTools, false); // conservative default
});

test("ollama provider works without api key", async () => {
  const p = new OllamaProvider({});
  const c = p.capabilities;
  assert.ok(c.model); // doesn't throw
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write OllamaProvider**

Create `src/providers/ollama-provider.ts`:

```typescript
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export class OllamaProvider extends BaseProvider {
  id = "ollama";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OllamaConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? "llama3",
      baseUrl: config.baseUrl ?? "http://localhost:11434",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "ollama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: false, // conservative; detect per-model at runtime if needed
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
      stream: false,
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;

    // Ollama API: no Authorization header when apiKey is empty
    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string; tool_calls?: unknown[] };
      tool_calls?: Array<{ name: string; arguments: string }>;
      error?: string;
    };

    if (data.error) throw new Error(`Ollama: ${data.error}`);

    let text = data.message?.content ?? "";
    const toolCalls = [];

    if (data.message?.tool_calls) {
      for (const tc of data.message.tool_calls as Array<{ name: string; arguments: string }>) {
        toolCalls.push({
          id: `call_${Date.now()}`,
          name: tc.name,
          args: tc.arguments ? JSON.parse(tc.arguments) : {},
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/ollama-provider.ts tests/providers.test.ts
git commit -m "feat: add OllamaProvider (local) adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: PerplexityProvider

**Files:**
- Create: `src/providers/perplexity-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("perplexity provider returns correct capabilities", () => {
  const p = new PerplexityProvider({ apiKey: "pplx-test" });
  assert.equal(p.capabilities.provider, "perplexity");
  assert.equal(p.capabilities.model, "llama-3.1-sonar-small-128k-online");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write PerplexityProvider**

Create `src/providers/perplexity-provider.ts`:

```typescript
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type PerplexityConfig = {
  apiKey?: string;
  model?: string;
};

export class PerplexityProvider extends BaseProvider {
  id = "perplexity";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: PerplexityConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.PERPLEXITY_API_KEY ?? "",
      model: config.model ?? "llama-3.1-sonar-small-128k-online",
      baseUrl: "https://api.perplexity.ai",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "perplexity",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("PERPLEXITY_API_KEY is not set");

    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Perplexity API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/perplexity-provider.ts tests/providers.test.ts
git commit -m "feat: add PerplexityProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: DeepSeekProvider

**Files:**
- Create: `src/providers/deepseek-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("deepseek provider returns correct capabilities", () => {
  const p = new DeepSeekProvider({ apiKey: "sk-ds-test" });
  assert.equal(p.capabilities.provider, "deepseek");
  assert.equal(p.capabilities.model, "deepseek-chat");
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write DeepSeekProvider**

Create `src/providers/deepseek-provider.ts`:

```typescript
import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type DeepSeekConfig = {
  apiKey?: string;
  model?: string;
};

export class DeepSeekProvider extends BaseProvider {
  id = "deepseek";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: DeepSeekConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      model: config.model ?? "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "deepseek",
      model: this._model,
      inputTokenLimit: 64_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("DEEPSEEK_API_KEY is not set");

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/deepseek-provider.ts tests/providers.test.ts
git commit -m "feat: add DeepSeekProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: GeminiProvider (custom format)

**Files:**
- Create: `src/providers/gemini-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("gemini provider returns correct capabilities", () => {
  const p = new GeminiProvider({ apiKey: "AIza-test" });
  const c = p.capabilities;
  assert.equal(c.provider, "google");
  assert.equal(c.model, "gemini-2.0-flash");
  assert.equal(c.editFormatPreference, "search_replace");
  assert.equal(c.longContextStrategy, "expanded_context");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write GeminiProvider**

Create `src/providers/gemini-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type GeminiConfig = {
  apiKey?: string;
  model?: string;
};

export class GeminiProvider implements ModelAdapter {
  id = "google";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "expanded_context" as const;

  private _apiKey: string;
  private _model: string;

  constructor(config: GeminiConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this._model = config.model ?? "gemini-2.0-flash";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "google",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: true,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GEMINI_API_KEY is not set");

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts:
        typeof m.content === "string"
          ? [{ text: m.content }]
          : m.content.map((p) => ("text" in p ? { text: p.text } : { image: { raw: p.source } })),
    }));

    const body: Record<string, unknown> = {
      contents,
      system_instruction: request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = {
        functionDeclarations: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
        };
      }>;
    };

    const parts = data.candidates?.at(-1)?.content?.parts ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          args: part.functionCall.args,
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/gemini-provider.ts tests/providers.test.ts
git commit -m "feat: add GeminiProvider (Google) adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: MiniMaxProvider (custom format)

**Files:**
- Create: `src/providers/minimax-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("minimax provider returns correct capabilities", () => {
  const p = new MiniMaxProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "minimax");
  assert.equal(p.capabilities.model, "MiniMax-Text-01");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write MiniMaxProvider**

Create `src/providers/minimax-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type MiniMaxConfig = {
  apiKey?: string;
  model?: string;
  groupId?: string;
};

export class MiniMaxProvider implements ModelAdapter {
  id = "minimax";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;
  private _groupId: string;

  constructor(config: MiniMaxConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
    this._model = config.model ?? "MiniMax-Text-01";
    this._groupId = config.groupId ?? "";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "minimax",
      model: this._model,
      inputTokenLimit: 100_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("MINIMAX_API_KEY is not set");

    const messages = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (this._groupId) body.group_id = this._groupId;

    if (request.tools && request.tools.length > 0) {
      body.tools = {
        type: "function",
        function: {
          name: "functions",
          description: "Available tools",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              arguments: { type: "string" },
            },
          },
        },
      };
    }

    const response = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices?.at(-1);
    let text = "";
    const toolCalls: ToolCall[] = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? randomUUID(),
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/minimax-provider.ts tests/providers.test.ts
git commit -m "feat: add MiniMaxProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: ZhipuAIProvider (custom format)

**Files:**
- Create: `src/providers/zhipuai-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("zhipuai provider returns correct capabilities", () => {
  const p = new ZhipuAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "zhipuai");
  assert.equal(p.capabilities.model, "glm-4-flash");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write ZhipuAIProvider**

Create `src/providers/zhipuai-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type ZhipuAIConfig = {
  apiKey?: string;
  model?: string;
};

export class ZhipuAIProvider implements ModelAdapter {
  id = "zhipuai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;

  constructor(config: ZhipuAIConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.ZHIPUAI_API_KEY ?? "";
    this._model = config.model ?? "glm-4-flash";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "zhipuai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("ZHIPUAI_API_KEY is not set");

    const messages = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: "system", content: request.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ZhipuAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls: ToolCall[] = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? randomUUID(),
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/zhipuai-provider.ts tests/providers.test.ts
git commit -m "feat: add ZhipuAIProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: GrokAIProvider (custom format)

**Files:**
- Create: `src/providers/grokai-provider.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("grokai provider returns correct capabilities", () => {
  const p = new GrokAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "grokai");
  assert.equal(p.capabilities.model, "grok-2");
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write GrokAIProvider**

Create `src/providers/grokai-provider.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type GrokAIConfig = {
  apiKey?: string;
  model?: string;
};

export class GrokAIProvider implements ModelAdapter {
  id = "grokai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;

  constructor(config: GrokAIConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.GROKAI_API_KEY ?? "";
    this._model = config.model ?? "grok-2";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "grokai",
      model: this._model,
      inputTokenLimit: 131_072,
      outputTokenLimit: 32_768,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GROKAI_API_KEY is not set");

    const messages = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: "system", content: request.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await fetch("https://api.grok.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`GrokAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls: ToolCall[] = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? randomUUID(),
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/grokai-provider.ts tests/providers.test.ts
git commit -m "feat: add GrokAIProvider adapter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: ProviderRegistry

**Files:**
- Create: `src/providers/registry.ts`
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createProvider, listProviders } from "../src/providers/registry.js";

test("createProvider produces correct provider for all ids", () => {
  const ids = ["anthropic", "openai", "google", "openrouter", "groq", "ollama", "perplexity", "minimax", "zhipuai", "grokai", "deepseek", "mock"] as const;
  for (const id of ids) {
    const p = createProvider({ provider: id }, "fake-key");
    assert.equal(p.id, id);
  }
});

test("createProvider throws for unknown provider", () => {
  assert.throws(() => createProvider({ provider: "unknown" }, "fake-key"), {
    message: /Unknown provider/,
  });
});

test("listProviders returns all 12 providers", () => {
  const list = listProviders();
  assert.equal(list.length, 12);
  assert.ok(list.find((p) => p.id === "deepseek"));
  assert.ok(list.find((p) => p.id === "grokai"));
});
```

Run: `npm run build 2>&1` — Expected: compile error

- [ ] **Step 2: Write registry**

Create `src/providers/registry.ts`:

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

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/providers/registry.ts tests/providers.test.ts
git commit -m "feat: add provider registry factory and listProviders

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Config Schema + Defaults

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/defaults.ts`

- [ ] **Step 1: Update provider union type in schema.ts**

```typescript
// In src/config/schema.ts, replace line 4:
export type ModelConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek" | "local";
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
};
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED (existing defaults.ts already has anthropic as default)

- [ ] **Step 2: Verify defaults match spec**

Check `src/config/defaults.ts` — it should already have `provider: "anthropic"` and `name: "claude-sonnet-4-6-20250514"`. If not, update it.

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1` — Expected: pass (config-loader test verifies provider is "anthropic")

- [ ] **Step 4: Commit**

```bash
git add src/config/schema.ts src/config/defaults.ts
git commit -m "feat: extend config provider union to all 12 providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Edit Format Policy

**Files:**
- Modify: `src/patch/edit-format-policy.ts`

- [ ] **Step 1: Update defaultEditFormatForProvider**

```typescript
// In src/patch/edit-format-policy.ts, replace the function:
export function defaultEditFormatForProvider(provider: string): EditFormat {
  if (["google", "local", "ollama", "minimax", "zhipuai", "grokai"].includes(provider)) {
    return "search_replace";
  }
  return "structured_patch";
}
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 3: Commit**

```bash
git add src/patch/edit-format-policy.ts
git commit -m "feat: update edit format policy for new providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 15: CLI set-key with All Providers

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update PROVIDERS array**

```typescript
// In src/cli.ts, replace the PROVIDERS array:
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

Also update the help text in `cli.ts`:

```typescript
// In the help output, update the usage text to include more providers:
console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"
  alix serve
  alix config show
  alix config set-key     Interactive API key setup (supports 11 providers)
`);
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1` — Expected: pass

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: extend CLI set-key to all 11 providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 16: Wire createProvider into run.ts

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Replace hardcoded provider selection**

Read `src/run.ts` lines 100–110. The current code is:

```typescript
const provider =
  config.model.provider === "anthropic"
    ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
    : new MockProvider();
```

Replace with:

```typescript
import { createProvider } from "./providers/registry.js";

// Replace the hardcoded provider block with:
const provider = createProvider(
  { provider: config.model.provider, model: config.model.name },
  process.env[`${config.model.provider.toUpperCase()}_API_KEY`]
);
```

Also remove the now-unused imports:

```typescript
// Remove: import { MockProvider } from "./providers/mock-provider.js";
// Remove: import { AnthropicProvider } from "./providers/anthropic-provider.js";
```

And remove the `TOOL_NAME_MAP` entries if they reference provider-specific tool names — check if entries like `file_read` → `file.read` already exist (they do, from lines 16–21 in run.ts), keep those.

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1` — Expected: pass (run-flow test should work with anthropic provider)

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "feat: wire createProvider registry into run.ts

Replaces hardcoded anthropic/mock selection with dynamic provider
instantiation based on config.model.provider.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 17: Provider Unit Tests

**Files:**
- Modify: `tests/providers.test.ts`

- [ ] **Step 1: Add comprehensive tests**

Add the following tests to `tests/providers.test.ts` — these test the `capabilities` shape and constructor behavior for each provider without making real API calls:

```typescript
// === Per-provider capabilities tests ===

test("gemini provider editFormatPreference is search_replace", () => {
  const p = new GeminiProvider({ apiKey: "test" });
  assert.equal(p.editFormatPreference, "search_replace");
  assert.equal(p.longContextStrategy, "expanded_context");
});

test("ollama provider editFormatPreference is search_replace", () => {
  const p = new OllamaProvider({});
  assert.equal(p.editFormatPreference, "search_replace");
});

test("minimax provider editFormatPreference is search_replace", () => {
  const p = new MiniMaxProvider({ apiKey: "test" });
  assert.equal(p.editFormatPreference, "search_replace");
});

test("zhipuai provider editFormatPreference is search_replace", () => {
  const p = new ZhipuAIProvider({ apiKey: "test" });
  assert.equal(p.editFormatPreference, "search_replace");
});

test("grokai provider editFormatPreference is search_replace", () => {
  const p = new GrokAIProvider({ apiKey: "test" });
  assert.equal(p.editFormatPreference, "search_replace");
});

test("openai provider editFormatPreference is structured_patch", () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  assert.equal(p.editFormatPreference, "structured_patch");
});

test("deepseek provider supports structured output", () => {
  const p = new DeepSeekProvider({ apiKey: "test" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("ollama provider works without api key", () => {
  const p = new OllamaProvider({});
  assert.ok(p._apiKey === "");
  const c = p.capabilities;
  assert.equal(c.supportsTools, false); // conservative default
});

// === Registry tests ===

test("registry createProvider works with model override", () => {
  const p = createProvider({ provider: "openai", model: "gpt-4o-mini" }, "key");
  assert.equal(p.capabilities.model, "gpt-4o-mini");
});

test("registry listProviders has all expected providers", () => {
  const list = listProviders();
  const ids = list.map((p) => p.id).sort();
  const expected = [
    "anthropic", "deepseek", "google", "groq", "grokai",
    "minimax", "ollama", "openai", "openrouter",
    "perplexity", "zhipuai"
  ].sort();
  assert.deepEqual(ids, expected);
});
```

Run: `npm run build 2>&1` — Expected: BUILD SUCCEEDED

- [ ] **Step 2: Run all tests**

Run: `npm test 2>&1` — Expected: all pass (60+ tests)

- [ ] **Step 3: Commit**

```bash
git add tests/providers.test.ts
git commit -m "test: add provider unit tests covering all adapters

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] BaseProvider — Task 1
- [x] OpenAI — Task 2
- [x] OpenRouter — Task 3
- [x] Groq — Task 4
- [x] Ollama — Task 5
- [x] Perplexity — Task 6
- [x] DeepSeek — Task 7
- [x] Gemini — Task 8
- [x] MiniMax — Task 9
- [x] ZhipuAI — Task 10
- [x] GrokAI — Task 11
- [x] Registry — Task 12
- [x] Config schema — Task 13
- [x] Edit format policy — Task 14
- [x] CLI set-key — Task 15
- [x] run.ts wiring — Task 16
- [x] Tests — Task 17

**2. Placeholder scan:** No TBD, TODO, "fill in later", or "similar to X" patterns. Every step shows actual code.

**3. Type consistency:** All `complete()` methods return `Promise<NormalizedResponse>`, all `capabilities` getters return `ModelCapabilities`, all class `id` properties match their provider string in config schema.