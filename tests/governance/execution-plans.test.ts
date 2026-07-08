import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExecutionPlanFromRemediation, RemediationNotAcceptedException } from "../../src/governance/execution-plans.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: "prop-test",
    sourceRecommendationIds: ["rec-1"],
    title: "Test proposal",
    severity: "warning",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "accepted",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
    ...overrides,
  };
}

describe("createExecutionPlanFromRemediation", () => {
  it("accepted remediation → draft plan", () => {
    const p = makeProposal();
    const plan = createExecutionPlanFromRemediation(p, { now: NOW });
    assert.equal(plan.status, "draft");
    assert.equal(plan.remediationId, "prop-test");
  });

  it("open remediation → throws", () => {
    assert.throws(() => createExecutionPlanFromRemediation(makeProposal({ status: "open" })), RemediationNotAcceptedException);
  });

  it("dismissed remediation → throws", () => {
    assert.throws(() => createExecutionPlanFromRemediation(makeProposal({ status: "dismissed" })), RemediationNotAcceptedException);
  });

  it("resolved remediation → throws", () => {
    assert.throws(() => createExecutionPlanFromRemediation(makeProposal({ status: "resolved" })), RemediationNotAcceptedException);
  });

  it("superseded remediation → throws", () => {
    assert.throws(() => createExecutionPlanFromRemediation(makeProposal({ status: "superseded" })), RemediationNotAcceptedException);
  });

  it("planId deterministic with injected now", () => {
    const p = makeProposal();
    const p1 = createExecutionPlanFromRemediation(p, { now: NOW });
    const p2 = createExecutionPlanFromRemediation(p, { now: NOW });
    assert.equal(p1.planId, p2.planId);
    assert.ok(p1.planId.length === 16);
  });

  it("proposedActions present and sorted by actionId asc", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal(), { now: NOW });
    assert.ok(plan.proposedActions.length > 0);
    for (let i = 1; i < plan.proposedActions.length; i++) {
      assert.ok(plan.proposedActions[i - 1]!.actionId <= plan.proposedActions[i]!.actionId);
    }
  });

  it("investigate_anomaly maps to investigate action", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal({ responseKind: "investigate_anomaly" }), { now: NOW });
    assert.ok(plan.proposedActions.some((a) => a.kind === "investigate_anomaly"));
  });

  it("inspect_policy_gap maps to review_policy action", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal({ responseKind: "inspect_policy_gap" }), { now: NOW });
    assert.ok(plan.proposedActions.some((a) => a.kind === "review_policy"));
  });

  it("rollback plan present for medium/high risk", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal({ severity: "warning" }), { now: NOW });
    assert.ok(plan.requiresRollbackPlan);
    assert.ok(plan.rollbackPlan !== null);
  });

  it("no rollback plan for low risk", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal({ severity: "info" }), { now: NOW });
    assert.equal(plan.requiresRollbackPlan, false);
    assert.equal(plan.rollbackPlan, null);
  });

  it("approvedAt/approvedBy null, executionAttemptIds empty, auditRefs empty", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal(), { now: NOW });
    assert.equal(plan.approvedAt, null);
    assert.equal(plan.approvedBy, null);
    assert.deepEqual(plan.executionAttemptIds, []);
    assert.deepEqual(plan.auditRefs, []);
  });

  it("createdAt uses injected now", () => {
    const plan = createExecutionPlanFromRemediation(makeProposal(), { now: NOW });
    assert.equal(plan.createdAt, NOW);
  });
});
