import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDaemonEvent } from "../../src/tui/daemon-client.js";
import type { DaemonResponse } from "../../src/daemon/daemon-types.js";

describe("Daemon event formatting", () => {
  it("formats session.started", () => {
    const line = formatDaemonEvent({ type: "session.started", sessionId: "sess_1" });
    assert.equal(line, "Session started: sess_1");
  });

  it("formats task.accepted", () => {
    const line = formatDaemonEvent({ type: "task.accepted", sessionId: "sess_1", task: "test" });
    assert.equal(line, "Task accepted: sess_1");
  });

  it("formats queue.position", () => {
    const line = formatDaemonEvent({ type: "queue.position", position: 3 });
    assert.equal(line, "Queue position: 3");
  });

  it("formats tool.event completed", () => {
    const line = formatDaemonEvent({ type: "tool.event", sessionId: "sess_1", toolName: "web_search", status: "completed" });
    assert.equal(line, "  ✓ web_search completed");
  });

  it("formats tool.event failed", () => {
    const line = formatDaemonEvent({ type: "tool.event", sessionId: "sess_1", toolName: "shell_exec", status: "failed" });
    assert.equal(line, "  ✗ shell_exec failed");
  });

  it("formats tool.event started (unknown status)", () => {
    const line = formatDaemonEvent({ type: "tool.event", sessionId: "sess_1", toolName: "web_search", status: "started" });
    assert.equal(line, "  → web_search started");
  });

  it("formats task.completed", () => {
    const line = formatDaemonEvent({ type: "task.completed", sessionId: "sess_1", status: "completed" });
    assert.equal(line, "✓ Task completed: completed");
  });

  it("formats task.failed", () => {
    const line = formatDaemonEvent({ type: "task.failed", sessionId: "sess_1", error: "Timeout" });
    assert.equal(line, "✗ Task failed: Timeout");
  });

  it("formats error", () => {
    const line = formatDaemonEvent({ type: "error", message: "Task not found" });
    assert.equal(line, "Error: Task not found");
  });

  it("returns null for unknown event types", () => {
    const line = formatDaemonEvent({ type: "pong", sessionId: "sess_1" });
    assert.equal(line, null);
  });

  it("handles tool.event with no toolName", () => {
    const line = formatDaemonEvent({ type: "tool.event", sessionId: "sess_1", status: "completed" });
    assert.equal(line, "  ✓ tool completed");
  });
});
