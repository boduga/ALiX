import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ReadinessClassificationError,
  approvedActionsFor,
  classifyExecutionReadiness,
} from "../../src/governance/execution-readiness.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type {
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "../../src/governance/execution-plans.js";

const NOW = "2026-07-08T18:00:00.000Z";

function makeAction(
  overrides: Partial<GovernanceExecutionAction> = {},
): GovernanceExecutionAction {
  return {
    actionId: "act-1",
    kind: "investigate_anomaly",
    description: "Investigate",
    target: { type: "anomaly", id: "anom-1" },
    expectedEffect: "Cause identified",
    mutationRequired: false,
    externalSideEffect: false,
    approvalRequired: true,
    reversible: true,
    rollbackHint: null,
    ...overrides,
  };
}

function makePlan(
  actions: GovernanceExecutionAction[] = [makeAction()],
  overrides: Partial<GovernanceExecutionPlan> = {},
): GovernanceExecutionPlan {
  return {
    planId: "plan-1",
    remediationId: "rem-1",
    sourceProposalId: "proposal-1",
    status: "draft",
    title: "Plan",
    summary: "Summary",
    proposedActions: actions,
    riskLevel: "low",
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

function makeApproval(
  overrides: Partial<GovernanceExecutionApproval> = {},
): GovernanceExecutionApproval {
  return {
    approvalId: "approval-1",
    planId: "plan-1",
    remediationId: "rem-1",
    decision: "approved",
    rationale: "Approved",
    operatorId: "operator-1",
    createdAt: NOW,
    approvedActionIds: ["act-1"],
    auditRefs: [],
    ...overrides,
  };
}

describe("classifyExecutionReadiness", () => {
  it("rejects an approval that was not approved", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(
          makePlan(),
          makeApproval({ decision: "rejected", approvedActionIds: [] }),
          { now: NOW },
        ),
      ReadinessClassificationError,
    );
  });

  it("rejects an approval for another plan", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(
          makePlan(),
          makeApproval({ planId: "plan-other" }),
          { now: NOW },
        ),
      { name: "ReadinessClassificationError", message: /planId/ },
    );
  });

  it("classifies fully supported non-mutating actions as dry-run capable", () => {
    const assessment = classifyExecutionReadiness(makePlan(), makeApproval(), {
      now: NOW,
    });

    assert.equal(assessment.readinessLevel, "dry_run_capable");
    assert.deepEqual(assessment.facts, {
      approvedActionCount: 1,
      mutationRequired: false,
      reversible: true,
      externalSideEffect: false,
      rollbackPlanPresent: false,
      rollbackCoverageComplete: true,
      simulatorCoverageComplete: true,
    });
    assert.deepEqual(
      assessment.reasons.map((reason) => reason.code),
      ["semantic_simulation_supported"],
    );
  });

  it("rejects an approval for another remediation", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(
          makePlan(),
          makeApproval({ remediationId: "rem-other" }),
        ),
      { name: "ReadinessClassificationError", message: /remediationId/ },
    );
  });

  it("rejects an empty approved action list", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(
          makePlan(),
          makeApproval({ approvedActionIds: [] }),
        ),
      { name: "ReadinessClassificationError", message: /non-empty/ },
    );
  });

  it("rejects an approved action absent from the plan", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(
          makePlan(),
          makeApproval({ approvedActionIds: ["unknown"] }),
        ),
      { name: "ReadinessClassificationError", message: /unknown/ },
    );
  });

  it("external side effects take highest readiness-level precedence", () => {
    const actions = [
      makeAction({ actionId: "safe" }),
      makeAction({
        actionId: "external",
        externalSideEffect: true,
        reversible: false,
        mutationRequired: true,
      }),
    ];
    const assessment = classifyExecutionReadiness(
      makePlan(actions),
      makeApproval({ approvedActionIds: ["safe", "external"] }),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "external_side_effecting");
    assert.deepEqual(assessment.reasons[0]!.actionIds, ["external"]);
  });

  it("collects every applicable reason independently of level precedence", () => {
    const actions = [
      makeAction({
        actionId: "external",
        externalSideEffect: true,
        reversible: false,
      }),
      makeAction({
        actionId: "manual",
        kind: "manual_action",
      }),
    ];
    const assessment = classifyExecutionReadiness(
      makePlan(actions),
      makeApproval({ approvedActionIds: ["manual", "external"] }),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "external_side_effecting");
    assert.deepEqual(
      assessment.reasons.map((item) => item.code),
      [
        "external_side_effect",
        "irreversible_action",
        "manual_action_required",
      ],
    );
  });

  it("irreversible actions take precedence over mutation", () => {
    const actions = [
      makeAction({
        actionId: "mutation",
        kind: "update_config",
        mutationRequired: true,
      }),
      makeAction({ actionId: "irreversible", reversible: false }),
    ];
    const assessment = classifyExecutionReadiness(
      makePlan(actions),
      makeApproval({ approvedActionIds: ["mutation", "irreversible"] }),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "irreversible");
    assert.equal(assessment.facts.reversible, false);
  });

  it("does not describe mutation as reversible when any approved action is irreversible", () => {
    const actions = [
      makeAction({ actionId: "irreversible", reversible: false }),
      makeAction({
        actionId: "mutation",
        kind: "update_config",
        mutationRequired: true,
      }),
    ];
    const assessment = classifyExecutionReadiness(
      makePlan(actions),
      makeApproval({ approvedActionIds: ["mutation", "irreversible"] }),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "irreversible");
    assert.equal(
      assessment.reasons.some((item) => item.code === "irreversible_action"),
      true,
    );
    assert.equal(
      assessment.reasons.some((item) => item.code === "reversible_mutation"),
      false,
    );
  });

  it("classifies reversible mutation before simulator coverage", () => {
    const action = makeAction({
      kind: "update_config",
      mutationRequired: true,
    });
    const assessment = classifyExecutionReadiness(
      makePlan([action]),
      makeApproval(),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "reversible");
    assert.equal(assessment.facts.mutationRequired, true);
  });

  it("classifies unsupported non-mutating actions as manual-only", () => {
    const action = makeAction({ kind: "manual_action" });
    const assessment = classifyExecutionReadiness(
      makePlan([action]),
      makeApproval(),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "manual_only");
    assert.equal(assessment.facts.simulatorCoverageComplete, false);
  });

  it("excludes unapproved actions from classification", () => {
    const actions = [
      makeAction({ actionId: "approved" }),
      makeAction({
        actionId: "not-approved",
        externalSideEffect: true,
        reversible: false,
        mutationRequired: true,
      }),
    ];
    const plan = makePlan(actions);
    const approval = makeApproval({ approvedActionIds: ["approved"] });

    assert.deepEqual(
      approvedActionsFor(plan, approval).map((action) => action.actionId),
      ["approved"],
    );
    assert.equal(
      classifyExecutionReadiness(plan, approval, { now: NOW }).readinessLevel,
      "dry_run_capable",
    );
  });

  it("reports complete rollback coverage", () => {
    const action = makeAction({
      kind: "update_config",
      mutationRequired: true,
    });
    const plan = makePlan([action], {
      requiresRollbackPlan: true,
      rollbackPlan: {
        rollbackId: "rollback-1",
        summary: "Rollback",
        reversibleActions: ["act-1"],
        nonReversibleActions: [],
        operatorInstructions: [],
        riskNotes: [],
      },
    });
    const assessment = classifyExecutionReadiness(plan, makeApproval(), {
      now: NOW,
    });

    assert.equal(assessment.facts.rollbackPlanPresent, true);
    assert.equal(assessment.facts.rollbackCoverageComplete, true);
    assert.deepEqual(
      assessment.reasons.map((item) => item.code),
      ["reversible_mutation", "semantic_simulation_supported"],
    );
  });

  it("reports incomplete rollback coverage without changing precedence", () => {
    const actions = [
      makeAction({
        actionId: "covered",
        kind: "update_config",
        mutationRequired: true,
      }),
      makeAction({
        actionId: "uncovered",
        kind: "update_config",
        mutationRequired: true,
      }),
    ];
    const plan = makePlan(actions, {
      requiresRollbackPlan: true,
      rollbackPlan: {
        rollbackId: "rollback-1",
        summary: "Rollback",
        reversibleActions: ["covered"],
        nonReversibleActions: [],
        operatorInstructions: [],
        riskNotes: [],
      },
    });
    const assessment = classifyExecutionReadiness(
      plan,
      makeApproval({ approvedActionIds: ["uncovered", "covered"] }),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "reversible");
    assert.equal(assessment.facts.rollbackCoverageComplete, false);
    assert.deepEqual(
      assessment.reasons.map((item) => item.code),
      [
        "reversible_mutation",
        "rollback_coverage_incomplete",
        "semantic_simulation_supported",
      ],
    );
    assert.deepEqual(assessment.reasons[1]!.actionIds, ["uncovered"]);
  });

  it("reports a missing rollback plan without changing precedence", () => {
    const action = makeAction({
      kind: "update_config",
      mutationRequired: true,
    });
    const assessment = classifyExecutionReadiness(
      makePlan([action], { requiresRollbackPlan: true }),
      makeApproval(),
      { now: NOW },
    );

    assert.equal(assessment.readinessLevel, "reversible");
    assert.equal(assessment.facts.rollbackCoverageComplete, false);
    assert.deepEqual(
      assessment.reasons.map((item) => item.code),
      [
        "reversible_mutation",
        "rollback_plan_missing",
        "semantic_simulation_supported",
      ],
    );
  });

  it("does not report rollback gaps when rollback is not required", () => {
    const action = makeAction({
      kind: "update_config",
      mutationRequired: true,
    });
    const assessment = classifyExecutionReadiness(
      makePlan([action], { requiresRollbackPlan: false, rollbackPlan: null }),
      makeApproval(),
      { now: NOW },
    );

    assert.equal(assessment.facts.rollbackCoverageComplete, false);
    assert.equal(
      assessment.reasons.some((item) => item.code.startsWith("rollback_")),
      false,
    );
  });

  it("produces deterministic output and the specified assessment ID", () => {
    const plan = makePlan();
    const approval = makeApproval();
    const first = classifyExecutionReadiness(plan, approval, { now: NOW });
    const second = classifyExecutionReadiness(plan, approval, { now: NOW });
    const expectedId = createHash("sha256")
      .update(
        [
          "p19.1",
          plan.planId,
          approval.approvalId,
          "dry_run_capable",
          NOW,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 16);

    assert.deepEqual(first, second);
    assert.equal(first.assessmentId, expectedId);
    assert.equal(first.assessedAt, NOW);
  });

  it("rejects a malformed assessment timestamp", () => {
    assert.throws(
      () =>
        classifyExecutionReadiness(makePlan(), makeApproval(), {
          now: "July 8, 2026",
        }),
      { name: "ReadinessClassificationError", message: /assessedAt/ },
    );
  });

  it("does not mutate plan or approval inputs", () => {
    const actions = [
      makeAction({ actionId: "z-action" }),
      makeAction({ actionId: "a-action" }),
    ];
    const plan = makePlan(actions);
    const approval = makeApproval({
      approvedActionIds: ["z-action", "a-action"],
    });
    const planSnapshot = structuredClone(plan);
    const approvalSnapshot = structuredClone(approval);

    classifyExecutionReadiness(plan, approval, { now: NOW });

    assert.deepEqual(plan, planSnapshot);
    assert.deepEqual(approval, approvalSnapshot);
  });
});
