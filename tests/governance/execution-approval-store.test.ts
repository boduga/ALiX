import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionApprovalStore } from "../../src/governance/execution-approval-store.js";
import { approveExecutionPlan, rejectExecutionPlan } from "../../src/governance/execution-approval.js";
import { createExecutionPlanFromRemediation } from "../../src/governance/execution-plans.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeProposal(proposalId = "prop-test"): GovernanceRemediationProposal {
  return {
    proposalId,
    sourceRecommendationIds: ["rec-1"],
    title: "Test",
    severity: "warning",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "accepted",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
  };
}

function makePlan(proposalId = "prop-test"): GovernanceExecutionPlan {
  return createExecutionPlanFromRemediation(makeProposal(proposalId), { now: NOW });
}

describe("ExecutionApprovalStore", () => {
  let tmpDir: string;
  let store: ExecutionApprovalStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approval-store-test-"));
    store = new ExecutionApprovalStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and get: round-trips an approval", async () => {
    const plan = makePlan();
    const approval = approveExecutionPlan(plan, "alice", "ok", [plan.proposedActions[0]!.actionId], { now: NOW });
    await store.append(approval);
    const found = await store.get(approval.approvalId);
    assert.ok(found);
    assert.equal(found!.decision, "approved");
  });

  it("getByPlanId: returns latest approval for a plan", async () => {
    const plan = makePlan("distinct-prop");
    const actionId = plan.proposedActions[0]!.actionId;
    const a1 = approveExecutionPlan(plan, "alice", "ok", [actionId], { now: "2026-07-07T10:00:00.000Z" });
    const a2 = rejectExecutionPlan(plan, "alice", "rejecting", { now: "2026-07-07T11:00:00.000Z" });
    await store.append(a1);
    await store.append(a2);
    const latest = await store.getByPlanId(plan.planId);
    assert.ok(latest);
    assert.equal(latest!.decision, "rejected", "latest approval by createdAt wins");
  });

  it("getByPlanId: no approval returns null", async () => {
    assert.equal(await store.getByPlanId("nonexistent"), null);
  });

  it("get: not found returns null", async () => {
    assert.equal(await store.get("missing"), null);
  });

  it("list: newest-first by createdAt", async () => {
    const all = await store.list();
    const times = all.map((a) => new Date(a.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i - 1]! >= times[i]!, "list sorted newest-first");
    }
  });

  it("empty store returns empty list", async () => {
    const emptyStore = new ExecutionApprovalStore(join(tmpdir(), "empty-approval-dir"));
    assert.deepEqual(await emptyStore.list(), []);
  });
});
