// tests/contracts/helpers.test.ts

import { describe, it, assert } from "vitest";
import { Result } from "effect";
import { decode, parseOrThrow, formatErrors } from "../../src/runtime-state/contracts/helpers.js";
import { ToolCallRequestSchema } from "../../src/runtime-state/contracts/tool-schemas.js";

describe("decode", () => {
  it("returns Right for valid input", () => {
    const result = decode(ToolCallRequestSchema, {
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/x" },
    });
    assert.isTrue(Result.isSuccess(result));
    if (Result.isSuccess(result)) {
      assert.strictEqual(result.success.toolCallId, "call-1");
    }
  });

  it("returns Left for invalid input", () => {
    const result = decode(ToolCallRequestSchema, {
      name: "file.read",
    });
    assert.isTrue(Result.isFailure(result));
  });
});

describe("parseOrThrow", () => {
  it("returns decoded value for valid input", () => {
    const v: any = parseOrThrow(ToolCallRequestSchema, {
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/x" },
    });
    assert.strictEqual(v.toolCallId, "call-1");
  });

  it("throws for invalid input", () => {
    assert.throws(() => {
      parseOrThrow(ToolCallRequestSchema, { name: "Bob" });
    });
  });
});

describe("formatErrors", () => {
  it("formats a parse error as a readable string", () => {
    const result = decode(ToolCallRequestSchema, { name: 42 as any });
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      const msg = formatErrors(result.failure);
      assert.isTrue(msg.length > 0);
    }
  });
});
