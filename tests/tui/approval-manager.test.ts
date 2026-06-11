import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager, type ApprovalManagerDeps } from "../../src/tui/approval-manager.js";

describe("ApprovalManager", () => {
  let deps: ApprovalManagerDeps;
  let resolvedId: string | null;
  let resolvedStatus: string | null;

  beforeEach(() => {
    resolvedId = null;
    resolvedStatus = null;
    deps = {
      listPendingApprovals: async () => [
        { id: "approval_001", capability: "shell.run", reason: "Command 'rm' requires approval", toolId: "shell.run", createdAt: "2026-06-10T12:00:00Z" },
        { id: "approval_002", capability: "file.write", reason: "Path is protected", toolId: "file.write", createdAt: "2026-06-10T12:01:00Z" },
      ],
      resolveApproval: async (id, status) => {
        resolvedId = id;
        resolvedStatus = status;
        return { success: true, message: `Approval ${id} ${status}.` };
      },
    };
  });

  it("non-command returns handled: false", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("hello");
    assert.equal(r.handled, false);
  });

  it("/approvals lists pending approvals", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approvals");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("approval_001"));
    assert.ok((r as any).message.includes("approval_002"));
  });

  it("/approval alias lists pending approvals", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approval");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Pending approvals"));
  });

  it("/approve <id> resolves approval", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approve approval_001");
    assert.equal(r.handled, true);
    assert.equal((r as any).action, "approved");
    assert.equal((r as any).approvalId, "approval_001");
    assert.equal(resolvedId, "approval_001");
    assert.equal(resolvedStatus, "approved");
  });

  it("/deny <id> resolves as denied", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/deny approval_001");
    assert.equal(r.handled, true);
    assert.equal((r as any).action, "denied");
    assert.equal((r as any).approvalId, "approval_001");
    assert.equal(resolvedStatus, "denied");
  });

  it("/approve without id shows usage", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/approve");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("/deny without id shows usage", async () => {
    const mgr = new ApprovalManager(deps);
    const r = await mgr.tryHandleCommand("/deny");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("empty list returns no pending message", async () => {
    const emptyDeps: ApprovalManagerDeps = {
      ...deps,
      listPendingApprovals: async () => [],
    };
    const mgr = new ApprovalManager(emptyDeps);
    const r = await mgr.tryHandleCommand("/approvals");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("No pending approvals"));
  });
});
