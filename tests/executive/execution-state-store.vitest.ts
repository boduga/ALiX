import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";

function makePlan(overrides?: Partial<PersistedExecutionPlan>): PersistedExecutionPlan {
  return {
    id: "plan-test-1",
    objectives: ["obj-1"],
    steps: [
      { id: "step-1", action: "diagnose_root_cause", stepNumber: 1, targetSubsystem: "governance", dependsOn: [], status: "pending", title: "Step 1", objectiveId: "obj-1", priorityScore: 50, objectiveScore: 50, riskLevel: "medium" },
      { id: "step-2", action: "audit_metrics", stepNumber: 2, targetSubsystem: "governance", dependsOn: ["step-1"], status: "pending", title: "Step 2", objectiveId: "obj-1", priorityScore: 50, objectiveScore: 50, riskLevel: "medium" },
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

describe("ExecutionStateStore", () => {
  let dir: string;
  let store: ExecutionStateStore;

  beforeEach(() => {
    dir = join(tmpdir(), `exec-state-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    store = new ExecutionStateStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("initializes all steps as pending", () => {
    const plan = makePlan();
    const state = store.init(plan);
    expect(state.planId).toBe("plan-test-1");
    expect(state.status).toBe("draft");
    expect(Object.keys(state.stepStates)).toHaveLength(2);
    expect(state.stepStates["step-1"].status).toBe("pending");
    expect(state.stepStates["step-2"].status).toBe("pending");
  });

  it("init creates state matching plan structure", () => {
    const plan = makePlan();
    const state = store.init(plan);
    expect(state.planId).toBe(plan.id);
    expect(state.planTransitions).toHaveLength(1);
    expect(state.planTransitions[0].sequence).toBe(1);
    expect(state.planTransitions[0].reason).toBe("plan created");
    expect(state.timestamps.createdAt).toBeTruthy();
    // Every step in the plan has exactly one StepRuntimeState
    for (const step of plan.steps) {
      expect(state.stepStates[step.id]).toBeDefined();
      expect(state.stepStates[step.id].status).toBe("pending");
    }
  });

  it("loads saved state", () => {
    const plan = makePlan();
    store.init(plan);
    const loaded = store.load("plan-test-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.planId).toBe("plan-test-1");
    expect(loaded!.planTransitions).toHaveLength(1);
  });

  it("returns null for unknown plan", () => {
    expect(store.load("nonexistent")).toBeNull();
  });

  it("updates step status atomically", () => {
    const plan = makePlan();
    store.init(plan);
    const updated = store.update(
      "plan-test-1",
      { from: "draft", to: "draft", reason: "step completed" },
      s => {
        s.stepStates["step-1"].status = "completed";
        s.stepStates["step-1"].completedAt = "2026-06-25T00:01:00.000Z";
        return s;
      },
    );
    expect(updated.stepStates["step-1"].status).toBe("completed");
    expect(updated.planTransitions).toHaveLength(2);
    expect(updated.planTransitions[1].sequence).toBe(2);
  });

  it("rejects mutator that modified planTransitions", () => {
    const plan = makePlan();
    store.init(plan);
    expect(() =>
      store.update(
        "plan-test-1",
        { from: "draft", to: "draft", reason: "bad mutator" },
        s => {
          s.planTransitions.push({ sequence: 99, from: "draft", to: "running", at: "now" });
          return s;
        },
      ),
    ).toThrow("MUST NOT modify planTransitions");
  });

  it("updates plan status when transition changes it", () => {
    const plan = makePlan();
    store.init(plan);
    const updated = store.update(
      "plan-test-1",
      { from: "draft", to: "approved", executionId: "exec-1" },
      s => {
        s.status = "approved";
        s.approval = { status: "approved", approvedBy: "user", approvedAt: new Date().toISOString() };
        return s;
      },
    );
    expect(updated.status).toBe("approved");
    expect(updated.timestamps.approvedAt).toBeTruthy();
    expect(updated.lastExecutionId).toBe("exec-1");
  });

  it("sequences transitions monotonically", () => {
    const plan = makePlan();
    store.init(plan);

    const t1 = store.update(
      "plan-test-1",
      { from: "draft", to: "draft", reason: "first" },
      s => s,
    );
    expect(t1.planTransitions[t1.planTransitions.length - 1].sequence).toBe(2);

    const t2 = store.update(
      "plan-test-1",
      { from: "draft", to: "draft", reason: "second" },
      s => s,
    );
    expect(t2.planTransitions[t2.planTransitions.length - 1].sequence).toBe(3);
  });

  it("throws on update for unknown plan", () => {
    expect(() =>
      store.update("nonexistent", { from: "draft", to: "draft" }, s => s),
    ).toThrow("not found");
  });
});
