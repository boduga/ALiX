import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovalQueue } from "../../src/policy/approvals.js";

describe("ApprovalQueue", () => {
  it("tracks pending approvals", () => {
    const queue = new ApprovalQueue();
    const approval = queue.request("Run npm test?");
    assert.equal(queue.pending().length, 1);
    queue.resolve(approval.id, "approved");
    assert.equal(queue.pending().length, 0);
  });
});
