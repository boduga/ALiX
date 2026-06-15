/**
 * approval-store.test.ts — Tests for file-backed approval store.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

function freshStore(): { store: ApprovalStore; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), "approval-store-test-"));
  const store = new ApprovalStore(tmpDir);
  return { store, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

describe("ApprovalStore", () => {
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
      const a = await store.request({ reason: "first" });
      await new Promise(r => setTimeout(r, 2)); // ensure distinct timestamps
      const b = await store.request({ reason: "second" });
      const list = store.list();
      assert.equal(list[0].id, b.id, "newer item should be first");
      assert.equal(list[1].id, a.id, "older item should be second");
    } finally { cleanup(); }
  });

  it("listPending returns only pending", async () => {
    const { store, cleanup } = freshStore();
    try {
      await store.load();
      const a = await store.request({ reason: "pending one" });
      const b = await store.request({ reason: "pending two" });
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
});
