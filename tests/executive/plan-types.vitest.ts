import { describe, it, expect } from "vitest";
import { behaviorFor, READ_ONLY_ACTIONS, INVESTIGATION_ACTIONS, MUTATION_ACTIONS, STEP_BEHAVIOR } from "../../src/executive/step-behavior.js";
import type { ExecutionStepAction } from "../../src/executive/planning-engine.js";

import { validateStateStepIds } from "../../src/executive/executive-plan-types.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// step-behavior tests
// ---------------------------------------------------------------------------

describe("step-behavior", () => {
  it("classifies all 12 actions", () => {
    const allActions = Object.keys(STEP_BEHAVIOR) as ExecutionStepAction[];
    expect(allActions).toHaveLength(12);
  });

  it("has exactly 6 read-only actions", () => {
    expect(READ_ONLY_ACTIONS.size).toBe(6);
  });

  it("has exactly 3 investigation actions", () => {
    expect(INVESTIGATION_ACTIONS.size).toBe(3);
  });

  it("has exactly 3 mutation actions", () => {
    expect(MUTATION_ACTIONS.size).toBe(3);
  });

  it("diagnose_root_cause is read-only", () => {
    expect(behaviorFor("diagnose_root_cause")).toBe("read-only");
  });

  it("triage_investigations is investigation", () => {
    expect(behaviorFor("triage_investigations")).toBe("investigation");
  });

  it("create_remediation_proposal is mutation", () => {
    expect(behaviorFor("create_remediation_proposal")).toBe("mutation");
  });
});

// ---------------------------------------------------------------------------
// validateStateStepIds tests
// ---------------------------------------------------------------------------

describe("executive-plan-types", () => {
  it("validateStateStepIds passes matching step IDs", () => {
    const plan = { id: "plan-x", steps: [{ id: "step-1" }, { id: "step-2" }] } as unknown as PersistedExecutionPlan;
    const state = { planId: "plan-x", stepStates: { "step-1": { status: "pending" }, "step-2": { status: "completed" } } } as unknown as PlanExecutionState;
    expect(() => validateStateStepIds(plan, state)).not.toThrow();
  });

  it("validateStateStepIds throws on unknown step ID", () => {
    // plan has step-1, state has step-3 — cardinalities match (1=1) but IDs
    // differ, so direction-1 fires first ("no runtime state").
    const plan = { id: "plan-x", steps: [{ id: "step-1" }] } as unknown as PersistedExecutionPlan;
    const state = { planId: "plan-x", stepStates: { "step-3": { status: "pending" } } } as unknown as PlanExecutionState;
    expect(() => validateStateStepIds(plan, state)).toThrow("no runtime state");
  });

  it("validateStateStepIds throws on cardinality mismatch", () => {
    const plan = { id: "plan-x", steps: [{ id: "step-1" }, { id: "step-2" }] } as unknown as PersistedExecutionPlan;
    const state = { planId: "plan-x", stepStates: { "step-1": { status: "pending" } } } as unknown as PlanExecutionState;
    expect(() => validateStateStepIds(plan, state)).toThrow("cardinality");
  });

  it("validateStateStepIds throws when plan step has no runtime state", () => {
    const plan = { id: "plan-x", steps: [{ id: "step-1" }, { id: "step-2" }] } as unknown as PersistedExecutionPlan;
    const state = { planId: "plan-x", stepStates: { "step-1": { status: "pending" }, "step-2": { status: "completed" }, "step-3": { status: "pending" } } } as unknown as PlanExecutionState;
    expect(() => validateStateStepIds(plan, state)).toThrow("cardinality");
  });
});
