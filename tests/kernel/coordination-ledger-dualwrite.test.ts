// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { reconcileCoordinationLedger } from "../../src/kernel/coordination-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/storage/runtime-ledger.js";
import type { CoordinationRun, WorkerAssignment } from "../../src/kernel/coordination-types.js";

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

describe("coordination store ↔ ledger dual-write", () => {
  it("save emits genesis, mutations bump versions, reconciliation is clean", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;

    await store.save(run(runId, [worker("w1")]));
    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(runId), 1);

    // Worker status change flows through updateRun → snapshot v2.
    await store.patchWorker(runId, "w1", { status: "running", attempt: 1 });
    assert.equal(ledger.entityVersion(runId), 2);

    // Reconcile: JSON matches last snapshot → clean.
    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.scannedRuns, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.truncated, false);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.ok, true);

    const events = ledger.readEvents({ entityId: runId });
    assert.equal(events.length, 2);
    assert.equal(events[0].eventType, "coordination.run.created");
    assert.equal(events[1].eventType, "coordination.run.persisted");
    const snap = events[1].payload as { workerStatuses: Record<string, { status: string; attempt: number }> };
    assert.deepEqual(snap.workerStatuses.w1, { status: "running", attempt: 1 });

    assert.deepEqual(store.ledgerStatus().failures, 0);
    assert.equal(store.ledgerStatus().appends, 2);
  });

  it("attachAggregateIfUnfinalized dual-writes outcome and reconciles clean", async () => {
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
    const events = ledger.readEvents({ entityId: runId });
    const lastSnap = events[events.length - 1].payload as { outcome: string; aggregateResultRef: string };
    assert.equal(lastSnap.outcome, "success");
    assert.equal(lastSnap.aggregateResultRef, "results/runs/x.json");

    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
  });

  it("delete emits a terminal event — no orphan, no missing", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await store.save(run(runId));
    assert.equal(await store.delete(runId), true);

    const events = getSharedLedger(dir).readEvents({ entityId: runId });
    assert.equal(events[events.length - 1].eventType, "coordination.run.deleted");

    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
  });

  it("out-of-band JSON mutation is reported as status_mismatch", async () => {
    const dir = tmp();
    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    const r = run(runId);
    await store.save(r);

    // Bypass the store: rewrite status directly (the drift R2 must see).
    r.status = "completed";
    writeFileSync(join(dir, ".alix", "coordination", `${runId}.json`), JSON.stringify(r, null, 2));

    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("status_mismatch"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
    const issue = report.issues.find(i => i.kind === "status_mismatch");
    assert.match(issue!.detail, /json=completed ledger=planning/);
  });

  it("legacy run (JSON without ledger events) is reported missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "coordination"), { recursive: true });
    const legacy = run("coord_legacy");
    writeFileSync(join(dir, ".alix", "coordination", "coord_legacy.json"), JSON.stringify(legacy, null, 2));

    const report = await reconcileCoordinationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
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
    // Ledger entity with no JSON and no delete event → orphan too.
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("orphan_in_ledger"));
  });

  it("ledger write failure never breaks the JSON path and is observable", async () => {
    const dir = tmp();
    // Break the ledger DB: occupy the path with a directory so open() throws.
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const store = new CoordinationStore(dir);
    const runId = `coord_${randomUUID()}`;
    await store.save(run(runId)); // JSON must still be written

    const status = store.ledgerStatus();
    assert.equal(status.failures, 1);
    assert.ok(status.lastError);

    // JSON side untouched by the failure.
    const loaded = await store.load(runId);
    assert.ok(loaded);
    assert.equal(loaded!.id, runId);

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("fresh workspace reconciles clean with zero runs", async () => {
    const dir = tmp();
    const report = await reconcileCoordinationLedger(dir);
    assert.equal(report.scannedRuns, 0);
    assert.equal(report.ledgerEventsRead, 0);
    assert.equal(report.ok, true);
  });
});
