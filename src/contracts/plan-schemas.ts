// src/contracts/plan-schemas.ts
//
// Effect Schema contracts for strategic planning boundaries.
// Mirrors src/planning/planning-types.ts.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Enums / literals
// ---------------------------------------------------------------------------

export const EffortEstimateSchema = Schema.Literal("low", "medium", "high");
export const StrategicImpactSchema = Schema.Literal("direct", "indirect", "compound");
export const PlanStatusSchema = Schema.Literal(
  "ok",
  "no_degradation",
  "insufficient_analysis",
  "no_objectives",
);

export const CorrelationSubsystemIdSchema = Schema.Literal(
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
);

export const CausalMechanismSchema = Schema.Literal(
  "temporal_cascade",
  "concurrent_degradation",
  "inverse_correlation",
  "degradation_chain",
);

// ---------------------------------------------------------------------------
// PlanningObjective
// ---------------------------------------------------------------------------

export const PlanningObjectiveSchema = Schema.Struct({
  id: Schema.String,
  targetSubsystem: CorrelationSubsystemIdSchema,
  targetMetric: Schema.NullOr(Schema.String),
  topCauseSubsystem: Schema.NullOr(CorrelationSubsystemIdSchema),
  currentScore: Schema.Number,
  urgencyScore: Schema.Number,
  expectedImpact: StrategicImpactSchema,
  improvesSubsystems: Schema.Array(CorrelationSubsystemIdSchema),
  estimatedEffort: EffortEstimateSchema,
  effortRationale: Schema.String,
  prerequisites: Schema.Array(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  mechanism: Schema.NullOr(CausalMechanismSchema),
  sourceFindingSubsystem: CorrelationSubsystemIdSchema,
  rationale: Schema.String,
});
export type PlanningObjectiveFromSchema = typeof PlanningObjectiveSchema.Type;

// ---------------------------------------------------------------------------
// StrategicPlanMeta
// ---------------------------------------------------------------------------

export const StrategicPlanMetaSchema = Schema.Struct({
  totalSubsystemsEvaluated: Schema.Number,
  prioritizedObjectives: Schema.Number,
  objectivesLow: Schema.Number,
  objectivesMedium: Schema.Number,
  objectivesHigh: Schema.Number,
});

// ---------------------------------------------------------------------------
// StrategicPlan
// ---------------------------------------------------------------------------

export const StrategicPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal("p11.3.0"),
  planId: Schema.String,
  generatedAt: Schema.String,
  rootCauseAnalysisId: Schema.String,
  correlationGraphId: Schema.String,
  status: PlanStatusSchema,
  objectives: Schema.Array(PlanningObjectiveSchema),
  meta: StrategicPlanMetaSchema,
});
export type StrategicPlanFromSchema = typeof StrategicPlanSchema.Type;
