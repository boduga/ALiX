/**
 * P10.4b — ExecutionEngine bridge dispatch integration test.
 *
 * Exercises the engine's new dispatch branch end-to-end with a fake
 * StepRunner, fake ProposalStore, and fake EvidenceEventWriter.
 * Validates:
 *   (a) success path through runReadySteps writes one proposal + one bridge evidence
 *   (b) idempotency — second call is silent
 *   (c) failure path — warning + failed evidence, status unchanged
 *   (d) runStep parity — manual single-step entry point produces identical bridge behavior
 *
 * The runStep parity test (d) catches the "wire only into runReadySteps" regression
 * directly: if someone refactors bridge dispatch back into runReadySteps alone,
 * runStep will skip the bridge and this test will fail.
 */

import { describe, expect, it } from "vitest";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner } from "../../src/executive/step-runner.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type {
  PersistedExecutionPlan,
  PlanExecutionState,
  PlanTransition,
  StepRuntimeState,
} from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { StepRunnerResult } from "../../src/executive/executive-plan-types.js";

const NOW = "2026-06-25T12:00:00.000Z";
const STEP_ID = "step-obj-1-governance-create_remediation_proposal";

function makeStep(): ExecutionStep {
  return {
    id: STEP_ID,
    action: "create_remediation_proposal",
    title: "Create remediation proposal",
    stepNumber: 2,
    targetSubsystem: "governance",
    dependsOn: [],
    status: "pending",
    objectiveId: "obj-1",
    priorityScore: 80,
    objectiveScore: 75,
    riskLevel: "high",
  };
}

function makePlan(): PersistedExecutionPlan {
  return {
    id: "plan-1",
    objectives: ["obj-1"],
    steps: [makeStep()],
    generatedAt: NOW,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "deadbeef",
  };
}

interface EngineHandle {
  engine: ExecutionEngine;
  planStore: PlanStore;
  stateStore: ExecutionStateStore & { _state: PlanExecutionState };
  stepRunner: StepRunner;
  evidenceWriter: EvidenceEventWriter;
  evidenceCalls: Array<{ method: string; payload: Record<string, unknown> }>;
  proposalStore: ProposalStore & { _saved: AdaptationProposal[] };
}

/**
 * Build an ExecutionEngine wired to in-memory fakes.
 *
 * - stateStore fake matches the load/update signatures the engine uses in executeStepInternal.
 * - stepRunner fake returns newStepStatus: "waiting_for_bridge" (matches real StepRunner
 *   behavior for create_remediation_proposal mutation steps).
 * - evidenceWriter fake is cast via `as unknown as EvidenceEventWriter` so it satisfies
 *   the concrete class type — only the 2 P10.4b methods the engine actually calls need
 *   to be implemented. recordExecutivePlanStarted/Completed are stubbed as no-ops so
 *   the maybeCompletePlan best-effort .catch(() => {}) path doesn't crash.
 */
function makeEngine(opts: {
  proposalSaveImpl?: (p: AdaptationProposal) => Promise<void>;
  initialPlanStatus?: PlanExecutionState["status"];
} = {}): EngineHandle {
  const plan = makePlan();
  const initialStatus: PlanExecutionState["status"] = opts.initialPlanStatus ?? "running";

  const stepState: StepRuntimeState = {
    status: "pending",
    evidenceIds: [],
    generatedArtifacts: [],
    warnings: [],
  };
  const state: PlanExecutionState = {
    planId: plan.id,
    status: initialStatus,
    approval: { status: "approved", approvedBy: "user", approvedAt: NOW },
    stepStates: { [STEP_ID]: stepState },
    planTransitions: [
      { sequence: 1, from: "draft", to: "approved", at: NOW },
      { sequence: 2, from: "approved", to: "running", at: NOW },
    ],
    timestamps: { createdAt: NOW, approvedAt: NOW, runningAt: NOW },
  };

  const planStore: PlanStore = {
    load: (_id: string) => plan,
    save: async () => plan,
    list: () => [plan],
  } as unknown as PlanStore;

  const stateStore: ExecutionStateStore & { _state: PlanExecutionState } = {
    _state: state,
    init: () => state,
    load: (_id: string) => state,
    update: (
      _planId: string,
      _transition: Omit<PlanTransition, "sequence" | "at">,
      mutator: (s: PlanExecutionState) => PlanExecutionState,
    ): PlanExecutionState => {
      // Apply mutator to the tracked state object (engine reads state after writes)
      const next = mutator(JSON.parse(JSON.stringify(state)) as PlanExecutionState);
      // Mutate in place so subsequent load() calls see the updated state
      Object.assign(state, next);
      stateStore._state = state;
      return state;
    },
  } as unknown as ExecutionStateStore & { _state: PlanExecutionState };

  const stepRunner: StepRunner = {
    async execute(
      _planId: string,
      _step: ExecutionStep,
      _executionId: string,
    ): Promise<StepRunnerResult> {
      return {
        outcome: "intent_recorded",
        durationMs: 1,
        generatedArtifacts: [],
        evidenceIds: [],
        warnings: [],
        retryable: false,
        newStepStatus: "waiting_for_bridge",
      };
    },
  } as unknown as StepRunner;

  const evidenceCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const evidenceWriter: EvidenceEventWriter = {
    async recordExecutiveStepBridgedToProposal(payload: {
      planId: string;
      stepId: string;
      proposalId: string;
      bridgeVersion: string;
    }) {
      evidenceCalls.push({
        method: "recordExecutiveStepBridgedToProposal",
        payload: { ...payload },
      });
      return null;
    },
    async recordExecutiveStepBridgeFailed(payload: {
      planId: string;
      stepId: string;
      error: string;
    }) {
      evidenceCalls.push({
        method: "recordExecutiveStepBridgeFailed",
        payload: { ...payload },
      });
      return null;
    },
    // Best-effort no-ops for other writer methods the engine may call.
    async recordExecutivePlanStarted() {
      return null;
    },
    async recordExecutivePlanCompleted() {
      return null;
    },
    async recordExecutiveStepExecuted() {
      return null;
    },
    async recordExecutiveStepIntentRecorded() {
      return null;
    },
    async recordExecutiveStepBlocked() {
      return null;
    },
    async recordExecutivePlanFailed() {
      return null;
    },
  } as unknown as EvidenceEventWriter;

  const saved: AdaptationProposal[] = [];
  const proposalSaveImpl =
    opts.proposalSaveImpl ??
    (async (p: AdaptationProposal) => {
      saved.push(p);
    });
  const proposalStore: ProposalStore & { _saved: AdaptationProposal[] } = {
    _saved: saved,
    async save(p: AdaptationProposal) {
      await proposalSaveImpl(p);
    },
  } as unknown as ProposalStore & { _saved: AdaptationProposal[] };

  const engine = new ExecutionEngine(
    planStore,
    stateStore,
    stepRunner,
    evidenceWriter,
    proposalStore,
  );

  return {
    engine,
    planStore,
    stateStore,
    stepRunner,
    evidenceWriter,
    evidenceCalls,
    proposalStore,
  };
}

describe("ExecutionEngine — executive bridge dispatch", () => {
  it("runReadySteps writes one proposal + one bridge evidence on first run", async () => {
    const h = makeEngine();
    await h.engine.runReadySteps("plan-1");

    expect(h.proposalStore._saved).toHaveLength(1);
    expect(h.proposalStore._saved[0].action).toBe("executive_remediation_request");
    expect(h.proposalStore._saved[0].status).toBe("pending");

    expect(h.evidenceCalls).toHaveLength(1);
    expect(h.evidenceCalls[0].method).toBe("recordExecutiveStepBridgedToProposal");
    const payload = h.evidenceCalls[0].payload as {
      planId: string;
      stepId: string;
      proposalId: string;
      bridgeVersion: string;
    };
    expect(payload.planId).toBe("plan-1");
    expect(payload.stepId).toBe(STEP_ID);
    expect(payload.proposalId).toBe(h.proposalStore._saved[0].id);
    expect(payload.bridgeVersion).toBeDefined();

    const stepState = h.stateStore._state.stepStates[STEP_ID];
    expect(stepState.generatedArtifacts).toHaveLength(1);
    expect(stepState.generatedArtifacts[0]).toEqual({
      type: "proposal",
      id: h.proposalStore._saved[0].id,
    });
    expect(stepState.warnings).toHaveLength(0);
  });

  it("runReadySteps is idempotent — second call adds zero proposals and zero new evidence calls", async () => {
    const h = makeEngine();
    await h.engine.runReadySteps("plan-1");
    const savedAfterFirst = h.proposalStore._saved.length;
    const callsAfterFirst = h.evidenceCalls.length;

    // After the first run the step is in "waiting_for_bridge" with one
    // proposal artifact, so it's no longer runnable. To exercise the
    // bridge's idempotency guard directly, we reset the step status to
    // "pending" and clear the plan status (it transitions to "completed"
    // because the only step is terminal) so the engine will re-enter
    // executeStepInternal. The bridge must then short-circuit because
    // generatedArtifacts already contains a proposal ref.
    h.stateStore._state.stepStates[STEP_ID].status = "pending";
    h.stateStore._state.stepStates[STEP_ID].generatedArtifacts = [
      ...h.stateStore._state.stepStates[STEP_ID].generatedArtifacts,
    ];
    h.stateStore._state.status = "running";

    await h.engine.runReadySteps("plan-1");

    expect(h.proposalStore._saved.length).toBe(savedAfterFirst);
    expect(h.evidenceCalls.length).toBe(callsAfterFirst);
  });

  it("runReadySteps on save failure: bridge-failed evidence recorded, status stays waiting_for_bridge, no proposal saved", async () => {
    const h = makeEngine({
      proposalSaveImpl: async () => {
        throw new Error("disk full");
      },
    });
    await h.engine.runReadySteps("plan-1");

    const stepState = h.stateStore._state.stepStates[STEP_ID];

    // Status stays "waiting_for_bridge" (StepRunner sets this via newStepStatus;
    // bridge does not change it on failure — engine retries on next runReadySteps).
    expect(stepState.status).toBe("waiting_for_bridge");

    // One bridge-failed evidence call with the error message (durable signal).
    expect(h.evidenceCalls).toContainEqual(
      expect.objectContaining({
        method: "recordExecutiveStepBridgeFailed",
        payload: expect.objectContaining({
          planId: "plan-1",
          stepId: STEP_ID,
          error: expect.stringMatching(/disk full/),
        }),
      }),
    );

    // No bridge-success evidence call (the bridge did not succeed).
    expect(h.evidenceCalls).not.toContainEqual(
      expect.objectContaining({ method: "recordExecutiveStepBridgedToProposal" }),
    );

    // No proposal saved.
    expect(h.proposalStore._saved).toHaveLength(0);

    // No proposal artifact ref appended (save failed before bridge result returned).
    const proposalRefs = stepState.generatedArtifacts.filter(a => a.type === "proposal");
    expect(proposalRefs).toHaveLength(0);
  });

  it("runStep (manual single-step entry point) gets identical bridge behavior as runReadySteps", async () => {
    // This test directly catches the "wire only into runReadySteps" bug.
    // If someone refactors bridge dispatch back into runReadySteps alone,
    // runStep will skip the bridge and this test will fail (saved.length === 0).
    const h = makeEngine();
    await h.engine.runStep("plan-1", STEP_ID);

    expect(h.proposalStore._saved).toHaveLength(1);
    expect(h.proposalStore._saved[0].action).toBe("executive_remediation_request");

    const stepState = h.stateStore._state.stepStates[STEP_ID];
    expect(stepState.generatedArtifacts).toHaveLength(1);
    expect(stepState.generatedArtifacts[0].type).toBe("proposal");

    expect(h.evidenceCalls).toContainEqual(
      expect.objectContaining({ method: "recordExecutiveStepBridgedToProposal" }),
    );
    expect(h.evidenceCalls).not.toContainEqual(
      expect.objectContaining({ method: "recordExecutiveStepBridgeFailed" }),
    );
  });
});