// tests/contracts/plan-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  PlanningObjectiveSchema,
  StrategicPlanSchema,
  EffortEstimateSchema,
  CausalMechanismSchema,
  CorrelationSubsystemIdSchema,
} from "../../src/contracts/plan-schemas.js";

describe("EffortEstimateSchema", () => {
  it("accepts valid efforts", () => {
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("low" as any));
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("medium" as any));
    assert.doesNotThrow(() => Schema.decodeSync(EffortEstimateSchema)("high" as any));
  });
  it("rejects invalid efforts", () => {
    assert.throws(() => Schema.decodeSync(EffortEstimateSchema)("extreme" as any));
  });
});

describe("CorrelationSubsystemIdSchema", () => {
  it("accepts memory", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(CorrelationSubsystemIdSchema)("memory" as any)
    );
  });
  it("rejects unknown subsystem", () => {
    assert.throws(() =>
      Schema.decodeSync(CorrelationSubsystemIdSchema)("unknown" as any)
    );
  });
});

describe("CausalMechanismSchema", () => {
  it("accepts degradation_chain", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(CausalMechanismSchema)("degradation_chain" as any)
    );
  });
  it("rejects invalid mechanism", () => {
    assert.throws(() =>
      Schema.decodeSync(CausalMechanismSchema)("resource_exhaustion" as any)
    );
  });
});

describe("PlanningObjectiveSchema", () => {
  it("decodes a valid objective", () => {
    const obj = Schema.decodeSync(PlanningObjectiveSchema)({
      id: "strat-obj-1",
      targetSubsystem: "memory",
      targetMetric: null,
      topCauseSubsystem: "tools",
      currentScore: 65,
      urgencyScore: 72,
      expectedImpact: "compound",
      improvesSubsystems: ["workflow", "agents"],
      estimatedEffort: "medium",
      effortRationale: "Requires cross-subsystem inspection",
      prerequisites: [],
      confidence: 0.8,
      mechanism: "degradation_chain",
      sourceFindingSubsystem: "memory",
      rationale: "Memory subsystem is degraded",
    } as any);
    assert.strictEqual(obj.targetSubsystem, "memory");
    assert.strictEqual(obj.mechanism, "degradation_chain");
  });

  it("rejects invalid subsystem", () => {
    assert.throws(() =>
      Schema.decodeSync(PlanningObjectiveSchema)({
        id: "obj-1",
        targetSubsystem: "nonexistent",
        targetMetric: null,
        topCauseSubsystem: null,
        currentScore: 50,
        urgencyScore: 10,
        expectedImpact: "direct",
        improvesSubsystems: [],
        estimatedEffort: "low",
        effortRationale: "test",
        prerequisites: [],
        confidence: null,
        mechanism: null,
        sourceFindingSubsystem: "memory",
        rationale: "test",
      } as any)
    );
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(PlanningObjectiveSchema)({ id: "obj-1" } as any)
    );
  });
});

describe("StrategicPlanSchema", () => {
  it("decodes a valid plan", () => {
    const plan = Schema.decodeSync(StrategicPlanSchema)({
      schemaVersion: "p11.3.0",
      planId: "strat-1",
      generatedAt: "2026-07-03T00:00:00.000Z",
      rootCauseAnalysisId: "rca-1",
      correlationGraphId: "cg-1",
      status: "ok",
      objectives: [],
      meta: {
        totalSubsystemsEvaluated: 8,
        prioritizedObjectives: 0,
        objectivesLow: 0,
        objectivesMedium: 0,
        objectivesHigh: 0,
      },
    } as any);
    assert.strictEqual(plan.planId, "strat-1");
  });
});
