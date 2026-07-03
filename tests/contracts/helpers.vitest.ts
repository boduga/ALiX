// tests/contracts/helpers.test.ts

import { describe, it, assert } from "vitest";
import { Either } from "effect";
import { decode, parseOrThrow, formatErrors } from "../../src/contracts/helpers.js";
import { ToolCallRequestSchema } from "../../src/contracts/tool-schemas.js";

describe("decode", () => {
  it("returns Right for valid input", () => {
    const result = decode(ToolCallRequestSchema, {
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/x" },
    });
    assert.isTrue(Either.isRight(result));
    if (Either.isRight(result)) {
      assert.strictEqual(result.right.toolCallId, "call-1");
    }
  });

  it("returns Left for invalid input", () => {
    const result = decode(ToolCallRequestSchema, {
      name: "file.read",
    });
    assert.isTrue(Either.isLeft(result));
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
    assert.isTrue(Either.isLeft(result));
    if (Either.isLeft(result)) {
      const msg = formatErrors(result.left);
      assert.isTrue(msg.length > 0);
    }
  });
});
