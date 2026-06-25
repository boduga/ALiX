import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionPlan } from "../../src/executive/planning-engine.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";

function makeTestPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    id: overrides?.id ?? "plan-test-1",
    objectives: ["obj-1"],
    steps: [
      {
        id: "step-1",
        action: "diagnose_root_cause",
        title: "Diagnose monitoring gaps",
        stepNumber: 1,
        targetSubsystem: "governance",
        dependsOn: [],
        status: "pending",
        objectiveId: "obj-1",
        priorityScore: 85,
        objectiveScore: 80,
        riskLevel: "medium",
      },
    ],
    generatedAt: "2026-06-25T00:00:00.000Z",
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    ...overrides,
  };
}

function makeMockEvidenceWriter(): {
  writer: EvidenceEventWriter;
  calls: Array<{
    planId: string;
    contentHash: string;
    stepCount: number;
  }>;
} {
  const calls: Array<{
    planId: string;
    contentHash: string;
    stepCount: number;
  }> = [];
  const writer = {
    recordExecutivePlanSaved: vi.fn(
      async (payload: {
        planId: string;
        contentHash: string;
        stepCount: number;
        executionId?: string;
      }) => {
        calls.push({
          planId: payload.planId,
          contentHash: payload.contentHash,
          stepCount: payload.stepCount,
        });
        return { type: "executive_plan_saved", payload };
      },
    ),
    recordExecutivePlanApproved: vi.fn(),
    recordExecutivePlanRejected: vi.fn(),
    recordExecutivePlanStarted: vi.fn(),
    recordExecutiveStepExecuted: vi.fn(),
    recordExecutiveStepIntentRecorded: vi.fn(),
    recordExecutiveStepBlocked: vi.fn(),
    recordExecutivePlanCompleted: vi.fn(),
    recordExecutivePlanFailed: vi.fn(),
  } as unknown as EvidenceEventWriter;
  return { writer, calls };
}

describe("PlanStore", () => {
  let dir: string;
  let store: PlanStore;

  beforeEach(() => {
    dir = join(tmpdir(), `plan-store-test-${randomUUID()}`);
    store = new PlanStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a plan", async () => {
    const plan = makeTestPlan();
    const result = await store.save(plan);

    expect(result).toHaveProperty("contentHash");
    expect(result.generatedAt).toBe(plan.generatedAt);

    const loaded = store.load(plan.id);
    expect(loaded).toEqual(result);
  });

  it("stores contentHash in saved file", async () => {
    const plan = makeTestPlan();
    await store.save(plan);

    const raw = readFileSync(join(dir, `${plan.id}.json`), "utf-8");
    const onDisk = JSON.parse(raw);
    expect(onDisk).toHaveProperty("contentHash");
    expect(typeof onDisk.contentHash).toBe("string");
  });

  it("throws for unknown plan", () => {
    expect(() => store.load("nonexistent")).toThrow("Plan not found");
  });

  it("rejects tampered contentHash on load", async () => {
    const plan = makeTestPlan();
    await store.save(plan);
    const filePath = join(dir, `${plan.id}.json`);
    const raw = readFileSync(filePath, "utf-8");
    const tampered = raw.replace(`"contentHash": "`, `"contentHash": "tampered`);
    writeFileSync(filePath, tampered, "utf-8");

    expect(() => store.load(plan.id)).toThrow("contentHash mismatch");
  });

  it("returns empty list when no plans", () => {
    const emptyStore = new PlanStore(join(tmpdir(), `empty-${randomUUID()}`));
    expect(emptyStore.list()).toEqual([]);
  });

  it("lists plans newest first", async () => {
    const older = makeTestPlan({ id: "plan-older", generatedAt: "2026-06-20T00:00:00.000Z" });
    const newer = makeTestPlan({ id: "plan-newer", generatedAt: "2026-06-25T00:00:00.000Z" });
    await store.save(newer);
    await store.save(older);

    const list = store.list();
    expect(list.map(p => p.id)).toEqual(["plan-newer", "plan-older"]);
  });

  it("skips unparseable files in list", async () => {
    await store.save(makeTestPlan({ id: "plan-good" }));
    writeFileSync(join(dir, "corrupt.json"), "not json", "utf-8");
    const list = store.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("plan-good");
  });

  it("lists plans whose id ends in 'state'", async () => {
    // Plans ending in "state" (e.g. "genesis-state") must appear in list()
    // because contentHash is the discriminator, not the filename.
    const plan = makeTestPlan({ id: "genesis-state" });
    await store.save(plan);
    const list = store.list();
    expect(list.map(p => p.id)).toContain("genesis-state");
  });

  // -----------------------------------------------------------------------
  // Validation tests
  // -----------------------------------------------------------------------

  it("rejects plan with empty steps array", async () => {
    const plan = makeTestPlan({ steps: [] });
    await expect(store.save(plan)).rejects.toThrow(
      "Plan validation failed: steps must be non-empty",
    );
  });

  it("rejects plan with zero steps", async () => {
    const plan = makeTestPlan();
    // Cast to bypass type checking for the test — we want to test runtime validation
    (plan as { steps: unknown[] }).steps = [];
    await expect(store.save(plan)).rejects.toThrow(
      "Plan validation failed: steps must be non-empty",
    );
  });

  it("rejects step missing id", async () => {
    const plan = makeTestPlan();
    const step = { ...plan.steps[0], id: "" };
    plan.steps = [step as typeof plan.steps[0]];
    await expect(store.save(plan)).rejects.toThrow(
      'is missing required field "id"',
    );
  });

  it("rejects step missing action", async () => {
    const plan = makeTestPlan();
    const step = { ...plan.steps[0], action: "" as any };
    plan.steps = [step as typeof plan.steps[0]];
    await expect(store.save(plan)).rejects.toThrow(
      'is missing required field "action"',
    );
  });

  it("rejects step missing targetSubsystem", async () => {
    const plan = makeTestPlan();
    const step = { ...plan.steps[0], targetSubsystem: "" as any };
    plan.steps = [step as typeof plan.steps[0]];
    await expect(store.save(plan)).rejects.toThrow(
      'is missing required field "targetSubsystem"',
    );
  });

  it("rejects step missing objectiveId", async () => {
    const plan = makeTestPlan();
    const step = { ...plan.steps[0], objectiveId: "" };
    plan.steps = [step as typeof plan.steps[0]];
    await expect(store.save(plan)).rejects.toThrow(
      'is missing required field "objectiveId"',
    );
  });

  it("rejects step missing priorityScore", async () => {
    const plan = makeTestPlan();
    const step = { ...plan.steps[0], priorityScore: undefined as any };
    plan.steps = [step as typeof plan.steps[0]];
    await expect(store.save(plan)).rejects.toThrow(
      'is missing required field "priorityScore"',
    );
  });

  it("rejects step with invalid dependsOn reference", async () => {
    const plan = makeTestPlan({
      steps: [
        {
          id: "step-1",
          action: "diagnose_root_cause",
          title: "Diagnose monitoring gaps",
          stepNumber: 1,
          targetSubsystem: "governance",
          dependsOn: ["nonexistent-step"],
          status: "pending",
          objectiveId: "obj-1",
          priorityScore: 85,
          objectiveScore: 80,
          riskLevel: "medium",
        },
      ],
    });
    await expect(store.save(plan)).rejects.toThrow(
      "depends on unknown step 'nonexistent-step'",
    );
  });

  // -----------------------------------------------------------------------
  // Evidence emission tests
  // -----------------------------------------------------------------------

  it("emits evidence when evidenceWriter is provided", async () => {
    const plan = makeTestPlan();
    const { writer, calls } = makeMockEvidenceWriter();

    const result = await store.save(plan, writer);

    expect(writer.recordExecutivePlanSaved).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
    expect(calls[0].planId).toBe(plan.id);
    expect(calls[0].contentHash).toBe(result.contentHash);
    expect(calls[0].stepCount).toBe(1);
  });

  it("does not throw when evidenceWriter throws", async () => {
    const plan = makeTestPlan();
    const writer = {
      recordExecutivePlanSaved: vi.fn().mockRejectedValue(new Error("evidence down")),
      recordExecutivePlanApproved: vi.fn(),
      recordExecutivePlanRejected: vi.fn(),
      recordExecutivePlanStarted: vi.fn(),
      recordExecutiveStepExecuted: vi.fn(),
      recordExecutiveStepIntentRecorded: vi.fn(),
      recordExecutiveStepBlocked: vi.fn(),
      recordExecutivePlanCompleted: vi.fn(),
      recordExecutivePlanFailed: vi.fn(),
    } as unknown as EvidenceEventWriter;

    // Should not throw — evidence is best-effort
    const result = await store.save(plan, writer);
    expect(result).toHaveProperty("contentHash");
    expect(writer.recordExecutivePlanSaved).toHaveBeenCalledTimes(1);
  });

  it("does not emit evidence when no evidenceWriter provided", async () => {
    const plan = makeTestPlan();
    const result = await store.save(plan);
    expect(result).toHaveProperty("contentHash");
    // No evidence writer — just verifying it doesn't throw
  });

  it("correctly passes contentHash to evidence even after mutation", async () => {
    const plan = makeTestPlan({ id: "plan-e2e" });
    const { writer, calls } = makeMockEvidenceWriter();

    const result = await store.save(plan, writer);

    // contentHash in evidence matches the persisted plan's contentHash
    expect(calls[0].contentHash).toBe(result.contentHash);

    // Loading should verify the same hash
    const loaded = store.load(plan.id);
    expect(loaded.contentHash).toBe(calls[0].contentHash);
  });
});
