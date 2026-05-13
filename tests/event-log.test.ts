import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import { replay } from "../src/events/replay.js";

test("appends events with increasing sequence numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-events-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const first = await log.append({ sessionId: "s1", type: "session.started", actor: "system", payload: {} });
    const second = await log.append({ sessionId: "s1", type: "user.message", actor: "user", payload: { text: "hi" } });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal((await log.readAll()).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay reconstructs changed files", () => {
  const projection = replay([
    {
      id: "1",
      seq: 1,
      version: 1,
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      type: "patch.applied",
      actor: "system",
      payload: { changedFiles: ["a.ts", "a.ts", "b.ts"] }
    }
  ]);

  assert.deepEqual(projection.changedFiles, ["a.ts", "b.ts"]);
});
