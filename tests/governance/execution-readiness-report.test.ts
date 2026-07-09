import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExecutionReadinessReport } from "../../src/governance/execution-readiness-report.js";
import type { GovernanceExecutionAction } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { WorkbenchLifecycleTrace } from "../../src/governance/governance-workbench.js";
import { classifyExecutionReadiness } from "../../src/governance/execution-readiness.js";
import { simulateExecutionPlan } from "../../src/governance/dry-run-simulator.js";
import {
  evaluateReadinessGate,
  type ExecutionReadinessPolicy,
} from "../../src/governance/readiness-policy-gate.js";

const NOW = "2026-07-08T18:00:00.000Z";
const WINDOW_START = "2026-07-01T00:00:00.000Z";

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
) {
  return {
    remediationId: p.remediationId,
    planId: p.planId,
    approvalId: a.approvalId,
    lifecycleTrace,
  };
}

function makePipeline() {
  const p = plan([action("inspect")]);
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
  return { assessment, simulation, decision, lifecycleTrace: trace(p, a) };
}

describe("buildExecutionReadinessReport", () => {
  it("empty input produces zero totals", () => {
    const report = buildExecutionReadinessReport({
      assessments: [],
      simulations: [],
      decisions: [],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: NOW },
    });
    assert.equal(report.items.length, 0);
    assert.deepEqual(report.totals, {
      blocked: 0,
      manualOnly: 0,
      dryRunAllowed: 0,
      notEvaluated: 0,
      externalSideEffecting: 0,
      irreversible: 0,
      reversible: 0,
      dryRunCapable: 0,
      missingP18Visibility: 0,
      futureCandidates: 0,
    });
  });

  it("joins correlated artifacts and counts disposition", () => {
    const pipeline = makePipeline();
    const report = buildExecutionReadinessReport({
      assessments: [pipeline.assessment],
      simulations: [pipeline.simulation],
      decisions: [pipeline.decision],
      lifecycleTraces: [pipeline.lifecycleTrace],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    assert.equal(report.items[0]!.assessmentId, pipeline.assessment.assessmentId);
    assert.equal(report.items[0]!.simulationId, pipeline.simulation.simulationId);
    assert.equal(report.items[0]!.decisionId, pipeline.decision.decisionId);
    assert.equal(report.items[0]!.p18TracePresent, true);
    assert.equal(report.totals.dryRunAllowed, 1);
  });

  it("marks missing P18 trace as attention and never dry-run allowed", () => {
    const pipeline = makePipeline();
    const report = buildExecutionReadinessReport({
      assessments: [pipeline.assessment],
      simulations: [pipeline.simulation],
      decisions: [pipeline.decision],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    assert.equal(report.items[0]!.p18TracePresent, false);
    assert.equal(report.items[0]!.requiresAttention, true);
    assert.equal(report.items[0]!.futureControlledExecutionCandidate, false);
    assert.ok(report.items[0]!.reasonCodes.includes("p18_visibility_missing"));
  });

  it("marks missing simulation as not simulated", () => {
    const pipeline = makePipeline();
    const report = buildExecutionReadinessReport({
      assessments: [pipeline.assessment],
      simulations: [],
      decisions: [],
      lifecycleTraces: [pipeline.lifecycleTrace],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    assert.equal(report.items[0]!.simulationStatus, "not_simulated");
    assert.equal(report.items[0]!.disposition, "not_evaluated");
  });

  it("respects [since, until) time window", () => {
    const old = classifyExecutionReadiness(
      plan([action("old")]),
      approval(plan([action("old")])),
      { now: "2026-06-01T00:00:00.000Z" },
    );
    const report = buildExecutionReadinessReport({
      assessments: [old],
      simulations: [],
      decisions: [],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: NOW },
    });
    assert.equal(report.items.length, 0);
  });

  it("contains no operator identity or ranking fields", () => {
    const pipeline = makePipeline();
    const report = buildExecutionReadinessReport({
      assessments: [pipeline.assessment],
      simulations: [pipeline.simulation],
      decisions: [pipeline.decision],
      lifecycleTraces: [pipeline.lifecycleTrace],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    const json = JSON.stringify(report);
    assert.equal(json.includes("operatorId"), false);
    assert.equal(json.includes("ranking"), false);
    assert.equal(json.includes("leaderboard"), false);
  });

  it("sorts deterministically", () => {
    const a = classifyExecutionReadiness(
      plan([action("x")], { planId: "plan-a", remediationId: "rem-a" }),
      approval(plan([action("x")], { planId: "plan-a", remediationId: "rem-a" })),
      { now: NOW },
    );
    const b = classifyExecutionReadiness(
      plan([action("y")], { planId: "plan-b", remediationId: "rem-b" }),
      approval(plan([action("y")], { planId: "plan-b", remediationId: "rem-b" })),
      { now: NOW },
    );
    const first = buildExecutionReadinessReport({
      assessments: [a, b],
      simulations: [],
      decisions: [],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    const second = buildExecutionReadinessReport({
      assessments: [b, a],
      simulations: [],
      decisions: [],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    assert.deepEqual(first.items.map((i) => i.planId), second.items.map((i) => i.planId));
  });

  it("counts readiness levels correctly", () => {
    const p = plan([action("m", { kind: "update_config", mutationRequired: true })], { remediationId: "rem-m" });
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const report = buildExecutionReadinessReport({
      assessments: [assessment],
      simulations: [],
      decisions: [],
      lifecycleTraces: [],
      options: { now: NOW, since: WINDOW_START, until: "2026-07-09T00:00:00.000Z" },
    });
    assert.equal(report.totals.reversible, 1);
  });
});
