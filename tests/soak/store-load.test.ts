/**
 * store-load.test.ts — Store concurrency and load tests.
 *
 * Tier 1 (fast, runs on every commit). Tests that every storage layer
 * handles sustained operations without errors or data loss.
 * No daemon, no subprocess.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "soak-load-"));
  mkdirSync(join(d, ".alix", "approvals"), { recursive: true });
  return d;
}

// ─── TaskRegistry ───────────────────────────────────────────────────────

describe("TaskRegistry load", () => {
  it("create, update, get round-trip", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-tr-rt-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    const oldHome = process.env.HOME;
    process.env.HOME = testHome;
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
      const reg = new TaskRegistry();
      await reg.load();
      const t = reg.create("test-roundtrip", "/tmp");
      assert.ok(t.id);
      reg.update(t.id, { status: "running", startedAt: new Date().toISOString() });
      const running = reg.get(t.id);
      assert.equal(running?.status, "running");
    } finally {
      process.env.HOME = oldHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("list returns all tasks", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-tr-list-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    const oldHome = process.env.HOME;
    process.env.HOME = testHome;
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
      const reg = new TaskRegistry();
      await reg.load();
      for (let i = 0; i < 20; i++) reg.create(`task-${i}`, "/tmp");
      assert.equal(reg.list().length, 20);
    } finally {
      process.env.HOME = oldHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  });
});

// ─── ApprovalStore ──────────────────────────────────────────────────────

describe("ApprovalStore load", () => {
  let dir: string;
  let store: any;

  beforeEach(async () => {
    dir = tmpDir();
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    store = new ApprovalStore(dir);
    await store.load();
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("100 rapid request/resolve cycles", async () => {
    for (let i = 0; i < 100; i++) {
      const rec = await store.request({ reason: `test ${i}`, capability: `cap.${i}`, sessionId: "s1", toolId: `tool.${i}` });
      await store.resolve(rec.id, "approved", "auto");
    }
    assert.equal(store.listPending().length, 0);
  });

  it("duplicate resolve returns existing record (idempotent)", async () => {
    const rec = await store.request({ reason: "dup", capability: "cap.test", sessionId: "s1", toolId: "tool.test" });
    const first = await store.resolve(rec.id, "approved");
    assert.ok(first);
    const second = await store.resolve(rec.id, "approved");
    assert.equal(second?.status, "approved");
    assert.equal(second?.decidedAt, first?.decidedAt);
  });

  it("500-pending storm then resolve all", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      const rec = await store.request({ reason: `storm ${i}`, capability: `cap.${i}`, sessionId: "s1", toolId: `tool.${i}` });
      ids.push(rec.id);
    }
    assert.equal(store.listPending().length, 500);
    for (const id of ids) await store.resolve(id, "approved");
    assert.equal(store.listPending().length, 0);
  });

  it("survives reload after 200 writes", async () => {
    for (let i = 0; i < 200; i++) {
      await store.request({ reason: `reload ${i}`, capability: "cap.test", sessionId: "s1", toolId: `tool.${i}` });
    }
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const fresh = new ApprovalStore(dir);
    await fresh.load();
    assert.equal(fresh.list().length, 200);
  });
});

// ─── ContinuationStore ──────────────────────────────────────────────────

describe("ContinuationStore load", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("persist, findByApprovalId, remove round-trip", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist({ approvalId: "apr_1", kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: "tc1", name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: "abc" }, createdAt: new Date().toISOString() });
    const found = store.findByApprovalId("apr_1");
    assert.ok(found);
    await store.remove("apr_1");
    assert.equal(store.findByApprovalId("apr_1"), undefined);
  });

  it("1000 persist/remove cycles", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    for (let i = 0; i < 1000; i++) {
      await store.persist({ approvalId: `apr_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() });
    }
    assert.equal(store.list().length, 1000);
    for (let i = 0; i < 1000; i++) await store.remove(`apr_${i}`);
    assert.equal(store.list().length, 0);
  });

  it("concurrent persists resolve correctly", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      store.persist({ approvalId: `apr_conc_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() })
    ));
    assert.equal(store.list().length, 20);
  });
});

// ─── RuntimeIndex ───────────────────────────────────────────────────────

describe("RuntimeIndex load", () => {
  it("build and query on deterministic fixture", { timeout: 30000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "soak-rix-"));
    mkdirSync(join(dir, ".alix", "audit"), { recursive: true });
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });

    // 1000 audit events
    const auditLines = Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: `audit_${i}`, timestamp: new Date().toISOString(), source: "session", action: "tool.started", payload: { tool: "file.read" } })
    ).join("\n") + "\n";
    writeFileSync(join(dir, ".alix", "audit", "audit.jsonl"), auditLines, "utf-8");

    // 100 session events
    const sessionDir = join(dir, ".alix", "sessions", "test-session");
    mkdirSync(sessionDir, { recursive: true });
    const slines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ sessionId: "s1", type: "tool.started", payload: { toolCallId: `tc_${i}` } })
    ).join("\n") + "\n";
    writeFileSync(join(sessionDir, "events.jsonl"), slines, "utf-8");

    const { buildRuntimeIndex } = await import("../../src/runtime/runtime-index.js");
    const index = await buildRuntimeIndex(dir);
    assert.ok(index.events.length > 0);

    rmSync(dir, { recursive: true, force: true });
  });
});
