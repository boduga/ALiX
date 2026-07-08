import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approveExecutionPlan, rejectExecutionPlan, ApprovalValidationError } from "../../src/governance/execution-approval.js";
import { createExecutionPlanFromRemediation } from "../../src/governance/execution-plans.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeAcceptedProposal(): GovernanceRemediationProposal {
  return {
    proposalId: "prop-test",
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

function makeDraftPlan(): GovernanceExecutionPlan {
  return createExecutionPlanFromRemediation(makeAcceptedProposal(), { now: NOW });
}

function makePlanWithStatus(status: string): GovernanceExecutionPlan {
  return { ...makeDraftPlan(), status } as GovernanceExecutionPlan;
}

describe("approveExecutionPlan", () => {
  it("draft + rationale + operator + valid action IDs → approved", () => {
    const plan = makeDraftPlan();
    const actionId = plan.proposedActions[0]!.actionId;
    const a = approveExecutionPlan(plan, "alice", "looks good", [actionId], { now: NOW });
    assert.equal(a.decision, "approved");
    assert.equal(a.operatorId, "alice");
  });

  it("non-draft plan → throws", () => {
    assert.throws(() => approveExecutionPlan(makePlanWithStatus("executed"), "alice", "ok", ["x"]), ApprovalValidationError);
  });

  it("empty operatorId → throws", () => {
    const plan = makeDraftPlan();
    assert.throws(() => approveExecutionPlan(plan, "", "ok", [plan.proposedActions[0]!.actionId]), ApprovalValidationError);
  });

  it("empty rationale → throws", () => {
    const plan = makeDraftPlan();
    assert.throws(() => approveExecutionPlan(plan, "alice", "   ", [plan.proposedActions[0]!.actionId]), ApprovalValidationError);
  });

  it("approvedActionId not in plan → throws", () => {
    const plan = makeDraftPlan();
    assert.throws(() => approveExecutionPlan(plan, "alice", "ok", ["nonexistent"]), ApprovalValidationError);
  });

  it("empty approvedActionIds → throws", () => {
    const plan = makeDraftPlan();
    assert.throws(() => approveExecutionPlan(plan, "alice", "ok", []), ApprovalValidationError);
  });

  it("approvalId deterministic with injected now", () => {
    const plan = makeDraftPlan();
    const actionId = plan.proposedActions[0]!.actionId;
    const a1 = approveExecutionPlan(plan, "alice", "ok", [actionId], { now: NOW });
    const a2 = approveExecutionPlan(plan, "alice", "ok", [actionId], { now: NOW });
    assert.equal(a1.approvalId, a2.approvalId);
    assert.equal(a1.approvalId.length, 16);
  });

  it("approvedActionIds input array not mutated", () => {
    const plan = makeDraftPlan();
    const actionId = plan.proposedActions[0]!.actionId;
    const input = [actionId];
    const snapshot = [...input];
    approveExecutionPlan(plan, "alice", "ok", input, { now: NOW });
    assert.deepEqual(input, snapshot);
  });
});

describe("rejectExecutionPlan", () => {
  it("reject draft plan → rejected, approvedActionIds: []", () => {
    const plan = makeDraftPlan();
    const a = rejectExecutionPlan(plan, "alice", "not needed", { now: NOW });
    assert.equal(a.decision, "rejected");
    assert.deepEqual(a.approvedActionIds, []);
  });

  it("empty operatorId → throws", () => {
    assert.throws(() => rejectExecutionPlan(makeDraftPlan(), "", "ok"), ApprovalValidationError);
  });

  it("non-draft plan → throws", () => {
    assert.throws(() => rejectExecutionPlan(makePlanWithStatus("rejected"), "alice", "ok"), ApprovalValidationError);
  });
});
