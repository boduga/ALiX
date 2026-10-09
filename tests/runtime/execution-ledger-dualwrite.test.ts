// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ExecutionStateStore, stateFilePath } from "../../src/runtime-state/runtime/execution-state/execution-state-store.js";
import { reconcileExecutionLedger } from "../../src/runtime-state/runtime/execution-state/execution-ledger-reconcile.js";
import { project, applyEvent, ProjectionUnsupportedError } from "../../src/runtime-state/runtime/execution-state/execution-state-projector.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { ExecutionState } from "../../src/runtime-state/runtime/execution-state/execution-state.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "exec-ledger-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

function state(executionId: string, version: number): ExecutionState {
  return {
    executionId,
    schemaVersion: "1.0.0",
    version,
    step: version,
    objective: "do the thing",
    status: "running",
    intent: { intentId: "intent-1" },
    pendingActions: [],
    activeCapabilities: [],
    constraints: [],
    artifacts: [],
  } as unknown as ExecutionState;
}

describe("execution-state ledger authority (R2.12)", () => {
  it("save mirrors create + update; reconcile clean", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;

    assert.equal(store.save(state(id, 0), null).committed, true);
    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(id), 1);
    assert.equal(ledger.lastEvent(id)?.eventType, "execution.state_created");

    assert.equal(store.save(state(id, 1), 0).committed, true);
    assert.equal(ledger.entityVersion(id), 2);
    const last = ledger.lastEvent(id);
    assert.equal(last?.eventType, "execution.state_saved");
    assert.equal((last?.payload as { state: ExecutionState }).state.version, 1);

    assert.equal(store.ledgerStatus().failures, 0);
    assert.equal(store.ledgerStatus().appends, 2);

    const report = await reconcileExecutionLedger(storeDir, dir);
    assert.equal(report.scannedSnapshots, 1);
    assert.equal(report.ledgerEntities, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("tampered snapshot reported as record_mismatch", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    store.save(state(id, 0), null);
    store.save(state(id, 1), 0);

    // Flip the snapshot version behind the store's back.
    const path = stateFilePath(storeDir, id);
    const snap = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    snap.version = 7;
    writeFileSync(path, JSON.stringify(snap, null, 2));

    const report = await reconcileExecutionLedger(storeDir, dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /json=\{v7,/);
    assert.match(mismatch!.detail, /ledger=\{v1,/);
    assert.equal(report.ok, false);
  });

  it("legacy snapshot reported missing_in_ledger", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const id = "exec_legacy";
    mkdirSync(join(storeDir, id), { recursive: true });
    writeFileSync(join(storeDir, id, "state.json"), JSON.stringify(state(id, 3), null, 2));

    const report = await reconcileExecutionLedger(storeDir, dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("append failure fails the mutation — no JSON-only commit (R2.12 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    assert.throws(() => store.save(state(id, 0), null), /SQLITE|unable|not a database|ledger append failed/i);
    assert.equal(store.ledgerStatus().failures >= 1, true);
    assert.ok(store.ledgerStatus().lastError);
    // Authoritative store unavailable → no projection commit either.
    assert.ok(!existsSync(join(storeDir, id, "state.json")));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, load still works", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    // Occupy the per-execution directory with a FILE so atomicWriteFile's
    // mkdirSync fails — projection broken, ledger intact.
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, id), "not a directory");

    assert.equal(store.save(state(id, 0), null).committed, true); // must NOT throw
    assert.equal(store.ledgerStatus().projectionFailures, 1);
    assert.ok(store.ledgerStatus().lastProjectionError);
    assert.equal(getSharedLedger(dir).entityVersion(id), 1);

    // Authority read works with no usable projection file.
    assert.equal(store.load(id)?.version, 0);

    const report = await reconcileExecutionLedger(storeDir, dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("load prefers the LEDGER over a tampered projection file", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    store.save(state(id, 0), null);
    store.save(state(id, 1), 0);

    // Flip the projection version behind the store's back.
    const path = join(storeDir, id, "state.json");
    const snap = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    snap.version = 7;
    writeFileSync(path, JSON.stringify(snap, null, 2));

    const fresh = new ExecutionStateStore(storeDir);
    assert.equal(fresh.load(id)?.version, 1); // ledger truth, not the tampered file
  });

  it("projector accepts execution.action_executed as evidence (replay no longer crashes)", () => {
    const id = `exec_${randomUUID()}`;
    const events = [
      { seq: 1, type: "execution.created", payload: { executionId: id, objective: "goal" } },
      { seq: 2, type: "execution.status_changed", payload: { status: "running" } },
      { seq: 3, type: "execution.action_executed", payload: { kind: "write", capability: "filesystem.write", success: true } },
    ];
    // Must NOT throw ProjectionUnsupportedError.
    const before = project(events.slice(0, 2));
    const state = project(events);
    assert.equal(state.historyRevision, 3);
    assert.ok(state.historyHash.length > 0);
    // Evidence advances revision/hash but never the state version.
    assert.equal(state.version, before.version);
    assert.equal(state.status, before.status);
  });

  it("projector still fails closed on genuinely unknown execution.* types", () => {
    const id = `exec_${randomUUID()}`;
    const base = [
      { seq: 1, type: "execution.created", payload: { executionId: id, objective: "goal" } },
      { seq: 2, type: "execution.status_changed", payload: { status: "running" } },
    ];
    const s0 = project(base);
    assert.throws(
      () => applyEvent(s0, { seq: 3, type: "execution.not_a_real_type", payload: {} }),
      (err: Error) => err instanceof ProjectionUnsupportedError,
    );
  });

  it("rebuild refuses to overwrite a newer snapshot with an older projection (B7)", () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    store.save(state(id, 0), null);
    store.save(state(id, 1), 0); // committed at v1

    // Rebuild projecting an OLDER (v0) state must be refused before delete.
    assert.throws(
      () => store.rebuildFromEvents(id, [], () => state(id, 0)),
      /Rebuild refused.*newer than projected/,
    );
    // Snapshot untouched.
    assert.equal(store.load(id)?.version, 1);
  });

  it("rebuild with a current/equal projection succeeds and mirrors", () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const store = new ExecutionStateStore(storeDir);
    const id = `exec_${randomUUID()}`;
    store.save(state(id, 0), null);

    const rebuilt = store.rebuildFromEvents(id, [], () => state(id, 0));
    assert.equal(rebuilt.version, 0);
    assert.equal(store.load(id)?.version, 0);
    assert.ok(store.ledgerStatus().appends >= 1);
  });

  it("fresh workspace reconciles clean with zero snapshots", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "executions");
    const report = await reconcileExecutionLedger(storeDir, dir);
    assert.equal(report.scannedSnapshots, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ok, true);
  });
});
