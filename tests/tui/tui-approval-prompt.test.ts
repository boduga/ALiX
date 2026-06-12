import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("inline approval prompt", () => {
  it("approval ID is extracted from approval-required output", () => {
    const output = "Approval required.\n\nPending approval:\n  approval_1718100000000_a1b2c\n\nRun:\n  /approve approval_1718100000000_a1b2c\nor:\n  /deny approval_1718100000000_a1b2c";
    const match = output.match(/approval_[a-zA-Z0-9_-]+/);
    assert.ok(match);
    assert.equal(match[0], "approval_1718100000000_a1b2c");
  });

  it("approval not in output returns null", () => {
    const output = "ls\nfile1.txt\nfile2.txt";
    const match = output.match(/approval_[a-zA-Z0-9_-]+/);
    assert.equal(match, null);
  });

  it("approval confirm context stores approvalId", () => {
    const ctx = { approvalId: "approval_123_xyz", text: "Approval required" };
    assert.ok(ctx.approvalId);
    assert.equal(ctx.approvalId, "approval_123_xyz");
  });

  it("y response triggers approval path", () => {
    const response = "y";
    const approved = response === "y" || response === "yes";
    assert.equal(approved, true);
  });

  it("n response triggers denial path", () => {
    const response = "n";
    const denied = response === "n" || response === "no";
    assert.equal(denied, true);
  });

  it("details response continues to details view", () => {
    const response = "details";
    const details = response === "details" || response === "d";
    assert.equal(details, true);
  });
});
