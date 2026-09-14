import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

  it("allocates unique sequences during truly concurrent multi-writer appends", async () => {
    const logs = Array.from({ length: 20 }, () => new EventLog(dir));
    await Promise.all(logs.map((log) => log.init()));
    const events = await Promise.all(logs.map((log, i) => log.append({
      sessionId: `s${i}`, type: "test.concurrent", actor: "system", payload: { i },
    })));
    const seqs = events.map((event) => event.seq);
    assert.equal(new Set(seqs).size, events.length, `duplicate seqs: ${seqs.join(",")}`);
  });

  // #688: a lock whose owner is demonstrably dead is reclaimed promptly.
  it("reclaims a stale lock left by a dead process", async () => {
    const log = new EventLog(dir);
    await log.init();
    const lockPath = join(dir, "events.jsonl.lock");
    await writeFile(lockPath, JSON.stringify({
      pid: 1 << 30, // no such process
      token: "dead-holder",
      heartbeat: new Date(Date.now() - 60_000).toISOString(),
    }));
    const ev = await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} });
    assert.equal(ev.seq, 1);
    assert.equal(existsSync(lockPath), false);
  });

  // #688: a live holder (fresh heartbeat, living PID) is never stolen, even
  // past the staleness threshold — the waiter times out instead of forging
  // a duplicate seq.
  it("never steals a live holder's lock", async () => {
    const log = new EventLog(dir);
    await log.init();
    const lockPath = join(dir, "events.jsonl.lock");
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      token: "live-holder",
      heartbeat: new Date().toISOString(),
    }));
    await assert.rejects(
      log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} }),
      /Timed out acquiring EventLog append lock/,
    );
    const raw = await readFile(lockPath, "utf8");
    assert.equal((JSON.parse(raw) as { token: string }).token, "live-holder");
  });

  // #688: legacy locks (empty files from pre-ownership writers) still
  // recover by mtime staleness so upgrades never deadlock.
  it("recovers a stale legacy lock without owner metadata", async () => {
    const log = new EventLog(dir);
    await log.init();
    const lockPath = join(dir, "events.jsonl.lock");
    await writeFile(lockPath, "");
    const ancient = new Date(Date.now() - 60_000);
    await utimes(lockPath, ancient, ancient);
    const ev = await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} });
    assert.equal(ev.seq, 1);
    assert.equal(existsSync(lockPath), false);
  });

  // #688: separate OS processes appending concurrently must never share a
  // seq (the in-process queue cannot serialize them — only the file lock).
  it("allocates unique seqs across concurrent processes", async () => {
    const log = new EventLog(dir);
    await log.init();
    const moduleUrl = new URL("../../src/events/event-log.js", import.meta.url).href;
    const worker = `
      const { EventLog } = await import(${JSON.stringify(moduleUrl)});
      const log = new EventLog(${JSON.stringify(dir)});
      await log.init();
      for (let i = 0; i < 15; i++) {
        await log.append({ sessionId: "child", type: "test.concurrent", actor: "system", payload: {} });
      }
    `;
    const run = promisify(execFile);
    await Promise.all([0, 1, 2, 3].map(() =>
      run(process.execPath, ["--input-type=module", "-e", worker], { timeout: 60_000 }),
    ));
    const all = await log.readAll();
    assert.equal(all.length, 60);
    const seqs = all.map((e) => e.seq ?? -1);
    assert.equal(new Set(seqs).size, seqs.length, `duplicate seqs: ${seqs.join(",")}`);
    assert.equal(existsSync(join(dir, "events.jsonl.lock")), false);
  });

  // #698: append cost must not scale with log size (tail-only resync).
  it("append latency is flat as the log grows", async () => {
    const smallDir = await mkdtemp(join(tmpdir(), "alix-event-log-small-"));
    const bigDir = await mkdtemp(join(tmpdir(), "alix-event-log-big-"));
    try {
      // Seed the big log directly (no EventLog) so setup stays cheap.
      const bigLines: string[] = [];
      for (let i = 1; i <= 20_000; i++) {
        bigLines.push(JSON.stringify({
          id: `ev_${i}`, seq: i, version: 1, timestamp: new Date().toISOString(),
          sessionId: "seed", actor: "system", type: "test.event", payload: {},
        }));
      }
      await writeFile(join(bigDir, "events.jsonl"), bigLines.join("\n") + "\n");

      const small = new EventLog(smallDir);
      const big = new EventLog(bigDir);
      await small.init();
      await big.init();

      const measure = async (log: EventLog): Promise<number> => {
        const start = process.hrtime.bigint();
        for (let i = 0; i < 10; i++) {
          await log.append({ sessionId: "s", type: "test.event", actor: "system", payload: {} });
        }
        return Number(process.hrtime.bigint() - start) / 1e6 / 10;
      };

      const smallAvg = await measure(small);
      const bigAvg = await measure(big);
      // Full re-parse of 20k lines would be ~100x slower; allow generous
      // noise (5x + 5ms floor) while still catching an O(log size) regress.
      assert.ok(
        bigAvg < smallAvg * 5 + 5,
        `append scaled with log size: small=${smallAvg.toFixed(2)}ms big=${bigAvg.toFixed(2)}ms`,
      );
      assert.equal((await big.readAll()).length, 20_010);
    } finally {
      await rm(smallDir, { recursive: true, force: true });
      await rm(bigDir, { recursive: true, force: true });
    }
  });

  // #700: readSince must be incremental — only events appended after the
  // returned cursor are returned, and retrying the same cursor is stable.
  it("readSince returns only newly appended events", async () => {
    const log = new EventLog(dir);
    await log.init();
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 1 } });
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 2 } });

    let { events, cursor } = await log.readSince(log.beginningCursor());
    assert.equal(events.length, 2);
    assert.equal((events[1]!.payload as { n: number }).n, 2);

    // Nothing new — stable, empty.
    const again = await log.readSince(cursor);
    assert.equal(again.events.length, 0);

    // Append two more; only those are returned.
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 3 } });
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 4 } });
    const next = await log.readSince(cursor);
    assert.equal(next.events.length, 2);
    assert.deepEqual(next.events.map((e) => (e.payload as { n: number }).n), [3, 4]);
  });

  // #700: cursor-error semantics are unchanged for foreign and out-of-range
  // cursors.
  it("readSince still rejects foreign cursors; deserialize rejects beyond-head", async () => {
    const log = new EventLog(dir);
    await log.init();
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: {} });

    const foreign = new EventLog(dir);
    await foreign.init();
    await assert.rejects(() => log.readSince(foreign.getCursor()), /different EventLog instance/);

    assert.throws(
      () => log.deserializeCursor(JSON.stringify({ version: 1, seq: 99 })),
      /beyond the current EventLog head/,
    );
  });

  // #701: watching delivers appended events in order and stops cleanly.
  it("startWatching delivers appended events and stops", async () => {
    const log = new EventLog(dir);
    await log.init();
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 1 } });

    const seen: number[] = [];
    const stop = await log.startWatching((e) => seen.push((e.payload as { n: number }).n));
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 2 } });
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 3 } });

    const deadline = Date.now() + 5_000;
    while (seen.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.deepEqual(seen, [2, 3]);
    stop();

    // After stopping, further appends are not delivered.
    await log.append({ sessionId: "s1", type: "test.event", actor: "system", payload: { n: 4 } });
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(seen, [2, 3]);
  });
});
