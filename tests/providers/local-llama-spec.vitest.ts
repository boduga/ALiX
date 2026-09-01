import { describe, it, expect } from "vitest";
import { localLlamaSpec } from "../../src/providers/specs/local-llama-spec.js";
import { LocalLlamaProvider } from "../../src/providers/local-llama-provider.js";

describe("localLlamaSpec", () => {
  it("uses llama-server's OpenAI-compat base URL by default", () => {
    expect(localLlamaSpec.baseUrl).toBe("http://localhost:8080/v1/chat/completions");
  });

  it("no auth header (local server)", () => {
    const headers = localLlamaSpec.authHeader("");
    expect(headers).toEqual({});
  });

  describe("toRequestBody with tools", () => {
    it("adds response_format.json_schema when tools provided", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        tools: [{ name: "file.read", description: "x", input_schema: { type: "object", properties: {} } }],
      });
      expect((body as any).response_format).toBeDefined();
      expect((body as any).response_format.type).toBe("json_schema");
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
      expect(schema.properties.name.enum).toEqual(["file.read", "shell.run"]);
      expect(schema.properties.type.enum).toEqual(["text", "tool"]);
    });

    it("no response_format when no tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
      });
      expect((body as any).response_format).toBeUndefined();
    });
  });

  describe("toRequestBody with structuredOutputSchema", () => {
    it("passes through caller structuredOutputSchema when no tools", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        structuredOutputSchema: {
          name: "my_schema",
          properties: { foo: { type: "string" } },
          required: ["foo"],
        },
      });
      expect((body as any).response_format).toBeDefined();
      expect((body as any).response_format.type).toBe("json_schema");
      const schema = (body as any).response_format.json_schema.schema;
      expect((body as any).response_format.json_schema.name).toBe("my_schema");
      expect(schema.properties).toEqual({ foo: { type: "string" } });
      expect(schema.required).toEqual(["foo"]);
    });

    it("caller structuredOutputSchema takes precedence over tool schema when both present", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        tools: [{ name: "file.read", description: "x", input_schema: { type: "object", properties: {} } }],
        structuredOutputSchema: {
          name: "my_schema",
          properties: { bar: { type: "number" } },
          required: ["bar"],
        },
      });
      expect((body as any).response_format).toBeDefined();
      const schema = (body as any).response_format.json_schema.schema;
      expect((body as any).response_format.json_schema.name).toBe("my_schema");
      expect(schema.properties).toEqual({ bar: { type: "number" } });
      expect(schema.required).toEqual(["bar"]);
    });

    it("tools without structuredOutputSchema still uses grammar tool schema", () => {
      const body = localLlamaSpec.toRequestBody({
        systemPrompt: "", messages: [], model: "tinyllama",
        tools: [{ name: "file.read", description: "x", input_schema: { type: "object", properties: {} } }],
      });
      const schema = (body as any).response_format.json_schema.schema;
      expect(schema.properties.name.enum).toEqual(["file.read"]);
      expect(schema.properties.type.enum).toEqual(["text", "tool"]);
    });
  });

  describe("fromResponse (JSON schema format)", () => {
    it("parses text response from json_schema output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: '{"type": "text", "content": "Hi there!"}' } }],
      });
      expect(resp.toolCalls.length).toBe(0);
      expect(resp.text).toBe("Hi there!");
    });

    it("parses tool call from json_schema output", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: '{"type": "tool", "name": "file.read", "arguments": {"path": "src/foo.ts"}}' } }],
      });
      expect(resp.toolCalls.length).toBe(1);
      expect(resp.toolCalls[0].name).toBe("file.read");
    });

    it("treats plain text as text", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "Hi" } }],
      });
      expect(resp.toolCalls.length).toBe(0);
      expect(resp.text).toBe("Hi");
    });

    it("extracts usage when present", () => {
      const resp = localLlamaSpec.fromResponse({
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      expect(resp.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
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
      expect(resp.finishReason).toBe("tool_calls");
    });
  });
});

describe("LocalLlamaProvider capabilities", () => {
  it("advertises supportsStructuredOutput: true", () => {
    const provider = new LocalLlamaProvider();
    expect(provider.capabilities.supportsStructuredOutput).toBe(true);
  });
});
