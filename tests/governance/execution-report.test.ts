import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExecutionReport } from "../../src/governance/execution-report.js";
import type {
  GovernanceExecutionReport,
  GovernanceExecutionReportItem,
} from "../../src/governance/execution-report.js";
import { createExecutionPlanFromRemediation } from "../../src/governance/execution-plans.js";
import { approveExecutionPlan, rejectExecutionPlan } from "../../src/governance/execution-approval.js";
import { recordExecutionAttempt } from "../../src/governance/execution-recorder.js";
import type { GovernanceExecutionActionResult } from "../../src/governance/execution-recorder.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";

const NOW = "2026-07-07T14:00:00.000Z";
const SEVEN_DAYS_AGO = "2026-06-30T14:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(
  overrides: Partial<GovernanceRemediationProposal> = {},
): GovernanceRemediationProposal {
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

function makePlan(overrides: Partial<GovernanceExecutionPlan> = {}): GovernanceExecutionPlan {
  return {
    ...createExecutionPlanFromRemediation(makeProposal(), { now: NOW }),
    ...overrides,
  } as GovernanceExecutionPlan;
}

function makeApprovedApproval(
  plan: GovernanceExecutionPlan,
  operator = "alice",
): GovernanceExecutionApproval {
  return approveExecutionPlan(
    plan,
    operator,
    "looks good",
    plan.proposedActions.map((a) => a.actionId),
    { now: NOW },
  );
}

function makeRejectedApproval(plan: GovernanceExecutionPlan): GovernanceExecutionApproval {
  return rejectExecutionPlan(plan, "alice", "not needed", { now: NOW });
}

function makeAttempt(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  status: "started" | "succeeded" | "failed" | "partial" | "reverted",
  overrides: Partial<{
    executedBy: string;
    failureReason: string | null;
  }> = {},
) {
  const actionResults: GovernanceExecutionActionResult[] = plan.proposedActions.map((a) => ({
    actionId: a.actionId,
    status: "succeeded",
    summary: `Completed: ${a.description}`,
    evidenceRefs: [],
  }));

  return recordExecutionAttempt({
    plan,
    approval,
    status,
    executedBy: overrides.executedBy ?? "alice",
    actionResults,
    failureReason: overrides.failureReason ?? (status === "failed" || status === "partial" || status === "reverted" ? `Status: ${status}` : null),
    now: NOW,
  });
}

function makeProposalWithId(id: string, overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return makeProposal({ proposalId: id, ...overrides });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findItem(report: GovernanceExecutionReport, remediationId: string): GovernanceExecutionReportItem {
  const item = report.items.find((i) => i.remediationId === remediationId);
  assert.ok(item, `Item not found for remediation ${remediationId}`);
  return item!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExecutionReport", () => {
  it("empty inputs produce zero totals", () => {
    const report = buildExecutionReport({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.generatedAt, NOW);
    assert.deepEqual(report.totals, {
      accepted: 0,
      planned: 0,
      approved: 0,
      rejected: 0,
      executed: 0,
      failed: 0,
      partial: 0,
      reverted: 0,
      unresolved: 0,
      superseded: 0,
    });
    assert.deepEqual(report.items, []);
  });

  it("accepted remediation without plan is unresolved", () => {
    const proposal = makeProposalWithId("r-1");
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.totals.accepted, 1);
    assert.equal(report.totals.unresolved, 1);
    assert.equal(report.totals.planned, 0);

    const item = findItem(report, "r-1");
    assert.equal(item.remediationStatus, "accepted");
    assert.equal(item.planId, null);
    assert.equal(item.executionState, null);
    assert.equal(item.unresolved, true);
    assert.equal(item.requiresAttention, true);
  });

  it("accepted remediation with draft plan is planned + unresolved", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.totals.accepted, 1);
    assert.equal(report.totals.planned, 1);
    assert.equal(report.totals.unresolved, 1);
    assert.equal(report.totals.approved, 0);

    const item = findItem(report, "r-1");
    assert.equal(item.planId, plan.planId);
    assert.equal(item.executionState, "draft");
    assert.equal(item.unresolved, true);
    assert.equal(item.requiresAttention, true);
  });

  it("approved plan with no attempt requires attention", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.totals.approved, 1);
    assert.equal(report.totals.unresolved, 0);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "approved");
    assert.equal(item.requiresAttention, true);
    assert.equal(item.unresolved, false);
  });

  it("succeeded attempt counts as executed", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);
    const attempt = makeAttempt(plan, approval, "succeeded");
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW },
    });

    assert.equal(report.totals.executed, 1);
    assert.equal(report.totals.unresolved, 0);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "executed");
    assert.equal(item.requiresAttention, false);
    assert.equal(item.unresolved, false);
  });

  it("failed attempt counts as failed + unresolved + requires attention", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);
    const attempt = makeAttempt(plan, approval, "failed", { failureReason: "Error" });
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW },
    });

    assert.equal(report.totals.failed, 1);
    assert.equal(report.totals.unresolved, 1);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "failed");
    assert.equal(item.requiresAttention, true);
    assert.equal(item.unresolved, true);
  });

  it("partial attempt counts as partial + unresolved + requires attention", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);
    const attempt = makeAttempt(plan, approval, "partial", { failureReason: "Partial" });
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW },
    });

    assert.equal(report.totals.partial, 1);
    assert.equal(report.totals.unresolved, 1);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "partial");
    assert.equal(item.requiresAttention, true);
    assert.equal(item.unresolved, true);
  });

  it("reverted attempt counts as reverted", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);
    const attempt = makeAttempt(plan, approval, "reverted", { failureReason: "Reverted" });
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW },
    });

    assert.equal(report.totals.reverted, 1);
    assert.equal(report.totals.unresolved, 0);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "reverted");
    assert.equal(item.requiresAttention, false);
    assert.equal(item.unresolved, false);
  });

  it("rejected approval counts as rejected", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeRejectedApproval(plan);
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.totals.rejected, 1);

    const item = findItem(report, "r-1");
    assert.equal(item.executionState, "rejected");
    assert.equal(item.unresolved, true);
    assert.equal(item.requiresAttention, false); // rejected plans do not need attention
  });

  it("superseded remediation counts as superseded", () => {
    const proposal = makeProposalWithId("r-1", { status: "superseded" });
    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.totals.superseded, 1);

    const item = findItem(report, "r-1");
    assert.equal(item.remediationStatus, "superseded");
    assert.equal(item.executionState, "superseded");
    assert.equal(item.requiresAttention, false);
    assert.equal(item.unresolved, false);
  });

  it("report uses [since, until) window", () => {
    const inside = makeProposalWithId("inside", { createdAt: "2026-07-05T00:00:00.000Z" });
    const before = makeProposalWithId("before", { createdAt: "2026-06-01T00:00:00.000Z" });
    const after = makeProposalWithId("after", { createdAt: "2026-07-10T00:00:00.000Z" });

    const report = buildExecutionReport({
      remediations: [inside, before, after],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: {
        since: "2026-07-01T00:00:00.000Z",
        until: "2026-07-08T00:00:00.000Z",
        now: NOW,
      },
    });

    assert.equal(report.items.length, 1);
    assert.equal(report.items[0]!.remediationId, "inside");
    assert.equal(report.windowStart, "2026-07-01T00:00:00.000Z");
    assert.equal(report.windowEnd, "2026-07-08T00:00:00.000Z");
  });

  it("default window is last 7 days", () => {
    const recent = makeProposalWithId("recent", { createdAt: NOW });
    const old = makeProposalWithId("old", { createdAt: "2026-06-01T00:00:00.000Z" });

    const report = buildExecutionReport({
      remediations: [recent, old],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW },
    });

    assert.equal(report.items.length, 1);
    assert.equal(report.items[0]!.remediationId, "recent");
    // windowStart should be ~7 days before NOW
    const windowStartMs = new Date(report.windowStart).getTime();
    const nowMs = new Date(NOW).getTime();
    const diffDays = (nowMs - windowStartMs) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diffDays - 7) < 0.01, `Expected ~7 days, got ${diffDays}`);
  });

  it("report sorting is deterministic", () => {
    // Create two remediations: one needs attention, one doesn't
    const rAttention = makeProposalWithId("r-attention");
    const plan1 = makePlan({ remediationId: "r-attention", sourceProposalId: "r-attention" });
    // Needs attention: draft plan with no approval

    const rDone = makeProposalWithId("r-done");
    const plan2 = makePlan({ remediationId: "r-done", sourceProposalId: "r-done" });
    const approval2 = makeApprovedApproval(plan2);
    const attempt2 = makeAttempt(plan2, approval2, "succeeded");

    const report = buildExecutionReport({
      remediations: [rDone, rAttention],
      executionPlans: [plan2, plan1],
      approvals: [approval2],
      attempts: [attempt2],
      options: { now: NOW },
    });

    assert.equal(report.items.length, 2);
    // requiresAttention items first
    assert.equal(report.items[0]!.remediationId, "r-attention");
    assert.equal(report.items[1]!.remediationId, "r-done");

    // Run again, verify same order
    const report2 = buildExecutionReport({
      remediations: [rDone, rAttention],
      executionPlans: [plan2, plan1],
      approvals: [approval2],
      attempts: [attempt2],
      options: { now: NOW },
    });

    assert.equal(report2.items[0]!.remediationId, "r-attention");
    assert.equal(report2.items[1]!.remediationId, "r-done");
  });

  it("latest attempt per plan, not historical", () => {
    const proposal = makeProposalWithId("r-1");
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApprovedApproval(plan);

    // First a failed attempt, then a succeeded attempt (later in time)
    const failAttempt = makeAttempt(plan, approval, "failed", {
      failureReason: "First attempt failed",
    });
    const succeedAttempt = recordExecutionAttempt({
      plan,
      approval,
      status: "succeeded",
      executedBy: "alice",
      actionResults: plan.proposedActions.map((a) => ({
        actionId: a.actionId,
        status: "succeeded",
        summary: "Done",
        evidenceRefs: [],
      })),
      now: "2026-07-07T15:00:00.000Z",
    });

    const report = buildExecutionReport({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [failAttempt, succeedAttempt],
      options: { now: NOW, since: "2026-07-01T00:00:00.000Z", until: "2026-07-08T00:00:00.000Z" },
    });

    // Should count as executed (latest = succeeded), not failed
    assert.equal(report.totals.executed, 1);
    assert.equal(report.totals.failed, 0);
    assert.equal(report.totals.unresolved, 0);
  });
});
