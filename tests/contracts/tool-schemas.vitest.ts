// tests/contracts/tool-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import { ALIX_BUILTIN_EXECUTORS } from "../../src/agents/tool-manifest.js";
import {
  ToolNameSchema,
  ToolCallRequestSchema,
  ToolResultSchema,
} from "../../src/contracts/tool-schemas.js";

describe("ToolNameSchema", () => {
  it("decodes every executor id the manifest declares", () => {
    // Derived from the manifest, so this is the drift guard: a tool added to
    // `ALIX_BUILTIN_EXECUTORS` must decode without editing this file.
    for (const exec of Object.values(ALIX_BUILTIN_EXECUTORS)) {
      assert.doesNotThrow(
        () => Schema.decodeSync(ToolNameSchema)(exec as any),
        `executor id ${exec} must decode`,
      );
    }
  });

  it("rejects a model-facing name — this schema is the internal dispatch id", () => {
    // `alix_shell_run` is what the model calls; `shell.run` is what the
    // executor receives. Mixing the two here is how the old literal invited a
    // caller to pass a name the resolver had already translated away.
    assert.throws(() => Schema.decodeSync(ToolNameSchema)("alix_shell_run" as any));
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
