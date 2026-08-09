/**
 * anthropic-stream-tools.test.ts — Regression coverage for Anthropic-format
 * streamed tool-call argument accumulation (content_block_start →
 * input_json_delta → content_block_stop).
 *
 * MiniMax and Anthropic stream tool arguments as `input_json_delta` fragments;
 * the `content_block_start` event only carries `input: {}` (arguments are
 * explicitly incomplete at that point). The orchestration-layer accumulator in
 * unified-complete.ts reconstructs args from the fragments — these tests cover
 * the full stream path the TUI consumes, not fromStreamChunk directly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { stream, complete, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import type { StreamChunk, ToolCall, ToolDef } from "../../src/providers/types.js";

// ── SSE mock helpers ─────────────────────────────────────────────────────

function sseResponse(lines: string[]): Response {
  const body = new TextEncoder().encode(lines.join("\n") + "\n");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const tools: ToolDef[] = [
  {
    name: "alix_shell_run",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to execute." } },
      required: ["command"],
    },
  },
];

async function collectStream(lines: string[], provider = "anthropic", model = "claude-opus-4-8"): Promise<StreamChunk[]> {
  const original = globalThis.fetch;
  _setFetchForTesting(async () => sseResponse(lines));
  try {
    const chunks: StreamChunk[] = [];
    for await (const c of stream(provider, model, {
      systemPrompt: "",
      messages: [{ role: "user", content: "is llama.cpp installed?" }],
      stream: true,
      tools,
    })) {
      chunks.push(c);
    }
    return chunks;
  } finally {
    _setFetchForTesting(original);
  }
}

const toolCallsOf = (chunks: StreamChunk[]): ToolCall[] =>
  chunks
    .filter((c) => c.type === "tool_call")
    .map((c) => (c as { type: "tool_call"; toolCall: ToolCall }).toolCall);

// ── Tests ────────────────────────────────────────────────────────────────

test("single streamed Anthropic tool call reconstructs args", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"alix_shell_run","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"which llama-cli\\"}"}}',
    'data: {"type":"content_block_stop","index":1}',
    'data: {"type":"message_stop"}',
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1, "exactly one tool call — no premature empty-args emission");
  assert.equal(calls[0].id, "call_1");
  assert.equal(calls[0].name, "alix_shell_run");
  assert.deepEqual(calls[0].args, { command: "which llama-cli" });
});

test("JSON arguments split across arbitrary partial_json boundaries", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"alix_shell_run","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"comm"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"and\\":\\"echo h"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"ello\\"}"}}',
    'data: {"type":"content_block_stop","index":1}',
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { command: "echo hello" });
});

test("multiple tool calls in one response are keyed by content-block index", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_a","name":"alix_file_read","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}',
    'data: {"type":"content_block_stop","index":1}',
    'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call_b","name":"alix_shell_run","input":{}}}',
    'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls -la\\"}"}}',
    'data: {"type":"content_block_stop","index":2}',
    'data: {"type":"message_stop"}',
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.id), ["call_a", "call_b"]);
  assert.deepEqual(calls[0].args, { path: "a.txt" });
  assert.deepEqual(calls[1].args, { command: "ls -la" });
});

test("text deltas interleave with tool calls unchanged", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I\\u0027ll check."}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"alix_shell_run","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"which llama-cli\\"}"}}',
    'data: {"type":"content_block_stop","index":1}',
    'data: {"type":"message_stop"}',
  ]);

  const text = chunks
    .filter((c) => c.type === "text_delta")
    .map((c) => (c as { type: "text_delta"; text: string }).text)
    .join("");
  assert.equal(text, "I'll check.");

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { command: "which llama-cli" });

  // text block (index 0) must precede the tool block (index 1)
  const firstTextIdx = chunks.findIndex((c) => c.type === "text_delta");
  const firstToolIdx = chunks.findIndex((c) => c.type === "tool_call");
  assert.ok(firstTextIdx >= 0 && firstToolIdx >= 0 && firstTextIdx < firstToolIdx, "text arrives before tool call");
});

test("malformed accumulated JSON yields a stream error, not a manufactured {}", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"alix_shell_run","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}',
    'data: {"type":"content_block_stop","index":1}',
  ]);

  const errors = chunks.filter((c) => c.type === "error");
  assert.equal(errors.length, 1, "expected a stream error chunk");
  assert.match((errors[0] as { error: string }).error, /Failed to parse streamed tool arguments/);
  assert.equal(toolCallsOf(chunks).length, 0, "no tool call with manufactured empty args");
});

test("tool_use with no argument fragments preserves {} (legitimate empty args)", async () => {
  const chunks = await collectStream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"alix_done","input":{}}}',
    'data: {"type":"content_block_stop","index":1}',
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, {});
});

test("non-streaming Anthropic complete() still returns full tool args", async () => {
  const original = globalThis.fetch;
  _setFetchForTesting(async () => {
    return new Response(
      JSON.stringify({
        content: [
          { type: "text", text: "ok" },
          { type: "tool_use", id: "call_1", name: "alix_shell_run", input: { command: "ls -la" } },
        ],
        stop_reason: "tool_use",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  try {
    const resp = await complete("anthropic", "claude-opus-4-8", {
      systemPrompt: "",
      messages: [{ role: "user", content: "list files" }],
      tools,
    });
    assert.equal(resp.text, "ok");
    assert.equal(resp.toolCalls.length, 1);
    assert.deepEqual(resp.toolCalls[0].args, { command: "ls -la" });
  } finally {
    _setFetchForTesting(original);
  }
});

test("MiniMax regression: content_block_start({}) + input_json_delta reconstructs args.command", async () => {
  const chunks = await collectStream(
    [
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_mm","name":"alix_shell_run","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"which llama-cli 2>/dev/null; ls /usr/local/bin/llama"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"* 2>/dev/null\\"}"}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"message_stop"}',
    ],
    "minimax-token-plan",
    "MiniMax-M3",
  );

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "alix_shell_run");
  assert.equal(
    calls[0].args.command,
    "which llama-cli 2>/dev/null; ls /usr/local/bin/llama* 2>/dev/null",
    "streamed MiniMax tool arguments must be reconstructed, not {}",
  );
});
