import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Daemon protocol", () => {
  it("parses a run command", () => {
    const raw = JSON.stringify({ command: "run", task: "write a story" });
    const cmd = JSON.parse(raw);
    assert.equal(cmd.command, "run");
    assert.equal(cmd.task, "write a story");
  });

  it("parses a ping command", () => {
    const raw = JSON.stringify({ command: "ping" });
    const cmd = JSON.parse(raw);
    assert.equal(cmd.command, "ping");
  });

  it("formats a session.started response", () => {
    const msg = { type: "session.started" as const, sessionId: "sess_123" };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.type, "session.started");
    assert.equal(parsed.sessionId, "sess_123");
  });

  it("formats a tool.event response", () => {
    const msg = { type: "tool.event" as const, sessionId: "sess_1", toolName: "file.create", status: "completed" };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.toolName, "file.create");
  });

  it("formats a queue.position response", () => {
    const msg = { type: "queue.position" as const, position: 3 };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.position, 3);
  });
});
