// tests/contracts/llm-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolCallSchema,
  TokenUsageSchema,
  NormalizedResponseSchema,
  NormalizedMessageSchema,
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
