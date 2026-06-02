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
        systemPrompt: "You are helpful",
        messages: [{ role: "user", content: "read foo.ts" }],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
        ],
      });
      assert.ok((body as any).response_format);
      assert.equal((body as any).response_format.type, "json_schema");
      assert.ok((body as any).response_format.json_schema);
    });

    it("json_schema includes tool name enum", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
          { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
        ],
      });
      const schema = (body as any).response_format.json_schema.schema;
      assert.deepEqual(schema.properties.name.enum, ["file.read", "shell.run"]);
    });

    it("no response_format when no tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
      });
      assert.equal((body as any).response_format, undefined);
    });
  });

  describe("fromResponse", () => {
    it("parses JSON tool call from model output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: {
            content: '{"name": "file.read", "arguments": {"path": "src/foo.ts"}}',
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0].name, "file.read");
      assert.deepEqual(resp.toolCalls[0].args, { path: "src/foo.ts" });
      assert.equal(resp.text, "");
    });

    it("treats plain text as text response (not tool call)", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: "Hello, how can I help?" },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hello, how can I help?");
    });

    it("handles invalid JSON gracefully", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: "{invalid json" },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "{invalid json");
    });

    it("extracts usage when present", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      assert.deepEqual(resp.usage, { inputTokens: 100, outputTokens: 50 });
    });
  });
});