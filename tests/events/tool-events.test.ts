import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  ToolRequestPayload,
  ToolStartedPayload,
  ToolOutputPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from "../../src/events/types.js";

describe("Tool Event Payload Types", () => {
  it("ToolRequestPayload tracks tool call details", () => {
    const payload: ToolRequestPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      capability: "file.read",
      argsPreview: { path: "src/index.ts" },
    };
    assert.equal(payload.toolCallId, "call-123");
    assert.equal(payload.capability, "file.read");
  });

  it("ToolCompletedPayload includes duration", () => {
    const payload: ToolCompletedPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      status: "success",
      durationMs: 42,
    };
    assert.equal(payload.status, "success");
    assert.equal(payload.durationMs, 42);
  });

  it("ToolFailedPayload includes error details", () => {
    const payload: ToolFailedPayload = {
      toolCallId: "call-123",
      toolName: "alix_shell_run",
      error: "Command failed with exit code 1",
      durationMs: 150,
    };
    assert.ok(payload.error.includes("exit code 1"));
  });

  it("ToolStartedPayload has required fields", () => {
    const payload: ToolStartedPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
    };
    assert.equal(payload.toolCallId, "call-123");
    assert.equal(payload.toolName, "alix_file_read");
  });

  it("ToolOutputPayload includes output details", () => {
    const payload: ToolOutputPayload = {
      toolCallId: "call-123",
      outputRef: "path/to/output.txt",
      outputPreview: "Hello world...",
      outputSize: 5000,
    };
    assert.ok(payload.outputRef);
    assert.ok(payload.outputPreview);
    assert.equal(payload.outputSize, 5000);
  });
});