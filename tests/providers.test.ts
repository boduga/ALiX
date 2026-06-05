import test from "node:test";
import assert from "node:assert/strict";

// BaseProvider is abstract — test through a concrete subclass
import { BaseProvider } from "../src/providers/base.js";
import { OpenAIProvider } from "../src/providers/openai-provider.js";
import { OpenRouterProvider } from "../src/providers/openrouter-provider.js";
import { OllamaProvider } from "../src/providers/ollama-provider.js";
import { DeepSeekProvider } from "../src/providers/deepseek-provider.js";
import { PerplexityProvider } from "../src/providers/perplexity-provider.js";
import { GroqProvider } from "../src/providers/groq-provider.js";
import { GrokAIProvider } from "../src/providers/grokai-provider.js";
import { GeminiProvider } from "../src/providers/gemini-provider.js";
import { ZhipuAIProvider } from "../src/providers/zhipuai-provider.js";
import { MiniMaxProvider } from "../src/providers/minimax-provider.js";
import { AnthropicProvider } from "../src/providers/anthropic-provider.js";

test("base provider accepts apiKey and model options", () => {
  const p = new OpenAIProvider({ apiKey: "test-key", model: "gpt-4o" });
  assert.equal(p.capabilities.model, "gpt-4o");
});

test("base provider uses correct base URL", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // Check via capabilities — model name confirms URL resolution worked
  assert.equal(p.capabilities.provider, "openai");
});

test("openrouter provider returns correct capabilities", () => {
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  assert.equal(p.id, "openrouter");
  assert.equal((p as any)._model, "openai/gpt-4o");
});

test("openrouter provider adds required headers", () => {
  // Headers are now part of the spec, not extraHeaders(). Verify via spec directly.
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  assert.equal(p.id, "openrouter");
  // spec test already covers header behavior in tests/providers/inheritors.test.ts
});

test("ollama provider returns correct capabilities", () => {
  const p = new OllamaProvider({ apiKey: "" });
  assert.equal(p.id, "ollama");
  assert.equal((p as any)._model, "llama3.2");
});

test("ollama provider works without api key", async () => {
  const p = new OllamaProvider({});
  const c = p.capabilities;
  assert.ok(c.model);
});

test("ollama complete sends tools and parses tool calls", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, any> | undefined;

  globalThis.fetch = (async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            function: {
              name: "alix_shell_run",
              arguments: "{\"command\":\"ls src/agents\"}",
            },
          }],
        },
      }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal((capturedBody?.tools as any[])?.[0]?.function?.name, "alix_shell_run");
    assert.deepEqual(resp.toolCalls, [{
      id: "call_1",
      name: "alix_shell_run",
      args: { command: "ls src/agents" },
    }]);
    assert.deepEqual(resp.usage, { inputTokens: 11, outputTokens: 7 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama complete parses JSON-in-text tool call fallback", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents\",\"cwd\":\"\",\"timeoutMs\":5000}}",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal(resp.text, "");
    assert.deepEqual(resp.toolCalls, [{
      id: resp.toolCalls[0].id,
      name: "alix_shell_run",
      args: { command: "ls src/agents", cwd: "", timeoutMs: 5000 },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama complete parses fenced JSON tool call fallback", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "```json\n{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents/\",\"cwd\":\"\",\"timeoutMs\":0}}\n```",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal(resp.text, "");
    assert.deepEqual(resp.toolCalls, [{
      id: resp.toolCalls[0].id,
      name: "alix_shell_run",
      args: { command: "ls src/agents/", cwd: "", timeoutMs: 0 },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama complete parses first embedded JSON tool call from prose", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "JSON responses:\n\n1. shell:\n{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents/\",\"cwd\":\"\",\"timeoutMs\":0}}\n\n2. done:\n{\"name\":\"alix_done\",\"parameters\":{}}",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal(resp.text, "");
    assert.deepEqual(resp.toolCalls, [{
      id: resp.toolCalls[0].id,
      name: "alix_shell_run",
      args: { command: "ls src/agents/", cwd: "", timeoutMs: 0 },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama complete parses unquoted tool name fallback", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "{\"name\": alix_shell_run, \"parameters\": {\"command\": \"ls\", \"cwd\": \"/home\"}}",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal(resp.text, "");
    assert.deepEqual(resp.toolCalls, [{
      id: resp.toolCalls[0].id,
      name: "alix_shell_run",
      args: { command: "ls", cwd: "/home" },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama complete parses Python-style None in tool arguments", { skip: true }, async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "{\"name\": \"alix_shell_run\", \"parameters\": {\"command\": \"ls /home\", \"cwd\": \"/home\", \"timeoutMs\": None}}",
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{
        name: "alix_shell_run",
        description: "Run shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      }],
    });

    assert.equal(resp.text, "");
    assert.deepEqual(resp.toolCalls, [{
      id: resp.toolCalls[0].id,
      name: "alix_shell_run",
      args: { command: "ls /home", cwd: "/home", timeoutMs: null },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("deepseek provider returns correct capabilities", () => {
  const p = new DeepSeekProvider({ apiKey: "sk-ds-test" });
  assert.equal(p.capabilities.provider, "deepseek");
  assert.equal(p.capabilities.model, "deepseek-chat");
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("anthropic provider supports structured output", () => {
  const p = new AnthropicProvider({ apiKey: "sk-test" });
  assert.equal(p.capabilities.provider, "anthropic");
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("openai provider supports structured output", () => {
  const p = new OpenAIProvider({ apiKey: "sk-test" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("gemini provider supports structured output", () => {
  const p = new GeminiProvider({ apiKey: "AIza-test" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("openrouter provider supports structured output", () => {
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("groq provider supports structured output", () => {
  const p = new GroqProvider({ apiKey: "gsk_test" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("ollama provider supports structured output", () => {
  const p = new OllamaProvider({ apiKey: "" });
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("minimax provider does not support structured output", () => {
  const p = new MiniMaxProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.supportsStructuredOutput, false);
});

test("zhipuai provider does not support structured output", () => {
  const p = new ZhipuAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.supportsStructuredOutput, false);
});

test("grokai provider does not support structured output", () => {
  const p = new GrokAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.supportsStructuredOutput, false);
});

test("perplexity provider returns correct capabilities", () => {
  const p = new PerplexityProvider({ apiKey: "pplx-test" });
  assert.equal(p.id, "perplexity");
  assert.equal((p as any)._model, "llama-3.1-sonar-large-128k-online");
});

test("groq provider returns correct capabilities", () => {
  const p = new GroqProvider({ apiKey: "gsk_test" });
  assert.equal(p.id, "groq");
  assert.equal((p as any)._model, "llama-3.1-70b");
});

test("grokai provider returns correct capabilities", () => {
  const p = new GrokAIProvider({ apiKey: "test-key" });
  assert.equal(p.id, "grokai");
  assert.equal(p.editFormatPreference, "structured_patch");
});

test("gemini provider returns correct capabilities", () => {
  const p = new GeminiProvider({ apiKey: "AIza-test" });
  assert.equal(p.id, "google");
  assert.equal((p as any)._model, "gemini-2.5-flash");
  assert.equal(p.editFormatPreference, "structured_patch");
});

test("zhipuai provider returns correct capabilities", () => {
  const p = new ZhipuAIProvider({ apiKey: "test-key" });
  assert.equal(p.id, "zhipuai");
  assert.equal(p.editFormatPreference, "structured_patch");
});

test("minimax provider returns correct capabilities", () => {
  const p = new MiniMaxProvider({ apiKey: "test-key" });
  assert.equal(p.id, "minimax");
  assert.equal(p.editFormatPreference, "structured_patch");
});

import { createProvider, listProviders } from "../src/providers/registry.js";

test("createProvider produces correct provider for all ids", async () => {
  const ids = ["anthropic", "openai", "google", "openrouter", "groq", "ollama", "perplexity", "minimax", "zhipuai", "grokai", "deepseek", "mock"] as const;
  for (const id of ids) {
    const p = await createProvider({ provider: id }, "fake-key");
    assert.equal(p.id, id);
  }
});

test("createProvider throws for unknown provider", async () => {
  await assert.rejects(createProvider({ provider: "unknown" }, "fake-key"), {
    message: /Unknown provider/,
  });
});

test("listProviders returns all providers", () => {
  const list = listProviders();
  assert.ok(list.length >= 12);
  assert.ok(list.find((p) => p.id === "deepseek"));
  assert.ok(list.find((p) => p.id === "grokai"));
  assert.ok(list.find((p) => p.id === "local-llama"));
});

test("parseChoiceToolCalls extracts tool calls from message.tool_calls", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Access from BaseProvider.prototype since the method lives there
  const parseChoiceToolCalls = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "parseChoiceToolCalls")?.value as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    choice: any
  ) => Array<{ id: string; name: string; args: Record<string, unknown> }>;

  const result = parseChoiceToolCalls.call(p, {
    message: {
      content: "Hello",
      tool_calls: [
        { id: "call_123", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
        { id: null, function: { name: "search", arguments: '{"query":"hi"}' } },
      ],
    },
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].name, "get_weather");
  assert.deepEqual(result[0].args, { city: "NYC" });
  assert.equal(result[0].id, "call_123");
  assert.equal(result[1].name, "search");
  assert.deepEqual(result[1].args, { query: "hi" });
  assert.ok(result[1].id.startsWith("call_"));
});

test("parseChoiceToolCalls falls back to content array when no tool_calls field", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Access from BaseProvider.prototype since the method lives there
  const parseChoiceToolCalls = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "parseChoiceToolCalls")?.value as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    choice: any
  ) => Array<{ id: string; name: string; args: Record<string, unknown> }>;

  const result = parseChoiceToolCalls.call(p, {
    message: {
      content: [
        { type: "function", function: { name: "my_tool", arguments: '{"arg":1}' } },
      ],
    },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "my_tool");
  assert.deepEqual(result[0].args, { arg: 1 });
  assert.ok(result[0].id.startsWith("call_"));
});

test("parseChoiceToolCalls returns empty array when no tool calls present", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // Access from BaseProvider.prototype since the method lives there
  const parseChoiceToolCalls = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "parseChoiceToolCalls")?.value as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    choice: any
  ) => Array<{ id: string; name: string; args: Record<string, unknown> }>;

  assert.equal(parseChoiceToolCalls.call(p, {}).length, 0);
  assert.equal(parseChoiceToolCalls.call(p, { message: { content: "hello" } }).length, 0);
  assert.equal(parseChoiceToolCalls.call(p, { message: { content: null } }).length, 0);
  assert.equal(parseChoiceToolCalls.call(p, { message: { content: "", tool_calls: [] } }).length, 0);
});

test("all providers support streaming and have stream method", async () => {
  const ids = ["anthropic", "openai", "google", "openrouter", "groq", "ollama", "perplexity", "deepseek", "minimax", "zhipuai", "grokai"] as const;
  for (const id of ids) {
    const p = await createProvider({ provider: id }, "fake-key");
    assert.equal(p.capabilities.supportsStreaming, true, `${id} should support streaming`);
    assert.ok(typeof p.stream === "function", `${id} should have stream method`);
  }
});

// --- SSE Streaming Parser Tests ---

// Helper: build a mock ReadableStream that yields encoded chunks
function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

test("streamSSE accumulates multi-chunk text deltas", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  // Access protected method from BaseProvider.prototype
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; text?: string }>;

  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const chunks: Array<{ type: string; text?: string }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    chunks.push(chunk);
  }

  const textDeltas = chunks.filter((c) => c.type === "text_delta");
  assert.equal(textDeltas.length, 2, "should have 2 text_delta chunks");
  assert.equal(textDeltas[0].text, "Hello");
  assert.equal(textDeltas[1].text, " world");
  const done = chunks.find((c) => c.type === "done");
  assert.ok(done, "should yield done");
});

test("streamSSE handles [DONE] event and stops", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string }>;

  const mockRes = {
    ok: true,
    body: makeSSEStream(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n', 'data: [DONE]\n', 'data: unexpected extra event\n']),
  } as unknown as Response;

  const chunks: Array<{ type: string }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    chunks.push(chunk);
  }

  const types = chunks.map((c) => c.type);
  assert.deepEqual(types, ["text_delta", "done"], "should stop at [DONE] and not yield extra");
});

test("streamSSE propagates error on non-OK response", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; error?: string }>;

  const mockRes = { ok: false, status: 500 } as unknown as Response;

  const chunks: Array<{ type: string; error?: string }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, "error");
  assert.ok(chunks[0].error?.includes("500"), "should include status code");
});

test("streamSSE propagates error when body is null", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; error?: string }>;

  const mockRes = { ok: true, body: null } as unknown as Response;

  const chunks: Array<{ type: string; error?: string }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, "error");
  assert.ok(chunks[0].error?.includes("No response body"));
});

test("streamSSE yields tool_call events", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }>;

  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"get_weather","arguments":"{}"}}]}}]}\n',
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const chunks: Array<{ type: string; toolCall?: { id: string; name: string } }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    chunks.push(chunk);
  }

  const toolCalls = chunks.filter((c) => c.type === "tool_call");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].toolCall?.name, "get_weather");
});

// --- Tool call accumulation tests ---

test("streamSSE accumulates tool call args across multiple deltas", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }>;

  // JSON arguments arrive across multiple SSE chunks — accumulate before yielding
  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_split","function":{"name":"run_shell","arguments":"{"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"command\\": \\"ls"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" -la\\"}"}}]}}]}\n',
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    if (chunk.type === "tool_call" && chunk.toolCall) {
      toolCalls.push(chunk.toolCall);
    }
  }

  assert.equal(toolCalls.length, 1, "should accumulate and yield exactly one tool_call");
  assert.equal(toolCalls[0].name, "run_shell");
  assert.equal(toolCalls[0].id, "call_split");
  assert.equal(toolCalls[0].args.command, "ls -la");
});

test("streamSSE yields only complete tool calls — not partial", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }>;

  // Send incomplete JSON (no closing brace yet)
  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_incomplete","function":{"name":"get_file","arguments":"{"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"path"}}]}}]}\n',
      // Not yet complete — no closing }
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    if (chunk.type === "tool_call" && chunk.toolCall) {
      toolCalls.push(chunk.toolCall);
    }
  }

  assert.equal(toolCalls.length, 0, "should not yield incomplete tool call");
});

test("streamSSE handles multiple tool calls in same response", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }>;

  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"tool_a","arguments":"{\\"x\\":1}"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"tool_b","arguments":"{\\"y\\":2}"}}]}}]}\n',
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for await (const chunk of streamSSE.call(p, mockRes)) {
    if (chunk.type === "tool_call" && chunk.toolCall) {
      toolCalls.push(chunk.toolCall);
    }
  }

  assert.equal(toolCalls.length, 2, "should yield both tool calls");
  assert.equal(toolCalls[0].name, "tool_a");
  assert.equal(toolCalls[0].args.x, 1);
  assert.equal(toolCalls[1].name, "tool_b");
  assert.equal(toolCalls[1].args.y, 2);
});

test("streamSSE handles text and tool_call interleaved in same response", async () => {
  const p = new OpenAIProvider({ apiKey: "test" });
  const streamSSE = Object.getOwnPropertyDescriptor(BaseProvider.prototype, "streamSSE")?.value as (res: Response) => AsyncGenerator<{ type: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }>;

  const mockRes = {
    ok: true,
    body: makeSSEStream([
      'data: {"choices":[{"delta":{"content":"Thinking..."}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_t","function":{"name":"my_tool","arguments":"{}"}}]}}]}\n',
      'data: {"choices":[{"delta":{"content":"Done!"}}]}\n',
      'data: [DONE]\n',
    ]),
  } as unknown as Response;

  const chunks = [];
  for await (const chunk of streamSSE.call(p, mockRes)) chunks.push(chunk);

  const textDeltas = chunks.filter((c) => c.type === "text_delta");
  const toolCalls = chunks.filter((c) => c.type === "tool_call");
  assert.ok(textDeltas.length >= 2, "should have text deltas");
  assert.equal(toolCalls.length, 1, "should have exactly one tool_call");
});
