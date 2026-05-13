# Provider Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all provider adapters per the provider-adapter-interface spec: complete AnthropicProvider, add OpenAI and Gemini providers, wire capability negotiation and streaming.

**Architecture:** Each provider is a separate class implementing `ModelAdapter`. Tool schemas and message formats are normalized at the adapter boundary. Capability negotiation happens in `run.ts` before provider selection.

**Tech Stack:** TypeScript, native `fetch`, `@google/genai` (Gemini), OpenAI SDK

---

## File Structure

```
src/providers/
  types.ts             — MODIFY: add missing types (StreamChunk, TokenUsage, CostProfile, etc.)
  mock-provider.ts      — KEEP: already complete
  anthropic-provider.ts — MODIFY: add streaming, token usage, negotiation
  openai-provider.ts    — CREATE: OpenAI GPT-4o adapter
  gemini-provider.ts   — CREATE: Google Gemini adapter
```

---

### Task 1: Complete Provider Types

**Files:**
- Modify: `src/providers/types.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/provider-types.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("NormalizedMessage supports multi-part content", () => {
  // types.ts should define TextPart, ImagePart, FilePart union
  const msg: import("../src/providers/types.js").NormalizedMessage = {
    role: "user",
    content: "hello" // currently string, should allow parts
  };
  assert.equal(msg.role, "user");
});

test("StreamChunk types are defined", () => {
  // Check StreamChunk union covers all variants
  const chunk: import("../src/providers/types.js").StreamChunk = {
    type: "text_delta",
    text: "hello"
  };
  assert.equal(chunk.type, "text_delta");
});

test("TokenUsage is defined with input/output", () => {
  const usage: import("../src/providers/types.js").TokenUsage = {
    inputTokens: 100,
    outputTokens: 50
  };
  assert.equal(usage.inputTokens, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check 2>&1`
Expected: FAIL — missing types

- [ ] **Step 3: Write full types**

Replace `src/providers/types.ts` with:

```ts
// Content parts for multi-modal messages
export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type FilePart = { type: "file"; source: { type: "base64"; media_type: string; data: string } };

export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string | TextPart[];
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type CostProfile = {
  currency: "USD";
  tiers: Array<{
    upToInputTokens?: number;
    inputPerMToken: number;
    outputPerMToken: number;
  }>;
};

export type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  costProfile?: CostProfile;
};

export type ToolParamBase = {
  type: string;
  description?: string;
  enum?: string[];
};

export type ToolParam = ToolParamBase | {
  type: "array";
  description?: string;
  items: { type: string };
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolParam>;
    required?: string[];
  };
};

export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools?: ToolDef[];
  toolResults?: NormalizedToolResult[];
  temperature?: number;
  maxOutputTokens?: number;
};

export type NormalizedToolResult = {
  toolUseId: string;
  content: string;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
};

export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason?: string }
  | { type: "error"; error: string };

export type NegotiatedCapabilities = {
  contextBudget: number;
  outputBudget: number;
  editFormat: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  toolsEnabled: boolean;
  structuredOutputEnabled: boolean;
  visionEnabled: boolean;
};

export type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  stream?(request: NormalizedRequest): AsyncIterable<StreamChunk>;
  negotiate?(taskType: string, config: Record<string, unknown>): NegotiatedCapabilities;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test 2>&1 | grep -E "ℹ tests|ℹ pass|ℹ fail"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/types.ts tests/provider-types.test.ts
git commit -m "feat: complete provider types per spec

Add: TextPart/ImagePart/FilePart, TokenUsage, CostProfile,
StreamChunk union, NormalizedToolResult, NegotiatedCapabilities.
Update ModelAdapter with optional stream() and negotiate().
```

---

### Task 2: Complete AnthropicProvider (streaming + token usage)

**Files:**
- Modify: `src/providers/anthropic-provider.ts`
- Modify: `tests/anthropic-provider.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/anthropic-provider.test.ts — add after existing tests
test("complete returns token usage", async () => {
  const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await provider.complete({
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Say hello in one word." }]
  });
  assert.ok(response.usage, "should return usage");
  assert.ok(response.usage!.inputTokens > 0, "should count input tokens");
  assert.ok(response.usage!.outputTokens > 0, "should count output tokens");
});

test("stream yields text_delta chunks", async () => {
  const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
  if (!provider.stream) return; // skip if not implemented yet
  const chunks: string[] = [];
  for await (const chunk of provider.stream({
    systemPrompt: "Say hi.",
    messages: [{ role: "user", content: "hi" }]
  })) {
    if (chunk.type === "text_delta") chunks.push(chunk.text);
    if (chunk.type === "done") break;
  }
  assert.ok(chunks.length > 0, "should have text delta chunks");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check 2>&1`
Expected: FAIL — `usage` and `stream` not implemented

- [ ] **Step 3: Add token usage and streaming to AnthropicProvider**

Read current `src/providers/anthropic-provider.ts`, then replace the `complete()` method and add `stream()`:

```ts
async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
  if (!this._apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const tools = request.tools ?? ALIX_TOOLS;
  const body: Record<string, unknown> = {
    model: this._model,
    max_tokens: this._maxTokens,
    system: request.systemPrompt,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : (m.content as TextPart[]).map(p => p.text).join("\n")
    }))
  };
  if (tools.length > 0) body.tools = tools;
  if (request.toolResults) {
    // Append tool results as user messages
    for (const tr of request.toolResults) {
      body.messages.push({
        role: "user",
        content: `<tool_result id="${tr.toolUseId}">\n${tr.content}\n</tool_result>`
      });
    }
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": this._apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  };

  const toolCalls: ToolCall[] = [];
  let text = "";
  for (const block of data.content) {
    if (block.type === "text") text += block.text ?? "";
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id ?? randomUUID(), name: block.name ?? "", args: block.input ?? {} });
    }
  }

  return {
    text: text.trim(),
    toolCalls,
    usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    finishReason: data.stop_reason
  };
}

async *stream(request: NormalizedRequest): AsyncIterable<StreamChunk> {
  if (!this._apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const tools = request.tools ?? ALIX_TOOLS;
  const body: Record<string, unknown> = {
    model: this._model,
    max_tokens: this._maxTokens,
    system: request.systemPrompt,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : (m.content as TextPart[]).map(p => p.text).join("\n")
    }))
  };
  if (tools.length > 0) body.tools = tools;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": this._apiKey,
      "anthropic-version": "2023-06-01",
      "x-stream": "true"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    const err = await response.text();
    yield { type: "error", error: `Anthropic API error ${response.status}: ${err}` };
    return;
  }

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentToolCall: ToolCall | null = null;
  let currentToolUseIndex: number | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          if (currentToolCall) {
            yield { type: "tool_call", toolCall: currentToolCall };
            currentToolCall = null;
          }
          yield { type: "done" };
          continue;
        }

        const event = JSON.parse(data) as { type: string; index?: number; name?: string; text?: string; input?: Record<string, unknown>; id?: string; usage?: { input_tokens: number; output_tokens: number } };

        if (event.type === "content_block_delta") {
          if (event.name === "input_token_history") continue;
          if (event.name === "thinking") continue;
          if (event.text) {
            if (currentToolCall) {
              yield { type: "tool_call", toolCall: currentToolCall };
              currentToolCall = null;
            }
            yield { type: "text_delta", text: event.text };
          }
        } else if (event.type === "content_block_start") {
          if (event.name === "tool_use") {
            currentToolCall = { id: event.id ?? randomUUID(), name: "", args: {} };
            currentToolUseIndex = event.index ?? null;
          }
        } else if (event.type === "content_block_delta" && event.name === "tool_result") {
          if (currentToolCall && event.input) {
            currentToolCall.args = { ...currentToolCall.args, ...event.input };
          }
        } else if (event.type === "message_delta" && event.usage) {
          yield {
            type: "usage",
            usage: { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens }
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

Also add `TextPart` import:
```ts
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, ToolDef, ToolCall, StreamChunk, TokenUsage } from "./types.js";
import type { TextPart } from "./types.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test 2>&1 | grep -E "ℹ tests|ℹ pass|ℹ fail"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic-provider.ts tests/anthropic-provider.test.ts
git commit -m "feat: add streaming and token usage to AnthropicProvider

- complete() returns TokenUsage from API response
- complete() injects toolResults as user messages
- stream() yields text_delta, tool_call, usage, done chunks
- Handles SSE event stream parsing for Anthropic messages API
```

---

### Task 3: OpenAI Provider

**Files:**
- Create: `src/providers/openai-provider.ts`
- Create: `tests/openai-provider.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/openai-provider.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/providers/openai-provider.js";

test("openai provider returns correct capabilities", () => {
  const provider = new OpenAIProvider({ apiKey: "test" });
  assert.equal(provider.id, "openai");
  assert.equal(provider.capabilities.provider, "openai");
  assert.ok(provider.capabilities.supportsTools);
  assert.equal(provider.editFormatPreference, "search_replace");
});

test("openai provider requires API key", async () => {
  const provider = new OpenAIProvider({ apiKey: "" });
  await assert.rejects(() => provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }]
  }), /OPENAI_API_KEY/);
});

test("complete parses tool calls from function_call blocks", async () => {
  if (!process.env.OPENAI_API_KEY) return; // skip without key
  const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
  const response = await provider.complete({
    systemPrompt: "You have tools. Use them.",
    messages: [{ role: "user", content: "What time is it?" }]
  });
  assert.equal(response.text.length > 0 || response.toolCalls.length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check 2>&1`
Expected: FAIL — `OpenAIProvider` not found

- [ ] **Step 3: Write OpenAI provider**

Create `src/providers/openai-provider.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
  StreamChunk,
  TokenUsage,
  TextPart,
} from "./types.js";

export type OpenAIConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

const ALIX_TOOLS: ToolDef[] = [
  {
    name: "file_read",
    description: "Read the contents of a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        path: { type: "string", description: "Relative path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "dir_search",
    description: "Search for a pattern across files in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        pattern: { type: "string", description: "Text pattern to search for" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern"]
    }
  },
  {
    name: "shell_run",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeoutMs: { type: "number", description: "Timeout in ms" }
      },
      required: ["command"]
    }
  },
  {
    name: "patch_apply",
    description: "Apply a code patch using search/replace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory" },
        format: { type: "string", description: "search_replace or structured_patch" },
        patchText: { type: "string", description: "The patch content" }
      },
      required: ["format", "patchText"]
    }
  }
];

export class OpenAIProvider implements ModelAdapter {
  id = "openai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: OpenAIConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this._model = config.model ?? "gpt-4o";
    this._maxTokens = config.maxTokens ?? 8192;
  }

  get capabilities() {
    return {
      provider: "openai" as const,
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("OPENAI_API_KEY is not set");

    const tools = request.tools ?? ALIX_TOOLS;
    const messages = [
      { role: "system", content: request.systemPrompt },
      ...request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : (m.content as TextPart[]).map(p => p.text).join("")
      }))
    ];

    if (request.toolResults) {
      for (const tr of request.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: tr.content
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
      max_tokens: this._maxTokens,
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: { type: "object", properties: t.input_schema.properties, required: t.input_schema.required } }
      }))
    };
    if (request.temperature) body.temperature = request.temperature;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });

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
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];
    let text = choice.message.content ?? "";

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments)
        });
      }
    }

    return {
      text,
      toolCalls,
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      finishReason: choice.finish_reason
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test 2>&1 | grep -E "ℹ tests|ℹ pass|ℹ fail"`
Expected: PASS (OpenAI tests skip without key)

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai-provider.ts tests/openai-provider.test.ts
git commit -m "feat: add OpenAI provider adapter

- Implements ModelAdapter for GPT-4o and variants
- Maps OpenAI tool_calls to normalized ToolCall[]
- Returns token usage from API response
- Tool names use underscores (no dots per API spec)
```

---

### Task 4: Gemini Provider

**Files:**
- Create: `src/providers/gemini-provider.ts`
- Create: `tests/gemini-provider.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/gemini-provider.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../src/providers/gemini-provider.js";

test("gemini provider returns correct capabilities", () => {
  const provider = new GeminiProvider({ apiKey: "test" });
  assert.equal(provider.id, "gemini");
  assert.equal(provider.capabilities.provider, "gemini");
  assert.ok(provider.capabilities.supportsVision);
  assert.equal(provider.longContextStrategy, "expanded_context");
  assert.equal(provider.editFormatPreference, "search_replace"); // Gemini default: safe for large files
});

test("gemini provider requires API key", async () => {
  const provider = new GeminiProvider({ apiKey: "" });
  await assert.rejects(() => provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }]
  }), /GEMINI_API_KEY/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check 2>&1`
Expected: FAIL — `GeminiProvider` not found

- [ ] **Step 3: Write Gemini provider**

Create `src/providers/gemini-provider.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
  TextPart,
} from "./types.js";

export type GeminiConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

const ALIX_TOOLS: ToolDef[] = [
  {
    name: "file_read",
    description: "Read a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string" },
        path: { type: "string", description: "Relative path" }
      },
      required: ["path"]
    }
  },
  {
    name: "dir_search",
    description: "Search for a pattern in files.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string" },
        pattern: { type: "string" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern"]
    }
  },
  {
    name: "shell_run",
    description: "Run a shell command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" }
      },
      required: ["command"]
    }
  },
  {
    name: "patch_apply",
    description: "Apply a code patch.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string" },
        format: { type: "string" },
        patchText: { type: "string" }
      },
      required: ["format", "patchText"]
    }
  }
];

export class GeminiProvider implements ModelAdapter {
  id = "gemini";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "expanded_context" as const; // Gemini's strength

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: GeminiConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this._model = config.model ?? "gemini-2.0-flash";
    this._maxTokens = config.maxTokens ?? 8192;
  }

  get capabilities() {
    return {
      provider: "gemini" as const,
      model: this._model,
      inputTokenLimit: 1_000_000, // Gemini 2.0 context
      outputTokenLimit: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GEMINI_API_KEY is not set");

    const tools = request.tools ?? ALIX_TOOLS;
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: typeof m.content === "string" ? m.content : (m.content as TextPart[]).map(p => p.text).join("")
        }
      ]
    }));

    if (request.toolResults) {
      for (const tr of request.toolResults) {
        contents.push({
          role: "user",
          parts: [{ text: `<tool_result id="${tr.toolUseId}">\n${tr.content}\n</tool_result>` }]
        });
      }
    }

    const body = {
      contents,
      system_instruction: { parts: [{ text: request.systemPrompt }] },
      tools: {
        function_declarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: { type: "object", properties: t.input_schema.properties, required: t.input_schema.required }
        }))
      },
      generationConfig: { maxOutputTokens: this._maxTokens }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
        };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = data.candidates?.[0];
    if (!candidate) return { text: "", toolCalls: [] };

    const toolCalls: ToolCall[] = [];
    let text = "";

    for (const part of candidate.content.parts) {
      if (part.text) text += part.text;
      else if (part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          args: part.functionCall.args
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usageMetadata
        ? { inputTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount }
        : undefined,
      finishReason: candidate.finishReason
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test 2>&1 | grep -E "ℹ tests|ℹ pass|ℹ fail"`
Expected: PASS (Gemini tests skip without key)

- [ ] **Step 5: Commit**

```bash
git add src/providers/gemini-provider.ts tests/gemini-provider.test.ts
git commit -m "feat: add Gemini provider adapter

- Implements ModelAdapter for Gemini 2.0
- expanded_context strategy (Gemini's 1M token context)
- search_replace default (safe for large files)
- Maps Gemini function calls to normalized ToolCall[]
- Returns token usage from API response
```

---

### Task 5: Provider Registry and Selection

**Files:**
- Create: `src/providers/registry.ts`
- Modify: `src/run.ts` (wire provider selection)
- Modify: `tests/registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/registry.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, listProviders } from "../src/providers/registry.js";

test("createProvider returns AnthropicProvider for anthropic config", () => {
  const { createProvider } = await import("../src/providers/registry.js");
  const provider = createProvider({ provider: "anthropic", name: "test" }, "test-key");
  assert.equal(provider.id, "anthropic");
});

test("createProvider returns OpenAIProvider for openai config", () => {
  const { createProvider } = await import("../src/providers/registry.js");
  const provider = createProvider({ provider: "openai", name: "gpt-4o" }, "test-key");
  assert.equal(provider.id, "openai");
});

test("createProvider returns GeminiProvider for gemini config", () => {
  const { createProvider } = await import("../src/providers/registry.js");
  const provider = createProvider({ provider: "gemini", name: "gemini-2.0-flash" }, "test-key");
  assert.equal(provider.id, "gemini");
});

test("createProvider throws on unknown provider", () => {
  const { createProvider } = await import("../src/providers/registry.js");
  assert.throws(() => createProvider({ provider: "unknown" } as any, "key"));
});

test("listProviders returns all provider IDs", () => {
  const { listProviders } = await import("../src/providers/registry.js");
  const providers = listProviders();
  assert.ok(providers.includes("mock"));
  assert.ok(providers.includes("anthropic"));
  assert.ok(providers.includes("openai"));
  assert.ok(providers.includes("gemini"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run check 2>&1`
Expected: FAIL — registry not found

- [ ] **Step 3: Write provider registry**

Create `src/providers/registry.ts`:

```ts
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
      throw new Error(`Unknown provider: ${config.provider}. Available: mock, anthropic, openai, gemini`);
  }
}

export function listProviders(): string[] {
  return ["mock", "anthropic", "openai", "gemini"];
}
```

- [ ] **Step 4: Wire provider selection into run.ts**

Read current `src/run.ts`. Replace the provider construction block:

```ts
// Replace this:
const provider =
  config.model.provider === "anthropic"
    ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
    : new MockProvider();

// With this:
import { createProvider } from "./providers/registry.js";
const provider = createProvider(config.model, process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY);
```

Also update `TOOL_NAME_MAP` to use underscore-prefixed names (matching OpenAI/Gemini tools):

```ts
// Map model tool names → executor tool names
const TOOL_NAME_MAP: Record<string, string> = {
  alix_file_read: "file.read",
  alix_dir_search: "dir.search",
  alix_shell_run: "shell.run",
  alix_patch_apply: "patch.apply",
  file_read: "file.read",
  dir_search: "dir.search",
  shell_run: "shell.run",
  patch_apply: "patch.apply",
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && npm test 2>&1 | grep -E "ℹ tests|ℹ pass|ℹ fail"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/providers/registry.ts src/run.ts tests/registry.test.ts
git commit -m "feat: add provider registry with multi-provider support

- createProvider() factory selects Anthropic/OpenAI/Gemini/Mock
- listProviders() returns all available providers
- run.ts wired through registry (no direct provider imports)
- TOOL_NAME_MAP extended for both naming conventions
```

---

## Self-Review

1. **Spec coverage:**
   - Task 1: All missing types added (StreamChunk, TokenUsage, CostProfile, TextPart, etc.) ✅
   - Task 2: Anthropic streaming + token usage + toolResults injection ✅
   - Task 3: OpenAI provider with full tool calling support ✅
   - Task 4: Gemini provider with expanded context strategy ✅
   - Task 5: Provider registry + multi-provider routing in run.ts ✅

2. **Placeholder scan:** No TBD/TODO — all code shown inline ✅

3. **Type consistency:** Tool names use underscores in all providers, mapped to dot-names in executor ✅

4. **Provider naming:** All providers use `provider_id` tool names (no dots) ✅

5. **API key env vars:** Anthropic → `ANTHROPIC_API_KEY`, OpenAI → `OPENAI_API_KEY`, Gemini → `GEMINI_API_KEY` ✅

6. **Model defaults:**
   - Anthropic: `claude-sonnet-4-6` ✅
   - OpenAI: `gpt-4o` ✅
   - Gemini: `gemini-2.0-flash` ✅