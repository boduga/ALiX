import { describe, it, expect } from "vitest";
import { reconcileApplyStep } from "../../src/executive/executive-apply-reconciler.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-1",
    stepNumber: 1,
    title: "Test step",
    action: "create_remediation_proposal",
    objectiveId: "obj-1",
    targetSubsystem: "adaptation",
    riskLevel: "medium",
    objectiveScore: 0,
    priorityScore: 0,
    status: "pending",
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(steps: ExecutionStep[]): PersistedExecutionPlan {
  return {
    id: "plan-1",
    steps,
    objectives: ["obj-1"],
    generatedAt: "2026-06-25T00:00:00.000Z",
    windowDays: 7,
    planStatus: "ready",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "test-hash",
  };
}

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "proposal-1",
    status: "pending",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "create-step-1",
      objectiveId: "obj-1",
      subsystem: "adaptation",
    },
    provenance: "manual",
    reason: "test",
    createdAt: "2026-06-25T00:00:00.000Z",
    sourceRecommendationType: "executive_remediation_request",
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {},
    ...overrides,
  } as AdaptationProposal;
}

describe("reconcileApplyStep", () => {
  it("returns stepCompleted=false when no sibling create_remediation_proposal step exists", () => {
    const plan = makePlan([
      makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" }),
    ]);
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const result = reconcileApplyStep(plan, applyStep, []);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when sibling exists but no matching proposal in store", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const result = reconcileApplyStep(plan, applyStep, []);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when matching proposal status is 'pending'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "pending",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=false when matching proposal status is 'approved'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "approved",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(false);
  });

  it("returns stepCompleted=true with matched IDs when proposal status is 'applied'", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const proposal = makeProposal({
      id: "proposal-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [proposal]);
    expect(result.stepCompleted).toBe(true);
    expect(result.matchedProposalId).toBe("proposal-1");
    expect(result.matchedCreateStepId).toBe("create-1");
  });

  it("selects correct proposal when multiple proposals exist and only one matches planId + stepId", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const unrelatedProposal = makeProposal({
      id: "unrelated-1",
      target: { kind: "executive_remediation", planId: "other-plan", stepId: "other-step", objectiveId: "other-obj", subsystem: "adaptation" },
      status: "applied",
    });
    const matchingProposal = makeProposal({
      id: "match-1",
      target: { kind: "executive_remediation", planId: "plan-1", stepId: "create-1", objectiveId: "obj-1", subsystem: "adaptation" },
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [unrelatedProposal, matchingProposal]);
    expect(result.stepCompleted).toBe(true);
    expect(result.matchedProposalId).toBe("match-1");
  });

  it("correctly filters out non-executive-remediation proposals", () => {
    const createStep = makeStep({ id: "create-1", action: "create_remediation_proposal", objectiveId: "obj-1" });
    const applyStep = makeStep({ id: "apply-1", action: "apply_remediation", objectiveId: "obj-1" });
    const plan = makePlan([createStep, applyStep]);
    const govProposal = makeProposal({
      id: "gov-1",
      action: "governance_change",
      target: { kind: "governance", recommendationId: "rec-1" } as any,
      status: "applied",
    });
    const result = reconcileApplyStep(plan, applyStep, [govProposal]);
    expect(result.stepCompleted).toBe(false);
  });
});
