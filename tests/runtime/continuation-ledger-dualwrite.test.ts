// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContinuationStore, continuationLedgerStatus, resetContinuationLedgerStatus } from "../../src/runtime/continuation-store.js";
import type { PendingContinuation } from "../../src/runtime/continuation-store.js";
import { reconcileContinuationLedger } from "../../src/runtime/continuation-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/storage/runtime-ledger.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cont-ledger-"));
  dirs.push(dir);
  resetContinuationLedgerStatus(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    resetContinuationLedgerStatus(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function cont(approvalId: string, argsHash = "hash-1"): PendingContinuation {
  return {
    approvalId,
    kind: "tool",
    sessionId: "sess-1",
    cwd: "/ws",
    toolCall: {
      toolCallId: "tc-1",
      name: "shell.run",
      capability: "shell.execute",
      args: { command: "ls" },
      argsHash,
      agentId: "agent-1",
    },
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

describe("continuation ledger authority (R2.14)", () => {
  it("persist mirrors created; remove mirrors tombstone; reconcile clean throughout", async () => {
    const dir = tmp();
    const store = new ContinuationStore(dir);
    await store.load();
    const c = cont("apr_1");
    await store.persist(c);

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion("apr_1"), 1);
    assert.equal(ledger.lastEvent("apr_1")?.eventType, "continuation.created");

    let report = await reconcileContinuationLedger(dir);
    assert.equal(report.scannedRecords, 1);
    assert.equal(report.ledgerEntities, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);

    await store.remove("apr_1");
    assert.equal(ledger.lastEvent("apr_1")?.eventType, "continuation.removed");
    assert.equal(store.findByApprovalId("apr_1"), undefined);

    report = await reconcileContinuationLedger(dir);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.equal(report.ledgerEntities, 0);
  });

  it("legacy continuation file reported missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    writeFileSync(
      join(dir, ".alix", "approvals", "continuations.json"),
      JSON.stringify([cont("apr_legacy")], null, 2),
    );

    const report = await reconcileContinuationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered argsHash reported as record_mismatch (integrity field)", async () => {
    const dir = tmp();
    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist(cont("apr_1", "hash-good"));

    const path = join(dir, ".alix", "approvals", "continuations.json");
    const records = JSON.parse(readFileSync(path, "utf-8")) as PendingContinuation[];
    records[0].toolCall!.argsHash = "hash-evil";
    writeFileSync(path, JSON.stringify(records, null, 2));

    const report = await reconcileContinuationLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /argsHash: json="hash-evil" ledger="hash-good"/);
    assert.equal(report.ok, false);
  });

  it("stale projection after ledger removal reported as projection_stale", async () => {
    const dir = tmp();
    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist(cont("apr_1"));
    await store.remove("apr_1");

    // Recreate the record behind the store's back.
    writeFileSync(
      join(dir, ".alix", "approvals", "continuations.json"),
      JSON.stringify([cont("apr_1")], null, 2),
    );

    const report = await reconcileContinuationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_stale"), JSON.stringify(report.issues));
  });

  it("append failure fails the mutation — no JSON-only state (R2.14 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const store = new ContinuationStore(dir);
    await assert.rejects(() => store.load(), /SQLITE|unable|not a database/i);
    await assert.rejects(() => store.persist(cont("apr_1")), /SQLITE|unable|not a database|ledger append failed/i);
    assert.equal(store.findByApprovalId("apr_1"), undefined); // memory untouched
    assert.equal(continuationLedgerStatus(dir).failures >= 1, true);
    assert.ok(continuationLedgerStatus(dir).lastError);
    assert.ok(!existsSync(join(dir, ".alix", "approvals", "continuations.json")));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, load still works", async () => {
    const dir = tmp();
    // Occupy the projection file path with a DIRECTORY so save() fails.
    mkdirSync(join(dir, ".alix", "approvals", "continuations.json"), { recursive: true });

    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist(cont("apr_1")); // must NOT throw
    assert.equal(continuationLedgerStatus(dir).projectionFailures, 1);
    assert.equal(getSharedLedger(dir).entityVersion("apr_1"), 1);

    const fresh = new ContinuationStore(dir);
    await fresh.load();
    assert.equal(fresh.findByApprovalId("apr_1")?.approvalId, "apr_1"); // authority read

    rmSync(join(dir, ".alix", "approvals", "continuations.json"), { recursive: true, force: true });
    const report = await reconcileContinuationLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("load prefers the LEDGER over a tampered file record", async () => {
    const dir = tmp();
    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist(cont("apr_1", "hash-good"));

    // Tamper the projection argsHash behind the store's back.
    const path = join(dir, ".alix", "approvals", "continuations.json");
    const records = JSON.parse(readFileSync(path, "utf-8")) as PendingContinuation[];
    records[0].toolCall!.argsHash = "hash-evil";
    writeFileSync(path, JSON.stringify(records, null, 2));

    const fresh = new ContinuationStore(dir);
    await fresh.load();
    assert.equal(fresh.findByApprovalId("apr_1")?.toolCall?.argsHash, "hash-good");
  });

  it("fresh workspace reconciles clean with zero records", async () => {
    const dir = tmp();
    const report = await reconcileContinuationLedger(dir);
    assert.equal(report.scannedRecords, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ok, true);
  });
});
