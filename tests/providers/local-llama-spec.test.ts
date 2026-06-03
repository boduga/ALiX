import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localLlamaSpec } from "../../src/providers/specs/local-llama-spec.js";

describe("localLlamaSpec", () => {
  it("uses llama-server's OpenAI-compat base URL by default", () => {
    assert.equal(localLlamaSpec.baseUrl, "http://localhost:8080/v1/chat/completions");
  });

  it("no auth header (local server)", () => {
    const headers = localLlamaSpec.authHeader("");
    assert.deepEqual(headers, {});
  });

  describe("toRequestBody with tools", () => {
    it("adds response_format.json_schema when tools provided", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        tools: [{ name: "file.read", description: "x", input_schema: { type: "object", properties: {} } }],
      });
      assert.ok((body as any).response_format);
      assert.equal((body as any).response_format.type, "json_schema");
    });

    it("json_schema includes tool name enum", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        tools: [
          { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
          { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
        ],
      });
      const schema = (body as any).response_format.json_schema.schema;
      assert.deepEqual(schema.properties.name.enum, ["file.read", "shell.run"]);
      assert.deepEqual(schema.properties.type.enum, ["text", "tool"]);
    });

    it("no response_format when no tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
      });
      assert.equal((body as any).response_format, undefined);
    });
  });

  describe("fromResponse (JSON schema format)", () => {
    it("parses text response from json_schema output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: '{"type": "text", "content": "Hi there!"}' } }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hi there!");
    });

    it("parses tool call from json_schema output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: '{"type": "tool", "name": "file.read", "arguments": {"path": "src/foo.ts"}}' } }],
      });
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0].name, "file.read");
    });

    it("treats plain text as text", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "Hi" } }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hi");
    });

    it("extracts usage when present", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      assert.deepEqual(resp.usage, { inputTokens: 100, outputTokens: 50 });
    });

    it("finish_reason tool_calls is preserved", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "x", type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }],
          },
          finish_reason: "tool_calls",
        }],
      });
      assert.equal(resp.finishReason, "tool_calls");
    });
  });
});
