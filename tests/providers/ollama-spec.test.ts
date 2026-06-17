/**
 * ollama-spec.test.ts — Contract tests for Ollama tool-call parsing and spec
 *
 * Tests the pure parser (ollama-tool-calls.ts) and the spec integration
 * (toRequestBody /api/chat routing, fromResponse parser wiring).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ollamaSpec } from "../../src/providers/specs/ollama-spec.js";
import {
  parseOllamaToolCalls,
  extractOllamaContent,
  extractOllamaUsage,
} from "../../src/providers/specs/ollama-tool-calls.js";

// =========================================================================
// parseOllamaToolCalls — Native /api/chat format
// =========================================================================

test("parseOllamaToolCalls: native single tool call", () => {
  const calls = parseOllamaToolCalls({
    model: "llama3.2",
    created_at: "2024-01-01T00:00:00Z",
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{
        type: "function",
        function: { name: "alix_shell_run", arguments: { command: "ls src/agents", cwd: "", timeoutMs: 5000 } },
      }],
    },
    done: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "alix_shell_run");
  assert.deepEqual(calls[0].args, { command: "ls src/agents", cwd: "", timeoutMs: 5000 });
  assert.ok(calls[0].id.startsWith("ollama_call_0_"));
});

test("parseOllamaToolCalls: native parallel tool calls", () => {
  const calls = parseOllamaToolCalls({
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        { type: "function", function: { name: "read_file", arguments: { path: "a.txt" } } },
        { type: "function", function: { name: "write_file", arguments: { path: "b.txt", content: "data" } } },
        { type: "function", function: { name: "shell_run", arguments: { command: "ls" } } },
      ],
    },
    done: true,
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].name, "read_file");
  assert.equal(calls[1].name, "write_file");
  assert.equal(calls[2].name, "shell_run");
  // IDs are deterministic — verify stability, not exact value
  assert.ok(calls[0].id.startsWith("ollama_call_0_"));
  assert.ok(calls[1].id.startsWith("ollama_call_1_"));
  assert.ok(calls[2].id.startsWith("ollama_call_2_"));
  // Same input produces same IDs
  const second = parseOllamaToolCalls({
    message: { role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "read_file", arguments: { path: "a.txt" } } }] },
  });
  assert.equal(second[0].id, "ollama_call_0_1p3se52");
});

test("parseOllamaToolCalls: native arguments already as object", () => {
  const calls = parseOllamaToolCalls({
    message: {
      role: "assistant",
      tool_calls: [{ function: { name: "read_file", arguments: { filename: "data.csv" } } }],
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.filename, "data.csv");
});

test("parseOllamaToolCalls: native arguments as JSON string", () => {
  const calls = parseOllamaToolCalls({
    message: {
      role: "assistant",
      tool_calls: [{
        function: { name: "search_web", arguments: JSON.stringify({ query: "latest news", maxResults: 5 }) },
      }],
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "search_web");
  assert.equal(calls[0].args.query, "latest news");
});

test("parseOllamaToolCalls: native content plus tool calls preserved", () => {
  const text = extractOllamaContent({
    message: { role: "assistant", content: "I'll look that up.", tool_calls: [{ function: { name: "search", arguments: { q: "hello" } } }] },
  });
  assert.equal(text, "I'll look that up.");

  const calls = parseOllamaToolCalls({
    message: { role: "assistant", content: "I'll look that up.", tool_calls: [{ function: { name: "search", arguments: { q: "hello" } } }] },
  });
  assert.equal(calls.length, 1);
});

test("parseOllamaToolCalls: native empty tool_calls returns []", () => {
  assert.equal(parseOllamaToolCalls({ message: { role: "assistant", content: "Hi", tool_calls: [] } }).length, 0);
});

test("parseOllamaToolCalls: native missing message returns []", () => {
  assert.equal(parseOllamaToolCalls({ done: true }).length, 0);
});

test("parseOllamaToolCalls: blank function name returns []", () => {
  assert.equal(parseOllamaToolCalls({
    message: { role: "assistant", tool_calls: [{ function: { name: "", arguments: {} } }, { function: { name: "  ", arguments: {} } }] },
  }).length, 0);
});

// =========================================================================
// parseOllamaToolCalls — Edge cases and security
// =========================================================================

test("parseOllamaToolCalls: arguments array/null/primitive rejected", () => {
  assert.equal(parseOllamaToolCalls({
    message: { tool_calls: [
      { function: { name: "t1", arguments: [1, 2, 3] } },
      { function: { name: "t2", arguments: null } },
      { function: { name: "t3", arguments: 42 } },
    ]},
  }).length, 0);
});

test("parseOllamaToolCalls: call-count limit enforced", () => {
  const calls = parseOllamaToolCalls(
    { message: { tool_calls: Array.from({ length: 50 }, (_, i) => ({ function: { name: `t_${i}`, arguments: { i } } })) } },
    { maxToolCalls: 4 },
  );
  assert.equal(calls.length, 4);
});

test("parseOllamaToolCalls: argument-size limit enforced", () => {
  const calls = parseOllamaToolCalls(
    { message: { tool_calls: [{ function: { name: "big", arguments: JSON.stringify({ data: "x".repeat(100_000) }) } }] } },
    { maxArgumentBytes: 1000 },
  );
  assert.equal(calls.length, 0);
});

test("parseOllamaToolCalls: prototype-pollution keys stripped", () => {
  const calls = parseOllamaToolCalls({
    message: { tool_calls: [{ function: { name: "exploit", arguments: { __proto__: { admin: true }, command: "ls", prototype: { x: 1 } } } }] },
  });
  assert.equal(calls.length, 1);
  // Own properties — __proto__ and prototype should be filtered out
  assert.equal(Object.hasOwn(calls[0].args, "__proto__"), false);
  assert.equal(Object.hasOwn(calls[0].args, "prototype"), false);
  assert.equal(calls[0].args.command, "ls");
});

test("parseOllamaToolCalls: deterministic IDs stable across calls", () => {
  const resp = { message: { tool_calls: [{ function: { name: "stable", arguments: { k: "v" } } }] } };
  assert.equal(parseOllamaToolCalls(resp)[0].id, parseOllamaToolCalls(resp)[0].id);
});

test("parseOllamaToolCalls: parser never throws", () => {
  for (const input of [null, undefined, "s", 42, [], true, {}, { message: "no calls" }, { message: { tool_calls: [null, "s", 42] } }, { message: { tool_calls: [{ function: null }] } }, { message: { tool_calls: [{ function: { name: 42 } }] } }]) {
    assert.doesNotThrow(() => parseOllamaToolCalls(input));
  }
});

// =========================================================================
// parseOllamaToolCalls — OpenAI-compatible format
// =========================================================================

test("parseOllamaToolCalls: OpenAI-compatible tool_calls", () => {
  const calls = parseOllamaToolCalls({
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_abc", type: "function", function: { name: "shell_run", arguments: '{"cmd":"ls"}' } }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "call_abc");
  assert.equal(calls[0].name, "shell_run");
  assert.deepEqual(calls[0].args, { cmd: "ls" });
});

test("parseOllamaToolCalls: OpenAI-compatible no tool_calls returns []", () => {
  assert.equal(parseOllamaToolCalls({ choices: [{ message: { content: "Hi" } }] }).length, 0);
});

// =========================================================================
// parseOllamaToolCalls — Textual envelope (strict, opt-in)
// =========================================================================

test("parseOllamaToolCalls: strict textual envelope accepted when opt-in", () => {
  const calls = parseOllamaToolCalls({ tool_calls: [{ name: "read_file", arguments: { path: "README.md" } }] }, { allowTextFallback: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "read_file");
});

test("parseOllamaToolCalls: textual envelope rejected when opt-out", () => {
  assert.equal(parseOllamaToolCalls({ tool_calls: [{ name: "read_file", arguments: { path: "x" } }] }).length, 0);
});

test("parseOllamaToolCalls: arbitrary JSON prose never parsed as calls", () => {
  assert.equal(parseOllamaToolCalls({ response: '{"name":"shell","arguments":{"cmd":"rm"}}' }, { allowTextFallback: true }).length, 0);
});

test("parseOllamaToolCalls: textual envelope empty calls returns []", () => {
  assert.equal(parseOllamaToolCalls({ tool_calls: [] }, { allowTextFallback: true }).length, 0);
});

// =========================================================================
// extractOllamaContent
// =========================================================================

test("extractOllamaContent: /api/generate response", () => {
  assert.equal(extractOllamaContent({ response: "Hello", done: true }), "Hello");
});

test("extractOllamaContent: /api/chat response", () => {
  assert.equal(extractOllamaContent({ message: { role: "assistant", content: "Hi!" } }), "Hi!");
});

test("extractOllamaContent: OpenAI-compatible response", () => {
  assert.equal(extractOllamaContent({ choices: [{ message: { content: "Hello" } }] }), "Hello");
});

test("extractOllamaContent: null/undefined/empty returns ''", () => {
  assert.equal(extractOllamaContent(null), "");
  assert.equal(extractOllamaContent(undefined), "");
  assert.equal(extractOllamaContent({}), "");
});

// =========================================================================
// extractOllamaUsage
// =========================================================================

test("extractOllamaUsage: native format", () => {
  assert.deepEqual(extractOllamaUsage({ prompt_eval_count: 10, eval_count: 25 }), { inputTokens: 10, outputTokens: 25 });
});

test("extractOllamaUsage: OpenAI-compatible format", () => {
  assert.deepEqual(extractOllamaUsage({ usage: { prompt_tokens: 11, completion_tokens: 7 } }), { inputTokens: 11, outputTokens: 7 });
});

test("extractOllamaUsage: missing returns undefined", () => {
  assert.equal(extractOllamaUsage({}), undefined);
});

// =========================================================================
// ollamaSpec.toRequestBody — /api/chat routing
// =========================================================================

test("ollamaSpec.toRequestBody: routes to /api/chat format when tools present", () => {
  const body: any = ollamaSpec.toRequestBody({
    model: "llama3.2",
    systemPrompt: "Use tools.",
    messages: [{ role: "user", content: "List files" }],
    tools: [{ name: "alix_shell_run", description: "Run a command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }],
  });

  assert.ok(body.messages, "should use messages format");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[0].content, "Use tools.");
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages[1].content, "List files");
  assert.ok(body.tools, "should include tools array");
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].function.name, "alix_shell_run");
  assert.equal(body.prompt, undefined);
});

test("ollamaSpec.toRequestBody: uses /api/generate format when no tools", () => {
  const body: any = ollamaSpec.toRequestBody({
    model: "llama3.2",
    systemPrompt: "Be helpful.",
    messages: [{ role: "user", content: "Say hello" }],
  });

  assert.equal(body.prompt, "Say hello");
  assert.equal(body.system, "Be helpful.");
  assert.equal(body.messages, undefined);
  assert.equal(body.tools, undefined);
});

// =========================================================================
// ollamaSpec.fromResponse — Parser integration
// =========================================================================

test("ollamaSpec.fromResponse: native /api/chat with tool calls", () => {
  const resp = ollamaSpec.fromResponse({
    message: { role: "assistant", content: "", tool_calls: [{ function: { name: "alix_shell_run", arguments: { command: "ls", cwd: "/home" } } }] },
    done: true,
    prompt_eval_count: 10,
    eval_count: 5,
  });

  assert.equal(resp.text, "");
  assert.equal(resp.toolCalls.length, 1);
  assert.equal(resp.toolCalls[0].name, "alix_shell_run");
  assert.equal(resp.toolCalls[0].args.command, "ls");
  assert.deepEqual(resp.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(resp.finishReason, "tool_call");
});

test("ollamaSpec.fromResponse: /api/generate text-only", () => {
  const resp = ollamaSpec.fromResponse({ response: "Hello!", done: true, prompt_eval_count: 5, eval_count: 10 });
  assert.equal(resp.text, "Hello!");
  assert.equal(resp.toolCalls.length, 0);
  assert.deepEqual(resp.usage, { inputTokens: 5, outputTokens: 10 });
  assert.equal(resp.finishReason, "stop");
});

test("ollamaSpec.fromResponse: OpenAI-compatible tool calls", () => {
  const resp = ollamaSpec.fromResponse({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_xyz", type: "function", function: { name: "web_fetch", arguments: '{"url":"https://example.com"}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });

  assert.equal(resp.text, "");
  assert.equal(resp.toolCalls.length, 1);
  assert.equal(resp.toolCalls[0].id, "call_xyz");
  assert.equal(resp.toolCalls[0].name, "web_fetch");
  assert.equal(resp.toolCalls[0].args.url, "https://example.com");
  assert.deepEqual(resp.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(resp.finishReason, "tool_call");
});

// =========================================================================
// Streaming boundary (P4.1c)
// =========================================================================

test("streaming tool call support is deferred to P4.1c", () => {
  const chunk = ollamaSpec.fromStreamChunk(JSON.stringify({
    message: { role: "assistant", content: "checking", tool_calls: [{ function: { name: "test", arguments: {} } }] },
  }));
  if (chunk) {
    assert.notEqual(chunk.type, "tool_call", "streaming tool_call chunks deferred to P4.1c");
  }
});

// =========================================================================
// Spec contract
// =========================================================================

test("ollamaSpec declares toolCallUrl as /api/chat", () => {
  assert.equal(ollamaSpec.baseUrl, "http://localhost:11434/api/generate");
  assert.equal(ollamaSpec.toolCallUrl, "http://localhost:11434/api/chat");
});

test("ollamaSpec.authHeader returns empty headers", () => {
  assert.deepEqual(ollamaSpec.authHeader(""), {});
  assert.deepEqual(ollamaSpec.authHeader("some-key"), {});
});
