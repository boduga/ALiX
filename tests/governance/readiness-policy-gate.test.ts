import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadinessGate,
  ReadinessGateError,
  type ExecutionReadinessPolicy,
  type WorkbenchVisibilityEvidence,
} from "../../src/governance/readiness-policy-gate.js";
import type { GovernanceExecutionAction } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";
import { classifyExecutionReadiness } from "../../src/governance/execution-readiness.js";
import { simulateExecutionPlan } from "../../src/governance/dry-run-simulator.js";

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
  actionId: string,
  overrides: Partial<GovernanceExecutionAction> = {},
): GovernanceExecutionAction {
  return {
    actionId,
    kind: "investigate_anomaly",
    description: `Action ${actionId}`,
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
      {
        kind: "proposal",
        id: p.remediationId,
        status: "accepted",
        summary: "Proposal",
        timestamp: NOW,
        gap: false,
      },
      {
        kind: "plan",
        id: p.planId,
        status: "plan_created",
        summary: "Plan",
        timestamp: NOW,
        gap: false,
      },
      {
        kind: "approval",
        id: a.approvalId,
        status: "approved",
        summary: "Approval",
        timestamp: NOW,
        gap: false,
      },
    ],
    ...overrides,
  };
}

function visibility(
  p: GovernanceExecutionPlan,
  a: GovernanceExecutionApproval,
  lifecycleTrace = trace(p, a),
): WorkbenchVisibilityEvidence {
  return {
    remediationId: p.remediationId,
    planId: p.planId,
    approvalId: a.approvalId,
    lifecycleTrace,
  };
}

function makeFullPipeline() {
  const p = plan([action("inspect")]);
  const a = approval(p);
  const assessment = classifyExecutionReadiness(p, a, { now: NOW });
  const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
  return { plan: p, approval: a, assessment, simulation };
}

describe("evaluateReadinessGate", () => {
  // --- Correlation validation ---

  it("rejects non-approved approval", () => {
    const p = plan([action("a")]);
    const a = approval(p, ["a"], { decision: "rejected" });
    const { assessment, simulation } = makeFullPipeline();
    assert.throws(
      () =>
        evaluateReadinessGate({
          plan: p,
          approval: a,
          assessment,
          simulation,
          policy: POLICY,
          visibility: visibility(p, a),
          options: { now: NOW },
        }),
      ReadinessGateError,
    );
  });

  it("rejects plan/approval ID mismatch", () => {
    const p = plan([action("a")]);
    const a = approval(p, ["a"], { planId: "other-plan" });
    const { assessment, simulation } = makeFullPipeline();
    assert.throws(
      () =>
        evaluateReadinessGate({
          plan: p,
          approval: a,
          assessment,
          simulation,
          policy: POLICY,
          visibility: visibility(p, a),
          options: { now: NOW },
        }),
      ReadinessGateError,
    );
  });

  it("rejects remediation ID mismatch", () => {
    const p = plan([action("a")]);
    const a = approval(p, ["a"], { remediationId: "other-rem" });
    const { assessment, simulation } = makeFullPipeline();
    assert.throws(
      () =>
        evaluateReadinessGate({
          plan: p,
          approval: a,
          assessment,
          simulation,
          policy: POLICY,
          visibility: visibility(p, a),
          options: { now: NOW },
        }),
      ReadinessGateError,
    );
  });

  it("rejects assessment/plan ID mismatch", () => {
    const p = plan([action("a")]);
    const a = approval(p);
    const { simulation } = makeFullPipeline();
    const badAssessment = {
      ...classifyExecutionReadiness(p, a, { now: NOW }),
      planId: "other-plan",
    };
    assert.throws(
      () =>
        evaluateReadinessGate({
          plan: p,
          approval: a,
          assessment: badAssessment,
          simulation,
          policy: POLICY,
          visibility: visibility(p, a),
          options: { now: NOW },
        }),
      ReadinessGateError,
    );
  });

  it("rejects simulation correlation mismatch", () => {
    const p = plan([action("a")]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const { simulation } = makeFullPipeline();
    const badSim = { ...simulation, planId: "other-plan" };
    assert.throws(
      () =>
        evaluateReadinessGate({
          plan: p,
          approval: a,
          assessment,
          simulation: badSim,
          policy: POLICY,
          visibility: visibility(p, a),
          options: { now: NOW },
        }),
      ReadinessGateError,
    );
  });

  // --- Decision rules ---

  it("blocks missing P18 visibility", () => {
    const { plan: p, approval: a, assessment, simulation } = makeFullPipeline();
    const brokenTrace = trace(p, a, {
      hops: trace(p, a).hops.filter((h) => h.kind !== "approval"),
    });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a, brokenTrace),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.ok(decision.reasonCodes.includes("p18_visibility_missing"));
  });

  it("blocks external_side_effecting", () => {
    const p = plan([
      action("ext", { externalSideEffect: true, reversible: false }),
    ]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.ok(decision.reasonCodes.includes("external_side_effect_blocked"));
    assert.equal(decision.controlledExecutionAuthorization, "not_available_in_p19");
  });

  it("blocks irreversible", () => {
    const p = plan([action("irr", { reversible: false })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.ok(decision.reasonCodes.includes("irreversible_action_blocked"));
  });

  it("blocks reversible mutation with incomplete rollback", () => {
    const p = plan(
      [action("config", { kind: "update_config", mutationRequired: true })],
      { requiresRollbackPlan: true, rollbackPlan: null },
    );
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "blocked");
    assert.ok(decision.reasonCodes.includes("rollback_coverage_incomplete"));
  });

  it("allows dry run for complete supported simulation", () => {
    const { plan: p, approval: a, assessment, simulation } = makeFullPipeline();
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "dry_run_allowed");
    assert.equal(decision.futureControlledExecutionCandidate, false);
  });

  it("returns manual_only when simulation is partial", () => {
    const p = plan([action("manual", { kind: "manual_action" })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.disposition, "manual_only");
  });

  it("marks only fully qualified reversible plan as future candidate", () => {
    const p = plan(
      [action("config", { kind: "update_config", mutationRequired: true })],
      {
        requiresRollbackPlan: true,
        rollbackPlan: {
          rollbackId: "rb-1",
          summary: "Rollback",
          reversibleActions: ["config"],
          nonReversibleActions: [],
          operatorInstructions: ["Restore"],
          riskNotes: [],
        },
      },
    );
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const simulation = simulateExecutionPlan(p, a, assessment, { now: NOW });
    const before = JSON.stringify({ plan: p, approval: a, assessment, simulation, policy: POLICY });
    const decision = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(decision.futureControlledExecutionCandidate, true);
    assert.equal(decision.controlledExecutionAuthorization, "not_available_in_p19");
    assert.equal(JSON.stringify({ plan: p, approval: a, assessment, simulation, policy: POLICY }), before);
  });

  // --- Determinism ---

  it("produces deterministic output", () => {
    const { plan: p, approval: a, assessment, simulation } = makeFullPipeline();
    const first = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    const second = evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.deepEqual(first, second);
    assert.equal(first.decisionId.length, 16);
  });

  it("does not mutate inputs", () => {
    const { plan: p, approval: a, assessment, simulation } = makeFullPipeline();
    const before = JSON.stringify({ plan: p, approval: a, assessment, simulation, policy: POLICY });
    evaluateReadinessGate({
      plan: p,
      approval: a,
      assessment,
      simulation,
      policy: POLICY,
      visibility: visibility(p, a),
      options: { now: NOW },
    });
    assert.equal(JSON.stringify({ plan: p, approval: a, assessment, simulation, policy: POLICY }), before);
  });
});
