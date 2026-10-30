/**
 * approval-store.test.ts — Tests for file-backed approval store.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";

function freshStore(): { store: ApprovalStore; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), "approval-store-test-"));
  const store = new ApprovalStore(tmpDir);
  return { store, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

describe("ApprovalStore", () => {
  it("selects newest exact binding even when the earlier record is approved", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const input = { reason: "test", bindingKey: "shared", requestFingerprint: "fp", policyRevision: "v1", capabilities: ["file.write"] };
      const older = await store.requestBound(input);
      await store.resolve(older.id, "approved");
      await new Promise(resolve => setTimeout(resolve, 10));
      const newer = await store.requestBound(input);
      await store.resolve(newer.id, "denied");
      assert.equal(store.findExact("shared")?.id, newer.id);
      assert.equal((await store.findExactFresh("shared"))?.id, newer.id);
      await new Promise(resolve => setTimeout(resolve, 10));
      const pending = await store.requestBound(input);
      assert.equal(store.findExact("shared")?.id, pending.id);
      assert.equal(store.findPendingByBindingKey("shared")?.id, pending.id);
    } finally { cleanup(); }
  });
  it("never reuses an older pending record after a newer denial", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const input = { reason: "test", bindingKey: "latest-only", requestFingerprint: "fp", policyRevision: "v1", capabilities: ["file.write"] };
      const older = await store.requestBound(input);
      await new Promise(resolve => setTimeout(resolve, 10));
      const newer = await store.requestBound(input);
      await store.resolve(newer.id, "denied");
      assert.equal(store.findExact(input.bindingKey)?.id, newer.id);
      assert.equal(store.findPendingByBindingKey(input.bindingKey), undefined);
      await new Promise(resolve => setTimeout(resolve, 10));
      const fresh = await store.requestOrReusePending(input);
      assert.notEqual(fresh.id, older.id);
      assert.notEqual(fresh.id, newer.id);
      assert.equal(store.findPendingByBindingKey(input.bindingKey)?.id, fresh.id);
    } finally { cleanup(); }
  });

  it("loads empty store when no file exists", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(); }
  });

  it("creates a pending approval request", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const record = await store.request({
        reason: "Shell execution requires approval",
        capability: "shell.exec",
        riskLevel: "high",
        graphId: "graph_abc",
        nodeId: "node_xyz",
      });
      assert.ok(record.id);
      assert.equal(record.status, "pending");
      assert.deepEqual(record.capabilities, ["shell.exec"]);
      assert.equal(record.riskLevel, "high");
      assert.equal(record.graphId, "graph_abc");
      assert.equal(record.nodeId, "node_xyz");
      assert.equal(record.reason, "Shell execution requires approval");
    } finally { cleanup(); }
  });

  it("approves a pending request", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const record = await store.request({ reason: "test" });
      const resolved = await store.resolve(record.id, "approved", "Looks good");
      assert.ok(resolved);
      assert.equal(resolved!.status, "approved");
      assert.ok(resolved!.decidedAt);
      assert.equal(resolved!.decisionReason, "Looks good");
    } finally { cleanup(); }
  });

  it("denies a pending request", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const record = await store.request({ reason: "test" });
      const resolved = await store.resolve(record.id, "denied", "Too risky");
      assert.equal(resolved!.status, "denied");
      assert.equal(resolved!.decisionReason, "Too risky");
    } finally { cleanup(); }
  });

  it("returns null for unknown ID on resolve", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const result = await store.resolve("nonexistent", "approved");
      assert.equal(result, null);
    } finally { cleanup(); }
  });

  it("does not double-resolve an already-resolved request", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const record = await store.request({ reason: "test" });
      await store.resolve(record.id, "approved");
      const second = await store.resolve(record.id, "denied");
      assert.equal(second!.status, "approved");
    } finally { cleanup(); }
  });

  it("lists newest first", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const a = await store.request({ reason: "first", graphId: "list-test-a" });
      await new Promise(r => setTimeout(r, 2)); // ensure distinct timestamps
      const b = await store.request({ reason: "second", graphId: "list-test-b" });
      const list = store.list();
      assert.equal(list[0].id, b.id, "newer item should be first");
      assert.equal(list[1].id, a.id, "older item should be second");
    } finally { cleanup(); }
  });

  it("listPending returns only pending", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const a = await store.request({ reason: "pending one", graphId: "pending-a" });
      const b = await store.request({ reason: "pending two", graphId: "pending-b" });
      await store.resolve(b.id, "denied");
      const pending = store.listPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].id, a.id);
    } finally { cleanup(); }
  });

  it("persists to disk and reloads", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "approval-persist-test-"));
    try {
      const store1 = new ApprovalStore(tmpDir);
      await store1.load();
      await store1.request({ reason: "disk test", capability: "shell.exec" });

      const store2 = new ApprovalStore(tmpDir);
      await store2.load();
      assert.equal(store2.list().length, 1);
      assert.deepEqual(store2.list()[0].capabilities, ["shell.exec"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("get returns undefined for unknown ID", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      assert.equal(store.get("nonexistent"), undefined);
    } finally { cleanup(); }
  });

  it("findPending returns existing pending approval for graph/node/capability", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      await store.request({ reason: "test", graphId: "g1", nodeId: "n1", capability: "shell.exec" });
      const found = store.findPending({ graphId: "g1", nodeId: "n1", capability: "shell.exec" });
      assert.ok(found);
      assert.equal(found!.status, "pending");
      assert.equal(found!.graphId, "g1");
      // Wrong capability should not match
      assert.equal(store.findPending({ graphId: "g1", nodeId: "n1", capability: "other" }), undefined);
    } finally { cleanup(); }
  });

  it("findResolved returns most recent resolved approval", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const a = await store.request({ reason: "first", graphId: "g1", nodeId: "n1", capability: "shell.exec" });
      await store.resolve(a.id, "denied", "Not now");
      const found = store.findResolved({ graphId: "g1", nodeId: "n1", capability: "shell.exec" });
      assert.ok(found);
      assert.equal(found!.status, "denied");
      // No pending match for findResolved
      assert.equal(store.findResolved({ graphId: "g2" }), undefined);
    } finally { cleanup(); }
  });

  // #703: indexes stay correct across mutations.
  it("indexes serve O(1) lookups after mutations", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const record = await store.request({ reason: "indexed", graphId: "g1", nodeId: "n1", capability: "shell.exec" });
      assert.equal(store.get(record.id)?.id, record.id);
      assert.equal(store.findExact(record.bindingKey)?.id, record.id);
      assert.equal(store.findPendingByBindingKey(record.bindingKey)?.id, record.id);
      await store.resolve(record.id, "approved");
      // After resolution the pending index no longer reports it.
      assert.equal(store.findPendingByBindingKey(record.bindingKey), undefined);
      assert.equal(store.get(record.id)?.status, "approved");
    } finally { cleanup(); }
  });

  // #703: pure additions append to the journal without rewriting the snapshot.
  it("appends new records to the journal without rewriting the snapshot", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "approval-journal-test-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();
      await store.request({ reason: "first" }); // first write compacts the snapshot
      const snapshotPath = join(tmpDir, ".alix", "approvals", "approvals.json");
      const journalPath = `${snapshotPath}.journal.jsonl`;
      assert.ok(existsSync(snapshotPath));
      const snapshotBefore = readFileSync(snapshotPath, "utf-8");

      await store.request({ reason: "second" }); // append-only fast path
      assert.equal(readFileSync(snapshotPath, "utf-8"), snapshotBefore, "snapshot must be unchanged");
      assert.ok(existsSync(journalPath), "journal must hold the addition");

      // A fresh store sees both records (snapshot + journal replay).
      const reopened = new ApprovalStore(tmpDir);
      await reopened.load();
      assert.equal(reopened.list().length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // #703: terminal-record retention bounds growth.
  it("prunes terminal records beyond the retention cap", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "approval-retention-test-"));
    try {
      const store = new ApprovalStore(tmpDir, { maxTerminalRecords: 2 });
      await store.load();
      for (let i = 0; i < 3; i++) {
        const r = await store.request({ reason: `req-${i}` });
        await store.resolve(r.id, "denied", `no-${i}`);
      }
      const reopened = new ApprovalStore(tmpDir, { maxTerminalRecords: 2 });
      await reopened.load();
      const terminal = reopened.list().filter((r) => r.status === "denied");
      assert.equal(terminal.length, 2, "terminal records capped at 2");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // SRAP #969 concurrency review: the authorization boundary reloads persisted
  // state with an UNLOCKED `load()` before deciding. That read must never
  // clobber or lose a mutation committed through the locked `mutate()` path,
  // and single-use consumption must stay exactly-once under interleaving.
  it("interleaved unlocked load() never loses a committed create or consume", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "approval-interleave-test-"));
    try {
      const store = new ApprovalStore(tmpDir);
      await store.load();

      // One committed, approved, single-use record to consume concurrently.
      const consumeMe = await store.requestBound({
        reason: "consume target", bindingKey: "bk-consume", requestFingerprint: "fp-1",
        policyRevision: "rev-1", capabilities: ["filesystem.write"],
      });
      await store.resolve(consumeMe.id, "approved", "ok");

      // Interleave many unlocked loads with a concurrent create and two
      // concurrent attempts to consume the SAME single-use record.
      const loads = Array.from({ length: 40 }, () => store.load());
      const create = store.requestBound({
        reason: "concurrent create", bindingKey: "bk-create", requestFingerprint: "fp-2",
        policyRevision: "rev-1", capabilities: ["filesystem.write"],
      });
      const c1 = store.consumeApproved(consumeMe.id, "bk-consume", {});
      const c2 = store.consumeApproved(consumeMe.id, "bk-consume", {});
      const [, created, r1, r2] = await Promise.all([Promise.all(loads), create, c1, c2]);

      assert.equal([r1, r2].filter((r) => r.consumed).length, 1,
        "exactly one consume may succeed while unlocked loads interleave");
      assert.equal(r1.consumed && r2.consumed, false);

      // The authoritative ledger (a fresh store) must hold BOTH committed facts.
      const fresh = new ApprovalStore(tmpDir);
      await fresh.load();
      assert.equal(fresh.get(consumeMe.id)?.status, "consumed",
        "the committed consume survives interleaved loads");
      assert.ok(fresh.get(created.id), "the committed create survives interleaved loads");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
