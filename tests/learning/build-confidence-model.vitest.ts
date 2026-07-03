// tests/learning/build-confidence-model.vitest.ts
//
// P11.4 — Pure function tests for buildConfidenceModel.

import { describe, it, expect } from "vitest";
import { buildConfidenceModel } from "../../src/learning/build-confidence-model.js";
import type { StrategicPlan, PlanningObjective } from "../../src/planning/planning-types.js";
import type { LearningOutcomeRecord, LearningObservationContext, LearningEngineConfig } from "../../src/learning/learning-types.js";
import type { CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";
import type { CausalMechanism } from "../../src/reasoning/reasoning-types.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeObjective(overrides?: Partial<PlanningObjective>): PlanningObjective {
  return {
    id: "strat-obj-obj-1",
    targetSubsystem: "memory" as CorrelationSubsystemId,
    targetMetric: null,
    topCauseSubsystem: "workflow" as CorrelationSubsystemId,
    currentScore: 65,
    urgencyScore: 80,
    expectedImpact: "direct",
    improvesSubsystems: [],
    estimatedEffort: "medium",
    effortRationale: "test",
    prerequisites: [],
    confidence: 0.75,
    mechanism: "temporal_cascade" as CausalMechanism,
    sourceFindingSubsystem: "memory" as CorrelationSubsystemId,
    rationale: "test objective",
    ...overrides,
  };
}

function makePlan(overrides?: Partial<StrategicPlan>): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId: "strat-test-1",
    generatedAt: "2026-07-03T12:00:00.000Z",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    status: "ok",
    objectives: [],
    meta: { totalSubsystemsEvaluated: 8, prioritizedObjectives: 0, objectivesLow: 0, objectivesMedium: 0, objectivesHigh: 0 },
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<LearningOutcomeRecord>): LearningOutcomeRecord {
  return {
    sourceObjectiveId: "strat-obj-obj-1",
    sourcePlanId: "strat-test-1",
    completed: true,
    completedAt: "2026-07-04T12:00:00.000Z",
    status: "completed",
    ...overrides,
  };
}

function makeContext(overrides?: Partial<LearningObservationContext>): LearningObservationContext {
  return {
    generatedAt: "2026-07-05T12:00:00.000Z",
    baselineTimestamp: "2026-07-03T12:00:00.000Z",
    evaluationTimestamp: "2026-07-05T12:00:00.000Z",
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<LearningEngineConfig>): LearningEngineConfig {
  return {
    maxPositiveAdjustment: 0.05,
    maxNegativeAdjustment: 0.05,
    minConfidence: 0.05,
    maxConfidence: 0.95,
    minImprovementDelta: 5,
    evaluationWindowMs: 604800000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildConfidenceModel", () => {
  const config = makeConfig();

  // T1: Completed + score improved → score_improvement, positive adjustment
  it("produces score_improvement with positive adjustment when completed and score improved", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-1", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 73]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("score_improvement");
    expect(model.updates[0].scoreDelta).toBe(8);
    expect(model.updates[0].adjustment).toBeCloseTo(0.04, 3);
    expect(model.updates[0].resultingConfidence).toBeCloseTo(0.79, 3);
    expect(model.meta.objectivesWithSignals).toBe(1);
    expect(model.meta.objectivesSkipped).toBe(0);
    expect(model.meta.objectivesWithoutSignal).toBe(0);
  });

  // T2: Completed + no improvement → completed_no_improvement, negative adjustment
  it("produces completed_no_improvement with full negative adjustment when completed but score did not improve", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-2", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-2", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("completed_no_improvement");
    expect(model.updates[0].adjustment).toBe(-0.05);
    expect(model.meta.objectivesWithSignals).toBe(1);
  });

  // T3: Not completed + score improved → no_action_improvement, 0 adjustment (audit only)
  it("produces no_action_improvement with zero adjustment when not completed but score improved", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-3", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-3", completed: false })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 77]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("no_action_improvement");
    expect(model.updates[0].adjustment).toBe(0);
    expect(model.updates[0].resultingConfidence).toBe(0.75); // unchanged
    expect(model.meta.objectivesWithSignals).toBe(1);
  });

  // T4: Not completed + no improvement → no update
  it("produces no update when not completed and no score improvement", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-4", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-4", completed: false })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 62]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(0);
    expect(model.meta.objectivesWithSignals).toBe(0);
    expect(model.meta.objectivesWithoutSignal).toBe(1);
  });

  // T5: Completed + degraded → completed_no_improvement, full negative
  it("produces completed_no_improvement with full negative when completed and further degraded", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-5", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-5", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 50]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("completed_no_improvement");
    expect(model.updates[0].adjustment).toBe(-0.05);
    expect(model.updates[0].scoreDelta).toBe(-15);
  });

  // T6: Objective with confidence:null → skipped
  it("skips objectives with null confidence", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-6", confidence: null })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-6", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 80]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(0);
    expect(model.meta.objectivesSkipped).toBe(1);
    expect(model.meta.objectivesEvaluated).toBe(1);
  });

  // T7: Adjustment clamped at maxPositiveAdjustment
  it("clamps adjustment to max positive boundary", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-7", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-7", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 50]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 90]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].adjustment).toBeLessThanOrEqual(0.05);
    expect(model.updates[0].adjustment).toBe(0.05); // Δ=40 → 0.05 * min(40/10, 1) = 0.05
  });

  // T8: Resulting confidence clamped to [0.05, 0.95]
  it("clamps resulting confidence to configured bounds", () => {
    const configLow = makeConfig({ minConfidence: 0.1, maxConfidence: 0.9 });
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-8", confidence: 0.04 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-8", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 73]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, configLow);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].resultingConfidence).toBe(0.1); // clamped up from 0.04 + 0.04 = 0.08
  });

  // T9: Empty plan → empty model with zero counters
  it("returns empty model when plan has no objectives", () => {
    const plan = makePlan({ objectives: [] });
    const context = makeContext();

    const model = buildConfidenceModel(plan, [], new Map(), new Map(), context, config);

    expect(model.updates).toHaveLength(0);
    expect(model.meta.objectivesEvaluated).toBe(0);
    expect(model.meta.objectivesWithSignals).toBe(0);
    expect(model.meta.objectivesSkipped).toBe(0);
    expect(model.meta.objectivesWithoutSignal).toBe(0);
    expect(model.summary.positiveUpdates).toBe(0);
  });

  // T10: No outcome records → defaults to incomplete
  it("treats all objectives as incomplete when no outcome records exist", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-10", confidence: 0.75 })],
    });
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 73]]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, [], baselineScores, currentScores, context, config);

    // Not completed but score improved → no_action_improvement (audit)
    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("no_action_improvement");
    expect(model.updates[0].completed).toBe(false);
    expect(model.updates[0].adjustment).toBe(0);
  });

  // T11: Score delta exactly at threshold → improved
  it("treats score delta exactly at minImprovementDelta as improved", () => {
    const plan = makePlan({
      objectives: [makeObjective({ id: "strat-obj-obj-11", confidence: 0.75 })],
    });
    const outcomes = [makeOutcome({ sourceObjectiveId: "strat-obj-obj-11", completed: true })];
    const baselineScores = new Map([["memory" as CorrelationSubsystemId, 65]]);
    const currentScores = new Map([["memory" as CorrelationSubsystemId, 70]]); // Δ=5, exactly at threshold
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(1);
    expect(model.updates[0].signal).toBe("score_improvement");
    expect(model.updates[0].adjustment).toBeCloseTo(0.025, 3); // 0.05 * min(5/10, 1) = 0.025
  });

  // T12: Multiple objectives → ordered updates, correct counters
  it("processes multiple objectives with mixed outcomes and correct counters", () => {
    const plan = makePlan({
      // planId inherited from makePlan — "strat-test-1"
      objectives: [
        makeObjective({ id: "obj-a", targetSubsystem: "memory" as CorrelationSubsystemId, confidence: 0.8 }),
        makeObjective({ id: "obj-b", targetSubsystem: "workflow" as CorrelationSubsystemId, confidence: 0.6 }),
        makeObjective({ id: "obj-c", targetSubsystem: "security" as CorrelationSubsystemId, confidence: 0.7 }),
      ],
    });
    const outcomes = [
      makeOutcome({ sourceObjectiveId: "obj-a", completed: true }),
      makeOutcome({ sourceObjectiveId: "obj-b", completed: true }),
      makeOutcome({ sourceObjectiveId: "obj-c", completed: false }),
    ];
    const baselineScores = new Map([
      ["memory" as CorrelationSubsystemId, 50],
      ["workflow" as CorrelationSubsystemId, 70],
      ["security" as CorrelationSubsystemId, 80],
    ]);
    const currentScores = new Map([
      ["memory" as CorrelationSubsystemId, 80],   // Δ=30, improved → score_improvement, adj=0.05
      ["workflow" as CorrelationSubsystemId, 70],  // Δ=0, not improved, completed → completed_no_improvement, adj=-0.05
      ["security" as CorrelationSubsystemId, 95],  // Δ=15, improved, not completed → no_action_improvement, adj=0
    ]);
    const context = makeContext();

    const model = buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config);

    expect(model.updates).toHaveLength(3);
    expect(model.meta.objectivesEvaluated).toBe(3);
    expect(model.meta.objectivesWithSignals).toBe(3);
    expect(model.meta.objectivesSkipped).toBe(0);
    expect(model.meta.objectivesWithoutSignal).toBe(0);
    expect(model.summary.positiveUpdates).toBe(1);
    expect(model.summary.negativeUpdates).toBe(1);
    expect(model.summary.zeroAdjustmentUpdates).toBe(1);
    expect(model.summary.averageAdjustment).toBe(0); // (0.05 + (-0.05) + 0) / 3 = 0
    expect(model.rootCauseAnalysisId).toBe("reason-anl-1");
    expect(model.correlationGraphId).toBe("abc123");
  });
});
