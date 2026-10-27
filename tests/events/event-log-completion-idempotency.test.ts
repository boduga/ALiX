import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import type { AlixEvent } from "../../src/runtime-state/events/types.js";

const completion = {
  sessionId: "d9-session",
  actor: "coordination" as const,
  type: "coordination.aggregate.completed",
  payload: {
    runId: "d9-run",
    aggregateResultRef: "results/d9-run.json",
    sourceFingerprint: "d9-fingerprint",
    outcome: "success",
    workerCount: 1,
  },
};

function matchesCompletion(existing: AlixEvent): boolean {
  const payload = existing.payload as Partial<typeof completion.payload> | undefined;
  return existing.type === completion.type && existing.sessionId === completion.sessionId &&
    payload?.runId === completion.payload.runId &&
    payload.aggregateResultRef === completion.payload.aggregateResultRef &&
    payload.sourceFingerprint === completion.payload.sourceFingerprint;
}

describe("D9 EventLog completion idempotency", () => {
  it("concurrent independent instances return one durable completion identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-d9-concurrent-events-"));
    const logs = Array.from({ length: 8 }, () => new EventLog(dir));
    try {
      await Promise.all(logs.map(log => log.init()));
      // All instances initialize before any writer starts; none may rely on
      // an instance-local sequence or an instance-local deduplication cache.
      const results = await Promise.all(logs.map(log => log.appendIfAbsent(completion, matchesCompletion)));
      const reader = new EventLog(dir);
      await reader.init();
      try {
        const persisted = await reader.readAll();
        assert.equal(persisted.length, 1);
        assert.ok(matchesCompletion(persisted[0]));
        for (const result of results) assert.deepEqual(result, persisted[0]);
        const next = await reader.append({ sessionId: completion.sessionId, actor: "system", type: "test.after", payload: {} });
        assert.equal(next.seq, persisted[0].seq + 1, "duplicate attempts must not allocate sequence numbers");
      } finally {
        await reader.close();
      }
    } finally {
      await Promise.all(logs.map(log => log.close()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a fresh instance recovers the persisted event after acknowledgement is lost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-d9-event-recovery-"));
    const first = new EventLog(dir);
    const restarted = new EventLog(dir);
    try {
      await first.init();
      // Inject failure after the real durable append, before its caller sees
      // the acknowledgement. This models the crash boundary, not a killed OS process.
      await assert.rejects(async () => {
        await first.appendIfAbsent(completion, matchesCompletion);
        throw new Error("lost completion acknowledgement");
      }, /lost completion acknowledgement/);
      await first.close();
      await restarted.init();
      const before = await restarted.readAll();
      assert.equal(before.length, 1);
      for (let attempt = 0; attempt < 3; attempt++) {
        const recovered = await restarted.appendIfAbsent(completion, matchesCompletion);
        assert.deepEqual(recovered, before[0], "retry must return the original id, seq and timestamp");
      }
      assert.deepEqual(await restarted.readAll(), before, "recovery must leave durable history unchanged");
    } finally {
      await first.close();
      await restarted.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("other sessions, runs, aggregate references and fingerprints do not suppress the exact event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-d9-event-identity-"));
    const log = new EventLog(dir);
    try {
      await log.init();
      await log.append({ ...completion, sessionId: "another-session" });
      await log.append({ ...completion, type: "coordination.aggregate.failed" });
      for (const field of ["runId", "aggregateResultRef", "sourceFingerprint"] as const) {
        await log.append({ ...completion, payload: { ...completion.payload, [field]: "different" } });
      }
      const created = await log.appendIfAbsent(completion, matchesCompletion);
      const retry = await log.appendIfAbsent(completion, matchesCompletion);
      const persisted = await log.readAll();
      assert.equal(persisted.length, 6);
      assert.equal(persisted.filter(matchesCompletion).length, 1);
      assert.deepEqual(retry, created);
    } finally {
      await log.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
