import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simulateExecutionPlan,
  DryRunSimulationError,
} from "../../src/governance/dry-run-simulator.js";
import {
  classifyExecutionReadiness,
  type ExecutionReadinessAssessment,
} from "../../src/governance/execution-readiness.js";
import type { GovernanceExecutionAction } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";

const NOW = "2026-07-08T18:00:00.000Z";

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
  actions: GovernanceExecutionAction[],
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

describe("simulateExecutionPlan", () => {
  it("semantically simulates supported read-only actions", () => {
    const p = plan([
      action("investigate", { kind: "investigate_anomaly" }),
      action("policy", { kind: "review_policy" }),
    ]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.equal(result.status, "complete");
    assert.equal(result.explicitlyNonExecuting, true);
    assert.deepEqual(
      result.actionProjections.map((item) => item.actionId),
      ["investigate", "policy"],
    );
    assert.ok(
      result.actionProjections.every((item) => item.status === "simulated"),
    );
  });

  it("semantically simulates config mutation with rollback notes", () => {
    const p = plan([
      action("config", {
        kind: "update_config",
        mutationRequired: true,
        rollbackHint: "Restore from backup",
      }),
    ]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.equal(result.status, "complete");
    assert.equal(result.actionProjections[0]!.status, "simulated");
    assert.deepEqual(result.rollbackNotes, ["Restore from backup"]);
  });

  it("marks manual action as manual required", () => {
    const p = plan([action("manual", { kind: "manual_action" })]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.equal(result.status, "partial");
    assert.equal(result.actionProjections[0]!.status, "manual_required");
  });

  for (const level of ["external_side_effecting", "irreversible"] as const) {
    it(`blocks ${level} assessment`, () => {
      const p = plan([
        action("blocked", {
          externalSideEffect: level === "external_side_effecting",
          reversible: level !== "irreversible",
        }),
      ]);
      const a = approval(p);
      const assessment = classifyExecutionReadiness(p, a, { now: NOW });
      const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

      assert.equal(result.status, "blocked");
      assert.equal(result.actionProjections[0]!.status, "blocked");
    });
  }

  it("adds rollback notes for reversible mutation", () => {
    const p = plan(
      [
        action("config", {
          kind: "update_config",
          mutationRequired: true,
          rollbackHint: "Restore prior value",
        }),
      ],
      {
        rollbackPlan: {
          rollbackId: "rb-1",
          summary: "Restore config",
          reversibleActions: ["config"],
          nonReversibleActions: [],
          operatorInstructions: ["Restore prior value"],
          riskNotes: [],
        },
      },
    );
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.deepEqual(result.rollbackNotes, ["Restore prior value"]);
  });

  it("produces deterministic output", () => {
    const p = plan([action("a")]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });

    assert.deepEqual(
      simulateExecutionPlan(p, a, assessment, { now: NOW }),
      simulateExecutionPlan(p, a, assessment, { now: NOW }),
    );
  });

  it("fails closed for an unknown future action kind", () => {
    const unknown = action("future", {
      kind: "future_kind" as GovernanceExecutionAction["kind"],
    });
    const p = plan([unknown]);
    const a = approval(p);
    const assessment = {
      ...classifyExecutionReadiness(p, a, { now: NOW }),
      readinessLevel: "manual_only" as const,
    };

    assert.throws(
      () => simulateExecutionPlan(p, a, assessment, { now: NOW }),
      DryRunSimulationError,
    );
  });

  it("rejects mismatched assessment and preserves inputs", () => {
    const p = plan([action("a")]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const before = JSON.stringify({ p, a, assessment });

    assert.throws(
      () =>
        simulateExecutionPlan(
          p,
          a,
          { ...assessment, planId: "other" },
          { now: NOW },
        ),
      DryRunSimulationError,
    );

    assert.equal(JSON.stringify({ p, a, assessment }), before);
  });

  it("produces partial status for mixed supported/manual actions", () => {
    const p = plan([
      action("supported", { kind: "investigate_anomaly" }),
      action("manual", { kind: "manual_action" }),
    ]);
    const a = approval(p);
    const assessment = classifyExecutionReadiness(p, a, { now: NOW });
    const result = simulateExecutionPlan(p, a, assessment, { now: NOW });

    assert.equal(result.status, "partial");
    assert.equal(
      result.actionProjections.find((item) => item.actionId === "supported")!
        .status,
      "simulated",
    );
    assert.equal(
      result.actionProjections.find((item) => item.actionId === "manual")!
        .status,
      "manual_required",
    );
  });
});
