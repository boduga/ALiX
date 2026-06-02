import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("EventLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "alix-event-log-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends events with increasing sequence numbers", async () => {
    const log = new EventLog(dir);
    await log.init();
    const first = await log.append({ sessionId: "s1", type: "session.started", actor: "system", payload: {} });
    const second = await log.append({ sessionId: "s1", type: "user.message", actor: "user", payload: { text: "hi" } });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal((await log.readAll()).length, 2);
  });

  it("readAll returns empty array when no events", async () => {
    const log = new EventLog(dir);
    await log.init();
    const events = await log.readAll();
    assert.deepEqual(events, []);
  });

  it("close is a no-op", async () => {
    const log = new EventLog(dir);
    await log.init();
    await log.close(); // should not throw
  });

  it("watch notifies listeners of new events", async () => {
    const log = new EventLog(dir);
    await log.init();
    let received: AlixEvent | null = null;
    const stop = log.watch(e => { received = e; });
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} });
    // Give async watch a moment
    await new Promise(r => setTimeout(r, 50));
    assert.ok(received !== null);
    assert.equal((received as AlixEvent).type, "test.event");
    stop();
  });

  it("watch returns a stop function", async () => {
    const log = new EventLog(dir);
    await log.init();
    let called = false;
    const stop = log.watch(() => { called = true; });
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(called, true); // was called
    called = false;
    stop(); // stop watching
    await log.append({ sessionId: "s1", type: "another.event", actor: "system", payload: {} });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(called, false); // listener was removed
  });
});