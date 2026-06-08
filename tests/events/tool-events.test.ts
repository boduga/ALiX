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
      canonicalCapability: "filesystem.read",
      argumentHash: "abc123def456",
    };
    assert.equal(payload.toolCallId, "call-123");
    assert.equal(payload.capability, "file.read");
    assert.equal(payload.canonicalCapability, "filesystem.read");
    assert.equal(payload.argumentHash, "abc123def456");
  });

  it("ToolCompletedPayload includes duration", () => {
    const payload: ToolCompletedPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      status: "success",
      durationMs: 42,
      canonicalCapability: "filesystem.read",
      argumentHash: "abc123def456",
    };
    assert.equal(payload.status, "success");
    assert.equal(payload.durationMs, 42);
    assert.equal(payload.canonicalCapability, "filesystem.read");
    assert.equal(payload.argumentHash, "abc123def456");
  });

  it("ToolFailedPayload includes error details", () => {
    const payload: ToolFailedPayload = {
      toolCallId: "call-123",
      toolName: "alix_shell_run",
      error: "Command failed with exit code 1",
      durationMs: 150,
      canonicalCapability: "shell.exec",
      argumentHash: "abc123def456",
    };
    assert.ok(payload.error.includes("exit code 1"));
    assert.equal(payload.canonicalCapability, "shell.exec");
    assert.equal(payload.argumentHash, "abc123def456");
  });

  it("ToolStartedPayload has required fields", () => {
    const payload: ToolStartedPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      argumentHash: "abc123def456",
    };
    assert.equal(payload.toolCallId, "call-123");
    assert.equal(payload.toolName, "alix_file_read");
    assert.equal(payload.argumentHash, "abc123def456");
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