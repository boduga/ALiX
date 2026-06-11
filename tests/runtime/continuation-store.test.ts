import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuationStore, type PendingContinuation } from "../../src/runtime/continuation-store.js";

const makeCont = (approvalId: string, overrides?: Partial<PendingContinuation>): PendingContinuation => ({
  approvalId,
  kind: "tool",
  sessionId: "sess_test",
  cwd: "/tmp",
  toolCall: { toolCallId: "tc1", name: "shell.run", capability: "shell.run", args: { command: "echo hi" }, argsHash: "abc123" },
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("ContinuationStore", () => {
  let tmpDir: string;
  let store: ContinuationStore;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cont-store-"));
    store = new ContinuationStore(tmpDir);
    await store.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists and retrieves a continuation", async () => {
    await store.persist(makeCont("approval_001"));
    const found = store.findByApprovalId("approval_001");
    assert.ok(found);
    assert.equal(found?.toolCall?.name, "shell.run");
  });

  it("returns undefined for unknown approvalId", () => {
    const found = store.findByApprovalId("nonexistent");
    assert.equal(found, undefined);
  });

  it("removes a continuation", async () => {
    await store.persist(makeCont("approval_002"));
    await store.remove("approval_002");
    assert.equal(store.findByApprovalId("approval_002"), undefined);
  });

  it("lists all continuations", async () => {
    await store.persist(makeCont("approval_003"));
    await store.persist(makeCont("approval_004"));
    const all = store.list();
    assert.ok(all.length >= 2);
  });

  it("survives save and reload cycle", async () => {
    await store.persist(makeCont("approval_005"));
    const store2 = new ContinuationStore(tmpDir);
    await store2.load();
    assert.ok(store2.findByApprovalId("approval_005"));
  });
});
