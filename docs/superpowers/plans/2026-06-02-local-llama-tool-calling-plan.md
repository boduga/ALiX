# Local-Llama Tool-Calling Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `local-llama` provider spec that uses `llama-server` with grammar-constrained tool calling, so ALiX can use local models for full agentic tasks.

**Architecture:** New `ProviderSpec` that extends OpenAI base but overrides `toRequestBody` (adds `response_format.json_schema` for tools) and `fromResponse` (parses structured JSON back to ToolCall). Uses llama-server's grammar-constrained generation feature.

**Tech Stack:** TypeScript, `node:test`, existing `ProviderSpec` infrastructure.

---

## File Structure

**New files:**
- `src/providers/specs/_tool-schema.ts` — Schema builder (~30 lines)
- `src/providers/specs/local-llama-spec.ts` — Provider spec (~100 lines)
- `tests/providers/tool-schema.test.ts` — Schema tests
- `tests/providers/local-llama-spec.test.ts` — Spec tests
- `docs/local-llama-setup.md` — User setup guide

**Modified files:**
- `src/providers/unified-complete.ts` — Register the new spec (one line)

---

## Task 1: Create `_tool-schema.ts` (TDD)

**Files:**
- Create: `tests/providers/tool-schema.test.ts`
- Create: `src/providers/specs/_tool-schema.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/tool-schema.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildToolCallSchema } from "../../src/providers/specs/_tool-schema.js";

describe("buildToolCallSchema", () => {
  it("returns an object schema", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal(schema.type, "object");
  });

  it("includes all tool names in enum", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
      { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual((schema.properties as any).name.enum, ["file.read", "shell.run"]);
  });

  it("requires name and arguments fields", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual(schema.required, ["name", "arguments"]);
  });

  it("arguments is an object type", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal((schema.properties as any).arguments.type, "object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

Expected: Module not found.

- [ ] **Step 3: Implement `src/providers/specs/_tool-schema.ts`**

```typescript
// src/providers/specs/_tool-schema.ts
import type { ToolDef } from "../types.js";

/**
 * Build a JSON schema for grammar-constrained tool calling.
 *
 * The schema forces the model to output:
 *   { "name": "<one of the tool names>", "arguments": { ... } }
 *
 * Used by local-llama-spec to wrap llama-server's grammar generation.
 */
export function buildToolCallSchema(tools: ToolDef[]): {
  type: "object";
  properties: { name: { type: "string"; enum: string[] }; arguments: { type: "object" } };
  required: string[];
} {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: tools.map((t) => t.name),
      },
      arguments: {
        type: "object",
      },
    },
    required: ["name", "arguments"],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/providers/tool-schema.test.js 2>&1 | tail -5
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/_tool-schema.ts tests/providers/tool-schema.test.ts
git commit -m "feat(providers): add buildToolCallSchema for grammar-constrained tools"
```

---

## Task 2: Create `local-llama-spec.ts` (TDD)

**Files:**
- Create: `tests/providers/local-llama-spec.test.ts`
- Create: `src/providers/specs/local-llama-spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/local-llama-spec.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localLlamaSpec } from "../../src/providers/specs/local-llama-spec.js";

describe("localLlamaSpec", () => {
  it("uses llama-server's OpenAI-compat base URL by default", () => {
    assert.equal(localLlamaSpec.baseUrl, "http://localhost:8080/v1/chat/completions");
  });

  it("no auth header (local server)", () => {
    const headers = localLlamaSpec.authHeader("");
    assert.deepEqual(headers, {});
  });

  describe("toRequestBody with tools", () => {
    it("adds response_format.json_schema when tools provided", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "You are helpful",
        messages: [{ role: "user", content: "read foo.ts" }],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
        ],
      });
      assert.ok((body as any).response_format);
      assert.equal((body as any).response_format.type, "json_schema");
      assert.ok((body as any).response_format.json_schema);
    });

    it("json_schema includes tool name enum", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "x", input_schema: { type: "object" } },
          { name: "shell.run", description: "y", input_schema: { type: "object" } },
        ],
      });
      const schema = (body as any).response_format.json_schema.schema;
      assert.deepEqual(schema.properties.name.enum, ["file.read", "shell.run"]);
    });

    it("no response_format when no tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
      });
      assert.equal((body as any).response_format, undefined);
    });
  });

  describe("fromResponse", () => {
    it("parses JSON tool call from model output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: {
            content: '{"name": "file.read", "arguments": {"path": "src/foo.ts"}}',
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0].name, "file.read");
      assert.deepEqual(resp.toolCalls[0].args, { path: "src/foo.ts" });
      assert.equal(resp.text, "");
    });

    it("treats plain text as text response (not tool call)", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: "Hello, how can I help?" },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hello, how can I help?");
    });

    it("handles invalid JSON gracefully", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: "{invalid json" },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "{invalid json");
    });

    it("extracts usage when present", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      assert.deepEqual(resp.usage, { inputTokens: 100, outputTokens: 50 });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/providers/specs/local-llama-spec.ts`**

```typescript
// src/providers/specs/local-llama-spec.ts
import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, ToolCall, TokenUsage } from "../types.js";
import { buildToolCallSchema } from "./_tool-schema.js";

/**
 * Provider spec for llama-server (local LLM inference).
 *
 * Uses llama-server's OpenAI-compat endpoint at /v1/chat/completions.
 * For tool calling, leverages the `response_format.json_schema` field
 * to force the model to output valid JSON tool calls via grammar-constrained
 * generation.
 *
 * The output is parsed back to ALiX's ToolCall[] format.
 *
 * Default base URL assumes llama-server running locally on port 8080.
 * Override at provider creation time for custom URLs (e.g., Tailscale IP).
 */
export const localLlamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:8080/v1/chat/completions",
  authHeader: () => ({}),

  toRequestBody: (req) => {
    const body: any = {
      model: req.model,
      messages: [
        ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.stream) body.stream = true;

    // If tools are provided, force structured tool-call output via JSON schema
    if (req.tools && req.tools.length > 0) {
      const toolSchema = buildToolCallSchema(req.tools);
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "tool_call",
          schema: toolSchema,
        },
      };
    }

    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const content = choice?.message?.content ?? "";

    // Try to parse as a tool call
    const toolCalls: ToolCall[] = [];
    let text = content;

    if (content.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
          toolCalls.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            args: parsed.arguments,
          });
          // Tool call succeeded; suppress text output
          text = "";
        }
      } catch {
        // Not valid JSON — treat as plain text
      }
    }

    return {
      text,
      toolCalls,
      usage: r.usage ? {
        inputTokens: r.usage.prompt_tokens ?? 0,
        outputTokens: r.usage.completion_tokens ?? 0,
      } : undefined,
      finishReason: choice?.finish_reason,
    };
  },

  fromStreamChunk: (line) => {
    // Streaming not supported in v1
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return { type: "done" };
    try {
      const obj = JSON.parse(data);
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content) return { type: "text_delta", text: delta.content };
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `llama-server error ${status}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/providers/local-llama-spec.test.js 2>&1 | tail -5
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/specs/local-llama-spec.ts tests/providers/local-llama-spec.test.ts
git commit -m "feat(providers): local-llama spec with grammar-constrained tool calling"
```

---

## Task 3: Register spec in dispatcher

**Files:**
- Modify: `src/providers/unified-complete.ts`

- [ ] **Step 1: Add import and registration**

Add the import at the top:
```typescript
import { localLlamaSpec } from "./specs/local-llama-spec.js";
```

Add to the `SPECS` Map:
```typescript
["local-llama", localLlamaSpec],
```

Also add to `PROVIDER_KEY_ENV`:
```typescript
local_llama: "",  // no env var for local
```

(Note: the key uses underscore per convention; user can still pass `provider: "local-llama"`)

- [ ] **Step 2: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/unified-complete.ts
git commit -m "feat(providers): register local-llama spec in dispatcher"
```

---

## Task 4: Write user setup guide

**Files:**
- Create: `docs/local-llama-setup.md`

- [ ] **Step 1: Create the file**

```markdown
# Local LLM with llama-server

Run ALiX against a local llama.cpp server with full tool-calling support.

## 1. Install llama.cpp

Already done — you have `/home/babasola/llama.cpp/build/bin/llama-server`.

## 2. Download a model

```bash
# Create models directory
mkdir -p ~/models

# Download a small but capable model (Phi-3 mini, ~2.3GB)
huggingface-cli download microsoft/Phi-3-mini-4k-instruct-gguf \
  --include "Phi-3-mini-4k-instruct-q4.gguf" \
  --local-dir ~/models

# Or TinyLlama (smaller, ~700MB, less capable)
huggingface-cli download TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF \
  --include "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf" \
  --local-dir ~/models
```

## 3. Start llama-server

```bash
cd /home/babasola/llama.cpp/build/bin
./llama-server -m ~/models/Phi-3-mini-4k-instruct-q4.gguf \
               -c 4096 \
               --port 8080
```

You should see: `HTTP server listening on port 8080`

## 4. Configure ALiX

Edit `.alix/config.json`:
```json
{
  "model": {
    "provider": "local-llama",
    "name": "phi-3"
  }
}
```

## 5. Test

```bash
alix run "list the files in src/"
```

The model should call `shell.run` with `ls src/` and return the result.

## How tool calling works

ALiX's `local-llama` spec uses llama-server's grammar-constrained generation:

1. Tool definitions are converted to a JSON schema
2. Schema is sent in `response_format.json_schema` field
3. llama-server forces model output to match schema
4. Output is parsed back to ALiX's `ToolCall[]` format

Works with any model that can produce JSON. Phi-3 and Qwen2.5 are recommended.

## Troubleshooting

- **Model outputs invalid JSON**: try a larger/better model (Phi-3 mini is the minimum)
- **Tool name not recognized**: the model picked a name not in your tool list
- **Slow inference**: reduce context size (`-c 2048`) or use a smaller quantization
```

- [ ] **Step 2: Commit**

```bash
git add docs/local-llama-setup.md
git commit -m "docs: add local-llama setup guide"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat(providers): local-llama tool-calling adapter complete

- buildToolCallSchema helper with TDD
- localLlamaSpec with grammar-constrained tool calling
- Registered in dispatcher
- 13 new tests, all pass
- docs/local-llama-setup.md user guide"
```

---

## Self-Review

- [x] Schema builder with TDD → Task 1
- [x] Provider spec with TDD → Task 2
- [x] Dispatcher integration → Task 3
- [x] User setup guide → Task 4
- [x] Final verification → Task 5
- [x] TDD throughout
- [x] Mocked tests, real verification deferred to user

Plan length: 5 tasks, each 2-5 minutes. ✓
