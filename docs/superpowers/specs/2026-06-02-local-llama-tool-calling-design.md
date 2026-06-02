# Local-Llama Tool-Calling Adapter Design

**Date:** 2026-06-02
**Status:** Draft
**Source:** User request + pi-llama-cpp pattern from YouTube article

## Motivation

User wants local inference via `llama-server` with full tool-calling support, similar to how Pi Agent's `pi-llama-cpp` extension works.

**Current state:** ALiX's `local-llama` provider doesn't exist. The `openai` provider could be pointed at llama-server but its OpenAI-compat mode doesn't natively support tool calls.

**Discovery:** `llama-server` supports grammar-constrained generation via the `json_schema` field in `/v1/chat/completions`. We can leverage this to force the model to output valid tool calls in a structured format.

## Goals

1. **New `local-llama` provider spec** that wraps `llama-server` with grammar-constrained tool calling
2. **Tool definitions converted to JSON schema** at request time
3. **Model output parsed back to `ToolCall[]`** matching OpenAI's tool-call format
4. **Works with any model that can do JSON output** — Phi-3, Qwen2.5, LLaMA-3.1, etc.
5. **No new dependencies** — uses the existing `ProviderSpec` interface

## Non-Goals

- Replacing Ollama support
- Streaming tool calls (text mode for now)
- Re-implementing Pi Agent's `models.ini` discovery (can be added later)
- Automatic model download (user provides GGUF path)

## Architecture

### Provider Spec

```typescript
// src/providers/specs/local-llama-spec.ts
export const localLlamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:8080/v1/chat/completions",
  // ... rest inherits from openaiBaseSpec
};
```

### The Tool-Calling Trick

The key insight: when ALiX sends `tools: [fileRead, shellRun, ...]` to a provider, we can:

1. **Convert tool definitions → JSON schema** describing a single function-call wrapper
2. **Send that schema in the `json_schema` field** of the request
3. **Model is forced to output valid JSON** matching that schema
4. **Parse the output** back into ALiX's `ToolCall[]` format

The schema looks like:
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "enum": ["file.read", "shell.run", ...] },
    "arguments": { "type": "object" }
  },
  "required": ["name", "arguments"]
}
```

### `toRequestBody` Override

```typescript
toRequestBody: (req) => {
  // Standard OpenAI-compat body (messages, system prompt, etc.)
  const body: any = {
    model: req.model,
    messages: [...],
  };
  
  // If tools provided, convert to JSON schema for grammar
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
}
```

### `fromResponse` Override

```typescript
fromResponse: (res) => {
  const r = res as any;
  const text = r.choices?.[0]?.message?.content ?? "";
  
  // The model output is JSON matching the tool_call schema
  let toolCalls: ToolCall[] = [];
  try {
    const parsed = JSON.parse(text);
    if (parsed.name && parsed.arguments) {
      toolCalls = [{
        id: `local-${Date.now()}-${Math.random()}`,
        name: parsed.name,
        args: parsed.arguments,
      }];
    }
  } catch {
    // Not a tool call — treat as plain text response
  }
  
  return {
    text: toolCalls.length > 0 ? "" : text,
    toolCalls,
    usage: r.usage ? { ... } : undefined,
    finishReason: r.choices?.[0]?.finish_reason,
  };
}
```

### Helper: `buildToolCallSchema`

```typescript
// src/providers/specs/_tool-schema.ts
export function buildToolCallSchema(tools: ToolDef[]): object {
  return {
    type: "object",
    properties: {
      name: { type: "string", enum: tools.map(t => t.name) },
      arguments: {
        type: "object",
        // Could include per-tool schemas, but most models handle generic object
      },
    },
    required: ["name", "arguments"],
  };
}
```

## Data Flow

```
runTask → provider.complete({ tools: [fileRead, shellRun, ...] })
  ↓
local-llama spec: toRequestBody
  - builds standard OpenAI body
  - adds response_format.json_schema with tool-call schema
  ↓
POST http://localhost:8080/v1/chat/completions
  ↓
llama-server: forces model to output valid JSON matching schema
  ↓
{ "name": "file.read", "arguments": { "path": "src/foo.ts" } }
  ↓
local-llama spec: fromResponse
  - parses JSON
  - converts to ToolCall[]
  ↓
ALiX continues with the tool call
```

## Edge Cases

1. **Model refuses to use tools** (e.g., outputs plain text instead of JSON) → `toolCalls = []`, text is returned
2. **Model picks wrong tool name** (not in enum) → grammar constrains it; should not happen
3. **Invalid arguments JSON** → fall back to empty args
4. **Model wants to call multiple tools** → current schema only allows one. Could extend to array, but most agents call one tool at a time
5. **No tools provided** → no `response_format` added; behaves like regular completion
6. **Streaming** → not supported in v1 (text-mode only); can add later

## Files Affected

| Action | File |
|--------|------|
| ➕ New | `src/providers/specs/local-llama-spec.ts` (~80 lines) |
| ➕ New | `src/providers/specs/_tool-schema.ts` (~30 lines) |
| ✏️ Modify | `src/providers/unified-complete.ts` (register spec) |
| ➕ New | `tests/providers/local-llama-spec.test.ts` (~150 lines) |

## Migration Strategy

1. **Create `_tool-schema.ts`** (pure function, easy to test)
2. **Create `local-llama-spec.ts`** (TDD)
3. **Register in `unified-complete.ts`** (one Map entry)
4. **User setup** (separate from code):
   - Download a model: `huggingface-cli download TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF`
   - Start llama-server: `./llama-server -m model.gguf -c 2048 --port 8080`
   - Configure ALiX: `alix config set-default-model local-llama tinyllama`

## Success Criteria

- [ ] `local-llama-spec.ts` implemented with TDD
- [ ] Schema conversion works for any tool list
- [ ] Parsed output matches `NormalizedResponse` shape
- [ ] All existing tests pass
- [ ] Manual test: real llama-server + small model + tool call works

## Limitations (Documented)

- **Streaming not supported** — full response only
- **One tool per response** — schema allows one function call
- **Model-dependent quality** — small models may hallucinate tool names
- **No native OpenAI tool-calling** — uses JSON schema workaround

## Out of Scope

- Auto-discovery of llama-server models
- Tailscale-friendly remote URL
- Hot-swap model presets
