import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner } from "../../src/executive/step-runner.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import {
  ExecutiveSnapshotStore,
} from "../../src/executive/executive-snapshot-store.js";
import type {
  ExecutivePlanSnapshot,
} from "../../src/executive/executive-snapshot-store.js";
import type {
  ExecutiveSnapshotProvider,
} from "../../src/executive/executive-snapshot-provider.js";

// ---------------------------------------------------------------------------
// Module-level mutable state for the current test
// ---------------------------------------------------------------------------

interface TestHarness {
  snapshotsDir: string;
  snapshotStore: ExecutiveSnapshotStore;
  planStore: PlanStore;
  stateStore: ExecutionStateStore;
  runner: StepRunner;
  writer: EvidenceEventWriter;
  /** Live mutable state for nextRunnableSteps / runStep. */
  currentStateRef: { value: PlanExecutionState };
}

function makeHarness(): TestHarness {
  const snapshotsDir = mkdtempSync(join(tmpdir(), "engine-baseline-"));
  const snapshotStore = new ExecutiveSnapshotStore(snapshotsDir);

  const initialState = makeState(["step-1"]);
  initialState.status = "running";
  const currentStateRef = { value: initialState };

  const planStore = {
    load: vi.fn().mockReturnValue(makePlan()),
  } as unknown as PlanStore;

  const stateStore = {
    load: vi.fn().mockImplementation(() => JSON.parse(JSON.stringify(currentStateRef.value))),
    update: vi.fn().mockImplementation((_id: string, _t: any, mutator: any) => {
      const s = JSON.parse(JSON.stringify(currentStateRef.value));
      mutator(s);
      for (const [, stepState] of Object.entries(s.stepStates)) {
        const ss = stepState as any;
        if (ss.status === "in_progress") ss.status = "completed";
      }
      currentStateRef.value = s;
      return JSON.parse(JSON.stringify(s));
    }),
    save: vi.fn(),
  } as unknown as ExecutionStateStore;

  const mockResult = {
    outcome: "executed",
    newStepStatus: "completed",
    durationMs: 5,
    evidenceIds: ["evt-1"],
    generatedArtifacts: [],
    warnings: [],
    retryable: false,
  };
  const runner = {
    execute: vi.fn().mockResolvedValue(mockResult),
  } as unknown as StepRunner;

  const writer = {
    recordExecutivePlanSaved: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutivePlanApproved: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutivePlanRejected: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutivePlanStarted: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutiveStepExecuted: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutiveStepIntentRecorded: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutiveStepBlocked: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutivePlanCompleted: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutivePlanFailed: vi.fn().mockReturnValue({ catch: () => {} }),
    recordExecutiveStepAppliedRemediation: vi.fn().mockReturnValue({ catch: () => {} }),
  } as unknown as EvidenceEventWriter;

  return { snapshotsDir, snapshotStore, planStore, stateStore, runner, writer, currentStateRef };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(steps: Partial<ExecutionStep>[] = [{ id: "step-1", action: "diagnose_root_cause" }]): PersistedExecutionPlan {
  return {
    id: "plan-baseline-1",
    objectives: ["obj-1"],
    steps: steps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      action: (s.action ?? "diagnose_root_cause") as ExecutionStep["action"],
      title: s.title ?? "Test step",
      stepNumber: s.stepNumber ?? (i + 1),
      targetSubsystem: (s.targetSubsystem ?? "governance") as ExecutionStep["targetSubsystem"],
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

function makeState(stepIds: string[] = ["step-1"]): PlanExecutionState {
  const stepStates: Record<string, any> = {};
  for (const id of stepIds) {
    stepStates[id] = {
      status: "pending",
      startedAt: undefined,
      completedAt: undefined,
      durationMs: undefined,
      evidenceIds: [],
      summary: undefined,
      generatedArtifacts: [],
      warnings: [],
    };
  }
  return {
    planId: "plan-baseline-1",
    status: "approved",
    approval: { status: "approved", approvedBy: "user", approvedAt: "2026-06-25T00:00:00.000Z" },
    stepStates,
    planTransitions: [],
    timestamps: {
      createdAt: "2026-06-25T00:00:00.000Z",
      approvedAt: "2026-06-25T00:00:00.000Z",
      runningAt: undefined,
      completedAt: undefined,
      failedAt: undefined,
      blockedAt: undefined,
      cancelledAt: undefined,
    },
    lastExecutionId: undefined,
  };
}

function makeStubProvider(
  captureBaseline: ReturnType<typeof vi.fn>,
): ExecutiveSnapshotProvider {
  return {
    captureBaseline: captureBaseline as unknown as ExecutiveSnapshotProvider["captureBaseline"],
    captureCurrent: vi.fn() as unknown as ExecutiveSnapshotProvider["captureCurrent"],
  };
}

function makeStubSnapshot(): ExecutivePlanSnapshot {
  return {
    metadata: {
      snapshotVersion: 1,
      alixVersion: "0.5.0",
      executiveEngineVersion: "1.0",
      createdBy: "ExecutionEngine",
      reason: "execution-start",
    },
    planId: "plan-baseline-1",
    capturedAt: "2026-06-25T12:00:00.000Z",
    captureKind: "baseline",
    rawSubsystemState: {
      trendSnapshotId: "exec-trend-X",
      outcomeReportIds: [],
    },
    id: "plan-baseline-1-baseline",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionEngine baseline snapshot capture", () => {
  let h: TestHarness;

  beforeEach(() => {
    h = makeHarness();
  });

  afterEach(() => {
    if (existsSync(h.snapshotsDir)) rmSync(h.snapshotsDir, { recursive: true, force: true });
  });

  // ─── Fresh plan + runStep ────────────────────────────────────────────────

  it("fresh plan + runStep → baseline file exists on disk", async () => {
    const captureBaseline = vi.fn().mockResolvedValue(makeStubSnapshot());
    const provider = makeStubProvider(captureBaseline);
    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      h.runner,
      h.writer,
      undefined,
      undefined,
      h.snapshotStore,
      provider,
    );

    await engine.runStep("plan-baseline-1", "step-1");

    const baselinePath = join(h.snapshotsDir, "plan-baseline-1-baseline.json");
    expect(existsSync(baselinePath)).toBe(true);
  });

  it("baseline file has correct captureKind, snapshotVersion, and rawSubsystemState", async () => {
    const captureBaseline = vi.fn().mockResolvedValue(makeStubSnapshot());
    const provider = makeStubProvider(captureBaseline);
    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      h.runner,
      h.writer,
      undefined,
      undefined,
      h.snapshotStore,
      provider,
    );

    await engine.runStep("plan-baseline-1", "step-1");

    const loaded = await h.snapshotStore.loadBaseline("plan-baseline-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.captureKind).toBe("baseline");
    expect(loaded!.metadata.snapshotVersion).toBe(1);
    expect(loaded!.rawSubsystemState.trendSnapshotId).toBe("exec-trend-X");
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  it("two runStep calls → captureBaseline called once, baseline file unchanged", async () => {
    const captureBaseline = vi.fn().mockResolvedValue(makeStubSnapshot());
    const provider = makeStubProvider(captureBaseline);
    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      h.runner,
      h.writer,
      undefined,
      undefined,
      h.snapshotStore,
      provider,
    );

    // Plan with two steps; state must match cardinality.
    vi.mocked(h.planStore.load).mockReturnValue(makePlan([
      { id: "step-1", action: "diagnose_root_cause" },
      { id: "step-2", action: "diagnose_root_cause" },
    ]));
    h.currentStateRef.value = makeState(["step-1", "step-2"]);
    h.currentStateRef.value.status = "running";

    await engine.runStep("plan-baseline-1", "step-1");
    await engine.runStep("plan-baseline-1", "step-2");

    expect(captureBaseline).toHaveBeenCalledTimes(1);

    const loaded = await h.snapshotStore.loadBaseline("plan-baseline-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.rawSubsystemState.trendSnapshotId).toBe("exec-trend-X");
  });

  // ─── Failing step ────────────────────────────────────────────────────────

  it("failing step → baseline still captured (error path doesn't bypass gate)", async () => {
    const captureBaseline = vi.fn().mockResolvedValue(makeStubSnapshot());
    const provider = makeStubProvider(captureBaseline);

    const failingRunner = {
      execute: vi.fn().mockResolvedValue({
        outcome: "executed",
        newStepStatus: "failed",
        durationMs: 5,
        evidenceIds: ["evt-1"],
        generatedArtifacts: [],
        warnings: ["step failed"],
        retryable: false,
      }),
    } as unknown as StepRunner;

    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      failingRunner,
      h.writer,
      undefined,
      undefined,
      h.snapshotStore,
      provider,
    );

    await engine.runStep("plan-baseline-1", "step-1");

    expect(captureBaseline).toHaveBeenCalledTimes(1);
    const baselinePath = join(h.snapshotsDir, "plan-baseline-1-baseline.json");
    expect(existsSync(baselinePath)).toBe(true);
  });

  // ─── Provider throws ─────────────────────────────────────────────────────

  it("provider throws → engine completes step anyway, no baseline file, warning logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const captureBaseline = vi.fn().mockRejectedValue(new Error("boom — observation provider down"));
    const provider = makeStubProvider(captureBaseline);

    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      h.runner,
      h.writer,
      undefined,
      undefined,
      h.snapshotStore,
      provider,
    );

    const result = await engine.runStep("plan-baseline-1", "step-1");

    expect(result.status).toBe("completed");
    expect(captureBaseline).toHaveBeenCalledTimes(1);

    const baselinePath = join(h.snapshotsDir, "plan-baseline-1-baseline.json");
    expect(existsSync(baselinePath)).toBe(false);

    expect(warnSpy).toHaveBeenCalled();
    const warningMessage = warnSpy.mock.calls[0][0] as string;
    expect(warningMessage).toContain("Baseline snapshot capture failed");
    expect(warningMessage).toContain("plan-baseline-1");
    expect(warningMessage).toContain("boom");

    warnSpy.mockRestore();
  });

  // ─── store throws ────────────────────────────────────────────────────────

  it("saveBaseline throws → engine completes step anyway, no baseline file, warning logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const captureBaseline = vi.fn().mockResolvedValue(makeStubSnapshot());
    const provider = makeStubProvider(captureBaseline);

    const throwingStore = {
      hasBaseline: vi.fn().mockResolvedValue(false),
      saveBaseline: vi.fn().mockRejectedValue(new Error("disk full")),
      saveCurrent: vi.fn(),
      loadBaseline: vi.fn(),
      loadCurrent: vi.fn(),
      list: vi.fn(),
    } as unknown as ExecutiveSnapshotStore;

    const engine = new ExecutionEngine(
      h.planStore,
      h.stateStore,
      h.runner,
      h.writer,
      undefined,
      undefined,
      throwingStore,
      provider,
    );

    const result = await engine.runStep("plan-baseline-1", "step-1");

    expect(result.status).toBe("completed");
    expect(captureBaseline).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    const warningMessage = warnSpy.mock.calls[0][0] as string;
    expect(warningMessage).toContain("Baseline snapshot capture failed");

    warnSpy.mockRestore();
  });

  // ─── Backward compatibility ──────────────────────────────────────────────

  it("default constructor (no snapshotStore/provider injected) uses built-in defaults — no crash", async () => {
    const engine = new ExecutionEngine(h.planStore, h.stateStore, h.runner, h.writer);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await engine.runStep("plan-baseline-1", "step-1");
    } finally {
      warnSpy.mockRestore();
    }
    // If a warning was emitted, that's acceptable graceful degradation.
  });
});