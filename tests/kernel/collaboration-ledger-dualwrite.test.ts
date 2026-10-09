// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CollaborationStore,
  collaborationLedgerStatus,
  resetCollaborationLedgerStatus,
} from "../../src/coordination/kernel/collaboration-store.js";
import { reconcileCollaborationLedger } from "../../src/coordination/kernel/collaboration-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { CollaborationState } from "../../src/coordination/kernel/collaboration-types.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "collab-ledger-"));
  dirs.push(dir);
  resetCollaborationLedgerStatus(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    resetCollaborationLedgerStatus(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function stateFile(dir: string, runId: string): string {
  return join(dir, ".alix", "coordination", "shared", runId, "state.json");
}

/** Existing test convention: production callers create the run dir (e.g. via
 *  persistManifest); mutate() assumes it exists. */
function ensureRunDir(dir: string, runId: string): void {
  mkdirSync(join(dir, ".alix", "coordination", "shared", runId), { recursive: true });
}

describe("collaboration ledger authority (R2.16)", () => {
  it("mutate mirrors created + updated; reconcile clean throughout", async () => {
    const dir = tmp();
    const runId = `run_${randomUUID()}`;
    const store = new CollaborationStore(dir, runId);
    ensureRunDir(dir, runId);

    await store.mutate((state) => { state.revision; });
    const ledger = getSharedLedger(dir);
    // Entity id is namespaced (`collab:<runId>`) — the raw runId belongs to
    // the coordination domain and runtime_entities keys by id alone.
    const entityId = `collab:${runId}`;
    assert.equal(ledger.entityVersion(entityId), 1);
    assert.equal(ledger.entityVersion(runId), 0, "coordination id space untouched");
    assert.equal(ledger.lastEvent(entityId)?.eventType, "collaboration.state_created");

    await store.mutate((state) => { void state; });
    assert.equal(ledger.entityVersion(entityId), 2);
    const last = ledger.lastEvent(entityId);
    assert.equal(last?.eventType, "collaboration.state_updated");
    assert.equal((last?.payload as { state: CollaborationState }).state.revision, 2);

    assert.equal(collaborationLedgerStatus(dir).failures, 0);
    assert.equal(collaborationLedgerStatus(dir).appends, 2);

    const report = await reconcileCollaborationLedger(dir);
    assert.equal(report.scannedStates, 1);
    assert.equal(report.ledgerEntities, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("legacy state file reported missing_in_ledger", async () => {
    const dir = tmp();
    const runId = "run_legacy";
    const path = stateFile(dir, runId);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({
      schemaVersion: "1.0", runId, revision: 3,
      findings: [], artifacts: [], conflicts: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }, null, 2));

    const report = await reconcileCollaborationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered revision reported as record_mismatch", async () => {
    const dir = tmp();
    const runId = `run_${randomUUID()}`;
    const store = new CollaborationStore(dir, runId);
    ensureRunDir(dir, runId);
    await store.mutate(() => undefined);
    await store.mutate(() => undefined); // revision 2 in ledger + file

    const path = stateFile(dir, runId);
    const file = JSON.parse(readFileSync(path, "utf-8")) as CollaborationState;
    file.revision = 99;
    writeFileSync(path, JSON.stringify(file, null, 2));

    const report = await reconcileCollaborationLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /revision: json=99 ledger=2/);
    assert.equal(report.ok, false);
  });

  it("append failure fails the worker mutation — no JSON-only state (R2.16 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const runId = `run_${randomUUID()}`;
    const store = new CollaborationStore(dir, runId);
    ensureRunDir(dir, runId);
    await assert.rejects(() => store.mutate(() => undefined), /SQLITE|unable|not a database|ledger append failed/i);

    const status = collaborationLedgerStatus(dir);
    assert.equal(status.failures >= 1, true);
    assert.ok(status.lastError);
    // No projection commit either.
    assert.ok(!existsSync(stateFile(dir, runId)));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, read still works", async () => {
    const dir = tmp();
    const runId = `run_${randomUUID()}`;
    // Occupy the state file path with a DIRECTORY so saveState fails.
    mkdirSync(stateFile(dir, runId), { recursive: true });

    const store = new CollaborationStore(dir, runId);
    await store.mutate(() => undefined); // must NOT throw

    const status = collaborationLedgerStatus(dir);
    assert.equal(status.projectionFailures, 1);
    assert.ok(status.lastProjectionError);
    assert.equal(getSharedLedger(dir).entityVersion(`collab:${runId}`), 1);

    const fresh = new CollaborationStore(dir, runId);
    const rev = await fresh.read((state) => state.revision); // authority read
    assert.equal(rev, 1);

    rmSync(stateFile(dir, runId), { recursive: true, force: true });
    const report = await reconcileCollaborationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("read prefers the LEDGER over a tampered state file", async () => {
    const dir = tmp();
    const runId = `run_${randomUUID()}`;
    const store = new CollaborationStore(dir, runId);
    ensureRunDir(dir, runId);
    await store.mutate(() => undefined);
    await store.mutate(() => undefined); // revision 2 in ledger + file

    const path = stateFile(dir, runId);
    const file = JSON.parse(readFileSync(path, "utf-8")) as CollaborationState;
    file.revision = 99;
    writeFileSync(path, JSON.stringify(file, null, 2));

    const fresh = new CollaborationStore(dir, runId);
    const rev = await fresh.read((state) => state.revision);
    assert.equal(rev, 2); // ledger truth, not the tampered file
  });

  it("fresh workspace reconciles clean with zero states", async () => {
    const dir = tmp();
    const report = await reconcileCollaborationLedger(dir);
    assert.equal(report.scannedStates, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ok, true);
  });
});
