/**
 * P10.4c — ExecutionEngine apply_remediation reconciler dispatch integration tests.
 *
 * Exercises engine's new apply_remediation dispatch branch end-to-end with fake
 * StepRunner, fake ProposalStore, fake EvidenceEventWriter.
 *
 * Validates:
 *   (a) Completes step when matching applied proposal exists + records evidence
 *   (b) Stays waiting_for_bridge when no matching proposal exists
 *   (c) Is no-op when proposalStore is undefined (backward compat)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { OutcomeEvaluationHook } from "../../src/executive/automatic-outcome-hook.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner } from "../../src/executive/step-runner.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { StepRunnerResult } from "../../src/executive/executive-plan-types.js";

// -----------------------------------------------------------------------
// Factory helpers
// -----------------------------------------------------------------------

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

const CREATE_STEP = makeStep({
  id: "create-1",
  action: "create_remediation_proposal",
  objectiveId: "obj-1",
});

const APPLY_STEP = makeStep({
  id: "apply-1",
  stepNumber: 2,
  action: "apply_remediation",
  objectiveId: "obj-1",
  dependsOn: ["create-1"],
});

const PLAN: PersistedExecutionPlan = {
  id: "plan-1",
  steps: [CREATE_STEP, APPLY_STEP],
  objectives: ["obj-1"],
  generatedAt: "2026-06-25T00:00:00.000Z",
  windowDays: 7,
  planStatus: "ready",
  plannerVersion: "1.0.0",
  planningAlgorithm: "test",
  contentHash: "test-hash",
} as PersistedExecutionPlan;

function makeBaseState(): PlanExecutionState {
  return {
    planId: "plan-1",
    status: "running",
    approval: { status: "approved" },
    planTransitions: [],
    timestamps: {
      createdAt: "2026-06-25T00:00:00.000Z",
      runningAt: "2026-06-25T00:00:00.000Z",
    },
    stepStates: {
      "create-1": {
        status: "completed",
        generatedArtifacts: [],
        durationMs: 10,
        warnings: [],
        summary: "done",
        evidenceIds: [],
        startedAt: "2026-06-25T00:00:00.000Z",
        completedAt: "2026-06-25T00:00:00.000Z",
        lastExecutionId: "test-exec-1",
      },
      "apply-1": {
        status: "pending",
        generatedArtifacts: [],
        durationMs: 0,
        warnings: [],
        summary: "",
        evidenceIds: [],
        startedAt: "",
        completedAt: "",
        lastExecutionId: "",
      },
    },
  };
}

function makeAppliedProposal(): AdaptationProposal {
  return {
    id: "proposal-1",
    status: "applied",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "create-1",
      objectiveId: "obj-1",
      subsystem: "adaptation",
    },
    provenance: "manual" as const,
    reason: "test",
    createdAt: "2026-06-25T00:00:00.000Z",
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {},
    sourceRecommendationType: "",
  } as AdaptationProposal;
}

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

function createMocks() {
  const planStore = {
    load: vi.fn().mockReturnValue(PLAN),
  } as unknown as PlanStore;

  // Mutable state — `load` returns current state so that multiple calls
  // within runStep (nextRunnableSteps → load, executeStepInternal → load)
  // see the same object. `update` replaces the mutable reference so the
  // in_progress mark is visible to the downstream terminal mark.
  let currentState = makeBaseState();

  const stateStore = {
    load: vi.fn().mockImplementation((_id: string) => currentState),
    update: vi.fn().mockImplementation(
      (
        _planId: string,
        _opts: any,
        fn: (s: PlanExecutionState) => PlanExecutionState,
      ) => {
        currentState = fn(JSON.parse(JSON.stringify(currentState)));
        return currentState;
      },
    ),
  } as unknown as ExecutionStateStore;

  const evidenceEvents: any[] = [];
  const writer = new EvidenceEventWriter(
    async (type: any, payload: any) => {
      evidenceEvents.push({ type, payload });
      return {
        id: `evt-${evidenceEvents.length}`,
        type,
        payload,
        version: 1,
        timestamp: "",
        fingerprint: "",
      } as any;
    },
  );

  const runner = {
    execute: vi.fn().mockResolvedValue({
      outcome: "intent_recorded" as const,
      newStepStatus: "waiting_for_bridge" as const,
      durationMs: 5,
      evidenceIds: [],
      generatedArtifacts: [],
      summary: "",
      warnings: [],
      retryable: false,
    } satisfies StepRunnerResult),
  } as unknown as StepRunner;

  return { planStore, stateStore, writer, runner, evidenceEvents };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("P10.4c engine dispatch — apply_remediation reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks step completed when proposal is applied and records evidence", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } =
      createMocks();
    const proposalStore = {
      list: vi.fn().mockResolvedValue([makeAppliedProposal()]),
    } as unknown as ProposalStore;

    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, proposalStore,
    );
    const result = await engine.runStep("plan-1", "apply-1");

    expect(result.status).toBe("completed");

    const appliedEvt = evidenceEvents.find(
      e => e.type === "executive_step_applied_remediation",
    );
    expect(appliedEvt).toBeDefined();
    expect(appliedEvt.payload).toMatchObject({
      planId: "plan-1",
      stepId: "apply-1",
      proposalId: "proposal-1",
    });
  });

  it("stays waiting_for_bridge when no matching proposal exists", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } =
      createMocks();
    // Simulate that the create step hasn't been bridged yet — no proposals exist
    const proposalStore = {
      list: vi.fn().mockResolvedValue([] as AdaptationProposal[]),
    } as unknown as ProposalStore;

    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, proposalStore,
    );
    const result = await engine.runStep("plan-1", "apply-1");

    // Apply step has a sibling create step on obj-1, but no proposals
    // exist in the store yet (the bridge hasn't run for create-1).
    // Reconciler returns stepCompleted=false → stays waiting_for_bridge.
    expect(result.status).toBe("waiting_for_bridge");

    const appliedEvt = evidenceEvents.find(
      e => e.type === "executive_step_applied_remediation",
    );
    expect(appliedEvt).toBeUndefined();
  });

  it("is no-op when proposalStore is undefined (backward compat)", async () => {
    const { planStore, stateStore, writer, runner, evidenceEvents } =
      createMocks();
    // No proposalStore — engine created with 4 args
    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer,
    );
    const result = await engine.runStep("plan-1", "apply-1");

    expect(result.status).toBe("waiting_for_bridge");

    const appliedEvt = evidenceEvents.find(
      e => e.type === "executive_step_applied_remediation",
    );
    expect(appliedEvt).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// P10.5c — automatic outcome evaluation hook integration tests
// -----------------------------------------------------------------------

/**
 * Helper: build a COMPLETABLE plan (a single step, already pending).
 * Caller pre-marks step as completed in the state, so runStep drives
 * the plan through to terminal status and maybeCompletePlan fires.
 */
function makeCompletablePlanAndState(): {
  plan: PersistedExecutionPlan;
  initialState: PlanExecutionState;
} {
  const step = makeStep({ id: "only-step", action: "audit_metrics" });
  const plan: PersistedExecutionPlan = {
    id: "plan-hook-1",
    steps: [step],
    objectives: ["obj-1"],
    generatedAt: "2026-06-25T00:00:00.000Z",
    windowDays: 7,
    planStatus: "ready",
    plannerVersion: "1.0.0",
    planningAlgorithm: "test",
    contentHash: "test-hash",
  } as PersistedExecutionPlan;

  // State with the step still pending, plan status "running"
  const initialState: PlanExecutionState = {
    planId: "plan-hook-1",
    status: "running",
    approval: { status: "approved" },
    planTransitions: [],
    timestamps: {
      createdAt: "2026-06-25T00:00:00.000Z",
      runningAt: "2026-06-25T00:00:00.000Z",
    },
    stepStates: {
      "only-step": {
        status: "pending",
        generatedArtifacts: [],
        durationMs: 0,
        warnings: [],
        summary: "",
        evidenceIds: [],
        startedAt: "",
        completedAt: "",
        lastExecutionId: "",
      },
    },
  };
  return { plan, initialState };
}

function makeHookRunner() {
  // A runner that completes the step on first call (drives plan to terminal)
  return {
    execute: vi.fn().mockResolvedValue({
      outcome: "executed" as const,
      newStepStatus: "completed" as const,
      durationMs: 7,
      evidenceIds: [],
      generatedArtifacts: [],
      summary: "ran",
      warnings: [],
      retryable: false,
    } satisfies StepRunnerResult),
  } as unknown as StepRunner;
}

function makeHookMocks(initialState: PlanExecutionState) {
  const planStore = {
    load: vi.fn().mockReturnValue(makeCompletablePlanAndState().plan),
  } as unknown as PlanStore;

  let currentState = initialState;
  const stateStore = {
    load: vi.fn().mockImplementation(() => currentState),
    update: vi.fn().mockImplementation(
      (_planId: string, _opts: any, fn: any) => {
        currentState = fn(JSON.parse(JSON.stringify(currentState)));
        return currentState;
      },
    ),
  } as unknown as ExecutionStateStore;

  const evidenceEvents: any[] = [];
  const writer = new EvidenceEventWriter(
    async (type: any, payload: any) => {
      evidenceEvents.push({ type, payload });
      return {
        id: `evt-${evidenceEvents.length}`,
        type,
        payload,
        version: 1,
        timestamp: "",
        fingerprint: "",
      } as any;
    },
  );

  return { planStore, stateStore, writer, evidenceEvents };
}

describe("P10.5c engine dispatch — automatic outcome hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires the outcome hook on plan completion (integration)", async () => {
    const { plan, initialState } = makeCompletablePlanAndState();
    const { planStore, stateStore, writer, evidenceEvents } =
      makeHookMocks(initialState);
    const runner = makeHookRunner();

    const hookFired = { count: 0, planIds: [] as string[] };
    const hook: OutcomeEvaluationHook = {
      async run(p, _s) {
        hookFired.count++;
        hookFired.planIds.push(p.id);
      },
    };
    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, undefined, hook,
    );

    await engine.runStep(plan.id, "only-step");

    expect(hookFired.count).toBe(1);
    expect(hookFired.planIds).toContain(plan.id);

    // Sanity: completion evidence recorded
    const completedEvt = evidenceEvents.find(
      e => e.type === "executive_plan_completed",
    );
    expect(completedEvt).toBeDefined();
  });

  it("hook failure does not block plan completion", async () => {
    const { plan, initialState } = makeCompletablePlanAndState();
    const { planStore, stateStore, writer, evidenceEvents } =
      makeHookMocks(initialState);
    const runner = makeHookRunner();

    const failingHook: OutcomeEvaluationHook = {
      async run() { throw new Error("boom"); },
    };
    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, undefined, failingHook,
    );

    // Must not throw even though hook throws
    const result = await engine.runStep(plan.id, "only-step");
    expect(result.status).toBe("completed");

    // Completion evidence must still be recorded
    const completedEvt = evidenceEvents.find(
      e => e.type === "executive_plan_completed",
    );
    expect(completedEvt).toBeDefined();

    // And the plan must be in terminal "completed" state
    const finalState = (stateStore.load as any)();
    expect(finalState.status).toBe("completed");
  });

  it("does not call hook.run() when plan is already in completed status", async () => {
    const { initialState } = makeCompletablePlanAndState();
    // Pre-set the plan to a terminal "completed" status with the step done.
    initialState.status = "completed";
    initialState.timestamps.completedAt = "2026-06-25T00:01:00.000Z";
    initialState.stepStates["only-step"].status = "completed";

    const { planStore, stateStore, writer } = makeHookMocks(initialState);
    const runner = makeHookRunner();

    const hookFired = { count: 0 };
    const hook: OutcomeEvaluationHook = {
      async run() { hookFired.count++; },
    };
    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, undefined, hook,
    );

    // runStep refuses because status !== "running" — guarantees the hook
    // can't be called when the plan is already terminal.
    await expect(
      engine.runStep("plan-hook-1", "only-step"),
    ).rejects.toThrow(/must be "running"/);
    expect(hookFired.count).toBe(0);
  });

  it("fires hook with the plan that reached terminal status", async () => {
    const { plan, initialState } = makeCompletablePlanAndState();
    const { planStore, stateStore, writer } = makeHookMocks(initialState);
    const runner = makeHookRunner();

    let receivedPlan: PersistedExecutionPlan | null = null;
    let receivedState: PlanExecutionState | null = null;
    const hook: OutcomeEvaluationHook = {
      async run(p, s) {
        receivedPlan = p;
        receivedState = s;
      },
    };
    const engine = new ExecutionEngine(
      planStore, stateStore, runner, writer, undefined, hook,
    );

    await engine.runStep(plan.id, "only-step");

    expect(receivedPlan).not.toBeNull();
    expect(receivedPlan!.id).toBe(plan.id);
    expect(receivedState).not.toBeNull();
    expect(receivedState!.status).toBe("completed");
    expect(receivedState!.timestamps.completedAt).toBeDefined();
  });
});
