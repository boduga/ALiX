import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuationManager } from "../../src/runtime/continuation-manager.js";
import { ContinuationStore } from "../../src/runtime/continuation-store.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";
import { hashArgs } from "../../src/tools/executor.js";

describe("ContinuationManager", () => {
  let tmpDir: string;
  let continuationStore: ContinuationStore;
  let approvalStore: ApprovalStore;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cont-mgr-"));
    mkdirSync(join(tmpDir, ".alix", "approvals"), { recursive: true });
    continuationStore = new ContinuationStore(tmpDir);
    await continuationStore.load();
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unknown approval", async () => {
    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    const result = await mgr.resumeApproved("nonexistent");
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("not found"));
  });

  it("rejects non-approved status", async () => {
    const approval = await approvalStore.request({ reason: "test", capability: "shell.run" });
    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("not 'approved'"));
  });

  it("resumes an approved and persisted tool call", async () => {
    const approval = await approvalStore.request({ reason: "test resume", capability: "shell.run" });
    await approvalStore.resolve(approval.id, "approved", "Test approved");
    const args = { command: "echo done" };
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_resume", name: "shell.run", capability: "shell.run", args, argsHash: hashArgs(args) },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "executed" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, true);
    assert.equal(result.output, "executed");
  });

  it("rejects argsHash mismatch", async () => {
    const approval = await approvalStore.request({ reason: "test hash", capability: "file.read" });
    await approvalStore.resolve(approval.id, "approved", "Approved");
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_hash", name: "file.read", capability: "file.read", args: { path: "/etc/passwd" }, argsHash: "original_hash" },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "should not run" }),
    });
    const result = await mgr.resumeApproved(approval.id);
    assert.equal(result.resumed, false);
    assert.ok(result.error?.includes("hash mismatch"));
  });

  it("is one-shot — continuation removed after resume", async () => {
    const approval = await approvalStore.request({ reason: "test oneshot", capability: "shell.run" });
    await approvalStore.resolve(approval.id, "approved", "Approved");
    const args = { command: "echo one" };
    await continuationStore.persist({
      approvalId: approval.id,
      kind: "tool",
      sessionId: "sess_test",
      cwd: tmpDir,
      toolCall: { toolCallId: "tc_oneshot", name: "shell.run", capability: "shell.run", args, argsHash: hashArgs(args) },
      createdAt: new Date().toISOString(),
    });

    const mgr = new ContinuationManager({
      continuationStore, approvalStore,
      executeTool: async () => ({ kind: "success", output: "ok" }),
    });
    await mgr.resumeApproved(approval.id);
    const cont = continuationStore.findByApprovalId(approval.id);
    assert.equal(cont, undefined);
  });
});
