// tests/contracts/llm-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolCallSchema,
  TokenUsageSchema,
  NormalizedResponseSchema,
  NormalizedMessageSchema,
  NormalizedRequestSchema,
  StreamChunkSchema,
} from "../../src/contracts/llm-schemas.js";

describe("ToolCallSchema", () => {
  it("decodes a valid tool call", () => {
    const tc = Schema.decodeSync(ToolCallSchema)({
      id: "call-1",
      name: "file.read",
      args: { path: "/tmp/test.txt" },
    } as any);
    assert.strictEqual(tc.id, "call-1");
    assert.strictEqual(tc.name, "file.read");
  });

  it("rejects missing id", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolCallSchema)({
        name: "file.read",
        args: {},
      } as any)
    );
  });
});

describe("TokenUsageSchema", () => {
  it("decodes token usage", () => {
    const tu = Schema.decodeSync(TokenUsageSchema)({
      inputTokens: 100,
      outputTokens: 50,
    } as any);
    assert.strictEqual(tu.inputTokens, 100);
  });
});

describe("NormalizedResponseSchema", () => {
  it("decodes a response with tool calls", () => {
    const resp = Schema.decodeSync(NormalizedResponseSchema)({
      text: "Here you go",
      toolCalls: [
        { id: "tc-1", name: "file.read", args: { path: "x" } },
      ],
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "tool_use",
    } as any);
    assert.strictEqual(resp.text, "Here you go");
    assert.strictEqual(resp.toolCalls.length, 1);
    assert.strictEqual(resp.finishReason, "tool_use");
  });

  it("decodes a response without optional fields", () => {
    const resp = Schema.decodeSync(NormalizedResponseSchema)({
      text: "Hello",
      toolCalls: [],
    } as any);
    assert.strictEqual(resp.text, "Hello");
    assert.strictEqual(resp.usage, undefined);
  });
});

describe("NormalizedMessageSchema", () => {
  it("decodes a simple text message", () => {
    const msg = Schema.decodeSync(NormalizedMessageSchema)({
      role: "user",
      content: "Hello",
    } as any);
    assert.strictEqual(msg.role, "user");
  });

  it("decodes a message with content parts", () => {
    const msg = Schema.decodeSync(NormalizedMessageSchema)({
      role: "user",
      content: [
        { type: "text", text: "What's in this image?" },
        { type: "image", source: "data:image/png;base64,..." },
      ],
    } as any);
    assert.strictEqual(msg.role, "user");
    assert.strictEqual(Array.isArray(msg.content), true);
  });
});

describe("NormalizedRequestSchema", () => {
  it("decodes with ToolDef in tools array", () => {
    const req = Schema.decodeSync(NormalizedRequestSchema)({
      systemPrompt: "You are a helpful assistant",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          name: "file.read",
          description: "Read a file",
          input_schema: { type: "object", properties: {}, required: [] },
        },
      ],
    } as any);
    assert.strictEqual(req.tools?.length, 1);
  });

  it("decodes with DeferredToolEntry in tools array", () => {
    const req = Schema.decodeSync(NormalizedRequestSchema)({
      systemPrompt: "You are a helpful assistant",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          name: "mcp_github_repos_list",
          execName: "mcp.github.repos.list",
          serverName: "github",
          toolName: "repos_list",
          description: "List repositories",
        },
      ],
    } as any);
    assert.strictEqual((req as any).tools[0].execName, "mcp.github.repos.list");
  });

  it("decodes with toolResults", () => {
    const req = Schema.decodeSync(NormalizedRequestSchema)({
      systemPrompt: "Continue",
      messages: [{ role: "user", content: "Do it" }],
      toolResults: [{ toolUseId: "tu-1", content: "Done" }],
    } as any);
    assert.strictEqual(req.toolResults?.length, 1);
  });

  it("rejects tool with neither ToolDef nor DeferredToolEntry shape", () => {
    assert.throws(() =>
      Schema.decodeSync(NormalizedRequestSchema)({
        systemPrompt: "X",
        messages: [],
        tools: [{ notATool: true }],
      } as any)
    );
  });
});

describe("StreamChunkSchema", () => {
  it("decodes text_delta", () => {
    const chunk = Schema.decodeSync(StreamChunkSchema)({
      type: "text_delta", text: "Hello",
    } as any);
    assert.strictEqual(chunk.type, "text_delta");
  });

  it("decodes tool_call", () => {
    const chunk = Schema.decodeSync(StreamChunkSchema)({
      type: "tool_call",
      toolCall: { id: "tc-1", name: "file.read", args: { path: "x" } },
    } as any);
    assert.strictEqual(chunk.type, "tool_call");
  });

  it("decodes usage", () => {
    const chunk = Schema.decodeSync(StreamChunkSchema)({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 20 },
    } as any);
    assert.strictEqual(chunk.type, "usage");
  });

  it("decodes done", () => {
    const chunk = Schema.decodeSync(StreamChunkSchema)({
      type: "done",
    } as any);
    assert.strictEqual(chunk.type, "done");
  });

  it("decodes error", () => {
    const chunk = Schema.decodeSync(StreamChunkSchema)({
      type: "error", error: "Something went wrong",
    } as any);
    assert.strictEqual(chunk.type, "error");
  });

  it("rejects invalid type", () => {
    assert.throws(() =>
      Schema.decodeSync(StreamChunkSchema)({
        type: "invalid",
      } as any)
    );
  });

  it("rejects text_delta missing text", () => {
    assert.throws(() =>
      Schema.decodeSync(StreamChunkSchema)({
        type: "text_delta",
      } as any)
    );
  });

  it("rejects tool_call with malformed toolCall", () => {
    assert.throws(() =>
      Schema.decodeSync(StreamChunkSchema)({
        type: "tool_call",
        toolCall: { name: "file.read" }, // missing id
      } as any)
    );
  });

  it("rejects usage with malformed usage", () => {
    assert.throws(() =>
      Schema.decodeSync(StreamChunkSchema)({
        type: "usage",
        usage: { inputTokens: "abc" }, // wrong type
      } as any)
    );
  });
});
