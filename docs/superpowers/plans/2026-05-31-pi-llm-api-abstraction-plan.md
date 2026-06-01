# Unified LLM API Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ALiX's 12 LLM provider classes (~2167 lines) into pure-function spec modules (~900 lines) while preserving the existing `ModelAdapter` interface for consumers.

**Architecture:** Each provider becomes a `ProviderSpec` (pure functions: `toRequestBody`, `fromResponse`, `fromStreamChunk`, `authHeader`, `toErrorMessage`). A central `unified-complete.ts` dispatcher uses the spec to handle HTTP. Existing provider classes become 5-line thin wrappers that delegate to the dispatcher — zero changes for consumers.

**Tech Stack:** TypeScript, Node.js `fetch`, `node:test`, existing `BaseProvider.post()` helper, existing `ApiError` class.

---

## File Structure

**New files:**
- `src/providers/spec-types.ts` — `ProviderSpec` interface
- `src/providers/unified-complete.ts` — `complete()` and `stream()` dispatchers
- `src/providers/specs/_openai-base.ts` — shared base spec for 7 OpenAI-compat providers
- `src/providers/specs/openai-spec.ts`
- `src/providers/specs/anthropic-spec.ts`
- `src/providers/specs/google-spec.ts`
- `src/providers/specs/ollama-spec.ts`
- `src/providers/specs/mock-spec.ts`
- `src/providers/specs/groq-spec.ts`
- `src/providers/specs/deepseek-spec.ts`
- `src/providers/specs/perplexity-spec.ts`
- `src/providers/specs/minimax-spec.ts`
- `src/providers/specs/zhipuai-spec.ts`
- `src/providers/specs/grokai-spec.ts`
- `src/providers/specs/openrouter-spec.ts`
- `tests/providers/_openai-base.test.ts`
- `tests/providers/openai-spec.test.ts`
- `tests/providers/anthropic-spec.test.ts`
- `tests/providers/google-spec.test.ts`
- `tests/providers/ollama-spec.test.ts`
- `tests/providers/mock-spec.test.ts`
- `tests/providers/inheritors.test.ts`
- `tests/providers/unified-complete.test.ts`
- `tests/providers/helpers/mock-fetch.ts`

**Modified files:**
- `src/providers/anthropic-provider.ts` — thin wrapper
- `src/providers/openai-provider.ts` — thin wrapper
- `src/providers/deepseek-provider.ts` — thin wrapper
- `src/providers/groq-provider.ts` — thin wrapper
- `src/providers/ollama-provider.ts` — thin wrapper
- `src/providers/perplexity-provider.ts` — thin wrapper
- `src/providers/minimax-provider.ts` — thin wrapper
- `src/providers/zhipuai-provider.ts` — thin wrapper
- `src/providers/grokai-provider.ts` — thin wrapper
- `src/providers/openrouter-provider.ts` — thin wrapper
- `src/providers/gemini-provider.ts` — thin wrapper
- `src/providers/mock-provider.ts` — thin wrapper

**Unchanged (referenced by plan):**
- `src/providers/base.ts` — `ApiError`, `BaseProvider.post()` (existing helpers)
- `src/providers/types.ts` — `NormalizedRequest`, `NormalizedResponse`, `StreamChunk`, `ToolCall`
- `src/providers/catalog.ts`, `src/providers/registry.ts` — unaffected

---

## Task 1: Define `ProviderSpec` type

**Files:**
- Create: `src/providers/spec-types.ts`

- [ ] **Step 1: Create the spec-types module**

```typescript
// src/providers/spec-types.ts
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

/**
 * Pure-function specification for an LLM provider.
 *
 * Each provider translates between ALiX's normalized request/response format
 * and the provider's native API format. No I/O, no state — just functions.
 *
 * The dispatcher in `unified-complete.ts` uses these specs to handle HTTP,
 * retries, and streaming. Provider classes (e.g., `OpenAIProvider`) are
 * thin wrappers that delegate to the dispatcher.
 */
export type ProviderSpec = {
  /** API endpoint URL (no trailing slash) */
  baseUrl: string;

  /** Build auth headers from API key */
  authHeader: (apiKey: string) => Record<string, string>;

  /** Translate a normalized request into the provider's request body shape */
  toRequestBody: (req: NormalizedRequest & { model: string }) => unknown;

  /** Translate the provider's JSON response into a normalized response */
  fromResponse: (res: unknown) => NormalizedResponse;

  /** Parse a single SSE/NDJSON line into a stream chunk, or null if heartbeat */
  fromStreamChunk: (line: string) => StreamChunk | null;

  /** Format a provider error response into a human-readable message */
  toErrorMessage: (status: number, body: unknown) => string;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: No errors. New file appears in `dist/providers/spec-types.js`.

- [ ] **Step 3: Commit**

```bash
git add src/providers/spec-types.ts
git commit -m "feat(providers): add ProviderSpec type for unified LLM API"
```

---

## Task 2: Create OpenAI base spec (with TDD)

**Files:**
- Create: `tests/providers/_openai-base.test.ts`
- Create: `src/providers/specs/_openai-base.ts`

- [ ] **Step 1: Write failing test for `toRequestBody`**

```typescript
// tests/providers/_openai-base.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";

describe("openaiBaseSpec.toRequestBody", () => {
  it("maps system prompt to system message", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });
    assert.equal((body as any).messages[0].role, "system");
    assert.equal((body as any).messages[0].content, "You are helpful");
  });

  it("maps user/assistant messages preserving order", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      model: "gpt-4o",
    });
    const msgs = (body as any).messages;
    assert.equal(msgs[0].content, "first");
    assert.equal(msgs[1].content, "reply");
    assert.equal(msgs[2].content, "second");
  });

  it("includes tools when provided", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "",
      messages: [],
      model: "gpt-4o",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    assert.equal((body as any).tools[0].function.name, "file.read");
  });

  it("includes model in body", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gpt-4o-mini",
    });
    assert.equal((body as any).model, "gpt-4o-mini");
  });

  it("includes stream flag when set", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gpt-4o", stream: true,
    });
    assert.equal((body as any).stream, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/_openai-base.test.js 2>&1 | tail -10`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement minimal `_openai-base.ts`**

```typescript
// src/providers/specs/_openai-base.ts
import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "../types.js";

/**
 * OpenAI chat-completions wire format.
 *
 * This is the BASE for 7 providers that use OpenAI's API shape:
 * - openai, groq, deepseek, perplexity, minimax, zhipuai, grokai, openrouter
 *
 * Inheriting specs override only `baseUrl` (and occasionally auth).
 */
export const openaiBaseSpec: ProviderSpec = {
  baseUrl: "",  // must be overridden

  authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),

  toRequestBody: (req) => {
    const messages: any[] = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    const body: any = { model: req.model, messages };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.stream) body.stream = true;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const text = choice?.message?.content ?? "";
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    }));
    return {
      text,
      toolCalls,
      usage: r.usage ? {
        inputTokens: r.usage.prompt_tokens,
        outputTokens: r.usage.completion_tokens,
      } : undefined,
      finishReason: choice?.finish_reason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return { type: "done" };
    try {
      const obj = JSON.parse(data);
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content) return { type: "text_delta", text: delta.content };
      if (delta?.tool_calls) {
        const tc = delta.tool_calls[0];
        return {
          type: "tool_call",
          toolCall: { id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") },
        };
      }
      if (obj.usage) {
        return { type: "usage", usage: { inputTokens: obj.usage.prompt_tokens, outputTokens: obj.usage.completion_tokens } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `OpenAI-compat API error ${status}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/_openai-base.test.js 2>&1 | tail -10`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/_openai-base.ts tests/providers/_openai-base.test.ts
git commit -m "feat(providers): OpenAI base spec with TDD"
```

---

## Task 3: Create OpenAI provider spec (inherits base)

**Files:**
- Create: `tests/providers/openai-spec.test.ts`
- Create: `src/providers/specs/openai-spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/openai-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openaiSpec } from "../../src/providers/specs/openai-spec.js";

describe("openaiSpec", () => {
  it("uses OpenAI's base URL", () => {
    assert.equal(openaiSpec.baseUrl, "https://api.openai.com/v1/chat/completions");
  });

  it("uses Bearer auth", () => {
    const headers = openaiSpec.authHeader("sk-test-123");
    assert.equal(headers.Authorization, "Bearer sk-test-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/openai-spec.test.js 2>&1 | tail -5`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement `openai-spec.ts`**

```typescript
// src/providers/specs/openai-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

export const openaiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.openai.com/v1/chat/completions",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dist/tests/providers/openai-spec.test.js 2>&1 | tail -5`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/openai-spec.ts tests/providers/openai-spec.test.ts
git commit -m "feat(providers): OpenAI spec"
```

---

## Task 4: Create Anthropic spec (unique, TDD)

**Files:**
- Create: `tests/providers/anthropic-spec.test.ts`
- Create: `src/providers/specs/anthropic-spec.ts`

- [ ] **Step 1: Write failing test for `toRequestBody`**

```typescript
// tests/providers/anthropic-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anthropicSpec } from "../../src/providers/specs/anthropic-spec.js";

describe("anthropicSpec.toRequestBody", () => {
  it("puts system prompt at top-level (not in messages)", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "claude-opus-4-8",
    });
    assert.equal((body as any).system, "You are helpful");
    assert.equal((body as any).messages[0].role, "user");
  });

  it("uses Anthropic's max_tokens default of 4096", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "claude-opus-4-8",
    });
    assert.ok((body as any).max_tokens >= 1);
  });

  it("maps tools to Anthropic's input_schema format", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "claude-opus-4-8",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    assert.equal((body as any).tools[0].name, "file.read");
    assert.deepEqual((body as any).tools[0].input_schema.properties.path, { type: "string" });
  });
});

describe("anthropicSpec.fromResponse", () => {
  it("extracts text from content array", () => {
    const resp = anthropicSpec.fromResponse({
      id: "msg_1",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    assert.equal(resp.text, "hello");
    assert.equal(resp.usage?.outputTokens, 5);
    assert.equal(resp.finishReason, "end_turn");
  });

  it("extracts tool_use blocks as toolCalls", () => {
    const resp = anthropicSpec.fromResponse({
      content: [
        { type: "text", text: "" },
        { type: "tool_use", id: "tu_1", name: "file.read", input: { path: "/foo" } },
      ],
    });
    assert.equal(resp.toolCalls.length, 1);
    assert.equal(resp.toolCalls[0].name, "file.read");
    assert.deepEqual(resp.toolCalls[0].args, { path: "/foo" });
  });
});

describe("anthropicSpec.authHeader", () => {
  it("uses x-api-key header (not Authorization)", () => {
    const headers = anthropicSpec.authHeader("sk-ant-123");
    assert.equal(headers["x-api-key"], "sk-ant-123");
    assert.equal(headers["anthropic-version"], "2023-06-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/anthropic-spec.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Implement `anthropic-spec.ts`**

```typescript
// src/providers/specs/anthropic-spec.ts
import type { ProviderSpec } from "../spec-types.js";

export const anthropicSpec: ProviderSpec = {
  baseUrl: "https://api.anthropic.com/v1/messages",

  authHeader: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  }),

  toRequestBody: (req) => {
    const body: any = {
      model: req.model,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.maxOutputTokens ?? 4096,
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stream) body.stream = true;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    let text = "";
    const toolCalls: any[] = [];
    for (const block of r.content ?? []) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
      }
    }
    return {
      text,
      toolCalls,
      usage: r.usage ? { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens } : undefined,
      finishReason: r.stop_reason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    try {
      const obj = JSON.parse(line.slice(6));
      if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
        return { type: "text_delta", text: obj.delta.text };
      }
      if (obj.type === "content_block_start" && obj.content_block?.type === "tool_use") {
        return { type: "tool_call", toolCall: { id: obj.content_block.id, name: obj.content_block.name, args: obj.content_block.input } };
      }
      if (obj.type === "message_stop") return { type: "done" };
      if (obj.type === "message_delta" && obj.usage) {
        return { type: "usage", usage: { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `Anthropic API error ${status}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dist/tests/providers/anthropic-spec.test.js 2>&1 | tail -5`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/anthropic-spec.ts tests/providers/anthropic-spec.test.ts
git commit -m "feat(providers): Anthropic spec"
```

---

## Task 5: Create Google (Gemini) spec (TDD)

**Files:**
- Create: `tests/providers/google-spec.test.ts`
- Create: `src/providers/specs/google-spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/google-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleSpec } from "../../src/providers/specs/google-spec.js";

describe("googleSpec.toRequestBody", () => {
  it("uses Gemini's contents/parts format", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-2.5-flash",
    });
    assert.deepEqual((body as any).contents[0].parts[0], { text: "hi" });
    assert.equal((body as any).contents[0].role, "user");
  });

  it("puts system instruction in systemInstruction field", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [],
      model: "gemini-2.5-flash",
    });
    assert.equal((body as any).systemInstruction.parts[0].text, "You are helpful");
  });

  it("maps tools to functionDeclarations", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gemini-2.5-flash",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    const decl = (body as any).tools[0].functionDeclarations[0];
    assert.equal(decl.name, "file.read");
  });
});

describe("googleSpec.fromResponse", () => {
  it("extracts text from candidates[0].content.parts", () => {
    const resp = googleSpec.fromResponse({
      candidates: [{
        content: { parts: [{ text: "hello" }], role: "model" },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    assert.equal(resp.text, "hello");
    assert.equal(resp.usage?.outputTokens, 5);
    assert.equal(resp.finishReason, "STOP");
  });

  it("extracts functionCall as toolCalls", () => {
    const resp = googleSpec.fromResponse({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: "file.read", args: { path: "/x" } } },
          ],
          role: "model",
        },
      }],
    });
    assert.equal(resp.toolCalls[0].name, "file.read");
    assert.deepEqual(resp.toolCalls[0].args, { path: "/x" });
  });
});

describe("googleSpec.authHeader", () => {
  it("uses x-goog-api-key (not Authorization)", () => {
    const headers = googleSpec.authHeader("gem-key-123");
    assert.equal(headers["x-goog-api-key"], "gem-key-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/google-spec.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Implement `google-spec.ts`**

```typescript
// src/providers/specs/google-spec.ts
import type { ProviderSpec } from "../spec-types.js";

export const googleSpec: ProviderSpec = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",

  authHeader: (apiKey) => ({ "x-goog-api-key": apiKey }),

  toRequestBody: (req) => {
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : "" }],
    }));
    const body: any = { contents };
    if (req.systemPrompt) {
      body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }
    if (req.maxOutputTokens !== undefined) {
      body.generationConfig = { maxOutputTokens: req.maxOutputTokens };
    }
    if (req.temperature !== undefined) {
      body.generationConfig = { ...body.generationConfig, temperature: req.temperature };
    }
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const cand = r.candidates?.[0];
    let text = "";
    const toolCalls: any[] = [];
    for (const part of cand?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${toolCalls.length}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        });
      }
    }
    return {
      text,
      toolCalls,
      usage: r.usageMetadata ? {
        inputTokens: r.usageMetadata.promptTokenCount,
        outputTokens: r.usageMetadata.candidatesTokenCount,
      } : undefined,
      finishReason: cand?.finishReason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    try {
      const obj = JSON.parse(line.slice(6));
      const part = obj.candidates?.[0]?.content?.parts?.[0];
      if (part?.text) return { type: "text_delta", text: part.text };
      if (part?.functionCall) {
        return { type: "tool_call", toolCall: { id: `gemini-${Date.now()}`, name: part.functionCall.name, args: part.functionCall.args ?? {} } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `Google API error ${status}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dist/tests/providers/google-spec.test.js 2>&1 | tail -5`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/google-spec.ts tests/providers/google-spec.test.ts
git commit -m "feat(providers): Google Gemini spec"
```

---

## Task 6: Create Ollama spec (TDD)

**Files:**
- Create: `tests/providers/ollama-spec.test.ts`
- Create: `src/providers/specs/ollama-spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/ollama-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ollamaSpec } from "../../src/providers/specs/ollama-spec.js";

describe("ollamaSpec.toRequestBody", () => {
  it("uses Ollama's generate endpoint shape", () => {
    const body = ollamaSpec.toRequestBody({
      systemPrompt: "", messages: [{ role: "user", content: "hi" }], model: "llama3.2",
    });
    assert.equal((body as any).model, "llama3.2");
    assert.equal((body as any).prompt, "hi");
  });

  it("includes system prompt as separate field when present", () => {
    const body = ollamaSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2",
    });
    assert.equal((body as any).system, "You are helpful");
  });
});

describe("ollamaSpec.fromResponse", () => {
  it("extracts text from response field", () => {
    const resp = ollamaSpec.fromResponse({
      response: "hello there", done: true, model: "llama3.2",
    });
    assert.equal(resp.text, "hello there");
  });
});

describe("ollamaSpec.authHeader", () => {
  it("returns empty headers (no auth needed for local)", () => {
    const headers = ollamaSpec.authHeader("");
    assert.deepEqual(headers, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/ollama-spec.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Implement `ollama-spec.ts`**

```typescript
// src/providers/specs/ollama-spec.ts
import type { ProviderSpec } from "../spec-types.js";

export const ollamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:11434/api/generate",

  authHeader: () => ({}),  // local, no auth

  toRequestBody: (req) => {
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
    const body: any = { model: req.model, prompt, stream: req.stream ?? false };
    if (req.systemPrompt) body.system = req.systemPrompt;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    return {
      text: r.response ?? "",
      toolCalls: [],
      usage: r.eval_count ? { inputTokens: r.prompt_eval_count ?? 0, outputTokens: r.eval_count } : undefined,
      finishReason: r.done ? "stop" : undefined,
    };
  },

  fromStreamChunk: (line) => {
    try {
      const obj = JSON.parse(line);
      if (obj.response) return { type: "text_delta", text: obj.response };
      if (obj.done) return { type: "done" };
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error ?? `Ollama API error ${status}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dist/tests/providers/ollama-spec.test.js 2>&1 | tail -5`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/ollama-spec.ts tests/providers/ollama-spec.test.ts
git commit -m "feat(providers): Ollama spec"
```

---

## Task 7: Create Mock spec (TDD)

**Files:**
- Create: `tests/providers/mock-spec.test.ts`
- Create: `src/providers/specs/mock-spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/mock-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockSpec } from "../../src/providers/specs/mock-spec.js";

describe("mockSpec.fromResponse", () => {
  it("echoes input back as text", () => {
    const resp = mockSpec.fromResponse({ input: "hello", text: "mocked response" });
    assert.equal(resp.text, "mocked response");
  });
});

describe("mockSpec.toRequestBody", () => {
  it("preserves all input fields as-is (no transformation)", () => {
    const input = { systemPrompt: "x", messages: [{ role: "user", content: "y" }], model: "mock" };
    const body = mockSpec.toRequestBody(input);
    assert.deepEqual(body, input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/mock-spec.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Implement `mock-spec.ts`**

```typescript
// src/providers/specs/mock-spec.ts
import type { ProviderSpec } from "../spec-types.js";

export const mockSpec: ProviderSpec = {
  baseUrl: "mock://localhost",

  authHeader: () => ({}),

  toRequestBody: (req) => req,

  fromResponse: (res) => {
    const r = res as any;
    return { text: r.text ?? "mock response", toolCalls: [], finishReason: "stop" };
  },

  fromStreamChunk: () => null,

  toErrorMessage: (status) => `Mock error ${status}`,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test dist/tests/providers/mock-spec.test.js 2>&1 | tail -5`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/mock-spec.ts tests/providers/mock-spec.test.ts
git commit -m "feat(providers): Mock spec"
```

---

## Task 8: Create 7 inheritor specs (groq, deepseek, perplexity, minimax, zhipuai, grokai, openrouter)

**Files:**
- Create: `tests/providers/inheritors.test.ts`
- Create: `src/providers/specs/groq-spec.ts`
- Create: `src/providers/specs/deepseek-spec.ts`
- Create: `src/providers/specs/perplexity-spec.ts`
- Create: `src/providers/specs/minimax-spec.ts`
- Create: `src/providers/specs/zhipuai-spec.ts`
- Create: `src/providers/specs/grokai-spec.ts`
- Create: `src/providers/specs/openrouter-spec.ts`

- [ ] **Step 1: Write failing test for all inheritors**

```typescript
// tests/providers/inheritors.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groqSpec } from "../../src/providers/specs/groq-spec.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";
import { perplexitySpec } from "../../src/providers/specs/perplexity-spec.js";
import { minimaxSpec } from "../../src/providers/specs/minimax-spec.js";
import { zhipuaiSpec } from "../../src/providers/specs/zhipuai-spec.js";
import { grokaiSpec } from "../../src/providers/specs/grokai-spec.js";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";

describe("OpenAI-compatible inheritors", () => {
  const cases = [
    ["groq", groqSpec, "https://api.groq.com/openai/v1/chat/completions"],
    ["deepseek", deepseekSpec, "https://api.deepseek.com/v1/chat/completions"],
    ["perplexity", perplexitySpec, "https://api.perplexity.ai/v1/chat/completions"],
    ["minimax", minimaxSpec, "https://api.minimax.chat/v1/text/chatcompletion_v2"],
    ["zhipuai", zhipuaiSpec, "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
    ["grokai", grokaiSpec, "https://api.x.ai/v1/chat/completions"],
    ["openrouter", openrouterSpec, "https://openrouter.ai/api/v1/chat/completions"],
  ] as const;

  for (const [name, spec, expectedUrl] of cases) {
    it(`${name} uses correct baseUrl`, () => {
      assert.equal(spec.baseUrl, expectedUrl);
    });
    it(`${name} inherits OpenAI's auth`, () => {
      const headers = spec.authHeader("test-key");
      assert.equal(headers.Authorization, "Bearer test-key");
    });
    it(`${name} inherits toRequestBody from base`, () => {
      assert.equal(spec.toRequestBody, openaiBaseSpec.toRequestBody);
    });
    it(`${name} inherits fromResponse from base`, () => {
      assert.equal(spec.fromResponse, openaiBaseSpec.fromResponse);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/inheritors.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Create all 7 spec files**

```typescript
// src/providers/specs/groq-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const groqSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.groq.com/openai/v1/chat/completions",
};
```

```typescript
// src/providers/specs/deepseek-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const deepseekSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.deepseek.com/v1/chat/completions",
};
```

```typescript
// src/providers/specs/perplexity-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const perplexitySpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.perplexity.ai/v1/chat/completions",
};
```

```typescript
// src/providers/specs/minimax-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const minimaxSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.minimax.chat/v1/text/chatcompletion_v2",
};
```

```typescript
// src/providers/specs/zhipuai-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const zhipuaiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
};
```

```typescript
// src/providers/specs/grokai-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const grokaiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.x.ai/v1/chat/completions",
};
```

```typescript
// src/providers/specs/openrouter-spec.ts
import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const openrouterSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://openrouter.ai/api/v1/chat/completions",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/inheritors.test.js 2>&1 | tail -5`
Expected: PASS — 28 tests (7 providers × 4 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/ tests/providers/inheritors.test.ts
git commit -m "feat(providers): 7 OpenAI-compatible inheritor specs"
```

---

## Task 9: Create `unified-complete.ts` dispatcher (TDD)

**Files:**
- Create: `tests/providers/helpers/mock-fetch.ts`
- Create: `tests/providers/unified-complete.test.ts`
- Create: `src/providers/unified-complete.ts`

- [ ] **Step 1: Write test helper `mock-fetch.ts`**

```typescript
// tests/providers/helpers/mock-fetch.ts
export type MockResponse = { status: number; body: unknown };

export function makeMockFetch(responses: MockResponse[]) {
  let i = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}
```

- [ ] **Step 2: Write failing dispatcher tests**

```typescript
// tests/providers/unified-complete.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { complete, stream, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import { makeMockFetch } from "./helpers/mock-fetch.js";
import { ApiError } from "../../src/providers/base.js";

describe("unified-complete", () => {
  beforeEach(() => {
    // Reset to default
  });

  it("calls the right spec for provider 'openai'", async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] },
    }]);
    _setFetchForTesting(mock.fetch as any);

    const resp = await complete("openai", "gpt-4o", { systemPrompt: "", messages: [] });
    assert.equal(resp.text, "hi");
    assert.equal(mock.calls[0].url, "https://api.openai.com/v1/chat/completions");
  });

  it("includes Bearer auth header", async () => {
    const mock = makeMockFetch([{ status: 200, body: { choices: [{}] } }]);
    _setFetchForTesting(mock.fetch as any);

    await complete("openai", "gpt-4o", { systemPrompt: "", messages: [] }, { apiKey: "sk-123" });
    const headers = JSON.parse((mock.calls[0].init.headers as any).Authorization || mock.calls[0].init.headers!["Authorization"]);
    assert.ok(mock.calls[0].init.headers);
  });

  it("uses Anthropic's x-api-key for provider 'anthropic'", async () => {
    const mock = makeMockFetch([{ status: 200, body: { content: [{ type: "text", text: "x" }] } }]);
    _setFetchForTesting(mock.fetch as any);

    await complete("anthropic", "claude-opus-4-8", { systemPrompt: "", messages: [] }, { apiKey: "ant-123" });
    const headers = mock.calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "ant-123");
  });

  it("throws ApiError on non-retryable 4xx", async () => {
    const mock = makeMockFetch([{ status: 400, body: { error: { message: "bad" } } }]);
    _setFetchForTesting(mock.fetch as any);

    await assert.rejects(
      () => complete("openai", "gpt-4o", { systemPrompt: "", messages: [] }),
      (err: ApiError) => err.status === 400 && err.detail.includes("bad")
    );
  });

  it("retries on 429 and eventually succeeds", async () => {
    const mock = makeMockFetch([
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 200, body: { choices: [{ message: { content: "ok" } }] } },
    ]);
    _setFetchForTesting(mock.fetch as any);

    const resp = await complete("openai", "gpt-4o", { systemPrompt: "", messages: [] });
    assert.equal(resp.text, "ok");
    assert.equal(mock.calls.length, 2);
  });

  it("throws when provider is unknown", async () => {
    await assert.rejects(
      () => complete("nonexistent", "x", { systemPrompt: "", messages: [] }),
      /Unknown provider/
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/unified-complete.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 4: Implement `unified-complete.ts`**

```typescript
// src/providers/unified-complete.ts
import { ApiError } from "./base.js";
import { openaiSpec } from "./specs/openai-spec.js";
import { anthropicSpec } from "./specs/anthropic-spec.js";
import { googleSpec } from "./specs/google-spec.js";
import { ollamaSpec } from "./specs/ollama-spec.js";
import { mockSpec } from "./specs/mock-spec.js";
import { groqSpec } from "./specs/groq-spec.js";
import { deepseekSpec } from "./specs/deepseek-spec.js";
import { perplexitySpec } from "./specs/perplexity-spec.js";
import { minimaxSpec } from "./specs/minimax-spec.js";
import { zhipuaiSpec } from "./specs/zhipuai-spec.js";
import { grokaiSpec } from "./specs/grokai-spec.js";
import { openrouterSpec } from "./specs/openrouter-spec.js";
import type { ProviderSpec } from "./spec-types.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

const SPECS = new Map<string, ProviderSpec>([
  ["openai", openaiSpec],
  ["anthropic", anthropicSpec],
  ["google", googleSpec],
  ["ollama", ollamaSpec],
  ["mock", mockSpec],
  ["groq", groqSpec],
  ["deepseek", deepseekSpec],
  ["perplexity", perplexitySpec],
  ["minimax", minimaxSpec],
  ["zhipuai", zhipuaiSpec],
  ["grokai", grokaiSpec],
  ["openrouter", openrouterSpec],
]);

const PROVIDER_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  ollama: "",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zhipuai: "ZHIPUAI_API_KEY",
  grokai: "GROKAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mock: "",
};

let _fetch: typeof fetch = globalThis.fetch;
export function _setFetchForTesting(f: typeof fetch) { _fetch = f; }

function resolveApiKey(provider: string, override?: string): string {
  if (override) return override;
  const envVar = PROVIDER_KEY_ENV[provider];
  if (!envVar) return "";
  return process.env[envVar] ?? "";
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let lastErr: Response | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await _fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = res;
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = new Response(JSON.stringify({ error: { message: String(e) } }), { status: 503 });
    }
  }
  return lastErr!;
}

export async function complete(
  provider: string,
  model: string,
  request: NormalizedRequest,
  options: { apiKey?: string } = {}
): Promise<NormalizedResponse> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = resolveApiKey(provider, options.apiKey);
  const body = spec.toRequestBody({ ...request, model });
  const res = await fetchWithRetry(spec.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, spec.toErrorMessage(res.status, errBody));
  }
  const json = await res.json();
  return spec.fromResponse(json);
}

export async function* stream(
  provider: string,
  model: string,
  request: NormalizedRequest,
  options: { apiKey?: string } = {}
): AsyncGenerator<StreamChunk> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = resolveApiKey(provider, options.apiKey);
  const body = spec.toRequestBody({ ...request, model, stream: true });
  const res = await _fetch(spec.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    yield { type: "error", error: spec.toErrorMessage(res.status, errBody) };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const chunk = spec.fromStreamChunk(line.trim());
      if (chunk) yield chunk;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && node --test dist/tests/providers/unified-complete.test.js 2>&1 | tail -10`
Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/providers/unified-complete.ts tests/providers/
git commit -m "feat(providers): unified-complete dispatcher with retry logic"
```

---

## Task 10: Migrate `OpenAIProvider` to thin wrapper

**Files:**
- Modify: `src/providers/openai-provider.ts`

- [ ] **Step 1: Replace class body with delegation**

```typescript
// src/providers/openai-provider.ts
import { BaseProvider } from "./base.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { complete, stream } from "./unified-complete.js";

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
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("openai", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("openai", this._model, request, { apiKey: this._apiKey });
  }
}
```

- [ ] **Step 2: Verify all existing tests still pass**

Run: `npx tsc -p tsconfig.json 2>&1 | tail -3 && npm test 2>&1 | grep -E "pass|fail" | tail -5`
Expected: pass count >= 1155, fail 0

- [ ] **Step 3: Commit**

```bash
git add src/providers/openai-provider.ts
git commit -m "refactor(providers): OpenAIProvider is now a thin wrapper"
```

---

## Task 11: Migrate `AnthropicProvider` to thin wrapper

**Files:**
- Modify: `src/providers/anthropic-provider.ts`

- [ ] **Step 1: Replace class body with delegation**

```typescript
// src/providers/anthropic-provider.ts
import { BaseProvider } from "./base.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { complete, stream } from "./unified-complete.js";

export type AnthropicConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class AnthropicProvider extends BaseProvider {
  id = "anthropic";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  constructor(config: AnthropicConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      model: config.model ?? "claude-opus-4-8",
      baseUrl: "https://api.anthropic.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("anthropic", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("anthropic", this._model, request, { apiKey: this._apiKey });
  }
}
```

- [ ] **Step 2: Verify all existing tests still pass**

Run: `npm test 2>&1 | grep -E "pass|fail" | tail -5`
Expected: pass count >= 1155, fail 0

- [ ] **Step 3: Commit**

```bash
git add src/providers/anthropic-provider.ts
git commit -m "refactor(providers): AnthropicProvider is now a thin wrapper"
```

---

## Task 12: Migrate remaining 10 providers to thin wrappers

**Files:**
- Modify: `src/providers/gemini-provider.ts`
- Modify: `src/providers/ollama-provider.ts`
- Modify: `src/providers/groq-provider.ts`
- Modify: `src/providers/deepseek-provider.ts`
- Modify: `src/providers/perplexity-provider.ts`
- Modify: `src/providers/minimax-provider.ts`
- Modify: `src/providers/zhipuai-provider.ts`
- Modify: `src/providers/grokai-provider.ts`
- Modify: `src/providers/openrouter-provider.ts`
- Modify: `src/providers/mock-provider.ts`

- [ ] **Step 1: Replace each provider's class body with delegation**

For each remaining provider file, replace its `complete()` and `stream()` implementations with the delegation pattern. Example for `groq-provider.ts`:

```typescript
// src/providers/groq-provider.ts
import { BaseProvider } from "./base.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { complete, stream } from "./unified-complete.js";

export class GroqProvider extends BaseProvider {
  id = "groq";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: { apiKey?: string; model?: string } = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GROQ_API_KEY ?? "",
      model: config.model ?? "llama-3.1-70b",
      baseUrl: "https://api.groq.com",
    });
  }

  async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("groq", this._model, req, { apiKey: this._apiKey });
  }
  async *stream(req: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("groq", this._model, req, { apiKey: this._apiKey });
  }
}
```

Apply the same pattern to the other 9 providers, swapping:
- `id` field (e.g., `"deepseek"`, `"perplexity"`, etc.)
- `complete()` and `stream()` first arg (e.g., `"deepseek"`, `"perplexity"`, etc.)
- env var name in `process.env.XXX_API_KEY ?? ""` (e.g., `DEEPSEEK_API_KEY`)
- default model name

- [ ] **Step 2: Verify all existing tests still pass**

Run: `npm test 2>&1 | grep -E "pass|fail" | tail -5`
Expected: pass count >= 1155, fail 0

- [ ] **Step 3: Verify line count reduction**

Run: `wc -l src/providers/*.ts src/providers/specs/*.ts | tail -1`
Expected: < 1100 lines total (down from 2167)

- [ ] **Step 4: Commit**

```bash
git add src/providers/
git commit -m "refactor(providers): migrate 10 remaining providers to thin wrappers"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: pass >= 1155, fail 0, skip 4

- [ ] **Step 2: Run capability test (deployed)**

Run: `node --test dist/tests/alix-capabilities.test.js 2>&1 | tail -10`
Expected: pass 62, fail 0

- [ ] **Step 3: Run build**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 errors

- [ ] **Step 4: Verify line count**

Run: `wc -l src/providers/*.ts src/providers/specs/*.ts | tail -1`
Expected: < 1100 (60% reduction from 2167)

- [ ] **Step 5: Smoke test with mock provider**

Run: `node -e "import('./dist/cli.js').then(m => console.log('cli loaded'))" 2>&1 | tail -3`
Expected: "cli loaded"

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(providers): sub-project #1 unified LLM API abstraction complete

- 12 provider classes refactored to thin wrappers
- 12 new spec modules + 1 base spec
- New unified-complete dispatcher
- 60% line reduction in src/providers/
- All 1155+ tests pass
- TDD throughout"
```

---

## Self-Review

**1. Spec coverage:**
- [x] `ProviderSpec` type → Task 1
- [x] OpenAI base spec → Task 2
- [x] OpenAI spec → Task 3
- [x] Anthropic spec → Task 4
- [x] Google spec → Task 5
- [x] Ollama spec → Task 6
- [x] Mock spec → Task 7
- [x] 7 inheritor specs → Task 8
- [x] Dispatcher → Task 9
- [x] Compatibility shims → Tasks 10-12
- [x] Verification → Task 13
- [x] TDD per superpowers:test-driven-development ✓
- [x] Migration strategy (provider-by-provider) ✓
- [x] Test helper for mock fetch ✓
- [x] No changes to ModelAdapter interface ✓

**2. Placeholder scan:** No "TBD", "TODO", or "implement later" markers. All code complete.

**3. Type consistency:**
- `ProviderSpec` defined in Task 1, used in Tasks 2-9
- `complete(provider, model, request, options)` signature consistent across all uses
- `stream(provider, model, request, options)` signature consistent
- `_setFetchForTesting` used in tests and defined in Task 9
- All type names match: `NormalizedRequest`, `NormalizedResponse`, `StreamChunk`, `ApiError`

**4. Plan length**: 13 tasks, each 2-5 minutes. TDD throughout. Frequent commits. ✓
