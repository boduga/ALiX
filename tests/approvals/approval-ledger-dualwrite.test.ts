// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { reconcileApprovalLedger } from "../../src/approvals/approval-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/storage/runtime-ledger.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "approvals-ledger-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

function requestInput(id: string) {
  return {
    reason: `test ${id}`,
    bindingKey: `bk-${id}`,
    requestFingerprint: `fp-${id}`,
    policyRevision: "rev-1",
    capabilities: ["filesystem.write"],
  };
}

describe("approvals ledger authority (R2.5)", () => {
  it("create + resolve dual-write; journal fast-path recorded; reconcile clean", async () => {
    const dir = tmp();
    const store = new ApprovalStore(dir);
    await store.load();

    const a1 = await store.requestFresh(requestInput("one"));
    const a2 = await store.requestFresh(requestInput("two")); // journal fast path
    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(a1.id), 1);
    assert.equal(ledger.entityVersion(a2.id), 1);

    const resolved = await store.resolve(a1.id, "approved", "looks good");
    assert.equal(resolved?.status, "approved");
    assert.equal(ledger.entityVersion(a1.id), 2);

    const last = ledger.lastEvent(a1.id);
    assert.equal(last?.eventType, "approval.updated");
    const payload = last?.payload as { approval: { status: string; decisionReason?: string } };
    assert.equal(payload.approval.status, "approved");
    assert.equal(payload.approval.decisionReason, "looks good");

    assert.equal(store.ledgerStatus().failures, 0);
    assert.equal(store.ledgerStatus().appends, 3);

    const report = await reconcileApprovalLedger(dir);
    assert.equal(report.scannedRecords, 2);
    assert.equal(report.ledgerEntities, 2);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("retention prune emits approval.removed; both sides agree", async () => {
    const dir = tmp();
    const store = new ApprovalStore(dir, { maxTerminalRecords: 0 });
    await store.load();
    const a1 = await store.requestFresh(requestInput("doomed"));
    await store.resolve(a1.id, "denied", "no");

    // maxTerminalRecords=0 → the denied record was pruned from projection.
    assert.equal(existsSync(join(dir, ".alix", "approvals", "approvals.json")), true);
    const { readFile } = await import("node:fs/promises");
    const snapshot = JSON.parse(await readFile(join(dir, ".alix", "approvals", "approvals.json"), "utf-8"));
    assert.equal((snapshot.approvals ?? snapshot).length, 0);

    const last = getSharedLedger(dir).lastEvent(a1.id);
    assert.equal(last?.eventType, "approval.removed");

    const report = await reconcileApprovalLedger(dir);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
  });

  it("legacy projection record reported missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    writeFileSync(join(dir, ".alix", "approvals", "approvals.json"), JSON.stringify([
      {
        id: "approval_legacy", schemaVersion: "2.0", status: "approved",
        usePolicy: "single_use", bindingKey: "bk", requestFingerprint: "fp",
        policyRevision: "rev", capabilities: ["filesystem.write"],
        ownershipClaims: [], reason: "legacy", createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    ], null, 2));

    const report = await reconcileApprovalLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered projection status reported as record_mismatch (ledger authoritative)", async () => {
    const dir = tmp();
    const store = new ApprovalStore(dir);
    await store.load();
    const a1 = await store.requestFresh(requestInput("tamper"));
    await store.resolve(a1.id, "denied", "no");

    // Flip the projection status behind the store's back.
    const filePath = join(dir, ".alix", "approvals", "approvals.json");
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(filePath, "utf-8"));
    const list = Array.isArray(snapshot) ? snapshot : snapshot.approvals;
    list.find((r: { id: string }) => r.id === a1.id).status = "approved";
    await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(snapshot, null, 2));

    const report = await reconcileApprovalLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /status: json="approved" ledger="denied"/);
    assert.match(mismatch!.detail, /ledger authoritative/);
    assert.equal(report.ok, false);
  });

  it("append failure fails the mutation — no JSON-only commit (R2.5 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const store = new ApprovalStore(dir);
    // load() itself must fail closed on a broken authoritative store —
    // and the mutation must reject rather than commit JSON-only.
    await assert.rejects(() => store.load(), /SQLITE|unable|not a database|runtime-ledger/i);
    await assert.rejects(
      () => store.requestFresh(requestInput("headless")),
      /SQLITE|unable|not a database|runtime-ledger/i,
    );
    assert.equal(store.ledgerStatus().failures >= 1, true);
    assert.ok(store.ledgerStatus().lastError);
    // Authoritative store unavailable → no projection commit either.
    assert.ok(!existsSync(join(dir, ".alix", "approvals", "approvals.json")));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated: ledger holds truth, load still works", async () => {
    const dir = tmp();
    const store = new ApprovalStore(dir);
    await store.load();

    // Deterministically break BOTH projection writers for this instance.
    (store as unknown as { saveAtomic: () => Promise<void> }).saveAtomic = async () => {
      throw new Error("projection boom");
    };
    (store as unknown as { appendJournal: () => Promise<void> }).appendJournal = async () => {
      throw new Error("projection boom");
    };

    const a1 = await store.requestFresh(requestInput("no-projection")); // must NOT throw
    assert.equal(a1.status, "pending");
    assert.equal(store.ledgerStatus().projectionFailures, 1);
    assert.ok(store.ledgerStatus().lastProjectionError);

    // Authority read works with no projection file.
    assert.equal(getSharedLedger(dir).entityVersion(a1.id), 1);
    const reloaded = new ApprovalStore(dir);
    await reloaded.load();
    assert.equal(reloaded.get(a1.id)?.status, "pending");

    const report = await reconcileApprovalLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("load prefers the LEDGER over a tampered projection record", async () => {
    const dir = tmp();
    const store = new ApprovalStore(dir);
    await store.load();
    const a1 = await store.requestFresh(requestInput("tamper-load"));
    await store.resolve(a1.id, "denied", "no");

    // Flip the projection status behind the store's back.
    const filePath = join(dir, ".alix", "approvals", "approvals.json");
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(filePath, "utf-8"));
    const list = Array.isArray(snapshot) ? snapshot : snapshot.approvals;
    list.find((r: { id: string }) => r.id === a1.id).status = "approved";
    await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(snapshot, null, 2));

    const fresh = new ApprovalStore(dir);
    await fresh.load();
    assert.equal(fresh.get(a1.id)?.status, "denied"); // ledger truth, not tampered JSON
    assert.equal(fresh.listPending().length, 0); // denied stays denied
  });

  it("fresh workspace reconciles clean with zero records", async () => {
    const dir = tmp();
    const report = await reconcileApprovalLedger(dir);
    assert.equal(report.scannedRecords, 0);
    assert.equal(report.ledgerEntities, 0);
    assert.equal(report.ok, true);
  });
});
