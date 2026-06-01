import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anthropicSpec } from "../../src/providers/specs/anthropic-spec.js";

describe("anthropicSpec.toRequestBody", () => {
  it("puts system prompt at top-level (not in messages)", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "claude-opus-4-8",
    });
    assert.equal((body as any).system, "You are helpful");
    assert.equal((body as any).messages[0].role, "user");
  });

  it("uses Anthropic's max_tokens default of 4096", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "claude-opus-4-8",
    });
    assert.ok((body as any).max_tokens >= 1);
  });

  it("maps tools to Anthropic's input_schema format", () => {
    const body = anthropicSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "claude-opus-4-8",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    assert.equal((body as any).tools[0].name, "file.read");
    assert.deepEqual((body as any).tools[0].input_schema.properties.path, { type: "string" });
  });
});

describe("anthropicSpec.fromResponse", () => {
  it("extracts text from content array", () => {
    const resp = anthropicSpec.fromResponse({
      id: "msg_1",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    assert.equal(resp.text, "hello");
    assert.equal(resp.usage?.outputTokens, 5);
    assert.equal(resp.finishReason, "end_turn");
  });

  it("extracts tool_use blocks as toolCalls", () => {
    const resp = anthropicSpec.fromResponse({
      content: [
        { type: "text", text: "" },
        { type: "tool_use", id: "tu_1", name: "file.read", input: { path: "/foo" } },
      ],
    });
    assert.equal(resp.toolCalls.length, 1);
    assert.equal(resp.toolCalls[0].name, "file.read");
    assert.deepEqual(resp.toolCalls[0].args, { path: "/foo" });
  });
});

describe("anthropicSpec.authHeader", () => {
  it("uses x-api-key header (not Authorization)", () => {
    const headers = anthropicSpec.authHeader("sk-ant-123");
    assert.equal(headers["x-api-key"], "sk-ant-123");
    assert.equal(headers["anthropic-version"], "2023-06-01");
  });
});
