// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskRegistry, daemonTaskLedgerStatus, resetDaemonTaskLedgerStatus } from "../../src/operations/daemon/task-registry.js";
import { reconcileDaemonTaskLedger } from "../../src/operations/daemon/daemon-task-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/runtime-state/storage/runtime-ledger.js";

let origHome: string | undefined;
let testHome: string;
const registryPath = () => join(testHome, ".alix", "daemon-tasks.json");

before(() => {
  origHome = process.env.HOME;
  testHome = mkdtempSync(join(tmpdir(), "daemon-task-ledger-"));
  process.env.HOME = testHome;
  mkdirSync(join(testHome, ".alix"), { recursive: true });
  resetDaemonTaskLedgerStatus();
});

after(() => {
  try { closeSharedLedger(testHome); } catch { /* ignore */ }
  process.env.HOME = origHome;
  rmSync(testHome, { recursive: true, force: true });
});

afterEach(() => {
  // Close the shared connection BEFORE deleting files — a cached connection
  // would keep serving the old inode and leak events across tests.
  try { closeSharedLedger(testHome); } catch { /* ignore */ }
  resetDaemonTaskLedgerStatus();
  rmSync(join(testHome, ".alix", "runtime-ledger.db"), { recursive: true, force: true });
  rmSync(join(testHome, ".alix", "runtime-ledger.db-wal"), { recursive: true, force: true });
  rmSync(join(testHome, ".alix", "runtime-ledger.db-shm"), { recursive: true, force: true });
  rmSync(registryPath(), { force: true });
});

describe("daemon task registry ledger authority (R2.15)", () => {
  it("create + lifecycle updates mirror; reconcile clean", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("do the thing", testHome);
    await reg.flush();
    reg.update(r.id, { status: "running", sessionId: "sess_1", startedAt: new Date().toISOString() });
    await reg.flush();
    reg.update(r.id, { status: "completed", completedAt: new Date().toISOString() });
    await reg.flush();

    const ledger = getSharedLedger(testHome);
    assert.equal(ledger.entityVersion(r.id), 3);
    const last = ledger.lastEvent(r.id);
    assert.equal(last?.eventType, "daemonTask.updated");
    assert.equal((last?.payload as { task: { status: string } }).task.status, "completed");

    assert.equal(daemonTaskLedgerStatus().failures, 0);
    assert.equal(daemonTaskLedgerStatus().appends, 3);

    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    assert.equal(report.scannedRecords, 1);
    assert.equal(report.ledgerEntities, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("reconcileOnStartup status flips are mirrored", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("crash victim", testHome);
    await reg.flush();
    reg.update(r.id, { status: "running", startedAt: new Date().toISOString() });
    await reg.flush();

    const reg2 = new TaskRegistry();
    await reg2.load();
    const result = reg2.reconcileOnStartup();
    assert.ok(result.reconciled >= 1);
    await reg2.flush();

    const ledger = getSharedLedger(testHome);
    const last = ledger.lastEvent(r.id);
    assert.equal((last?.payload as { task: { status: string } }).task.status, "failed_orphaned");

    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
  });

  it("legacy registry record reported missing_in_ledger (baseline, not mirrored)", async () => {
    writeFileSync(registryPath(), JSON.stringify([
      {
        id: "task_legacy", task: "old", cwd: testHome, status: "queued",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ], null, 2));

    const reg = new TaskRegistry();
    await reg.load(); // baseline set — no mirror of legacy records
    await reg.flush();
    assert.equal(daemonTaskLedgerStatus().appends, 0);

    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered registry status reported as record_mismatch", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("tamper target", testHome);
    reg.update(r.id, { status: "running" });
    await reg.flush();

    const records = JSON.parse(readFileSync(registryPath(), "utf-8")) as Array<{ id: string; status: string }>;
    records.find(x => x.id === r.id)!.status = "completed";
    writeFileSync(registryPath(), JSON.stringify(records, null, 2));

    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /status: json=completed ledger=running/);
    assert.equal(report.ok, false);
  });

  it("append failure blocks the projection — no JSON-only state (R2.15 authority)", async () => {
    closeSharedLedger(testHome);
    mkdirSync(runtimeLedgerPath(testHome), { recursive: true });

    const reg = new TaskRegistry();
    await assert.rejects(() => reg.load(), /SQLITE|unable|not a database/i);

    // Operator flow: ledger broken BEFORE startup → load throws (fail-closed).
    const reg2 = new TaskRegistry();
    await assert.rejects(async () => { await reg2.load(); }, /SQLITE|unable|not a database/i);

    const status = daemonTaskLedgerStatus();
    assert.equal(status.failures >= 1, true);
    assert.ok(status.lastError);
    assert.ok(!existsSync(registryPath()));

    rmSync(runtimeLedgerPath(testHome), { recursive: true, force: true });
    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    const kinds = report.issues.map(i => i.kind);
    // No registry + no ledger facts (failed appends rolled back) → clean.
    assert.ok(kinds.length === 0 || kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
  });

  it("projection write failure is tolerated and counted; authority load still works", async () => {
    const reg = new TaskRegistry();
    await reg.load();
    const r = reg.create("proj-fail", testHome);
    // Occupy the registry FILE path with a DIRECTORY so rename fails.
    rmSync(registryPath(), { force: true });
    mkdirSync(registryPath(), { recursive: true });
    await reg.flush();

    const status = daemonTaskLedgerStatus();
    assert.equal(status.projectionFailures >= 1, true);
    assert.ok(status.lastProjectionError);
    // Ledger fact exists (append-first) despite the projection failure.
    assert.ok(getSharedLedger(testHome).entityVersion(r.id) >= 1);

    rmSync(registryPath(), { recursive: true, force: true });
    const fresh = new TaskRegistry();
    await fresh.load();
    assert.equal(fresh.get(r.id)?.task, "proj-fail"); // authority read

    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("create throws and rolls back when the ledger append fails (R2.15 fail-closed)", async () => {
    const reg = new TaskRegistry();
    await reg.load();

    // Break the ledger AFTER a successful load: the append (the commit) must
    // reach the caller rather than being swallowed by the queued projection.
    closeSharedLedger(testHome);
    rmSync(runtimeLedgerPath(testHome), { force: true });
    mkdirSync(runtimeLedgerPath(testHome), { recursive: true });

    assert.throws(
      () => reg.create("will fail", testHome),
      /SQLITE|unable|not a database|ledger append failed/i,
    );
    // Rolled back: the failed record is not visible and no JSON was written.
    assert.equal(reg.list().length, 0);
    assert.equal(daemonTaskLedgerStatus().failures >= 1, true);
    assert.ok(daemonTaskLedgerStatus().lastError);

    rmSync(runtimeLedgerPath(testHome), { recursive: true, force: true });
  });

  it("fresh registry reconciles clean with zero records", async () => {
    const report = await reconcileDaemonTaskLedger(registryPath(), testHome);
    assert.equal(report.scannedRecords, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ok, true);
    assert.ok(!existsSync(registryPath()));
  });
});
