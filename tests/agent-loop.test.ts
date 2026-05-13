import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runTask } from "../src/run.js";
import { EventLog } from "../src/events/event-log.js";

test("runTask creates session and returns result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-loop-"));
  try {
    const result = await runTask(dir, "say hello");
    assert.ok(result.sessionId);
    assert.ok(existsSync(join(dir, ".alix", "sessions", result.sessionId, "events.jsonl")));

    const log = new EventLog(join(dir, ".alix", "sessions", result.sessionId));
    await log.init();
    const events = await log.readAll();
    assert.ok(events.some((e) => e.type === "session.started"), "should have session.started");
    assert.ok(events.some((e) => e.type === "session.ended"), "should have session.ended");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runTask loops on tool calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-loop-tool-"));
  try {
    const result = await runTask(dir, "run the tests");
    assert.ok(result.sessionId);

    const log = new EventLog(join(dir, ".alix", "sessions", result.sessionId));
    await log.init();
    const events = await log.readAll();

    const userMsg = events.filter((e) => e.type === "user.message");
    assert.ok(userMsg.length >= 1, "should have user message");

    const agentMsgs = events.filter((e) => e.type === "agent.message");
    assert.ok(agentMsgs.length >= 1, "should have agent messages");

    const toolRequested = events.filter((e) => e.type === "tool.requested");
    const toolCompleted = events.filter((e) => e.type === "tool.completed" || e.type === "tool.failed");
    assert.ok(toolRequested.length > 0 || agentMsgs.length > 0, "should have agent activity");
    assert.ok(toolCompleted.length > 0 || toolRequested.length === 0, "if tools called, results logged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runTask respects max iterations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-loop-max-"));
  try {
    const result = await runTask(dir, "run the tests");
    const log = new EventLog(join(dir, ".alix", "sessions", result.sessionId));
    await log.init();
    const events = await log.readAll();

    const toolRequested = events.filter((e) => e.type === "tool.requested");
    assert.ok(toolRequested.length <= 10, "should not exceed max iterations");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});