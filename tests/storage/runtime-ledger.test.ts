// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLedger, runtimeLedgerPath, drainLedgerEvents, getSharedLedger, closeSharedLedger } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { RuntimeEvent } from "../../src/runtime-state/contracts/runtime-event.js";

function makeEvent(overrides: Partial<RuntimeEvent> & { eventId: string; entityId: string; entityVersion: number }): RuntimeEvent {
  return {
    eventType: "coordination.worker.started",
    schemaVersion: 1,
    entityType: "coordinationRun",
    runId: "run-1",
    sessionId: "sess-1",
    coordinationRunId: "run-1",
    agentId: "agent-1",
    correlationId: "corr-1",
    actor: { type: "system", id: "scheduler" },
    occurredAt: "2026-10-07T00:00:00.000Z",
    recordedAt: "2026-10-07T00:00:00.000Z",
    payload: { status: "running", attempt: 1 },
    ...overrides,
  };
}

async function withLedger(fn: (ledger: RuntimeLedger, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "alix-ledger-"));
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    const ledger = new RuntimeLedger({ dbPath: join(dir, ".alix", "runtime-ledger.db") });
    try {
      await fn(ledger, dir);
    } finally {
      ledger.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("append creates event + bumped entity version + outbox row atomically", async () => {
  await withLedger(async (ledger) => {
    const res = ledger.append({
      event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 1 }),
      expectedVersion: 0,
    });
    assert.deepEqual(res, { ok: true, entityVersion: 1, ledgerSeq: 1 });
    assert.equal(ledger.entityVersion("w1"), 1);
    assert.equal(ledger.readEvents().length, 1);
    const outbox = ledger.claimOutbox();
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].eventId, "e1");
  });
});

test("version progression: entity version advances one per append", async () => {
  await withLedger(async (ledger) => {
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 1 }), expectedVersion: 0 }).ok);
    const second = ledger.append({ event: makeEvent({ eventId: "e2", entityId: "w1", entityVersion: 2, eventType: "coordination.worker.completed" }), expectedVersion: 1 });
    assert.ok(second.ok);
    assert.equal(ledger.entityVersion("w1"), 2);
    assert.equal(second.ok && second.entityVersion, 2);
  });
});

test("version conflict commits nothing — event, entity, outbox all absent", async () => {
  await withLedger(async (ledger) => {
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 1 }), expectedVersion: 0 }).ok);
    const conflict = ledger.append({
      event: makeEvent({ eventId: "e2", entityId: "w1", entityVersion: 1 }),
      expectedVersion: 0, // stale — current is 1
    });
    assert.ok(!conflict.ok);
    assert.equal(conflict.ok === false && conflict.reason, "version_conflict");
    // Atomicity: nothing from the failed append exists.
    assert.equal(ledger.entityVersion("w1"), 1);
    assert.equal(ledger.readEvents().length, 1);
    assert.equal(ledger.claimOutbox().length, 1);
  });
});

test("duplicate event id rolls back without touching the entity", async () => {
  await withLedger(async (ledger) => {
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 1 }), expectedVersion: 0 }).ok);
    const dup = ledger.append({
      event: makeEvent({ eventId: "e1", entityId: "w2", entityVersion: 1, correlationId: "corr-2" }),
      expectedVersion: 0,
    });
    assert.ok(!dup.ok);
    assert.equal(dup.ok === false && dup.reason, "duplicate_event");
    assert.equal(ledger.entityVersion("w2"), 0);
    assert.equal(ledger.readEvents().length, 1);
    assert.equal(ledger.readEvents().filter((e) => e.entityId === "w2").length, 0);
    assert.equal(ledger.claimOutbox().length, 1);
  });
});

test("event.entityVersion must equal expectedVersion + 1", async () => {
  await withLedger(async (ledger) => {
    const res = ledger.append({
      event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 5 }),
      expectedVersion: 0,
    });
    assert.ok(!res.ok);
    assert.equal(res.ok === false && res.reason, "invalid_precondition");
    assert.equal(ledger.readEvents().length, 0);
  });
});

test("negative expectedVersion rejected before any write", async () => {
  await withLedger(async (ledger) => {
    const res = ledger.append({ event: makeEvent({ eventId: "e1", entityId: "w1", entityVersion: 1 }), expectedVersion: -1 });
    assert.ok(!res.ok);
    assert.equal(res.ok === false && res.reason, "invalid_precondition");
    assert.equal(ledger.readEvents().length, 0);
    assert.equal(ledger.entityVersion("w1"), 0);
  });
});

test("replay is global-sequence ordered, cursor and entity filters work", async () => {
  await withLedger(async (ledger) => {
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e1", entityId: "a", entityVersion: 1 }), expectedVersion: 0 }).ok);
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e2", entityId: "b", entityVersion: 1 }), expectedVersion: 0 }).ok);
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e3", entityId: "a", entityVersion: 2 }), expectedVersion: 1 }).ok);

    const all = ledger.readEvents();
    assert.deepEqual(all.map((e) => e.eventId), ["e1", "e2", "e3"]);
    assert.deepEqual(all.map((e) => e.ledgerSeq), [1, 2, 3]);

    const afterFirst = ledger.readEvents({ sinceSeq: 1 });
    assert.deepEqual(afterFirst.map((e) => e.eventId), ["e2", "e3"]);

    const onlyA = ledger.readEvents({ entityId: "a" });
    assert.deepEqual(onlyA.map((e) => e.eventId), ["e1", "e3"]);

    // Envelope roundtrip — payload and optionals survive verbatim.
    const first = all[0];
    assert.deepEqual(first.payload, { status: "running", attempt: 1 });
    assert.equal(first.coordinationRunId, "run-1");
    assert.equal(first.actor.type, "system");
  });
});

test("outbox delivery marking removes rows from the claim queue", async () => {
  await withLedger(async (ledger) => {
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e1", entityId: "a", entityVersion: 1 }), expectedVersion: 0 }).ok);
    assert.ok(ledger.append({ event: makeEvent({ eventId: "e2", entityId: "b", entityVersion: 1 }), expectedVersion: 0 }).ok);
    const claim = ledger.claimOutbox();
    assert.equal(claim.length, 2);
    ledger.markDelivered(claim[0].outboxSeq, "2026-10-07T01:00:00.000Z");
    const remaining = ledger.claimOutbox();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].eventId, "e2");
    // Idempotent: marking again is a no-op.
    ledger.markDelivered(claim[0].outboxSeq, "2026-10-07T02:00:00.000Z");
    assert.equal(ledger.claimOutbox().length, 1);
  });
});

test("drainLedgerEvents advances past non-matching pages without false truncation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ledger-drain-"));
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    const ledger = getSharedLedger(dir);
    try {
      // Three "coordinationRun" facts fill a page with ZERO domain matches;
      // the matching "approval" fact is on the next page. The cursor must
      // advance past the unmatched page or the drain re-reads it and reports
      // a bogus `truncated` (the R2 review defect).
      for (let i = 0; i < 3; i++) {
        assert.ok(ledger.append({
          event: makeEvent({ eventId: `n${i}`, entityId: `c${i}`, entityVersion: 1, entityType: "coordinationRun" }),
          expectedVersion: 0,
        }).ok);
      }
      assert.ok(ledger.append({
        event: makeEvent({ eventId: "m1", entityId: "a1", entityVersion: 1, entityType: "approval" }),
        expectedVersion: 0,
      }).ok);

      const drained = drainLedgerEvents(dir, new Set(["approval"]), 50, 2);
      assert.equal(drained.truncated, false);
      assert.deepEqual(drained.events.map(e => e.entityId), ["a1"]);
    } finally {
      closeSharedLedger(dir);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtimeLedgerPath is workspace-rooted under .alix", () => {
  const p = runtimeLedgerPath("/ws/project");
  assert.ok(p.endsWith("/ws/project/.alix/runtime-ledger.db") || p.endsWith("\\ws\\project\\.alix\\runtime-ledger.db"));
});

test("ledger file is created on construction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ledger-file-"));
  try {
    const dbPath = join(dir, ".alix", "runtime-ledger.db");
    const ledger = new RuntimeLedger({ dbPath });
    ledger.close();
    assert.ok(existsSync(dbPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
