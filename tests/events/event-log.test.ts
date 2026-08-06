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

  // Regression: alix-init-test session 1786002949079 had `session.started`
  // (parent sessionId) and `agent.response` (agent sub-sessionId) both at
  // seq=6 with timestamps 23 seconds apart. Root cause: two EventLog instances
  // pointing at the same file with INDEPENDENT nextSeq counters, neither one
  // fully syncing before append(). Every code path that creates an EventLog
  // for the same sessionDir MUST share a counter, otherwise seq collisions
  // destroy event ordering across the whole timeline projection.
  it("two EventLog instances for the same file MUST allocate unique seqs", async () => {
    const logA = new EventLog(dir);
    await logA.init();
    const logB = new EventLog(dir); // re-reads the file via init() to sync
    await logB.init();

    const a1 = await logA.append({ sessionId: "sA", type: "session.started", actor: "system", payload: {} });
    const b1 = await logB.append({ sessionId: "sB", type: "agent.response", actor: "agent", payload: { text: "x" } });
    const a2 = await logA.append({ sessionId: "sA", type: "user.message", actor: "user", payload: {} });
    const b2 = await logB.append({ sessionId: "sB", type: "agent.decision", actor: "agent", payload: {} });

    // No two events may share a seq — this is the invariant the entire
    // timeline projection depends on.
    const seqs = [a1.seq, b1.seq, a2.seq, b2.seq];
    assert.equal(new Set(seqs).size, seqs.length, `duplicate seqs: ${seqs.join(',')}`);

    // And every read must see all four events.
    const all = await logA.readAll();
    assert.equal(all.length, 4);
  });

  // Companion regression: even when init() is missed on one instance,
  // append() must re-sync from disk before allocating. This is the safety
  // net for the live-session bug (alix-init-test 1786002949079) where two
  // EventLog instances stamped seq=6 in the same file.
  it("append() re-syncs from disk even if init() was missed", async () => {
    const logA = new EventLog(dir);
    await logA.init();
    const logB = new EventLog(dir); // intentionally NO init()

    const a1 = await logA.append({ sessionId: "sA", type: "session.started", actor: "system", payload: {} });
    const b1 = await logB.append({ sessionId: "sB", type: "agent.response", actor: "agent", payload: { text: "x" } });

    // After the fix: logB's append() reads the file, sees logA's seq=1, and
    // allocates b1.seq=2 — no collision despite the missed init().
    assert.equal(a1.seq, 1);
    assert.equal(b1.seq, 2);
    // And every read sees both events with unique seqs.
    const all = await logA.readAll();
    const seqs = all.map(e => e.seq ?? -1);
    assert.equal(new Set(seqs).size, seqs.length, `duplicate seqs: ${seqs.join(',')}`);
  });
});