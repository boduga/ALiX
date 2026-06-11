/**
 * tui-approval-persistence.test.ts — Guard test for approval store cross-instance persistence.
 *
 * The bug: ApprovalStore.resolve() searches in-memory this.approvals.
 * When PolicyGate creates an approval via a different ApprovalStore instance,
 * the TUI's store doesn't have it in memory. The fix: call load() before resolve().
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("TUI approval store cross-instance persistence", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-persist-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cross-instance: approval created by one store is found and resolved by another", async () => {
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    const record = await storeA.request({ capability: "filesystem.read", reason: "list files" });
    const approvalId = record.id;
    assert.equal(record.status, "pending");

    const storeB = new ApprovalStore(tmpDir);
    await storeB.load(); // THE FIX — reload from disk
    const resolved = await storeB.resolve(approvalId, "approved", "User approved via TUI");

    assert.ok(resolved, `approval ${approvalId} must be found by storeB after load()`);
    assert.equal(resolved!.status, "approved");
  });

  it("cross-instance: denial works across stores", async () => {
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    const record = await storeA.request({ capability: "shell.run", reason: "run command" });

    const storeB = new ApprovalStore(tmpDir);
    await storeB.load();
    const resolved = await storeB.resolve(record.id, "denied", "User denied");

    assert.ok(resolved);
    assert.equal(resolved!.status, "denied");
  });

  it("unknown ID still returns null after load", async () => {
    const store = new ApprovalStore(tmpDir);
    await store.load();
    const result = await store.resolve("approval_nonexistent", "approved", "test");
    assert.equal(result, null);
  });

  it("listPending sees cross-instance approvals after load", async () => {
    const storeA = new ApprovalStore(tmpDir);
    await storeA.load();
    await storeA.request({ capability: "test.read", reason: "cross-instance list" });

    const storeB = new ApprovalStore(tmpDir);
    await storeB.load();
    const pending = storeB.listPending();

    assert.ok(pending.length > 0, "storeB must see approvals from storeA after load()");
    assert.ok(pending.some(a => a.capability === "test.read"), "must find the cross-instance approval");
  });
});
