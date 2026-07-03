// tests/forecasting/build-health-forecast.vitest.ts
//
// P11.5 — Pure function tests for buildHealthForecast.

import { describe, it, expect } from "vitest";
import { buildHealthForecast } from "../../src/forecasting/build-health-forecast.js";
import type { StrategicPlan, PlanningObjective } from "../../src/planning/planning-types.js";
import type { UpdatedConfidenceModel } from "../../src/learning/learning-types.js";
import type { ForecastingEngineConfig, ForecastingObservationContext } from "../../src/forecasting/forecasting-types.js";
import type { CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";

function makeObjective(overrides?: Partial<PlanningObjective>): PlanningObjective {
  return {
    id: "strat-obj-1",
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
    sourceFindingSubsystem: "memory" as any,
    rationale: "test",
    ...overrides,
  };
}

function makePlan(overrides?: Partial<StrategicPlan>): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId: "strat-test-1",
    generatedAt: "2026-07-01T12:00:00.000Z",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    status: "ok",
    objectives: [],
    meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 0, objectivesLow: 0, objectivesMedium: 0, objectivesHigh: 0 },
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ForecastingObservationContext>): ForecastingObservationContext {
  return { generatedAt: "2026-07-03T12:00:00.000Z", ...overrides };
}

function makeConfig(overrides?: Partial<ForecastingEngineConfig>): ForecastingEngineConfig {
  return {
    forecastWindows: 3,
    trendWindow: 5,
    dampeningFactor: 0.3,
    windowDurationMs: 604800000,
    highConfidenceThreshold: 0.7,
    mediumConfidenceThreshold: 0.4,
    ...overrides,
  };
}

const config = makeConfig();
const ctx = makeContext();

describe("buildHealthForecast", () => {
  // T1: Forecast with trend and confidence model
  it("projects scores with trend and narrows intervals with high confidence", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "memory" as CorrelationSubsystemId, currentScore: 65 })],
    });
    const history = new Map([[ "memory" as CorrelationSubsystemId, [60, 62, 65, 68, 70] ]]);
    const currentScores = new Map([[ "memory" as CorrelationSubsystemId, 70 ]]);
    const confidenceModel = {
      schemaVersion: "p11.4.0",
      modelId: "lrn-test",
      generatedAt: "2026-07-03T12:00:00.000Z",
      sourcePlanId: "strat-test-1",
      rootCauseAnalysisId: "reason-anl-1",
      correlationGraphId: "abc123",
      updates: [{ targetSubsystem: "memory" as CorrelationSubsystemId, resultingConfidence: 0.85 }] as any[],
      meta: {} as any,
      summary: { positiveUpdates: 0, negativeUpdates: 0, zeroAdjustmentUpdates: 0, averageAdjustment: 0 },
      mechanismAdjustments: [],
    } as UpdatedConfidenceModel;

    const forecast = buildHealthForecast(plan, confidenceModel, history, currentScores, ctx, config);

    expect(forecast.projections).toHaveLength(1);
    expect(forecast.projections[0].targetSubsystem).toBe("memory");
    expect(forecast.projections[0].currentScore).toBe(70);
    expect(forecast.projections[0].projectedScores).toHaveLength(3);
    expect(forecast.projections[0].forecastConfidence).toBeCloseTo(0.85, 3);
    // With 5 history points, delta = (70-60)/4 = 2.5 per window
    expect(forecast.projections[0].observedDeltaPerWindow).toBeCloseTo(2.5, 2);
    expect(forecast.sourceConfidenceModelId).toBe("lrn-test");
  });

  // T2: Null confidence model uses default 0.5
  it("uses default confidence 0.5 when confidence model is null", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "memory" as CorrelationSubsystemId })],
    });
    const history = new Map([[ "memory" as CorrelationSubsystemId, [60, 65] ]]);
    const currentScores = new Map([[ "memory" as CorrelationSubsystemId, 65 ]]);

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    expect(forecast.projections).toHaveLength(1);
    expect(forecast.projections[0].forecastConfidence).toBe(0.5);
    expect(forecast.sourceConfidenceModelId).toBeNull();
  });

  // T3: No score history produces flat projection
  it("produces flat projection when score history is empty", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "memory" as CorrelationSubsystemId, currentScore: 65 })],
    });
    const history = new Map();
    const currentScores = new Map([[ "memory" as CorrelationSubsystemId, 65 ]]);

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    expect(forecast.projections).toHaveLength(1);
    expect(forecast.projections[0].observedDeltaPerWindow).toBe(0);
    expect(forecast.projections[0].observationCount).toBe(0);
    // Flat projection should hold near 65 (mean reversion toward 80 with dampening)
    expect(forecast.projections[0].projectedScores[0]).toBeGreaterThanOrEqual(65);
  });

  // T4: Single data point treated as no trend
  it("treats single history point as no trend", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "memory" as CorrelationSubsystemId })],
    });
    const history = new Map([[ "memory" as CorrelationSubsystemId, [65] ]]);
    const currentScores = new Map([[ "memory" as CorrelationSubsystemId, 65 ]]);

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    expect(forecast.projections).toHaveLength(1);
    expect(forecast.projections[0].observationCount).toBe(1);
    expect(forecast.projections[0].observedDeltaPerWindow).toBe(0);
  });

  // T5: Intervals widen with forward distance
  it("confidence intervals widen with each forward window", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "memory" as CorrelationSubsystemId })],
    });
    const history = new Map([[ "memory" as CorrelationSubsystemId, [60, 65] ]]);
    const currentScores = new Map([[ "memory" as CorrelationSubsystemId, 65 ]]);

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    const bounds = forecast.projections[0];
    const w0Spread = bounds.upperBound[0] - bounds.lowerBound[0];
    const w1Spread = bounds.upperBound[1] - bounds.lowerBound[1];
    const w2Spread = bounds.upperBound[2] - bounds.lowerBound[2];
    // Each window should have wider intervals: W1 < W2 < W3
    expect(w0Spread).toBeLessThan(w1Spread);
    expect(w1Spread).toBeLessThan(w2Spread);
  });

  // T6: High confidence produces narrower intervals than low confidence
  it("produces narrower intervals with high confidence", () => {
    const plan = makePlan({
      objectives: [
        makeObjective({ id: "o1", targetSubsystem: "memory" as CorrelationSubsystemId }),
        makeObjective({ id: "o2", targetSubsystem: "workflow" as CorrelationSubsystemId }),
      ],
    });
    const history = new Map([
      ["memory" as CorrelationSubsystemId, [60, 65]],
      ["workflow" as CorrelationSubsystemId, [60, 65]],
    ]);
    const currentScores = new Map([
      ["memory" as CorrelationSubsystemId, 65],
      ["workflow" as CorrelationSubsystemId, 65],
    ]);
    const confidenceModel = {
      schemaVersion: "p11.4.0", modelId: "lrn-test", generatedAt: "2026-07-03T12:00:00.000Z",
      sourcePlanId: "strat-test-1", rootCauseAnalysisId: "reason-anl-1", correlationGraphId: "abc123",
      updates: [
        { targetSubsystem: "memory" as CorrelationSubsystemId, resultingConfidence: 0.95 },
        { targetSubsystem: "workflow" as CorrelationSubsystemId, resultingConfidence: 0.2 },
      ] as any[],
      meta: {} as any, summary: { positiveUpdates: 0, negativeUpdates: 0, zeroAdjustmentUpdates: 0, averageAdjustment: 0 },
      mechanismAdjustments: [],
    } as UpdatedConfidenceModel;

    const forecast = buildHealthForecast(plan, confidenceModel, history, currentScores, ctx, config);

    const memoryBounds = forecast.projections.find(p => p.targetSubsystem === "memory")!;
    const workflowBounds = forecast.projections.find(p => p.targetSubsystem === "workflow")!;

    const memorySpread = memoryBounds.upperBound[0] - memoryBounds.lowerBound[0];
    const workflowSpread = workflowBounds.upperBound[0] - workflowBounds.lowerBound[0];

    expect(memorySpread).toBeLessThan(workflowSpread);
  });

  // T7: No subsystems found returns empty projections
  it("returns empty projections when no subsystems are found", () => {
    const plan = makePlan({ objectives: [] });
    const forecast = buildHealthForecast(plan, null, new Map(), new Map(), ctx, config);

    expect(forecast.projections).toHaveLength(0);
    expect(forecast.meta.subsystemsForecast).toBe(0);
  });

  // T8: Scores clamped to [0, 100]
  it("clamps projected scores within [0, 100]", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "workflow" as CorrelationSubsystemId, currentScore: 95 })],
    });
    // Positive trend would push score above 100
    const history = new Map([[ "workflow" as CorrelationSubsystemId, [80, 95] ]]);
    const currentScores = new Map([[ "workflow" as CorrelationSubsystemId, 95 ]]);

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    for (const p of forecast.projections) {
      for (const s of p.projectedScores) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  // T9: Dampening mean-reverts over long horizon
  it("mean-reverts toward 80 with dampening over long horizon", () => {
    const plan = makePlan({
      objectives: [makeObjective({ targetSubsystem: "tools" as CorrelationSubsystemId, currentScore: 40 })],
    });
    const history = new Map([[ "tools" as CorrelationSubsystemId, [30, 40] ]]);
    const currentScores = new Map([[ "tools" as CorrelationSubsystemId, 40 ]]);
    // Delta is 10 per window

    const forecast = buildHealthForecast(plan, null, history, currentScores, ctx, config);

    const proj = forecast.projections[0];
    // W1 = 40 + 10 = 50, with dampening toward 80
    // Should be between 50 and 80
    expect(proj.projectedScores[0]).toBeGreaterThan(50);
    expect(proj.projectedScores[0]).toBeLessThan(80);
    // W3 should be closer to 80 than W1 (more dampening)
    expect(proj.projectedScores[2]).toBeGreaterThan(proj.projectedScores[0]);
  });

  // T10: Confidence classification correctly counted in meta
  it("correctly classifies forecasts as high/medium/low confidence", () => {
    const plan = makePlan({
      objectives: [
        makeObjective({ id: "o1", targetSubsystem: "memory" as CorrelationSubsystemId }),
        makeObjective({ id: "o2", targetSubsystem: "workflow" as CorrelationSubsystemId }),
        makeObjective({ id: "o3", targetSubsystem: "agents" as CorrelationSubsystemId }),
      ],
    });
    const history = new Map([
      ["memory" as CorrelationSubsystemId, [60, 65]],
      ["workflow" as CorrelationSubsystemId, [60, 65]],
      ["agents" as CorrelationSubsystemId, [60, 65]],
    ]);
    const currentScores = new Map([
      ["memory" as CorrelationSubsystemId, 65],
      ["workflow" as CorrelationSubsystemId, 65],
      ["agents" as CorrelationSubsystemId, 65],
    ]);
    const confidenceModel = {
      schemaVersion: "p11.4.0", modelId: "lrn-test", generatedAt: "2026-07-03T12:00:00.000Z",
      sourcePlanId: "strat-test-1", rootCauseAnalysisId: "reason-anl-1", correlationGraphId: "abc123",
      updates: [
        { targetSubsystem: "memory" as CorrelationSubsystemId, resultingConfidence: 0.85 },
        { targetSubsystem: "workflow" as CorrelationSubsystemId, resultingConfidence: 0.55 },
        { targetSubsystem: "agents" as CorrelationSubsystemId, resultingConfidence: 0.25 },
      ] as any[],
      meta: {} as any, summary: { positiveUpdates: 0, negativeUpdates: 0, zeroAdjustmentUpdates: 0, averageAdjustment: 0 },
      mechanismAdjustments: [],
    } as UpdatedConfidenceModel;

    const forecast = buildHealthForecast(plan, confidenceModel, history, currentScores, ctx, config);

    expect(forecast.meta.highConfidenceForecasts).toBe(1); // memory
    expect(forecast.meta.mediumConfidenceForecasts).toBe(1); // workflow
    expect(forecast.meta.lowConfidenceForecasts).toBe(1); // agents
    expect(forecast.meta.subsystemsForecast).toBe(3);
  });
});
