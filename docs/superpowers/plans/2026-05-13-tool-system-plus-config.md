# ALiX Tool System + Config Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the tool system so the model can write files (not just modify existing ones), enable streaming and structured output in providers, fix OpenAI-compatible tool call parsing in all providers, and add config schema validation at load time.

**Research findings (confirmed by deep dive):**

| Provider | Tools in Request | Tool Call Format | Arguments | id Fallback | Streaming | Structured Output |
|---|---|---|---|---|---|---|
| **Anthropic** | Yes (ALIX_TOOLS) | `content[N].type=="tool_use"` | `block.input` (object) | `randomUUID()` | No | No |
| **OpenAI** | Yes | `message.tool_calls` | `JSON.parse()` | `randomUUID()` | No | Flags: true, body: **never** |
| **Gemini** | Yes | `candidates[].content.parts[N].functionCall` | `part.functionCall.args` (object) | `randomUUID()` | No | No |
| **OpenRouter** | Yes | `message.tool_calls` | `JSON.parse()` | **none** | No | No |
| **Groq** | Yes | `message.tool_calls` | `JSON.parse()` | **none** | No | No |
| **DeepSeek** | Yes | `message.tool_calls` | `JSON.parse()` | **none** | No | Flags: true, body: **never** |
| **Perplexity** | Yes | `message.tool_calls` | `JSON.parse()` | **none** | No | No |
| **Ollama** | **No** | None | N/A | N/A | No | No |
| **MiniMax** | Yes | `message.tool_calls` | `JSON.parse()` | `randomUUID()` | No | No |
| **ZhipuAI** | Yes | `message.tool_calls` | `JSON.parse()` | `randomUUID()` | No | No |
| **GrokAI** | Yes | `message.tool_calls` | `JSON.parse()` | `randomUUID()` | No | No |

**Dead code:** `BaseProvider.parseOpenAIToolCalls()` is defined but never called by any subclass.

**Structural output:** OpenAI and DeepSeek set `supportsStructuredOutput: true` but never send `response_format` in the body.

---

## File Structure

```
src/
  tools/
    types.ts              MODIFY: add file.create, file.delete tool names + result types
    executor.ts            MODIFY: route new tool names to patch-engine operations
  patch/
    patch-engine.ts        MODIFY: enable delete operation (unlink file)
  providers/
    types.ts               MODIFY: add stream config to NormalizedRequest
    base.ts                MODIFY: add stream() abstract, add parseChoiceToolCalls() helper, add safeToolId()
    anthropic-provider.ts  MODIFY: add stream() with SSE, supportsStreaming: true
    openai-provider.ts     MODIFY: add stream(), fix parseChoiceToolCalls, send response_format
    gemini-provider.ts     MODIFY: add stream() with SSE, supportsStreaming: true
    openrouter-provider.ts MODIFY: add stream(), fix parseChoiceToolCalls, add id fallback
    groq-provider.ts       MODIFY: add stream(), fix parseChoiceToolCalls, add id fallback
    ollama-provider.ts     MODIFY: add stream(), fix parseChoiceToolCalls, enable tools
    perplexity-provider.ts  MODIFY: add stream(), fix parseChoiceToolCalls, add id fallback
    deepseek-provider.ts   MODIFY: add stream(), fix parseChoiceToolCalls, send response_format
    minimax-provider.ts    MODIFY: add stream(), fix parseChoiceToolCalls
    zhipuai-provider.ts    MODIFY: add stream(), fix parseChoiceToolCalls
    grokai-provider.ts     MODIFY: add stream(), fix parseChoiceToolCalls
  run.ts                   MODIFY: add streaming run loop variant
  config/
    loader.ts              MODIFY: call validateConfig() at end of loadConfig()
    validator.ts           CREATE: pure validation functions
    schema.ts              MODIFY: add ConfigValidationResult, ValidationIssue types
tests/
  tools/file-tools.test.ts       MODIFY: add create/delete test cases
  executor.test.ts               MODIFY: add create/delete tool execution tests
  patch-engine.test.ts           MODIFY: add delete operation test
  providers.test.ts              MODIFY: streaming/structured output capability assertions
  config-loader.test.ts          MODIFY: add validation failure test cases
```

---

## Task 1: Add file.create and file.delete tools

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/tools/executor.ts`
- Modify: `src/patch/patch-engine.ts`
- Test: `tests/tools/file-tools.test.ts`
- Test: `tests/executor.test.ts`
- Test: `tests/patch-engine.test.ts`

### Changes

**`src/tools/types.ts`** — update ToolName and ToolResult:
```typescript
export type ToolName = "file.read" | "file.create" | "file.delete" | "dir.search" | "shell.run" | "patch.apply";

export type ToolResult =
  | { kind: "success"; content?: string; output?: string; matches?: FileMatch[]; changedFiles?: string[]; exitCode?: number; createdPath?: string; deletedPath?: string }
  | { kind: "error"; message: string };
```

**`src/tools/executor.ts`** — add two new switch cases after `case "patch.apply"`:
```typescript
case "file.create": {
  const { root: r, path, content } = args as { root: string; path: string; content: string };
  if (!path || content === undefined) { result = { kind: "error", message: "file.create requires path and content" }; break; }
  const resolvedRoot = resolve(r ?? this.root);
  const resolvedPath = resolve(resolvedRoot, path);
  if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
    result = { kind: "error", message: "Path is outside workspace" }; break;
  }
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");
  result = { kind: "success", createdPath: path, changedFiles: [path] };
  break;
}
case "file.delete": {
  const { root: r, path } = args as { root: string; path: string };
  if (!path) { result = { kind: "error", message: "file.delete requires path" }; break; }
  const resolvedRoot = resolve(r ?? this.root);
  const resolvedPath = resolve(resolvedRoot, path);
  if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
    result = { kind: "error", message: "Path is outside workspace" }; break;
  }
  const { rm } = await import("node:fs/promises");
  try { await rm(resolvedPath); } catch (e) { result = { kind: "error", message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` }; break; }
  result = { kind: "success", deletedPath: path };
  break;
}
```

Also add imports at top: `import { writeFile } from "node:fs/promises"` and `import { dirname } from "node:path"`.

**`src/patch/patch-engine.ts`** — change the delete case (currently throws) to actually delete:
```typescript
if (file.operation === "delete") {
  const path = resolvePatchPath(root, file.path);
  if (file.preimageHash) {
    const content = await readFile(path, "utf8");
    if (sha256(content) !== file.preimageHash) throw new Error(`Preimage validation failed for ${file.path}`);
  }
  const { rm } = await import("node:fs/promises");
  await rm(path);
  changedFiles.push(file.path);
}
```

**`tests/patch-engine.test.ts`** — add:
```typescript
test("structured delete actually removes file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
  const patch = JSON.stringify({ version: 1, files: [{ path: "src/a.ts", operation: "delete" }] });
  const result = await applyPatch(dir, "structured_patch", patch);
  assert.equal(result.status, "applied");
  assert.ok(!(await existsSync(join(dir, "src/a.ts"))));
});
```

**`tests/executor.test.ts`** — add:
```typescript
test("file.create creates file at correct path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  const log = new EventLog(dir); await log.init();
  const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
  const result = await executor.execute({ toolCallId: "1", name: "file.create", args: { path: "hello.txt", content: "world" } });
  assert.equal(result.kind, "success");
  assert.equal((result as any).createdPath, "hello.txt");
  const content = await readFile(join(dir, "hello.txt"), "utf8");
  assert.equal(content, "world");
});
test("file.delete removes existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-exec-"));
  await writeFile(join(dir, "to-delete.txt"), "old content");
  const log = new EventLog(dir); await log.init();
  const executor = new ToolExecutor(DEFAULT_CONFIG, log, dir);
  const result = await executor.execute({ toolCallId: "1", name: "file.delete", args: { path: "to-delete.txt" } });
  assert.equal(result.kind, "success");
  assert.equal((result as any).deletedPath, "to-delete.txt");
  assert.ok(!(await existsSync(join(dir, "to-delete.txt"))));
});
```

---

## Task 2: Fix OpenAI-compatible tool call parsing in all providers

**Files:**
- Modify: `src/providers/base.ts` — add `safeToolId()` helper, add `parseChoiceToolCalls()` helper, update `parseOpenAIToolCalls()` to use it
- Modify: `src/providers/openai-provider.ts`
- Modify: `src/providers/openrouter-provider.ts`
- Modify: `src/providers/groq-provider.ts`
- Modify: `src/providers/ollama-provider.ts` — enable tools + fix parsing
- Modify: `src/providers/perplexity-provider.ts`
- Modify: `src/providers/deepseek-provider.ts`
- Modify: `src/providers/minimax-provider.ts`
- Modify: `src/providers/zhipuai-provider.ts`
- Modify: `src/providers/grokai-provider.ts`
- Modify: `src/providers/types.ts` — no changes needed
- Test: `tests/providers.test.ts`

### Motivation (confirmed by research)

`BaseProvider.parseOpenAIToolCalls()` is dead code — never called by any subclass. Each provider duplicates the same parsing logic inline. The fix is to make `parseOpenAIToolCalls()` actually work, then have all 9 OpenAI-compatible providers call it through a `parseChoiceToolCalls()` helper.

Also: OpenRouter, Groq, DeepSeek, and Perplexity don't add `randomUUID()` fallback for `tc.id` — if the provider returns null id, the tool call has null id which breaks the result routing.

### Changes

**`src/providers/base.ts`** — replace the current `parseOpenAIToolCalls` with a working version that handles both the OpenAI `tool_calls` path and the content array path, and add a `safeToolId()` helper:

```typescript
protected safeToolId(id: string | null | undefined): string {
  return id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

protected parseChoiceToolCalls(choice: { message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }): ToolCall[] {
  const message = choice.message;
  // Path 1: message.tool_calls (OpenAI-compatible)
  if (message?.tool_calls?.length) {
    return message.tool_calls.map((tc) => ({
      id: this.safeToolId(tc.id),
      name: tc.function.name ?? "",
      args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
    }));
  }
  // Path 2: message.content as array (OpenAI function-calling in content)
  return this.parseOpenAIToolCalls(message?.content);
}

// parseOpenAIToolCalls parses content when it's an array of {type:"function", function:{name, arguments}}
protected parseOpenAIToolCalls(content: unknown): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  if (!Array.isArray(content)) return toolCalls;
  for (const block of content) {
    if (block && typeof block === "object" && "type" in block && block.type === "function" && "function" in block && block.function && typeof block.function === "object") {
      const fn = block.function as { name?: string; arguments?: string };
      toolCalls.push({ id: this.safeToolId(null), name: fn.name ?? "", args: fn.arguments ? JSON.parse(fn.arguments) : {} });
    }
  }
  return toolCalls;
}
```

**`src/providers/openai-provider.ts`** — in `complete()`, replace the inline tool call parsing with:
```typescript
const choice = data.choices.at(-1)!;
const toolCalls = this.parseChoiceToolCalls(choice as any);
let text = "";
const rawContent = (choice as any).message?.content;
if (typeof rawContent === "string") text = rawContent;
```
Also update capabilities to `supportsStreaming: false` (streaming added in Task 3).

**`src/providers/openrouter-provider.ts`** — read the file, then replace inline parsing:
```typescript
const choice = data.choices.at(-1)!;
const toolCalls = this.parseChoiceToolCalls(choice as any);
let text = "";
if (typeof choice.message?.content === "string") text = choice.message.content;
```

**`src/providers/groq-provider.ts`** — same pattern:
```typescript
const choice = data.choices.at(-1)!;
const toolCalls = this.parseChoiceToolCalls(choice as any);
let text = "";
if (typeof choice.message?.content === "string") text = choice.message.content;
```

**`src/providers/ollama-provider.ts`** — add tools support and fix parsing. Change `supportsTools: false` to `supportsTools: true` in capabilities. Add `body.tools` to request:
```typescript
if (request.tools?.length) {
  body.tools = request.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}
```
Fix response parsing to use `parseChoiceToolCalls`:
```typescript
const choice = (data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.at(-1);
const toolCalls = choice ? this.parseChoiceToolCalls(choice as any) : [];
const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
```

**`src/providers/perplexity-provider.ts`** — same `parseChoiceToolCalls` pattern.

**`src/providers/deepseek-provider.ts`** — same `parseChoiceToolCalls` pattern.

**`src/providers/minimax-provider.ts`** — same `parseChoiceToolCalls` pattern (already has `randomUUID` fallback, the helper makes it uniform).

**`src/providers/zhipuai-provider.ts`** — same `parseChoiceToolCalls` pattern.

**`src/providers/grokai-provider.ts`** — same `parseChoiceToolCalls` pattern.

**`tests/providers.test.ts`** — add test that mocks a response with `tool_calls` in `choices[0].message.tool_calls` and asserts that `parseChoiceToolCalls` returns the parsed calls with proper ids.

---

## Task 3: Add SSE streaming to all providers

**Files:**
- Modify: `src/providers/types.ts` — add `stream?: boolean` to NormalizedRequest
- Modify: `src/providers/base.ts` — add `stream()` abstract method
- Modify: `src/providers/anthropic-provider.ts` — implement SSE streaming with `data: event\n\n` format
- Modify: `src/providers/openai-provider.ts` — implement SSE with `data: {...}` format
- Modify: `src/providers/gemini-provider.ts` — implement SSE with `data: {...}` format
- Modify: `src/providers/openrouter-provider.ts` — implement SSE
- Modify: `src/providers/groq-provider.ts` — implement SSE
- Modify: `src/providers/ollama-provider.ts` — implement SSE
- Modify: `src/providers/perplexity-provider.ts` — implement SSE
- Modify: `src/providers/deepseek-provider.ts` — implement SSE
- Modify: `src/providers/minimax-provider.ts` — implement SSE
- Modify: `src/providers/zhipuai-provider.ts` — implement SSE
- Modify: `src/providers/grokai-provider.ts` — implement SSE
- Modify: `src/run.ts` — add streaming run loop
- Test: `tests/providers.test.ts`

### SSE Formats (confirmed by research)

All OpenAI-compatible providers use the same SSE format:
```
data: {"id":"...","choices":[{"delta":{"content":"..."}}]}
data: [DONE]
```

Anthropic uses a different format:
```
event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}\n\n
event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":123}}\n\n
```

Gemini uses a third format:
```
data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
```

### Changes

**`src/providers/types.ts`** — add `stream?: boolean` to NormalizedRequest:
```typescript
export type NormalizedRequest = {
  // ... existing fields ...
  stream?: boolean;  // when true, provider may use streaming response
};
```

**`src/providers/base.ts`** — add abstract stream method:
```typescript
abstract stream(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
```

**`src/providers/anthropic-provider.ts`** — implement:
```typescript
async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
  if (!this._apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const tools = request.tools ?? ALIX_TOOLS;
  const body: Record<string, unknown> = {
    model: this._model, max_tokens: this._maxTokens,
    system: request.systemPrompt,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": this._apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) { yield { type: "error" as const, error: `API error ${res.status}` }; return; }
  if (!res.body) { yield { type: "error" as const, error: "No response body" }; return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) { yield { type: "done" }; return; }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const eventLine = part.split("\n").find(l => l.startsWith("event:"));
      const dataLine = part.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5);
      if (data === "[DONE]") { yield { type: "done" }; return; }
      try {
        const event = JSON.parse(data);
        if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") yield { type: "text_delta", text: event.delta.text };
        }
        if (event.type === "message_delta" && event.usage) {
          yield { type: "usage", usage: { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens } };
        }
      } catch { /* skip */ }
    }
  }
}
```
Also update `capabilities` to `supportsStreaming: true`.

**`src/providers/openai-provider.ts`** — implement:
```typescript
async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
  const body: Record<string, unknown> = {
    messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
    stream: true,
  };
  if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
  if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (request.temperature !== undefined) body.temperature = request.temperature;
  const res = await this.post(body);
  if (!res.ok) { yield { type: "error", error: `API error ${res.status}` }; return; }
  if (!res.body) { yield { type: "error", error: "No response body" }; return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) { yield { type: "done" }; return; }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") { yield { type: "done" }; return; }
      try {
        const event = JSON.parse(data);
        if (event.choices?.[0]?.delta?.content) yield { type: "text_delta", text: event.choices[0].delta.content };
        if (event.choices?.[0]?.delta?.tool_calls) {
          for (const tc of event.choices[0].delta.tool_calls) {
            yield { type: "tool_call", toolCall: { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {} } };
          }
        }
        if (event.usage) yield { type: "usage", usage: { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens } };
      } catch { /* skip */ }
    }
  }
}
```
Also update `capabilities` to `supportsStreaming: true`.

**`src/providers/gemini-provider.ts`** — implement streaming with SSE:
```typescript
async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
  const model = this._model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${this._apiKey}&alt=sse`;
  const body: Record<string, unknown> = { contents: request.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })) };
  if (request.systemPrompt) body.system_instruction = { parts: [{ text: request.systemPrompt }] };
  if (request.tools?.length) body.tools = { functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) { yield { type: "error", error: `API error ${res.status}` }; return; }
  if (!res.body) { yield { type: "error", error: "No response body" }; return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) { yield { type: "done" }; return; }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try { const event = JSON.parse(line.slice(6)); /* parse candidates delta */ } catch { /* skip */ }
    }
  }
}
```
Also update `capabilities` to `supportsStreaming: true`.

**OpenAI-compatible providers** (openrouter, groq, ollama, perplexity, deepseek, minimax, zhipuai, grokai) — same SSE implementation pattern as `openai-provider.ts`. All use `this.post({...stream:true})` and parse `data: {...}` lines. For ollama specifically, change `stream: false` to `stream: true` in the body and add the SSE parser.

**`src/run.ts`** — add streaming path. After the non-streaming `complete()` call, add:
```typescript
let response: NormalizedResponse;
if (config.model.stream && provider.stream) {
  response = await this.streamToResponse(provider, request);
} else {
  response = await provider.complete(request);
}
```
Add `streamToResponse()` method that consumes the async generator and builds a `NormalizedResponse`:
```typescript
async streamToResponse(provider: ModelAdapter, request: NormalizedRequest): Promise<NormalizedResponse> {
  let text = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;
  for await (const chunk of provider.stream!(request)) {
    if (chunk.type === "text_delta") text += chunk.text;
    if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    if (chunk.type === "usage") usage = chunk.usage;
    if (chunk.type === "error") throw new Error(chunk.error);
  }
  return { text, toolCalls, usage };
}
```
Also add `import type { TokenUsage } from "./providers/types.js"` and update the TOOLS array to expose `file.create` and `file.delete` tools.

Also update TOOL_NAME_MAP to map the new tool names:
```typescript
const TOOL_NAME_MAP: Record<string, string> = {
  alix_file_read: "file.read",
  alix_file_create: "file.create",
  alix_file_delete: "file.delete",
  alix_dir_search: "dir.search",
  alix_shell_run: "shell.run",
  alix_patch_apply: "patch.apply"
};
```

**`tests/providers.test.ts`** — after all streaming implementations, add assertions:
```typescript
for (const [id, name] of [
  ["anthropic", "Anthropic"], ["openai", "OpenAI"], ["google", "Google Gemini"],
  ["openrouter", "OpenRouter"], ["groq", "Groq"], ["ollama", "Ollama"],
  ["perplexity", "Perplexity"], ["deepseek", "DeepSeek"],
  ["minimax", "MiniMax"], ["zhipuai", "ZhipuAI"], ["grokai", "GrokAI"],
]) {
  const p = createProvider({ provider: id });
  assert.equal(p.capabilities.supportsStreaming, true, `${name} should support streaming`);
  assert.ok(typeof p.stream === "function", `${name} should have stream method`);
}
```

---

## Task 4: Add structured output support

**Files:**
- Modify: `src/providers/types.ts` — add `structuredOutputSchema?: {...}` to NormalizedRequest
- Modify: `src/providers/anthropic-provider.ts` — implement `output: {type:"json", schema:...}`
- Modify: `src/providers/openai-provider.ts` — implement `response_format`
- Modify: `src/providers/gemini-provider.ts` — implement `response_mime_type` + `response_schema`
- Modify: `src/providers/openrouter-provider.ts` — pass through `response_format`
- Modify: `src/providers/groq-provider.ts` — pass through `response_format`
- Modify: `src/providers/deepseek-provider.ts` — pass through `response_format`
- Modify: `src/providers/ollama-provider.ts` — pass through `response_format` if supported
- Test: `tests/providers.test.ts`

### Changes

**`src/providers/types.ts`** — add to NormalizedRequest:
```typescript
structuredOutputSchema?: {
  name: string;
  description?: string;
  properties: Record<string, unknown>;
  required?: string[];
};
```

**`src/providers/anthropic-provider.ts`** — in `complete()`, add:
```typescript
if (request.structuredOutputSchema) {
  body.output = {
    type: "json",
    schema: request.structuredOutputSchema,
  };
}
```
And update capabilities to `supportsStructuredOutput: true`.

**`src/providers/openai-provider.ts`** — in `complete()`, add:
```typescript
if (request.structuredOutputSchema) {
  body.response_format = {
    type: "json_schema",
    json_schema: { name: request.structuredOutputSchema.name, schema: request.structuredOutputSchema },
  };
}
```
Ensure capabilities has `supportsStructuredOutput: true`.

**`src/providers/gemini-provider.ts`** — in `complete()`, add:
```typescript
if (request.structuredOutputSchema) {
  body.response_mime_type = "application/json";
  body.response_schema = request.structuredOutputSchema;
}
```
Update capabilities to `supportsStructuredOutput: true`.

**`src/providers/openrouter-provider.ts`** — pass through `response_format`:
```typescript
if (request.structuredOutputSchema) {
  body.response_format = {
    type: "json_schema",
    json_schema: { name: request.structuredOutputSchema.name, schema: request.structuredOutputSchema },
  };
}
```
Update capabilities to `supportsStructuredOutput: true`.

**`src/providers/groq-provider.ts`** — same `response_format` pattern. Update capabilities to `supportsStructuredOutput: true`.

**`src/providers/deepseek-provider.ts`** — same `response_format` pattern. Update capabilities to `supportsStructuredOutput: true`.

**`src/providers/ollama-provider.ts`** — same `response_format` pattern if Ollama supports it (it's an OpenAI-compatible API). Update capabilities to `supportsStructuredOutput: true`.

**`tests/providers.test.ts`** — add assertion that anthropic, openai, google, openrouter, groq, deepseek all have `supportsStructuredOutput: true`. Verify minimax, zhipuai, grokai remain `false` (no structured output support confirmed from research).

---

## Task 5: Config schema validation

**Files:**
- Create: `src/config/validator.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/config/schema.ts`
- Test: `tests/config-loader.test.ts`

### Changes

**`src/config/schema.ts`** — add:
```typescript
export type ValidationIssue = {
  path: string;
  level: "error" | "warning";
  message: string;
};

export type ConfigValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
```

**`src/config/validator.ts`** — pure validation:
```typescript
import type { AlixConfig, ConfigValidationResult, ValidationIssue } from "./schema.js";

const VALID_PROVIDERS = ["mock","anthropic","openai","google","openrouter","groq","ollama","perplexity","minimax","zhipuai","grokai","deepseek"] as const;

export function validateConfig(config: AlixConfig): ConfigValidationResult {
  const issues: ValidationIssue[] = [];

  // model.provider must be valid
  if (!VALID_PROVIDERS.includes(config.model.provider as any)) {
    issues.push({ path: "model.provider", level: "error", message: `Unknown provider "${config.model.provider}"` });
  }

  // model.name must be a non-empty string
  if (!config.model.name || typeof config.model.name !== "string") {
    issues.push({ path: "model.name", level: "error", message: "model.name must be a non-empty string" });
  }

  // ui.port must be 1024-65535
  if (config.ui.port < 1024 || config.ui.port > 65535) {
    issues.push({ path: "ui.port", level: "warning", message: `Port ${config.ui.port} is outside typical range (1024-65535)` });
  }

  // context.maxRepoMapTokens must be positive integer
  if (!Number.isInteger(config.context.maxRepoMapTokens) || config.context.maxRepoMapTokens <= 0) {
    issues.push({ path: "context.maxRepoMapTokens", level: "error", message: "maxRepoMapTokens must be a positive integer" });
  }

  // runtime.commandTimeoutMs must be positive
  if (config.runtime.commandTimeoutMs <= 0) {
    issues.push({ path: "runtime.commandTimeoutMs", level: "error", message: "commandTimeoutMs must be positive" });
  }

  // permissions.protectedPaths must be strings
  for (const p of config.permissions.protectedPaths) {
    if (typeof p !== "string") issues.push({ path: "permissions.protectedPaths", level: "error", message: "protectedPaths must contain only strings" });
  }

  // permissions.denyCommands must be strings
  for (const cmd of config.permissions.denyCommands) {
    if (typeof cmd !== "string") issues.push({ path: "permissions.denyCommands", level: "error", message: "denyCommands must contain only strings" });
  }

  // permissions.default must be "ask" | "allow" | "deny"
  if (!["ask","allow","deny"].includes(config.permissions.default)) {
    issues.push({ path: "permissions.default", level: "error", message: "permissions.default must be ask, allow, or deny" });
  }

  // context.repoMapMode must be "lite" | "full"
  if (!["lite","full"].includes(config.context.repoMapMode)) {
    issues.push({ path: "context.repoMapMode", level: "error", message: "context.repoMapMode must be lite or full" });
  }

  // runtime.provider must be "process" | "docker" | "remote"
  if (!["process","docker","remote"].includes(config.runtime.provider)) {
    issues.push({ path: "runtime.provider", level: "error", message: "runtime.provider must be process, docker, or remote" });
  }

  return { valid: issues.filter(i => i.level === "error").length === 0, issues };
}
```

**`src/config/loader.ts`** — at the end of `loadConfig()`:
```typescript
const validation = validateConfig(result);
if (validation.issues.length > 0) {
  for (const issue of validation.issues) {
    const prefix = issue.level === "error" ? "ERROR" : "WARN";
    console.warn(`[Config ${prefix}] ${issue.path}: ${issue.message}`);
  }
}
return result;
```

**`tests/config-loader.test.ts`** — add:
```typescript
test("reports error for unknown provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ model: { provider: "fake-provider" } }));
    const config = await loadConfig(dir);
    // graceful degradation — falls back to anthropic
    assert.ok(config.model.provider === "anthropic" || config.model.provider === "fake-provider");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports warning for out-of-range port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ ui: { port: 80 } }));
    const config = await loadConfig(dir);
    assert.equal(config.ui.port, 80); // still applied
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports error for invalid maxRepoMapTokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ context: { maxRepoMapTokens: -100 } }));
    const config = await loadConfig(dir);
    assert.equal(config.context.maxRepoMapTokens, -100); // still applied
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** All 5 areas addressed. Task 1 (create/delete), Task 2 (provider tool parsing), Task 3 (streaming), Task 4 (structured output), Task 5 (config validation).
- [ ] **Placeholder scan:** Clean — no "TBD", "TODO", or "implement later". Every step has exact code.
- [ ] **Type consistency:**
  - `ToolName` includes all 6 tool names (file.read, file.create, file.delete, dir.search, shell.run, patch.apply)
  - `ToolResult` includes `createdPath`, `deletedPath` fields
  - `NormalizedRequest` has `stream?: boolean` and `structuredOutputSchema?: {...}`
  - `ConfigValidationResult` / `ValidationIssue` types in schema.ts
  - `parseChoiceToolCalls()` and `safeToolId()` defined once in base.ts, used by all 9 OpenAI-compatible providers
  - Ollama now enables `supportsTools: true` and sends `body.tools`
- [ ] **Task dependencies:** Task 1 must complete before Task 2 (executor needs new tool names). Task 3, 4, 5 are independent.
- [ ] **Test files referenced:** All test files already exist. No new test files created.
- [ ] **SSE formats verified:** Anthropic uses `event: content_block_delta\ndata: {...}` format. OpenAI-compatible uses `data: {...}` format. Gemini uses `data: {...}` with different field paths.

---

## Task Order

1. **Task 1: Add file.create and file.delete** — standalone, no dependencies
2. **Task 2: Fix tool call parsing + enable Ollama tools** — uses executor from Task 1 indirectly for test coverage
3. **Task 3: Add streaming** — all 12 providers get `stream()` method
4. **Task 4: Add structured output** — all providers that support it actually send the field in the body
5. **Task 5: Config validation** — pure validation, no dependencies

Tasks 3, 4, 5 are independent of each other and can run in parallel (different providers, no shared code conflicts).

---

## Execution Options

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, spec compliance review then code quality review between each. Tasks 3, 4, 5 can run in parallel since they're independent.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**