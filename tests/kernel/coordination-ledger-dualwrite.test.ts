// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { reconcileCoordinationLedger } from "../../src/coordination/kernel/coordination-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { CoordinationRun, WorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "coord-ledger-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

function worker(id: string, status: WorkerAssignment["status"] = "pending"): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id,
    coordinationRunId: "unused",
    agentId: `agent-${id}`,
    taskLabel: `Task ${id}`,
    goalPrompt: "do the thing",
    dependencies: [],
    ownershipScopes: [],
    status,
    requiredCapabilities: [],
    attempt: 0,
    maxAttempts: 3,
    ownershipClaims: [],
    createdAt: now,
    updatedAt: now,
  };
}

function run(id: string, workers: WorkerAssignment[] = []): CoordinationRun {
  const now = new Date().toISOString();
  return {
    id,
    sessionId: "sess-1",
    rootGoal: "goal",
    status: "planning",
    coordinatorAgentId: "coordinator",
    workers,
    planRevision: 0,
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
}

describe("coordination ledger authority (R2.3)", () => {
  it("mutations commit to the ledger first; projection mirrors; reconcile clean", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;

    await store.save(run(runId, [worker("w1")]));
    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(runId), 1);

    await store.patchWorker(runId, "w1", { status: "running", attempt: 1 });
    assert.equal(ledger.entityVersion(runId), 2);

    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.scannedRuns, 1);
    assert.equal(report.ledgerEntities, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.truncated, false);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.ok, true);

    const events = ledger.readEvents({ entityId: runId });
    assert.equal(events.length, 2);
    assert.equal(events[0].eventType, "coordination.run.created");
    assert.equal(events[1].eventType, "coordination.run.persisted");
    const payload = events[1].payload as { run: CoordinationRun };
    const w1 = payload.run.workers.find(w => w.id === "w1");
    assert.equal(w1?.status, "running");
    assert.equal(w1?.attempt, 1);

    assert.equal(store.ledgerStatus().projectionFailures, 0);
    assert.equal(store.ledgerStatus().appends, 2);
  });

  it("load prefers the LEDGER over a tampered JSON projection", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await store.save(run(runId, [worker("w1")]));

    // Corrupt the projection: status flipped, worker removed.
    const tampered = run(runId, []);
    tampered.status = "completed";
    writeFileSync(join(dir, ".alix", "coordination", `${runId}.json`), JSON.stringify(tampered, null, 2));

    const loaded = await store.load(runId);
    assert.ok(loaded);
    assert.equal(loaded!.status, "planning"); // ledger truth, not the tampered file
    assert.equal(loaded!.workers.length, 1);

    // Reconcile reports the projection drift (ledger authoritative).
    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("status_mismatch"), JSON.stringify(report.issues));
    assert.ok(kinds.includes("worker_status_mismatch"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
    const statusIssue = report.issues.find(i => i.kind === "status_mismatch");
    assert.match(statusIssue!.detail, /json=completed ledger=planning/);
    assert.match(statusIssue!.detail, /ledger authoritative/);
  });

  it("legacy projection-only run loads from JSON and reports missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "coordination"), { recursive: true });
    const legacy = run("coord_legacy");
    writeFileSync(join(dir, ".alix", "coordination", "coord_legacy.json"), JSON.stringify(legacy, null, 2));

    const store = new CoordinationStore(dir);
    const loaded = await store.load("coord_legacy");
    assert.ok(loaded);
    assert.equal(loaded!.id, "coord_legacy");

    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("append failure fails the mutation — no silent JSON-only commit", async () => {
    const dir = tmp();
    // Break the ledger DB: occupy the path with a directory so open() throws.
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await assert.rejects(
      () => store.save(run(runId)),
      /runtime-ledger|SQLITE|unable|not a database/i,
    );
    // Authoritative store unavailable → no JSON commit either.
    assert.ok(!existsSync(join(dir, ".alix", "coordination", `${runId}.json`)));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, load still works", async () => {
    const dir = tmp();
    const runId = `coord_${randomUUID()}`;
    // Occupy the projection file path with a DIRECTORY → writeAtomic rename fails.
    mkdirSync(join(dir, ".alix", "coordination", `${runId}.json`), { recursive: true });

    const store = new CoordinationStore(dir);
    await store.save(run(runId, [worker("w1")])); // must NOT throw

    assert.equal(store.ledgerStatus().projectionFailures, 1);
    assert.ok(store.ledgerStatus().lastProjectionError);
    assert.equal(getSharedLedger(dir).entityVersion(runId), 1);

    // Authority read works with no usable projection file.
    const loaded = await store.load(runId);
    assert.ok(loaded);
    assert.equal(loaded!.id, runId);

    // Reconcile reports the missing projection (not an authority failure).
    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("deleted runs disappear from authority reads; stale projection reported", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await store.save(run(runId));
    assert.equal(await store.delete(runId), true);

    assert.equal(await store.load(runId), null);
    const listed = await store.list();
    assert.equal(listed.length, 0);
    assert.equal(existsSync(join(dir, ".alix", "coordination", `${runId}.json`)), false);

    // Recreate a stale projection file while the ledger says deleted.
    writeFileSync(join(dir, ".alix", "coordination", `${runId}.json`), JSON.stringify(run(runId), null, 2));
    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_stale"), JSON.stringify(report.issues));
  });

  it("attachAggregateIfUnfinalized commits to ledger and reconciles clean", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await store.save(run(runId, [worker("w1", "completed")]));

    const res = await store.attachAggregateIfUnfinalized(runId, {
      aggregateResultRef: "results/runs/x.json",
      aggregateGeneratedAt: new Date().toISOString(),
      aggregateSourceFingerprint: "fp1",
      outcome: "success",
    });
    assert.equal(res.attached, true);

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(runId), 2);
    const last = ledger.lastEvent(runId);
    const payload = last!.payload as { run: CoordinationRun };
    assert.equal(payload.run.outcome, "success");
    assert.equal(payload.run.aggregateResultRef, "results/runs/x.json");

    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
  });

  it("unknown event types are counted, never dropped", async () => {
    const dir = tmp();
    const ledger = getSharedLedger(dir);
    const expected = ledger.entityVersion("mystery-entity");
    const res = ledger.append({
      event: {
        eventId: randomUUID(),
        eventType: "coordination.run.mystery",
        schemaVersion: 1,
        entityType: "coordinationRun",
        entityId: "mystery-entity",
        entityVersion: expected + 1,
        correlationId: "mystery-entity",
        actor: { type: "system", id: "test" },
        occurredAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        payload: {},
      },
      expectedVersion: expected,
    });
    assert.ok(res.ok);

    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.unknownEventTypes["coordination.run.mystery"], 1);
    // Live entity without a projection file and without a run payload.
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("ledger_payload_invalid"), JSON.stringify(report.issues));
  });

  it("fresh workspace reconciles clean with zero runs", async () => {
    const dir = tmp();
    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.scannedRuns, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ledgerEventsRead, 0);
    assert.equal(report.ok, true);
  });
});
