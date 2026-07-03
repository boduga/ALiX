// tests/forecasting/forecasting-engine.vitest.ts
//
// P11.5 — ForecastingEngine tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync, rmdirSync } from "node:fs";
import { StrategicPlanStore } from "../../src/planning/strategic-plan-store.js";
import { ConfidenceModelStore } from "../../src/learning/confidence-model-store.js";
import { HealthForecastStore } from "../../src/forecasting/health-forecast-store.js";
import { ForecastingEngine } from "../../src/forecasting/forecasting-engine.js";
import type { StrategicPlan } from "../../src/planning/planning-types.js";
import type { CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";
import type { ScoreSnapshotProvider } from "../../src/learning/learning-types.js";
import { ForecasterError } from "../../src/forecasting/forecasting-types.js";
import { DEFAULT_FORECASTING_CONFIG } from "../../src/forecasting/forecasting-config.js";

function makePlan(overrides?: Partial<StrategicPlan>): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId: "strat-test-engine",
    generatedAt: "2026-07-01T12:00:00.000Z",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    status: "ok",
    objectives: [{
      id: "obj-1",
      targetSubsystem: "memory" as CorrelationSubsystemId,
      targetMetric: null, topCauseSubsystem: null,
      currentScore: 65, urgencyScore: 80, expectedImpact: "direct",
      improvesSubsystems: [], estimatedEffort: "medium",
      effortRationale: "test", prerequisites: [],
      confidence: 0.75, mechanism: "temporal_cascade" as any,
      sourceFindingSubsystem: "memory" as CorrelationSubsystemId,
      rationale: "test",
    }],
    meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 1, objectivesLow: 0, objectivesMedium: 1, objectivesHigh: 0 },
    ...overrides,
  };
}

describe("ForecastingEngine", () => {
  let planDir: string;
  let learnDir: string;
  let forecastDir: string;
  let planStore: StrategicPlanStore;
  let learnStore: ConfidenceModelStore;
  let forecastStore: HealthForecastStore;
  let scoreProvider: ScoreSnapshotProvider;

  beforeEach(() => {
    planDir = mkdtempSync(join(tmpdir(), "p11-5-engine-plan-"));
    learnDir = mkdtempSync(join(tmpdir(), "p11-5-engine-learn-"));
    forecastDir = mkdtempSync(join(tmpdir(), "p11-5-engine-forecast-"));
    planStore = new StrategicPlanStore(planDir);
    learnStore = new ConfidenceModelStore(learnDir);
    forecastStore = new HealthForecastStore(forecastDir);
    scoreProvider = {
      loadScoresAt: async () => new Map(),
      loadCurrentScores: async () => new Map([[ "memory" as CorrelationSubsystemId, 65 ]]),
    };
  });

  afterEach(() => {
    for (const dir of [planDir, learnDir, forecastDir]) {
      try {
        const f1 = join(dir, "strategic-plans.jsonl"); if (existsSync(f1)) unlinkSync(f1);
        const f2 = join(dir, "confidence-models.jsonl"); if (existsSync(f2)) unlinkSync(f2);
        const f3 = join(dir, "health-forecasts.jsonl"); if (existsSync(f3)) unlinkSync(f3);
        rmdirSync(dir);
      } catch { /* ok */ }
    }
  });

  // T15: run returns forecast when plan exists
  it("returns a forecast when a strategic plan exists", async () => {
    await planStore.save(makePlan());
    const engine = new ForecastingEngine(planStore, learnStore, forecastStore, scoreProvider, DEFAULT_FORECASTING_CONFIG);
    const forecast = await engine.run();
    expect(forecast).toBeDefined();
    expect(forecast.schemaVersion).toBe("p11.5.0");
    expect(forecast.sourcePlanId).toBe("strat-test-engine");
  });

  // T16: run throws when no plan exists
  it("throws ForecasterError when no strategic plan exists", async () => {
    const engine = new ForecastingEngine(planStore, learnStore, forecastStore, scoreProvider, DEFAULT_FORECASTING_CONFIG);
    await expect(engine.run()).rejects.toThrow(ForecasterError);
  });

  // T17: loadLatestForecast returns null when empty
  it("loadLatestForecast returns null when no forecasts exist", async () => {
    const engine = new ForecastingEngine(planStore, learnStore, forecastStore, scoreProvider, DEFAULT_FORECASTING_CONFIG);
    expect(await engine.loadLatestForecast()).toBeNull();
  });
});
