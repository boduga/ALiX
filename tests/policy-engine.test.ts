import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { ApprovalQueue } from "../src/policy/approvals.js";
import { decidePolicy } from "../src/policy/policy-engine.js";

test("allows configured read tool", () => {
  const decision = decidePolicy(DEFAULT_CONFIG, { toolCallId: "1", capability: "file.read", path: "src/a.ts" });
  assert.equal(decision.decision, "allow");
});

test("denies protected paths", () => {
  const decision = decidePolicy(DEFAULT_CONFIG, { toolCallId: "1", capability: "file.write", path: ".env" });
  assert.equal(decision.decision, "deny");
});

test("tracks pending approvals", () => {
  const queue = new ApprovalQueue();
  const approval = queue.request("Run npm test?");
  assert.equal(queue.pending().length, 1);
  queue.resolve(approval.id, "approved");
  assert.equal(queue.pending().length, 0);
});
