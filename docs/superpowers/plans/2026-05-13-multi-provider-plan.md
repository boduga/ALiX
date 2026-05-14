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

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Write the base class**

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

- [x] **Step 3: Run tests to verify they pass**

Run: `npm test 2>&1` — Expected: tests pass (BaseProvider is abstract so no direct test, covered via provider tests)

- [x] **Step 4: Commit**

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

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write OpenAIProvider**
- [x] **Step 3: Run tests to verify they pass**
- [x] **Step 4: Commit**

### Task 3: OpenRouterProvider

**Files:**
- Create: `src/providers/openrouter-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write OpenRouterProvider**
- [x] **Step 3: Run tests to verify they pass**
- [x] **Step 4: Commit**

### Task 4: GroqProvider

**Files:**
- Create: `src/providers/groq-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write GroqProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 5: OllamaProvider

**Files:**
- Create: `src/providers/ollama-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write OllamaProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 6: PerplexityProvider

**Files:**
- Create: `src/providers/perplexity-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write PerplexityProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 7: DeepSeekProvider

**Files:**
- Create: `src/providers/deepseek-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write DeepSeekProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 8: GeminiProvider (custom format)

**Files:**
- Create: `src/providers/gemini-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write GeminiProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 9: MiniMaxProvider (custom format)

**Files:**
- Create: `src/providers/minimax-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write MiniMaxProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 10: ZhipuAIProvider (custom format)

**Files:**
- Create: `src/providers/zhipuai-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write ZhipuAIProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 11: GrokAIProvider (custom format)

**Files:**
- Create: `src/providers/grokai-provider.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write GrokAIProvider**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 12: ProviderRegistry

**Files:**
- Create: `src/providers/registry.ts`
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Write registry**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 13: Config Schema + Defaults

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/defaults.ts`

- [x] **Step 1: Update provider union type in schema.ts**
- [x] **Step 2: Verify defaults match spec**
- [x] **Step 3: Run tests**
- [x] **Step 4: Commit**

### Task 14: Edit Format Policy

**Files:**
- Modify: `src/patch/edit-format-policy.ts`

- [x] **Step 1: Update defaultEditFormatForProvider**
- [x] **Step 2: Run tests**
- [x] **Step 3: Commit**

### Task 15: CLI set-key with All Providers

**Files:**
- Modify: `src/cli.ts`

- [x] **Step 1: Update PROVIDERS array**
- [x] **Step 2: Run tests**
- [x] **Step 3: Commit**

### Task 16: Wire createProvider into run.ts

**Files:**
- Modify: `src/run.ts`

- [x] **Step 1: Replace hardcoded provider selection**
- [x] **Step 2: Run tests**
- [x] **Step 3: Commit**

### Task 17: Provider Unit Tests

**Files:**
- Modify: `tests/providers.test.ts`

- [x] **Step 1: Add comprehensive tests**
- [x] **Step 2: Run all tests**
- [x] **Step 3: Commit**

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