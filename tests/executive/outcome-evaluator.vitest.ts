import { describe, it, expect } from "vitest";
import { evaluatePlanOutcome } from "../../src/executive/outcome-evaluator.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

// -----------------------------------------------------------------------
// Factory helpers
// -----------------------------------------------------------------------

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "s1",
    stepNumber: 1,
    title: "Test step",
    action: "diagnose_root_cause",
    objectiveId: "obj-1",
    targetSubsystem: "workflow",
    riskLevel: "medium",
    objectiveScore: 0,
    priorityScore: 0,
    status: "pending",
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<PersistedExecutionPlan> = {}): PersistedExecutionPlan {
  return {
    id: "plan-1",
    steps: [],
    objectives: ["obj-1"],
    generatedAt: "2026-06-10T00:00:00.000Z",
    windowDays: 7,
    planStatus: "ready", // inherited from ExecutionPlan (draft|ready|blocked)
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "hash",
    ...overrides,
  };
}

function makeCompletedState(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
  return {
    planId: "plan-1",
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: "2026-06-10T00:00:00.000Z", completedAt: "2026-06-15T00:00:00.000Z" },
    ...overrides,
  };
}

function makeSnapshot(generatedAt: string, scores: Record<string, number>): ExecutiveTrendSnapshot {
  return {
    id: `snap-${generatedAt}`,
    generatedAt,
    windowDays: 7,
    subsystemScores: scores as any,
  };
}

// -----------------------------------------------------------------------
// Classification tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — classification", () => {
  it("classifies improved when all objective target subsystems have delta >= +5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("improved");
    expect(obj!.aggregateDelta).toBeGreaterThanOrEqual(5);
    expect(result.overallDelta).toBe(40);
  });

  it("classifies degraded when all delta <= -5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 80 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 30 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("degraded");
  });

  it("classifies unchanged when all |delta| < 5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 55 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 57 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("unchanged");
  });

  it("classifies mixed when at least one delta >= +5 and at least one delta <= -5", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 70 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80, governance: 30 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("mixed");
  });

  it("classifies improved when one subsystem improves and another is unchanged", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 60 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80, governance: 62 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    // workflow=+40 (>=+5), governance=+2 (|<5|): at least one >=+5, none <=-5 → improved
    expect(obj!.outcome).toBe("improved");
  });
});

// -----------------------------------------------------------------------
// Fail-closed tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — fail-closed guards", () => {
  it("returns plan_not_executed when plan status is 'running'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "running" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("plan_not_executed");
    expect(result.objectives).toHaveLength(0);
  });

  it("returns plan_not_executed when plan status is 'draft'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "draft" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns plan_not_executed when plan status is 'blocked'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "blocked" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns plan_not_executed when plan status is 'cancelled'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "cancelled" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns plan_not_executed when plan status is 'approved'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "approved" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns insufficient_data when baseline is null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, null, current);

    expect(result.evaluationStatus).toBe("insufficient_data");
    expect(result.warnings).toContain("No baseline snapshot found");
  });

  it("returns insufficient_data when current is null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });

    const result = evaluatePlanOutcome(plan, state, baseline, null);

    expect(result.evaluationStatus).toBe("insufficient_data");
    expect(result.warnings).toContain("No current snapshot found");
  });

  it("returns insufficient_data when both snapshots are null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("insufficient_data");
  });

  it("passes through when status is 'failed' (terminal state → evaluation)", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState({ status: "failed" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    expect(result.objectives.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Output shape tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — output shape", () => {
  it("includes snapshot metadata in the report", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.baselineSnapshotId).toBe(baseline.id);
    expect(result.baselineGeneratedAt).toBe(baseline.generatedAt);
    expect(result.currentSnapshotId).toBe(current.id);
    expect(result.currentGeneratedAt).toBe(current.generatedAt);
  });

  it("computes overallDelta as mean of all subsystem deltas", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "apply_remediation", objectiveId: "obj-2", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2], objectives: ["obj-1", "obj-2"] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 60 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70, governance: 50 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    // workflow +30, governance -10 → mean = (+30 + -10) / 2 = +10
    expect(result.overallDelta).toBe(10);
  });

  it("populates evaluatedSubsystems from step target subsystems", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 60, governance: 55 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluatedSubsystems).toContain("workflow");
    expect(result.evaluatedSubsystems).toContain("governance");
    expect(result.evaluatedSubsystems.length).toBe(2);
  });

  it("infers objectiveType from step actions (stabilize for apply_remediation)", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.objectiveType).toBe("stabilize");
  });

  it("infers objectiveType as maintain when no recognizable actions exist", () => {
    const step = makeStep({ action: "update_documentation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 42 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.objectiveType).toBe("maintain");
  });
});
