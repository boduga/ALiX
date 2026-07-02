// tests/planning/strategic-plan-store.vitest.ts
//
// P11.3 — StrategicPlanStore tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, rmdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { StrategicPlanStore } from "../../src/planning/strategic-plan-store.js";
import type { StrategicPlan } from "../../src/planning/planning-types.js";

function makePlan(overrides?: Partial<StrategicPlan>): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId: "strat-20260703T120000000Z",
    generatedAt: "2026-07-03T12:00:00.000Z",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    status: "ok",
    objectives: [],
    meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 0, objectivesLow: 0, objectivesMedium: 0, objectivesHigh: 0 },
    ...overrides,
  };
}

function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "p11-3-store-test-"));
  return d;
}

function cleanDir(dir: string): void {
  try {
    const f = join(dir, "strategic-plans.jsonl");
    if (existsSync(f)) unlinkSync(f);
    rmdirSync(dir);
  } catch { /* ok */ }
}

describe("StrategicPlanStore", () => {
  let dir: string;
  let store: StrategicPlanStore;

  beforeEach(() => {
    dir = makeDir();
    store = new StrategicPlanStore(dir);
  });

  afterEach(() => {
    cleanDir(dir);
  });

  // T11: save + loadLatest round-trip
  it("round-trips a plan through save and loadLatest", async () => {
    const plan = makePlan({
      planId: "strat-test-1",
      objectives: [
        {
          id: "strat-obj-test-1-0",
          targetSubsystem: "memory" as any,
          targetMetric: "memory.healthScore",
          topCauseSubsystem: null,
          currentScore: 30,
          urgencyScore: 72,
          expectedImpact: "direct" as any,
          improvesSubsystems: [],
          estimatedEffort: "high" as any,
          effortRationale: "Test rationale",
          prerequisites: [],
          confidence: null,
          mechanism: null,
          sourceFindingSubsystem: "memory" as any,
          rationale: "memory degraded (score: 30). Priority: 72/100.",
        },
      ],
      meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 0, objectivesHigh: 1 },
    });
    await store.save(plan);
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.planId).toBe("strat-test-1");
    expect(loaded!.objectives).toHaveLength(1);
  });

  // T12: loadLatest returns last of two saves
  it("loadLatest returns the most recent saved plan", async () => {
    await store.save(makePlan({ planId: "plan-1", generatedAt: "2026-07-03T12:00:00.000Z" }));
    await store.save(makePlan({ planId: "plan-2", generatedAt: "2026-07-03T13:00:00.000Z" }));
    const loaded = await store.loadLatest();
    expect(loaded!.planId).toBe("plan-2");
  });

  // T13: loadLatest from non-existent file
  it("returns null when file does not exist", async () => {
    const emptyStore = new StrategicPlanStore("/nonexistent/path");
    const result = await emptyStore.loadLatest();
    expect(result).toBeNull();
  });

  // T14: malformed JSON silently skipped (returns null for empty)
  it("returns null when only line is malformed JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(dir, "strategic-plans.jsonl"), "not valid json\n", "utf-8");
    const result = await store.loadLatest();
    expect(result).toBeNull();
  });

  // T15: invalid schemaVersion throws on save
  it("throws on wrong schemaVersion during save", async () => {
    const plan = makePlan({ schemaVersion: "p11.2.0" as any });
    await expect(store.save(plan)).rejects.toThrow(/schemaVersion/);
  });

  // T16: invalid urgencyScore silently skipped on load (returns null)
  it("returns null when saved plan has invalid urgencyScore", async () => {
    const { appendFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const badPlan = JSON.stringify({
      schemaVersion: "p11.3.0",
      planId: "bad-urg",
      generatedAt: "2026-07-03T12:00:00.000Z",
      rootCauseAnalysisId: "rca-1",
      correlationGraphId: "cg-1",
      status: "ok",
      objectives: [
        {
          id: "obj-1",
          targetSubsystem: "memory",
          targetMetric: null,
          topCauseSubsystem: null,
          currentScore: 50,
          urgencyScore: 999,
          expectedImpact: "direct",
          improvesSubsystems: [],
          estimatedEffort: "medium",
          effortRationale: "",
          prerequisites: [],
          confidence: null,
          mechanism: null,
          sourceFindingSubsystem: "memory",
          rationale: "",
        },
      ],
      meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 1, objectivesHigh: 0 },
    }) + "\n";
    appendFileSync(join(dir, "strategic-plans.jsonl"), badPlan, "utf-8");
    const result = await store.loadLatest();
    expect(result).toBeNull();
  });

  // T17: invalid confidence silently skipped on load (returns null)
  it("returns null when saved plan has invalid confidence", async () => {
    const { appendFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const badPlan = JSON.stringify({
      schemaVersion: "p11.3.0",
      planId: "bad-conf",
      generatedAt: "2026-07-03T12:00:00.000Z",
      rootCauseAnalysisId: "rca-1",
      correlationGraphId: "cg-1",
      status: "ok",
      objectives: [
        {
          id: "obj-1",
          targetSubsystem: "memory",
          targetMetric: null,
          topCauseSubsystem: "agents",
          currentScore: 50,
          urgencyScore: 50,
          expectedImpact: "direct",
          improvesSubsystems: [],
          estimatedEffort: "medium",
          effortRationale: "",
          prerequisites: [],
          confidence: -0.1,
          mechanism: "temporal_cascade",
          sourceFindingSubsystem: "memory",
          rationale: "",
        },
      ],
      meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 1, objectivesHigh: 0 },
    }) + "\n";
    appendFileSync(join(dir, "strategic-plans.jsonl"), badPlan, "utf-8");
    const result = await store.loadLatest();
    expect(result).toBeNull();
  });

  // T18: invalid prerequisite silently skipped on load (returns null)
  it("returns null when saved plan has invalid prerequisite reference", async () => {
    const { appendFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const badPlan = JSON.stringify({
      schemaVersion: "p11.3.0",
      planId: "bad-prereq",
      generatedAt: "2026-07-03T12:00:00.000Z",
      rootCauseAnalysisId: "rca-1",
      correlationGraphId: "cg-1",
      status: "ok",
      objectives: [
        {
          id: "obj-1",
          targetSubsystem: "memory",
          targetMetric: null,
          topCauseSubsystem: null,
          currentScore: 50,
          urgencyScore: 50,
          expectedImpact: "direct",
          improvesSubsystems: [],
          estimatedEffort: "medium",
          effortRationale: "",
          prerequisites: ["nonexistent-obj"],
          confidence: null,
          mechanism: null,
          sourceFindingSubsystem: "memory",
          rationale: "",
        },
      ],
      meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 1, objectivesHigh: 0 },
    }) + "\n";
    appendFileSync(join(dir, "strategic-plans.jsonl"), badPlan, "utf-8");
    const result = await store.loadLatest();
    expect(result).toBeNull();
  });
});
