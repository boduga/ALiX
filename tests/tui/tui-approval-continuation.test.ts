import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/tui/approval-manager.js";
import type { ApprovalManagerDeps } from "../../src/tui/approval-manager.js";

describe("TUI approval continuation", () => {
  let pendingList: Array<{ id: string; capabilities?: string[]; reason: string; createdAt: string }> = [];

  const deps: ApprovalManagerDeps = {
    listPendingApprovals: async () => pendingList,
    resolveApproval: async (id, status) => {
      if (id === "approval_unknown") {
        return { success: false, message: `Approval not found: ${id}` };
      }
      return { success: true, message: `Approval ${id} ${status}.` };
    },
  };

  const manager = new ApprovalManager(deps);

  beforeEach(() => {
    pendingList = [
      { id: "approval_001", capabilities: ["filesystem.read"], reason: "list files in directory", createdAt: new Date().toISOString() },
    ];
  });

  it("/approvals lists pending approvals", async () => {
    const result = await manager.tryHandleCommand("/approvals");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("approval_001"));
    assert.ok(result.message.includes("filesystem.read"));
  });

  it("/approvals shows empty message when no pending", async () => {
    pendingList = [];
    const result = await manager.tryHandleCommand("/approvals");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("No pending"));
  });

  it("/approve <id> marks approval approved", async () => {
    const result = await manager.tryHandleCommand("/approve approval_001");
    assert.equal(result.handled, true);
    assert.equal(result.action, "approved");
    assert.equal(result.approvalId, "approval_001");
  });

  it("/deny <id> marks approval denied", async () => {
    const result = await manager.tryHandleCommand("/deny approval_001");
    assert.equal(result.handled, true);
    assert.equal(result.action, "denied");
    assert.equal(result.approvalId, "approval_001");
  });

  it("unknown approval ID shows helpful error", async () => {
    const result = await manager.tryHandleCommand("/approve approval_unknown");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("not found"));
  });

  it("/approve without ID shows usage", async () => {
    const result = await manager.tryHandleCommand("/approve");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("Usage"));
  });

  it("/deny without ID shows usage", async () => {
    const result = await manager.tryHandleCommand("/deny");
    assert.equal(result.handled, true);
    assert.ok(result.message.includes("Usage"));
  });

  it("non-approval command is not handled", async () => {
    const result = await manager.tryHandleCommand("list files");
    assert.equal(result.handled, false);
  });
});
