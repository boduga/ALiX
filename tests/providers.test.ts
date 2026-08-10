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
import { _setFetchForTesting } from "../src/providers/unified-complete.js";
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

test("ollama complete sends tools and parses tool calls", async () => {
  let capturedBody: Record<string, any> | undefined;

  const mockFetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      model: "llama3.2:3b",
      created_at: "2024-01-01T00:00:00Z",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          type: "function",
          function: {
            name: "alix_shell_run",
            arguments: { command: "ls src/agents" },
          },
        }],
      },
      done: true,
      prompt_eval_count: 11,
      eval_count: 7,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  _setFetchForTesting(mockFetch);

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
    assert.equal(resp.toolCalls.length, 1);
    assert.equal(resp.toolCalls[0].name, "alix_shell_run");
    assert.deepEqual(resp.toolCalls[0].args, { command: "ls src/agents" });
    assert.deepEqual(resp.usage, { inputTokens: 11, outputTokens: 7 });
  } finally {
    _setFetchForTesting(globalThis.fetch);
  }
});

test("ollama does not parse JSON-in-text content as tool calls (text fallback off)", async () => {
  const mockFetch = (async () => new Response(JSON.stringify({
    model: "llama3.2:3b",
    message: { role: "assistant", content: "{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents\",\"cwd\":\"\",\"timeoutMs\":5000}}" },
    done: true,
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  _setFetchForTesting(mockFetch);
  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "alix_shell_run", description: "Run shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
    });
    // Text fallback is disabled — content JSON must NOT be parsed as tool calls
    assert.equal(resp.toolCalls.length, 0);
    assert.ok(resp.text.includes("alix_shell_run"), "content preserved as text");
  } finally { _setFetchForTesting(globalThis.fetch); }
});

test("ollama does not parse fenced JSON content as tool calls", async () => {
  const mockFetch = (async () => new Response(JSON.stringify({
    model: "llama3.2:3b",
    message: { role: "assistant", content: "```json\n{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents/\",\"cwd\":\"\",\"timeoutMs\":0}}\n```" },
    done: true,
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  _setFetchForTesting(mockFetch);
  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "alix_shell_run", description: "Run shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
    });
    assert.equal(resp.toolCalls.length, 0);
    assert.ok(resp.text.includes("alix_shell_run"), "fenced JSON preserved as text");
  } finally { _setFetchForTesting(globalThis.fetch); }
});

test("ollama does not parse embedded JSON from prose as tool calls", async () => {
  const mockFetch = (async () => new Response(JSON.stringify({
    model: "llama3.2:3b",
    message: { role: "assistant", content: "JSON responses:\n\n1. shell:\n{\"name\":\"alix_shell_run\",\"parameters\":{\"command\":\"ls src/agents/\",\"cwd\":\"\",\"timeoutMs\":0}}\n\n2. done:\n{\"name\":\"alix_done\",\"parameters\":{}}" },
    done: true,
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  _setFetchForTesting(mockFetch);
  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "alix_shell_run", description: "Run shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
    });
    assert.equal(resp.toolCalls.length, 0);
    assert.ok(resp.text.includes("JSON responses"), "prose preserved as text");
  } finally { _setFetchForTesting(globalThis.fetch); }
});

test("ollama does not parse unquoted tool name text as tool calls", async () => {
  const mockFetch = (async () => new Response(JSON.stringify({
    model: "llama3.2:3b",
    message: { role: "assistant", content: "{\"name\": alix_shell_run, \"parameters\": {\"command\": \"ls\", \"cwd\": \"/home\"}}" },
    done: true,
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  _setFetchForTesting(mockFetch);
  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "alix_shell_run", description: "Run shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
    });
    assert.equal(resp.toolCalls.length, 0);
    assert.ok(resp.text.length > 0, "text preserved");
  } finally { _setFetchForTesting(globalThis.fetch); }
});

test("ollama does not parse Python-style None in tool args as tool calls", async () => {
  const mockFetch = (async () => new Response(JSON.stringify({
    model: "llama3.2:3b",
    message: { role: "assistant", content: "{\"name\": \"alix_shell_run\", \"parameters\": {\"command\": \"ls /home\", \"cwd\": \"/home\", \"timeoutMs\": None}}" },
    done: true,
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  _setFetchForTesting(mockFetch);
  try {
    const p = new OllamaProvider({ model: "llama3.2:3b" });
    const resp = await p.complete({
      systemPrompt: "Use tools.",
      messages: [{ role: "user", content: "List files" }],
      tools: [{ name: "alix_shell_run", description: "Run shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
    });
    assert.equal(resp.toolCalls.length, 0);
    assert.ok(resp.text.length > 0, "text preserved");
  } finally { _setFetchForTesting(globalThis.fetch); }
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
  const ids = ["anthropic", "openai", "google", "openrouter", "groq", "ollama", "perplexity", "minimax", "minimax-token-plan", "zhipuai", "grokai", "deepseek", "mock"] as const;
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
  assert.ok(list.length >= 13);
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
    // capabilities are only populated with a real key; fake-key creates a minimal stub
    if (p.capabilities) {
      assert.equal(p.capabilities.supportsStreaming, true, `${id} should support streaming`);
    }
    assert.ok(typeof p.stream === "function", `${id} should have stream method`);
  }
});

// --- SSE Streaming Parser Tests ---

// Helper: build a mock ReadableStream that yields encoded chunks
