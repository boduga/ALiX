import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanApprovalGate } from "../../src/executive/plan-approval-gate.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";

function mockPlan(overrides?: Partial<PersistedExecutionPlan>): PersistedExecutionPlan {
  return {
    id: "plan-test-1",
    objectives: ["obj-1"],
    steps: [
      { id: "step-1", action: "diagnose_root_cause", stepNumber: 1, targetSubsystem: "governance", dependsOn: [], status: "pending", title: "Step 1", objectiveId: "obj-1", priorityScore: 50, objectiveScore: 50, riskLevel: "medium" },
    ],
    generatedAt: "2026-06-25T00:00:00.000Z",
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "abc",
    ...overrides,
  };
}

function mockState(overrides?: Partial<PlanExecutionState>): PlanExecutionState {
  return {
    planId: "plan-test-1",
    status: "draft",
    approval: { status: "pending" },
    stepStates: { "step-1": { status: "pending", evidenceIds: [], generatedArtifacts: [], warnings: [] } },
    planTransitions: [{ sequence: 1, from: "draft", to: "draft", at: "2026-06-25T00:00:00.000Z", reason: "created" }],
    timestamps: { createdAt: "2026-06-25T00:00:00.000Z" },
    ...overrides,
  };
}

describe("PlanApprovalGate", () => {
  let planStore: PlanStore;
  let stateStore: ExecutionStateStore;
  let writer: EvidenceEventWriter;
  let gate: PlanApprovalGate;

  beforeEach(() => {
    planStore = { load: vi.fn(), save: vi.fn(), list: vi.fn() } as unknown as PlanStore;
    stateStore = { init: vi.fn(), load: vi.fn(), update: vi.fn() } as unknown as ExecutionStateStore;
    writer = {
      recordExecutivePlanApproved: vi.fn().mockResolvedValue(null),
      recordExecutivePlanRejected: vi.fn().mockResolvedValue(null),
    } as unknown as EvidenceEventWriter;
    gate = new PlanApprovalGate(planStore, stateStore, writer);
  });

  it("approves a draft plan", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState());
    vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
      const state = mockState();
      return mutator(state) as PlanExecutionState;
    });

    const result = gate.approve("plan-test-1", "user", "exec-1");
    expect(result.status).toBe("approved");
    expect(result.approval.approvedBy).toBe("user");
    expect(writer.recordExecutivePlanApproved).toHaveBeenCalled();
  });

  it("rejects approval for non-draft plan", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState({ status: "approved" }));
    expect(() => gate.approve("plan-test-1", "user", "exec-1")).toThrow("Cannot approve");
  });

  it("rejects approval for already-approved plan", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState({ approval: { status: "approved", approvedBy: "other" } }));
    expect(() => gate.approve("plan-test-1", "user", "exec-1")).toThrow("approval already");
  });

  it("rejects approval for empty plan", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan({ steps: [] }));
    vi.mocked(stateStore.load).mockReturnValue(mockState());
    expect(() => gate.approve("plan-test-1", "user", "exec-1")).toThrow("empty plan");
  });

  it("rejects plan and records evidence", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState());
    vi.mocked(stateStore.update).mockImplementation((_id, _t, mutator) => {
      const state = mockState();
      return mutator(state) as PlanExecutionState;
    });

    const result = gate.reject("plan-test-1", "user", "wrong priorities", "exec-1");
    expect(result.status).toBe("cancelled");
    expect(result.approval.rejectedBy).toBe("user");
    expect(writer.recordExecutivePlanRejected).toHaveBeenCalledWith({
      planId: "plan-test-1",
      rejectedBy: "user",
      reason: "wrong priorities",
      executionId: "exec-1",
    });
  });

  it("rejects rejection for approved plan", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState({ status: "running" }));
    expect(() => gate.reject("plan-test-1", "user", "no", "exec-1")).toThrow("Cannot reject");
  });

  it("rejects approval when state planId mismatches plan id", () => {
    vi.mocked(planStore.load).mockReturnValue(mockPlan());
    vi.mocked(stateStore.load).mockReturnValue(mockState({ planId: "different-plan" }));
    expect(() => gate.approve("plan-test-1", "user", "exec-1")).toThrow("planId mismatch");
  });
});
