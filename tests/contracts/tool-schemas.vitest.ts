// tests/contracts/tool-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolNameSchema,
  ToolCallRequestSchema,
  ToolResultSchema,
} from "../../src/contracts/tool-schemas.js";

describe("ToolNameSchema", () => {
  it("decodes valid tool names", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("file.read" as any)
    );
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("shell.run" as any)
    );
    assert.doesNotThrow(() =>
      Schema.decodeSync(ToolNameSchema)("done" as any)
    );
  });

  it("rejects invalid tool names", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolNameSchema)("invalid.tool" as any)
    );
    assert.throws(() =>
      Schema.decodeSync(ToolNameSchema)(42 as any)
    );
  });
});

describe("ToolCallRequestSchema", () => {
  it("decodes a valid request", () => {
    const req = Schema.decodeSync(ToolCallRequestSchema)({
      toolCallId: "call-1",
      name: "file.read",
      args: { path: "/tmp/test.txt" },
    } as any);
    assert.strictEqual((req as any).toolCallId, "call-1");
    assert.strictEqual((req as any).name, "file.read");
  });

  it("accepts optional fields", () => {
    const req = Schema.decodeSync(ToolCallRequestSchema)({
      toolCallId: "call-2",
      name: "shell.run",
      args: { command: "ls" },
      agentId: "agent-1",
      sessionId: "session-1",
    } as any);
    assert.strictEqual((req as any).agentId, "agent-1");
  });

  it("accepts traceability fields (replayId, source)", () => {
    const req = Schema.decodeSync(ToolCallRequestSchema)({
      toolCallId: "call-3",
      name: "shell.run",
      args: { command: "echo ok" },
      replayId: "replay-1",
      source: "continuation-resume",
    } as any);
    assert.strictEqual((req as any).replayId, "replay-1");
    assert.strictEqual((req as any).source, "continuation-resume");
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolCallRequestSchema)({
        name: "file.read",
      } as any)
    );
  });
});

describe("ToolResultSchema", () => {
  it("decodes a success result", () => {
    const result = Schema.decodeSync(ToolResultSchema)({
      kind: "success",
      content: "done",
    } as any);
    assert.strictEqual((result as any).kind, "success");
  });

  it("decodes an error result", () => {
    const result: any = Schema.decodeSync(ToolResultSchema)({
      kind: "error",
      message: "file not found",
      retryable: false,
    } as any);
    assert.strictEqual(result.kind, "error");
    assert.strictEqual(result.message, "file not found");
  });

  it("rejects unknown kind", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolResultSchema)({
        kind: "unknown",
      } as any)
    );
  });
});
