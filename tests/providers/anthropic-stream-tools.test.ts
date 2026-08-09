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

// ── SSE fixture builders ────────────────────────────────────────────────
// Anthropic SSE events, JSON-escaped through JSON.stringify so fixtures read
// at their logical level instead of carrying backslash soup.

const toolUseStart = (index: number, id: string, name: string) =>
  `data: ${JSON.stringify({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } })}`;
const inputDelta = (index: number, json: string) =>
  `data: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } })}`;
const blockStop = (index: number) =>
  `data: ${JSON.stringify({ type: "content_block_stop", index })}`;
const textStart = (index: number) =>
  `data: ${JSON.stringify({ type: "content_block_start", index, content_block: { type: "text", text: "" } })}`;
const textDelta = (index: number, text: string) =>
  `data: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "text_delta", text } })}`;
const messageStop = () => `data: ${JSON.stringify({ type: "message_stop" })}`;

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
    toolUseStart(1, "call_1", "alix_shell_run"),
    inputDelta(1, '{"command":"which llama-cli"}'),
    blockStop(1),
    messageStop(),
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1, "exactly one tool call — no premature empty-args emission");
  assert.equal(calls[0].id, "call_1");
  assert.equal(calls[0].name, "alix_shell_run");
  assert.deepEqual(calls[0].args, { command: "which llama-cli" });
});

test("JSON arguments split across arbitrary partial_json boundaries", async () => {
  const chunks = await collectStream([
    toolUseStart(1, "call_1", "alix_shell_run"),
    inputDelta(1, '{"comm'),
    inputDelta(1, 'and":"echo h'),
    inputDelta(1, 'ello"}'),
    blockStop(1),
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { command: "echo hello" });
});

test("multiple tool calls in one response are keyed by content-block index", async () => {
  const chunks = await collectStream([
    toolUseStart(1, "call_a", "alix_file_read"),
    inputDelta(1, '{"path":"a.txt"}'),
    blockStop(1),
    toolUseStart(2, "call_b", "alix_shell_run"),
    inputDelta(2, '{"command":"ls -la"}'),
    blockStop(2),
    messageStop(),
  ]);

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.id), ["call_a", "call_b"]);
  assert.deepEqual(calls[0].args, { path: "a.txt" });
  assert.deepEqual(calls[1].args, { command: "ls -la" });
});

test("text deltas interleave with tool calls unchanged", async () => {
  const chunks = await collectStream([
    textStart(0),
    textDelta(0, "I'll check."),
    blockStop(0),
    toolUseStart(1, "call_1", "alix_shell_run"),
    inputDelta(1, '{"command":"which llama-cli"}'),
    blockStop(1),
    messageStop(),
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
    toolUseStart(1, "call_1", "alix_shell_run"),
    inputDelta(1, '{"command":'),
    blockStop(1),
  ]);

  const errors = chunks.filter((c) => c.type === "error");
  assert.equal(errors.length, 1, "expected a stream error chunk");
  assert.match((errors[0] as { error: string }).error, /Failed to parse streamed tool arguments/);
  assert.equal(toolCallsOf(chunks).length, 0, "no tool call with manufactured empty args");
});

test("valid non-object arguments yield a stream error, not a manufactured {}", async () => {
  const chunks = await collectStream([
    toolUseStart(1, "call_1", "alix_shell_run"),
    inputDelta(1, "[1,2,3]"),
    blockStop(1),
  ]);

  const errors = chunks.filter((c) => c.type === "error");
  assert.equal(errors.length, 1, "expected a stream error chunk");
  assert.match((errors[0] as { error: string }).error, /must be a JSON object/);
  assert.equal(toolCallsOf(chunks).length, 0, "no tool call with manufactured empty args");
});

test("tool_use with no argument fragments preserves {} (legitimate empty args)", async () => {
  const chunks = await collectStream([
    toolUseStart(1, "call_1", "alix_done"),
    blockStop(1),
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
      toolUseStart(1, "call_mm", "alix_shell_run"),
      inputDelta(1, '{"command":"which llama-cli 2>/dev/null; ls /usr/local/bin/llama'),
      inputDelta(1, '* 2>/dev/null"}'),
      blockStop(1),
      messageStop(),
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
