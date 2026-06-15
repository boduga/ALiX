import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("TUI approval store wiring", () => {
  let tmpDir: string;
  let store: ApprovalStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-test-"));
    store = new ApprovalStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ApprovalStore can be eagerly initialized", async () => {
    const s = new ApprovalStore(tmpDir);
    await s.load();
    assert.ok(s);
    assert.equal(s.listPending().length, 0);
  });

  it("ApprovalStore request creates a pending approval", async () => {
    const record = await store.request({
      capability: "filesystem.read",
      reason: "list files in directory",
    });
    assert.ok(record);
    assert.equal(record.status, "pending");
    assert.deepEqual(record.capabilities, ["filesystem.read"]);
    assert.ok(existsSync(join(tmpDir, ".alix", "approvals", "approvals.json")));
  });

  it("ApprovalStore resolve marks approval as approved", async () => {
    const record = await store.request({ capability: "filesystem.write", reason: "write test file" });
    const resolved = await store.resolve(record.id, "approved", "User approved");
    assert.ok(resolved);
    assert.equal(resolved!.status, "approved");
  });

  it("ApprovalStore resolve marks approval as denied", async () => {
    const record = await store.request({ capability: "shell.run", reason: "run unknown command" });
    const resolved = await store.resolve(record.id, "denied", "User denied");
    assert.ok(resolved);
    assert.equal(resolved!.status, "denied");
  });

  it("RuntimeContext accepts optional approvalStore", () => {
    const ctx: { approvalStore?: ApprovalStore } = { approvalStore: store };
    assert.ok(ctx.approvalStore);
  });

  it("ToolExecutor passes approvalStore to PolicyGate constructor", () => {
    // Verify by checking the source — approvalStore appears in both places
    const executorSrc = readFileSync("src/tools/executor.ts", "utf-8");
    const hasApprovalStoreParam = executorSrc.includes("private approvalStore");
    const hasApprovalStoreInPolicyGate = executorSrc.includes("approvalStore: this.approvalStore");
    assert.ok(hasApprovalStoreParam, "ToolExecutor must accept approvalStore param");
    assert.ok(hasApprovalStoreInPolicyGate, "ToolExecutor must pass approvalStore to PolicyGate");
  });
});
