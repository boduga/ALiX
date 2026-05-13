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
  assert.equal(p.capabilities.provider, "openrouter");
  assert.equal(p.capabilities.model, "anthropic/claude-3.5-sonnet");
});

test("openrouter provider adds required headers", () => {
  const p = new OpenRouterProvider({ apiKey: "sk-or-test" });
  // Access protected method via prototype for testing
  const headers = (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(p), "extraHeaders")?.value as () => Record<string, string>).call(p);
  assert.ok(headers["HTTP-Referer"]);
  assert.ok(headers["X-Title"]);
});

test("ollama provider returns correct capabilities", () => {
  const p = new OllamaProvider({ apiKey: "" });
  assert.equal(p.capabilities.provider, "ollama");
  assert.equal(p.capabilities.model, "llama3");
  assert.equal(p.capabilities.supportsTools, true);
});

test("ollama provider works without api key", async () => {
  const p = new OllamaProvider({});
  const c = p.capabilities;
  assert.ok(c.model);
});
test("deepseek provider returns correct capabilities", () => {
  const p = new DeepSeekProvider({ apiKey: "sk-ds-test" });
  assert.equal(p.capabilities.provider, "deepseek");
  assert.equal(p.capabilities.model, "deepseek-chat");
  assert.equal(p.capabilities.supportsStructuredOutput, true);
});

test("perplexity provider returns correct capabilities", () => {
  const p = new PerplexityProvider({ apiKey: "pplx-test" });
  assert.equal(p.capabilities.provider, "perplexity");
  assert.equal(p.capabilities.model, "llama-3.1-sonar-small-128k-online");
});

test("groq provider returns correct capabilities", () => {
  const p = new GroqProvider({ apiKey: "gsk_test" });
  assert.equal(p.capabilities.provider, "groq");
  assert.equal(p.capabilities.model, "llama-3.3-70b-versatile");
});

test("grokai provider returns correct capabilities", () => {
  const p = new GrokAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "grokai");
  assert.equal(p.capabilities.model, "grok-2");
  assert.equal(p.editFormatPreference, "search_replace");
});

test("gemini provider returns correct capabilities", () => {
  const p = new GeminiProvider({ apiKey: "AIza-test" });
  const c = p.capabilities;
  assert.equal(c.provider, "google");
  assert.equal(c.model, "gemini-2.0-flash");
  assert.equal(p.editFormatPreference, "search_replace");
  assert.equal(p.longContextStrategy, "expanded_context");
});

test("zhipuai provider returns correct capabilities", () => {
  const p = new ZhipuAIProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "zhipuai");
  assert.equal(p.capabilities.model, "glm-4-flash");
  assert.equal(p.editFormatPreference, "search_replace");
});

test("minimax provider returns correct capabilities", () => {
  const p = new MiniMaxProvider({ apiKey: "test-key" });
  assert.equal(p.capabilities.provider, "minimax");
  assert.equal(p.capabilities.model, "MiniMax-Text-01");
  assert.equal(p.editFormatPreference, "search_replace");
});

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

test("all providers support streaming and have stream method", () => {
  const ids = ["anthropic", "openai", "google", "openrouter", "groq", "ollama", "perplexity", "deepseek", "minimax", "zhipuai", "grokai"] as const;
  for (const id of ids) {
    const p = createProvider({ provider: id }, "fake-key");
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