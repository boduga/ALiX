import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHandoffPackage,
  HandoffBuilderError,
} from "../../src/governance/handoff-builder.js";
import type { GovernanceExecutionAction } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";
import { classifyExecutionReadiness } from "../../src/governance/execution-readiness.js";
import { simulateExecutionPlan } from "../../src/governance/dry-run-simulator.js";
import {
  evaluateReadinessGate,
  type ExecutionReadinessPolicy,
} from "../../src/governance/readiness-policy-gate.js";

const NOW = "2026-07-08T18:00:00.000Z";

const POLICY: ExecutionReadinessPolicy = {
  policyId: "policy-default",
  allowSemanticDryRunFor: ["dry_run_capable", "reversible"],
  requireCompleteRollbackForReversible: true,
  blockExternalSideEffects: true,
  blockIrreversibleActions: true,
  requireP18Visibility: true,
};

function action(
  id: string,
  overrides: Partial<GovernanceExecutionAction> = {},
): GovernanceExecutionAction {
  return {
    actionId: id,
    kind: "investigate_anomaly",
    description: `Action ${id}`,
    target: { type: "anomaly", id: null },
    expectedEffect: "Evidence documented",
    mutationRequired: false,
    externalSideEffect: false,
    approvalRequired: true,
    reversible: true,
    rollbackHint: null,
    ...overrides,
  };
}

function plan(
  actions: GovernanceExecutionAction[] = [action("a")],
  overrides: Partial<GovernanceExecutionPlan> = {},
): GovernanceExecutionPlan {
  return {
    planId: "plan-1",
    remediationId: "rem-1",
    sourceProposalId: "rem-1",
    status: "draft",
    title: "Plan",
    summary: "Summary",
    proposedActions: actions,
    riskLevel: "medium",
    requiresRollbackPlan: false,
    rollbackPlan: null,
    createdAt: NOW,
    createdBy: "system",
    approvedAt: null,
    approvedBy: null,
    executionAttemptIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function approval(
  p: GovernanceExecutionPlan,
  approvedActionIds = p.proposedActions.map((item) => item.actionId),
  overrides: Partial<GovernanceExecutionApproval> = {},
): GovernanceExecutionApproval {
  return {
    approvalId: "approval-1",
    planId: p.planId,
    remediationId: p.remediationId,
    decision: "approved",
    rationale: "Reviewed",
    operatorId: "operator-1",
    createdAt: NOW,
    approvedActionIds,
    auditRefs: [],
    ...overrides,
  };
}

function trace(
  p: GovernanceExecutionPlan,
  a: GovernanceExecutionApproval,
  overrides: Partial<WorkbenchLifecycleTrace> = {},
): WorkbenchLifecycleTrace {
  return {
    remediationId: p.remediationId,
    hops: [
      { kind: "proposal", id: p.remediationId, status: "accepted", summary: "Proposal", timestamp: NOW, gap: false },
      { kind: "plan", id: p.planId, status: "plan_created", summary: "Plan", timestamp: NOW, gap: false },
      { kind: "approval", id: a.approvalId, status: "approved", summary: "Approval", timestamp: NOW, gap: false },
    ],
    ...overrides,
  };
}

function makeEligiblePipeline(
  kind: "investigate_anomaly" | "manual_action" = "investigate_anomaly",
) {
  const actions = [action("act-1", { kind })];
  const p = plan(actions);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  const visibility = {
    remediationId: p.remediationId,
    planId: p.planId,
    approvalId: a.approvalId,
    lifecycleTrace: trace(p, a),
  };
  const decision = evaluateReadinessGate({
    plan: p, approval: a, assessment, simulation,
    policy: POLICY, visibility,
    options: { now: NOW },
  });
  return { plan: p, approval: a, assessment, simulation, decision, lifecycleTrace: trace(p, a) };
}

describe("buildHandoffPackage", () => {
  it("rejects blocked readiness decision", () => {
    const p = plan([action("ext", { externalSideEffect: true, reversible: false })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const visibility = {
      remediationId: p.remediationId, planId: p.planId,
      approvalId: a.approvalId, lifecycleTrace: trace(p, a),
    };
    const decision = evaluateReadinessGate({
      plan: p, approval: a, assessment, simulation,
      policy: POLICY, visibility,
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.throws(
      () => buildHandoffPackage({
        plan: p, approval: a, assessment, simulation, decision, lifecycleTrace: trace(p, a),
      }),
      HandoffBuilderError,
    );
  });

  it("builds package with status pending for dry_run_allowed", () => {
    const pipeline = makeEligiblePipeline("investigate_anomaly");
    const pkg = buildHandoffPackage(pipeline, { now: NOW });
    assert.equal(pkg.status, "pending");
    assert.equal(pkg.explicitlyManualOnly, true);
    assert.equal(pkg.evidenceCaptured, false);
    assert.ok(pkg.handoffId.length > 0);
  });

  it("builds package for manual_only disposition", () => {
    const pipeline = makeEligiblePipeline("manual_action");
    const pkg = buildHandoffPackage(pipeline, { now: NOW });
    assert.equal(pkg.disposition, "manual_only");
    assert.equal(pkg.status, "pending");
    assert.ok(pkg.actions.length > 0);
  });

  it("generates evidence refs for mutating actions with complete rollback", () => {
    const p = plan(
      [action("cfg", { kind: "update_config", mutationRequired: true })],
      {
        requiresRollbackPlan: true,
        rollbackPlan: {
          rollbackId: "rb-1", summary: "Rollback config",
          reversibleActions: ["cfg"], nonReversibleActions: [],
          operatorInstructions: ["Restore prior config"], riskNotes: [],
        },
      },
    );
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const visibility = {
      remediationId: p.remediationId, planId: p.planId,
      approvalId: a.approvalId, lifecycleTrace: trace(p, a),
    };
    const decision = evaluateReadinessGate({
      plan: p, approval: a, assessment, simulation,
      policy: POLICY, visibility,
      options: { now: NOW },
    });
    const pkg = buildHandoffPackage({
      plan: p, approval: a, assessment, simulation, decision, lifecycleTrace: trace(p, a),
    }, { now: NOW });
    assert.ok(pkg.evidence.length > 0);
    assert.ok(pkg.evidence.every((e) => e.required === true));
    assert.ok(pkg.actions.find((ac) => ac.actionId === "cfg")?.evidenceRequired);
  });

  it("includes operator instructions from simulation", () => {
    const pipeline = makeEligiblePipeline("manual_action");
    const pkg = buildHandoffPackage(pipeline, { now: NOW });
    assert.ok(pkg.operatorInstructions.length > 0);
    assert.ok(pkg.operatorInstructions.some((i) => i.includes("ALiX does not execute")));
  });

  it("produces deterministic handoff ID", () => {
    const pipeline = makeEligiblePipeline("investigate_anomaly");
    const first = buildHandoffPackage(pipeline, { now: NOW });
    const second = buildHandoffPackage(pipeline, { now: NOW });
    assert.equal(first.handoffId, second.handoffId);
  });

  it("does not mutate inputs", () => {
    const pipeline = makeEligiblePipeline("investigate_anomaly");
    const before = JSON.stringify({ plan: pipeline.plan, approval: pipeline.approval });
    buildHandoffPackage(pipeline, { now: NOW });
    assert.equal(JSON.stringify({ plan: pipeline.plan, approval: pipeline.approval }), before);
  });
});
