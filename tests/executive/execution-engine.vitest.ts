import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner } from "../../src/executive/step-runner.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { PersistedExecutionPlan, PlanExecutionState, ExecutiveStepExecutionResult } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

function makePlan(steps: Partial<ExecutionStep>[] = [{ id: "step-1", action: "diagnose_root_cause" }]): PersistedExecutionPlan {
  return {
    id: "plan-test-1",
    objectives: ["obj-1"],
    steps: steps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      action: (s.action ?? "diagnose_root_cause") as ExecutionStep["action"],
      title: s.title ?? "Test step",
      stepNumber: s.stepNumber ?? (i + 1),
      targetSubsystem: (s.targetSubsystem ?? "governance") as any,
      dependsOn: s.dependsOn ?? [],
      status: "pending",
      objectiveId: "obj-1",
      priorityScore: 50,
      objectiveScore: 50,
      riskLevel: "medium",
    })),
    generatedAt: "2026-06-25T00:00:00.000Z",
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "abc",
  };
}

function makeState(steps: string[] = ["step-1"]): PlanExecutionState {
  const stepStates: Record<string, any> = {};
  for (const id of steps) {
    stepStates[id] = { status: "pending", evidenceIds: [], generatedArtifacts: [], warnings: [] };
  }
  return {
    planId: "plan-test-1",
    status: "approved",
    approval: { status: "approved", approvedBy: "user", approvedAt: "2026-06-25T00:00:00.000Z" },
    stepStates,
    planTransitions: [{ sequence: 1, from: "draft", to: "approved", at: "2026-06-25T00:00:00.000Z" }],
    timestamps: { createdAt: "2026-06-25T00:00:00.000Z", approvedAt: "2026-06-25T00:00:00.000Z" },
  };
}

describe("ExecutionEngine", () => {
  let planStore: PlanStore;
  let stateStore: ExecutionStateStore;
  let runner: StepRunner;
  let writer: EvidenceEventWriter;
  let engine: ExecutionEngine;

  beforeEach(() => {
    planStore = { load: vi.fn(), save: vi.fn(), list: vi.fn() } as unknown as PlanStore;
    stateStore = {
      init: vi.fn(),
      load: vi.fn(),
      update: vi.fn(),
    } as unknown as ExecutionStateStore;
    runner = {
      execute: vi.fn(),
    } as unknown as StepRunner;
    writer = {
      recordExecutivePlanStarted: vi.fn().mockResolvedValue(null),
      recordExecutivePlanCompleted: vi.fn().mockResolvedValue(null),
      recordExecutiveStepExecuted: vi.fn().mockResolvedValue({ id: "evt-1" }),
      recordExecutiveStepBlocked: vi.fn().mockResolvedValue(null),
    } as unknown as EvidenceEventWriter;
    engine = new ExecutionEngine(planStore, stateStore, runner, writer);
  });

  describe("startPlan", () => {
    it("starts an approved plan", () => {
      vi.mocked(planStore.load).mockReturnValue(makePlan());
      vi.mocked(stateStore.load).mockReturnValue(makeState());
      vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
        const state = makeState();
        return { ...mutator(state), planTransitions: [] } as PlanExecutionState;
      });

      engine.startPlan("plan-test-1", "user");
      expect(writer.recordExecutivePlanStarted).toHaveBeenCalledWith({
        planId: "plan-test-1",
        runnableStepCount: expect.any(Number),
        executionId: expect.any(String),
      });
    });

    it("throws for non-approved plan", () => {
      vi.mocked(planStore.load).mockReturnValue(makePlan());
      vi.mocked(stateStore.load).mockReturnValue(makeState());
      vi.mocked(stateStore.load).mockReturnValue({ ...makeState(), status: "draft" });
      expect(() => engine.startPlan("plan-test-1", "user")).toThrow("must be \"approved\"");
    });
  });

  describe("nextRunnableSteps", () => {
    it("returns pending steps with no dependencies", () => {
      vi.mocked(planStore.load).mockReturnValue(makePlan());
      vi.mocked(stateStore.load).mockReturnValue(makeState());
      expect(engine.nextRunnableSteps("plan-test-1")).toEqual(["step-1"]);
    });

    it("does not return completed steps", () => {
      vi.mocked(planStore.load).mockReturnValue(makePlan());
      vi.mocked(stateStore.load).mockReturnValue(makeState());
      const state = makeState();
      state.stepStates["step-1"].status = "completed";
      vi.mocked(stateStore.load).mockReturnValue(state);
      expect(engine.nextRunnableSteps("plan-test-1")).toEqual([]);
    });

    it("returns step with completed dependency", () => {
      const plan = makePlan([
        { id: "step-1", action: "diagnose_root_cause", stepNumber: 1 },
        { id: "step-2", action: "audit_metrics", stepNumber: 2, dependsOn: ["step-1"] },
      ]);
      vi.mocked(planStore.load).mockReturnValue(plan);
      const state = makeState(["step-1", "step-2"]);
      state.stepStates["step-1"].status = "completed";
      vi.mocked(stateStore.load).mockReturnValue(state);

      const runnable = engine.nextRunnableSteps("plan-test-1");
      expect(runnable).toEqual(["step-2"]);
    });
  });

  describe("runStep", () => {
    it("runs a runnable step", async () => {
      const plan = makePlan();
      vi.mocked(planStore.load).mockReturnValue(plan);
      const state = makeState();
      state.status = "running";
      vi.mocked(stateStore.load).mockReturnValue(state);

      const mockRunnerResult = {
        outcome: "executed", newStepStatus: "completed", durationMs: 5,
        evidenceIds: ["evt-1"], generatedArtifacts: [], warnings: [], retryable: false,
      };
      vi.mocked(runner.execute).mockResolvedValue(mockRunnerResult as any);

      // stateStore.update returns a state that shows step completed
      let stepCompleted = false;
      vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
        const s = JSON.parse(JSON.stringify(state));
        mutator(s);
        stepCompleted = s.stepStates["step-1"]?.status === "completed";
        return s;
      });

      const result = await engine.runStep("plan-test-1", "step-1");
      expect(result.stepId).toBe("step-1");
      expect(result.status).toBe("completed");
    });

    it("throws for non-runnable step", async () => {
      vi.mocked(planStore.load).mockReturnValue(makePlan());
      const state = makeState();
      state.stepStates["step-1"].status = "completed";
      vi.mocked(stateStore.load).mockReturnValue(state);
      await expect(engine.runStep("plan-test-1", "step-1")).rejects.toThrow("not runnable");
    });
  });

  describe("runReadySteps", () => {
    it("runs all runnable steps in order", async () => {
      const plan = makePlan([
        { id: "step-1", action: "diagnose_root_cause", stepNumber: 1 },
        { id: "step-2", action: "audit_metrics", stepNumber: 2, dependsOn: ["step-1"] },
      ]);
      vi.mocked(planStore.load).mockReturnValue(plan);
      let currentState: PlanExecutionState = makeState(["step-1", "step-2"]);
      currentState.status = "running";
      vi.mocked(stateStore.load).mockImplementation(() => JSON.parse(JSON.stringify(currentState)));

      const mockResult = {
        outcome: "executed", newStepStatus: "completed", durationMs: 5,
        evidenceIds: ["evt-1"], generatedArtifacts: [], warnings: [], retryable: false,
      };
      vi.mocked(runner.execute).mockResolvedValue(mockResult as any);

      // stateStore.update advances step state appropriately
      const completedSteps = new Set<string>();
      vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
        const s = JSON.parse(JSON.stringify(currentState));
        mutator(s);
        for (const [stepId, stepState] of Object.entries(s.stepStates) as [string, any][]) {
          if (stepState.status === "completed") completedSteps.add(stepId);
          if (stepState.status === "in_progress") {
            // Simulate completion on next update
            stepState.status = "completed";
            completedSteps.add(stepId);
          }
        }
        currentState = s;
        return JSON.parse(JSON.stringify(s));
      });

      const results = await engine.runReadySteps("plan-test-1");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.status === "completed")).toBe(true);
    });

    it("completes a linear DAG chain (A->B->C) in one runReadySteps invocation", async () => {
      // Verifies the "recompute after every step" invariant directly:
      // A completes -> B becomes runnable -> B completes -> C becomes runnable.
      // All three execute within a single runReadySteps call.
      const plan = makePlan([
        { id: "step-A", action: "diagnose_root_cause", stepNumber: 1 },
        { id: "step-B", action: "audit_metrics", stepNumber: 2, dependsOn: ["step-A"] },
        { id: "step-C", action: "identify_optimization_targets", stepNumber: 3, dependsOn: ["step-B"] },
      ]);
      vi.mocked(planStore.load).mockReturnValue(plan);
      let currentState: PlanExecutionState = makeState(["step-A", "step-B", "step-C"]);
      currentState.status = "running";
      vi.mocked(stateStore.load).mockImplementation(() => JSON.parse(JSON.stringify(currentState)));

      const mockResult = {
        outcome: "executed", newStepStatus: "completed", durationMs: 5,
        evidenceIds: ["evt-1"], generatedArtifacts: [], warnings: [], retryable: false,
      };
      vi.mocked(runner.execute).mockResolvedValue(mockResult as any);

      // Simulate: each stateStore.update call completes the step
      vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
        const s = JSON.parse(JSON.stringify(currentState));
        mutator(s);
        for (const [, stepState] of Object.entries(s.stepStates) as [string, any][]) {
          if (stepState.status === "in_progress") stepState.status = "completed";
        }
        currentState = s;
        return JSON.parse(JSON.stringify(s));
      });

      const results = await engine.runReadySteps("plan-test-1");
      expect(results).toHaveLength(3);
      expect(results.map(r => r.stepId)).toEqual(["step-A", "step-B", "step-C"]);
      expect(results.every(r => r.status === "completed")).toBe(true);
    });
  });
});
