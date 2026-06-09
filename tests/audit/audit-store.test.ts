import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/audit/audit-store.js";

describe("AuditStore", () => {
  it("appends and lists records", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "policy.allowed", details: { capability: "web.search" } });
      await store.append({ action: "approval.created", actor: "policy", details: { approvalId: "app_1" } });
      const list = await store.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].action, "approval.created");
      assert.equal(list[1].action, "policy.allowed");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by action", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-action-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "policy.allowed", details: {} });
      await store.append({ action: "policy.denied", details: {} });
      await store.append({ action: "policy.allowed", details: {} });
      const allowed = await store.findByAction("policy.allowed");
      assert.equal(allowed.length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by graph", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-graph-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "runtime.blocked", details: { graphId: "g1" } });
      await store.append({ action: "runtime.allowed", details: { graphId: "g2" } });
      const g1 = await store.findByGraph("g1");
      assert.equal(g1.length, 1);
      assert.equal(g1[0].action, "runtime.blocked");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by approval", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-approval-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "approval.created", details: { approvalId: "app_x" } });
      await store.append({ action: "approval.approved", details: { approvalId: "app_x" } });
      const found = await store.findByApproval("app_x");
      assert.equal(found.length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns empty array when no file exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-empty-"));
    try {
      const store = new AuditStore(tmpDir);
      const list = await store.list();
      assert.equal(list.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("respects limit", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-limit-"));
    try {
      const store = new AuditStore(tmpDir);
      for (let i = 0; i < 10; i++) {
        await store.append({ action: "policy.evaluated", details: { capability: "test" } });
      }
      const list = await store.list(3);
      assert.equal(list.length, 3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
