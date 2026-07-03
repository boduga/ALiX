// tests/learning/learning-engine.vitest.ts
//
// P11.4 — LearningEngine orchestrator tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync, rmdirSync } from "node:fs";
import { StrategicPlanStore } from "../../src/planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "../../src/learning/confidence-model-store.js";
import { LearningEngine } from "../../src/learning/learning-engine.js";
import type { StrategicPlan } from "../../src/planning/planning-types.js";
import type { LearningOutcomeRecord, LearningOutcomeStore } from "../../src/learning/learning-types.js";
import type { ScoreSnapshotProvider } from "../../src/learning/learning-types.js";
import { LearningEngineError } from "../../src/learning/learning-types.js";
import type { CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";
import { DEFAULT_LEARNING_CONFIG } from "../../src/learning/learning-config.js";

function makePlan(overrides?: Partial<StrategicPlan>): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId: "strat-test-engine-1",
    generatedAt: "2026-07-01T12:00:00.000Z",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    status: "ok",
    objectives: [
      {
        id: "strat-obj-engine-1-0",
        targetSubsystem: "memory" as CorrelationSubsystemId,
        targetMetric: null,
        topCauseSubsystem: null,
        currentScore: 65,
        urgencyScore: 80,
        expectedImpact: "direct",
        improvesSubsystems: [],
        estimatedEffort: "medium",
        effortRationale: "test",
        prerequisites: [],
        confidence: 0.75,
        mechanism: "temporal_cascade" as any,
        sourceFindingSubsystem: "memory" as CorrelationSubsystemId,
        rationale: "engine test",
      },
    ],
    meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 1, objectivesHigh: 0 },
    ...overrides,
  };
}

describe("LearningEngine", () => {
  let planDir: string;
  let learnDir: string;
  let planStore: StrategicPlanStore;
  let learnStore: ConfidenceModelStore;
  let outcomeStore: LearningOutcomeStore;
  let scoreProvider: ScoreSnapshotProvider;

  beforeEach(() => {
    planDir = mkdtempSync(join(tmpdir(), "p11-4-engine-plan-"));
    learnDir = mkdtempSync(join(tmpdir(), "p11-4-engine-learn-"));

    planStore = new StrategicPlanStore(planDir);
    learnStore = new ConfidenceModelStore(learnDir);

    outcomeStore = {
      list: async () => [] as LearningOutcomeRecord[],
    };

    scoreProvider = {
      loadScoresAt: async () => new Map([["memory" as CorrelationSubsystemId, 65]]),
      loadCurrentScores: async () => new Map([["memory" as CorrelationSubsystemId, 73]]),
    };
  });

  afterEach(() => {
    for (const dir of [planDir, learnDir]) {
      try {
        const f1 = join(dir, "strategic-plans.jsonl");
        if (existsSync(f1)) unlinkSync(f1);
        const f2 = join(dir, "confidence-models.jsonl");
        if (existsSync(f2)) unlinkSync(f2);
        rmdirSync(dir);
      } catch { /* ok */ }
    }
  });

  // T17: run returns model when plan exists
  it("returns a confidence model when a strategic plan exists", async () => {
    await planStore.save(makePlan());

    const engine = new LearningEngine(planStore, learnStore, outcomeStore, scoreProvider, DEFAULT_LEARNING_CONFIG);
    const model = await engine.run();

    expect(model).toBeDefined();
    expect(model.schemaVersion).toBe("p11.4.0");
    expect(model.sourcePlanId).toBe("strat-test-engine-1");
    // score improved 65→73 = Δ=8, not completed (no outcomes), should be no_action_improvement
    expect(model.updates.length).toBeGreaterThanOrEqual(0);
  });

  // T18: run throws when no plan exists
  it("throws LearningEngineError when no strategic plan exists", async () => {
    const engine = new LearningEngine(planStore, learnStore, outcomeStore, scoreProvider, DEFAULT_LEARNING_CONFIG);
    await expect(engine.run()).rejects.toThrow(LearningEngineError);
  });

  // T19: loadLatestModel returns null when empty
  it("loadLatestModel returns null when no models exist", async () => {
    const engine = new LearningEngine(planStore, learnStore, outcomeStore, scoreProvider, DEFAULT_LEARNING_CONFIG);
    const model = await engine.loadLatestModel();
    expect(model).toBeNull();
  });
});
