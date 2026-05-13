import test from "node:test";
import assert from "node:assert/strict";

test("StreamChunk union covers all variants", () => {
  const chunk1: import("../src/providers/types.js").StreamChunk = { type: "text_delta", text: "hello" };
  const chunk2: import("../src/providers/types.js").StreamChunk = { type: "tool_call", toolCall: { id: "1", name: "foo", args: {} } };
  const chunk3: import("../src/providers/types.js").StreamChunk = { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
  const chunk4: import("../src/providers/types.js").StreamChunk = { type: "done" };
  const chunk5: import("../src/providers/types.js").StreamChunk = { type: "error", error: "fail" };
  assert.equal(chunk1.type, "text_delta");
  assert.equal(chunk5.type, "error");
});

test("TokenUsage has input/output fields", () => {
  const usage: import("../src/providers/types.js").TokenUsage = { inputTokens: 100, outputTokens: 50 };
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
});

test("NormalizedRequest supports toolResults", () => {
  const req: import("../src/providers/types.js").NormalizedRequest = {
    systemPrompt: "act",
    messages: [{ role: "user", content: "hello" }],
    toolResults: [{ toolUseId: "1", content: "result" }]
  };
  assert.equal(req.toolResults?.length, 1);
});

test("NegotiatedCapabilities has all fields", () => {
  const caps: import("../src/providers/types.js").NegotiatedCapabilities = {
    contextBudget: 100000,
    outputBudget: 4096,
    editFormat: "search_replace",
    toolsEnabled: true,
    structuredOutputEnabled: false,
    visionEnabled: true
  };
  assert.equal(caps.editFormat, "search_replace");
});

test("ModelAdapter optionally has stream and negotiate", () => {
  const adapter: import("../src/providers/types.js").ModelAdapter = {
    id: "test",
    capabilities: { provider: "test", model: "t1", inputTokenLimit: 1000, outputTokenLimit: 100, supportsTools: false, supportsStreaming: false, supportsStructuredOutput: false, supportsVision: false },
    editFormatPreference: "search_replace",
    longContextStrategy: "trimmed_context",
    complete: async () => ({ text: "", toolCalls: [] })
  };
  assert.ok(adapter.complete);
});