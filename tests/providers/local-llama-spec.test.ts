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
    it("uses native OpenAI tools format when tools provided", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "You are helpful",
        messages: [{ role: "user", content: "read foo.ts" }],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
        ],
      });
      assert.ok((body as any).tools, "tools should be present");
      assert.equal((body as any).tools[0].type, "function");
      assert.equal((body as any).tools[0].function.name, "file.read");
    });

    it("includes multiple tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
        tools: [
          { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
          { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
        ],
      });
      assert.equal((body as any).tools.length, 2);
      assert.equal((body as any).tools[1].function.name, "shell.run");
    });

    it("no tools field when no tools provided", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "",
        messages: [],
        model: "tinyllama",
      });
      assert.equal((body as any).tools, undefined);
    });
  });

  describe("fromResponse with native tool calls", () => {
    it("parses native OpenAI tool_calls from response (--jinja mode)", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "file.read", arguments: '{"path":"src/foo.ts"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0].name, "file.read");
      assert.deepEqual(resp.toolCalls[0].args, { path: "src/foo.ts" });
      assert.equal(resp.text, "");
    });

    it("parses multiple tool calls", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: {
            tool_calls: [
              { id: "c1", type: "function", function: { name: "file.read", arguments: '{"path":"a.ts"}' } },
              { id: "c2", type: "function", function: { name: "file.read", arguments: '{"path":"b.ts"}' } },
            ],
          },
        }],
      });
      assert.equal(resp.toolCalls.length, 2);
    });

    it("returns text content when no tool_calls in response", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: "Hello, I can help with that." },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hello, I can help with that.");
    });
  });

  describe("fromResponse legacy fallback (JSON schema format)", () => {
    it("parses JSON tool call from model output (legacy)", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: '{"type": "tool", "name": "file.read", "arguments": {"path": "src/foo.ts"}}' },
        }],
      });
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0].name, "file.read");
    });

    it("parses text response from JSON schema format (legacy)", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{
          message: { content: '{"type": "text", "content": "The answer is 42."}' },
        }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "The answer is 42.");
    });

    it("treats plain text as text response", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "Hi there" } }],
      });
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.text, "Hi there");
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
