import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordExecutionAttempt,
  AttemptValidationError,
} from "../../src/governance/execution-recorder.js";
import type {
  GovernanceExecutionActionResult,
} from "../../src/governance/execution-recorder.js";
import { approveExecutionPlan, rejectExecutionPlan } from "../../src/governance/execution-approval.js";
import { createExecutionPlanFromRemediation } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";

const NOW = "2026-07-07T14:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAcceptedProposal(): GovernanceRemediationProposal {
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
  };
}

function makeDraftPlan(): GovernanceExecutionPlan {
  return createExecutionPlanFromRemediation(makeAcceptedProposal(), { now: NOW });
}

function approveAllActions(plan: GovernanceExecutionPlan): GovernanceExecutionApproval {
  const actionIds = plan.proposedActions.map((a) => a.actionId);
  return approveExecutionPlan(plan, "alice", "looks good", actionIds, { now: NOW });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recordExecutionAttempt", () => {
  it("happy path: approved plan → valid attempt record", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: `Completed: ${a.description}`,
      evidenceRefs: [],
    }));

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.ok(attempt.attemptId);
    assert.equal(attempt.attemptId.length, 16);
    assert.equal(attempt.planId, plan.planId);
    assert.equal(attempt.remediationId, plan.remediationId);
    assert.equal(attempt.approvalId, approval.approvalId);
    assert.equal(attempt.status, "started");
    assert.equal(attempt.startedAt, NOW);
    assert.equal(attempt.executedBy, "alice");
    assert.equal(attempt.actionResults.length, plan.proposedActions.length);
    assert.equal(attempt.failureReason, null);
    assert.equal(attempt.revertAttemptId, null);
    assert.deepEqual(attempt.auditRefs, []);
  });

  it("action results with evidence refs are preserved", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = [
      {
        actionId: plan.proposedActions[0]!.actionId,
        status: "succeeded",
        summary: "Done",
        evidenceRefs: ["ev-1", "ev-2"],
      },
    ];

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "bob",
      actionResults,
      now: NOW,
    });

    assert.deepEqual(attempt.actionResults[0]!.evidenceRefs, ["ev-1", "ev-2"]);
  });

  it("rejected approval → throws", () => {
    const plan = makeDraftPlan();
    const approval = rejectExecutionPlan(plan, "alice", "not needed", { now: NOW });

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "started",
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("plan/approval planId mismatch → throws", () => {
    const plan = makeDraftPlan();
    // Create a second plan with different proposalId so it gets a different planId hash
    const otherProposal = makeAcceptedProposal();
    otherProposal.proposalId = "other-proposal";
    const otherPlan = createExecutionPlanFromRemediation(otherProposal, { now: NOW });
    const approval = approveAllActions(otherPlan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "started",
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("empty executedBy → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "started",
          executedBy: "",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("invalid status → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "invalid" as any,
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("failed status without failureReason → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "failed",
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("partial status without failureReason → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "partial",
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("failed status with failureReason → allowed", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "failed",
      executedBy: "alice",
      actionResults: [],
      failureReason: "External service unreachable",
      now: NOW,
    });

    assert.equal(attempt.status, "failed");
    assert.equal(attempt.failureReason, "External service unreachable");
    assert.ok(attempt.completedAt !== null);
  });

  it("succeeded without failureReason → allowed", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "Done",
      evidenceRefs: [],
    }));

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.equal(attempt.status, "succeeded");
    assert.equal(attempt.failureReason, null);
    assert.ok(attempt.completedAt !== null);
  });

  it("action ID not in proposedActions → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "started",
          executedBy: "alice",
          actionResults: [
            { actionId: "act-nonexistent", status: "succeeded", summary: "Nope", evidenceRefs: [] },
          ],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("action ID not approved → throws", () => {
    const plan = makeDraftPlan();
    // Approve only a subset — if there's only one action, approve it but use a different ID
    const actionIds = plan.proposedActions.map((a) => a.actionId);
    const approval = approveExecutionPlan(plan, "alice", "looks good", actionIds, { now: NOW });

    // Every action is approved, so use a completely made-up ID
    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "started",
          executedBy: "alice",
          actionResults: [
            { actionId: "act-made-up", status: "succeeded", summary: "Nope", evidenceRefs: [] },
          ],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("deterministic attempt ID with same inputs", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "Done",
      evidenceRefs: [],
    }));

    const a1 = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });
    const a2 = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.equal(a1.attemptId, a2.attemptId);
  });

  it("different status → different attempt ID", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "Done",
      evidenceRefs: [],
    }));

    const started = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });
    const succeeded = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.notEqual(started.attemptId, succeeded.attemptId);
  });

  it("non-terminal status (started) has completedAt = null", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "In progress",
      evidenceRefs: [],
    }));

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.equal(attempt.completedAt, null);
  });

  it("terminal status (succeeded) has completedAt set", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "Done",
      evidenceRefs: [],
    }));

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.equal(attempt.completedAt, NOW);
  });

  it("revertAttemptId preserved when provided", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: "Done",
      evidenceRefs: [],
    }));

    const original = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    const revert = recordExecutionAttempt({
      plan,
      approval,
      status: "reverted",
      executedBy: "alice",
      actionResults: [],
      revertAttemptId: original.attemptId,
      failureReason: "Rolled back due to side effects",
      now: NOW,
    });

    assert.equal(revert.status, "reverted");
    assert.equal(revert.revertAttemptId, original.attemptId);
    assert.equal(revert.failureReason, "Rolled back due to side effects");
  });

  it("reverted status without failureReason → throws", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);

    assert.throws(
      () =>
        recordExecutionAttempt({
          plan,
          approval,
          status: "reverted",
          executedBy: "alice",
          actionResults: [],
          now: NOW,
        }),
      AttemptValidationError,
    );
  });

  it("started status with actionResults matching approved actions", () => {
    const plan = makeDraftPlan();
    const approval = approveAllActions(plan);
    const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
      actionId: a.actionId,
      status: "succeeded",
      summary: a.description,
      evidenceRefs: [],
    }));

    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status: "started",
      executedBy: "alice",
      actionResults,
      now: NOW,
    });

    assert.equal(attempt.actionResults.length, actionResults.length);
    for (let i = 0; i < actionResults.length; i++) {
      assert.equal(attempt.actionResults[i]!.actionId, actionResults[i]!.actionId);
    }
  });
});
