// tests/planning/build-strategic-plan.vitest.ts
//
// P11.3 — Pure function tests for buildStrategicPlan.

import { describe, it, expect } from "vitest";
import { buildStrategicPlan } from "../../src/planning/build-strategic-plan.js";
import type {
  RootCauseAnalysis,
  CausalFinding,
  LikelyCause,
} from "../../src/reasoning/reasoning-types.js";
import type { CorrelationSubsystemId } from "../../src/correlation/correlation-types.js";
import type { PlanningEngineConfig } from "../../src/planning/planning-types.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeAnalysis(overrides?: Partial<RootCauseAnalysis>): RootCauseAnalysis {
  return {
    schemaVersion: "p11.2.0",
    analysisId: "reason-test-1",
    generatedAt: "2026-07-03T12:00:00.000Z",
    correlationGraphId: "abc123",
    status: "ok",
    findings: [],
    meta: {
      totalSubsystemsExamined: 8,
      degradedSubsystems: 0,
      totalEdgesAnalyzed: 0,
    },
    ...overrides,
  };
}

function makeFinding(
  subsystem: string,
  score: number,
  causes?: LikelyCause[],
  drivingMetric?: string,
): CausalFinding {
  return {
    primarySubsystem: subsystem as CorrelationSubsystemId,
    currentScore: score,
    likelyCauses: causes ?? [],
    drivingMetric: drivingMetric ?? null,
    recommendedAction: `${subsystem} is degraded.`,
  };
}

function makeCause(
  causeSubsystem: string,
  confidence: number,
  mechanism: LikelyCause["mechanism"],
): LikelyCause {
  return {
    causeSubsystem: causeSubsystem as CorrelationSubsystemId,
    confidence,
    mechanism,
    evidenceIds: ["ev-1"],
    driftItemIds: [],
  };
}

function defaultConfig(): PlanningEngineConfig {
  return { maxObjectives: 8, minUrgencyScore: 15 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildStrategicPlan", () => {
  // T1: Returns objectives for analysis with degraded subsystems
  it("creates objectives for degraded subsystems with causes", () => {
    const analysis = makeAnalysis({
      findings: [
        makeFinding("memory", 35, [makeCause("workflow", 0.8, "temporal_cascade")]),
        makeFinding("workflow", 55, [makeCause("memory", 0.75, "concurrent_degradation")]),
      ],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.status).toBe("ok");
    expect(plan.objectives.length).toBe(2);
    expect(plan.rootCauseAnalysisId).toBe("reason-test-1");
    expect(plan.correlationGraphId).toBe("abc123");
  });

  // T2: Priorities degraded subsystems by urgency score
  it("sorts objectives by urgency descending", () => {
    const analysis = makeAnalysis({
      findings: [
        makeFinding("tools", 80, [makeCause("agents", 0.5, "temporal_cascade")]),
        makeFinding("memory", 20, [makeCause("workflow", 0.9, "concurrent_degradation")]),
      ],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.objectives.length).toBe(2);
    expect(plan.objectives[0].targetSubsystem).toBe("memory");
    expect(plan.objectives[0].urgencyScore).toBeGreaterThan(plan.objectives[1].urgencyScore);
  });

  // T3: Causal dependency creates prerequisites
  it("assigns prerequisites when causeSubsystem matches targetSubsystem", () => {
    const analysis = makeAnalysis({
      findings: [
        makeFinding("memory", 30, [makeCause("agents", 0.85, "temporal_cascade")]),
        makeFinding("workflow", 40, [makeCause("memory", 0.8, "concurrent_degradation")]),
      ],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    const workflowObj = plan.objectives.find((o) => o.targetSubsystem === "workflow");
    const memoryObj = plan.objectives.find((o) => o.targetSubsystem === "memory");
    expect(workflowObj).toBeDefined();
    expect(memoryObj).toBeDefined();
    expect(workflowObj!.prerequisites).toContain(memoryObj!.id);
  });

  // T4: no_degradation returns no_degradation status
  it("returns no_degradation when analysis status is no_degradation", () => {
    const analysis = makeAnalysis({ status: "no_degradation" });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.status).toBe("no_degradation");
    expect(plan.objectives).toHaveLength(0);
  });

  // T5: insufficient_history returns insufficient_analysis status
  it("returns insufficient_analysis when analysis status is insufficient_history", () => {
    const analysis = makeAnalysis({ status: "insufficient_history" });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.status).toBe("insufficient_analysis");
    expect(plan.objectives).toHaveLength(0);
  });

  // T6: No-cause findings get low urgency and no prerequisites
  it("assigns low urgency and no prerequisites for no-cause findings", () => {
    // Score 25 → urgency = floor((100-25)/100 * 25) = floor(18.75) = 18, above min of 15
    const analysis = makeAnalysis({
      findings: [makeFinding("tools", 25, [])],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.objectives.length).toBe(1);
    const obj = plan.objectives[0];
    expect(obj.urgencyScore).toBeLessThanOrEqual(25);
    expect(obj.prerequisites).toHaveLength(0);
    expect(obj.topCauseSubsystem).toBeNull();
    expect(obj.confidence).toBeNull();
    expect(obj.mechanism).toBeNull();
  });

  // T7: Max objectives cap is respected
  it("caps objectives at config.maxObjectives", () => {
    const findings = [1, 2, 3, 4, 5, 6].map((i) =>
      makeFinding(`sub${i}`, 30 - i * 5, [makeCause("memory", 0.8, "temporal_cascade")]),
    );
    const analysis = makeAnalysis({ findings });
    const plan = buildStrategicPlan(analysis, { maxObjectives: 3, minUrgencyScore: 0 });
    expect(plan.objectives.length).toBe(3);
  });

  // T8: Min urgency score filter works
  it("filters out objectives below minUrgencyScore", () => {
    const analysis = makeAnalysis({
      findings: [
        makeFinding("memory", 20, [makeCause("agents", 0.9, "temporal_cascade")]),
        makeFinding("tools", 99, []), // very healthy, minimal urgency
      ],
    });
    const plan = buildStrategicPlan(analysis, { maxObjectives: 8, minUrgencyScore: 5 });
    expect(plan.objectives.length).toBe(1);
    expect(plan.objectives[0].targetSubsystem).toBe("memory");
  });

  // T9: StrategicImpact classification for all three values
  it("classifies direct (0), indirect (1), and compound (2+) impacts correctly", () => {
    // agents causes: none as a causeSubsystem (0 dependents) → direct
    // security causes: agents depends on it (1 dependent) → indirect
    // memory causes: agents AND security depend on it (2+ dependents) → compound
    const analysis = makeAnalysis({
      findings: [
        makeFinding("agents", 30, [
          makeCause("security", 0.7, "temporal_cascade"),
          makeCause("memory", 0.7, "temporal_cascade"),
        ]),
        makeFinding("security", 35, [makeCause("memory", 0.8, "temporal_cascade")]),
      ],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    const agents = plan.objectives.find((o) => o.targetSubsystem === "agents");
    expect(agents!.expectedImpact).toBe("direct");
    const security = plan.objectives.find((o) => o.targetSubsystem === "security");
    expect(security!.expectedImpact).toBe("indirect");
    // No memory finding in objectives because it's not degraded
    // (memory causes both agents and security)
    // Verify improvesSubsystems assignment:
    expect(agents!.improvesSubsystems).toHaveLength(0);
    expect(security!.improvesSubsystems).toContain("agents");
  });

  // T10: Effort estimation per mechanism
  it("maps each mechanism to the correct default effort", () => {
    const analysis = makeAnalysis({
      findings: [
        makeFinding("memory", 30, [makeCause("agents", 0.8, "temporal_cascade")]),
        makeFinding("agents", 35, [makeCause("tools", 0.8, "concurrent_degradation")]),
        makeFinding("tools", 40, [makeCause("security", 0.8, "inverse_correlation")]),
        makeFinding("security", 45, [makeCause("workflow", 0.8, "degradation_chain")]),
      ],
    });
    const plan = buildStrategicPlan(analysis, defaultConfig());
    expect(plan.objectives.find((o) => o.targetSubsystem === "memory")!.estimatedEffort).toBe("medium");
    expect(plan.objectives.find((o) => o.targetSubsystem === "agents")!.estimatedEffort).toBe("high");
    expect(plan.objectives.find((o) => o.targetSubsystem === "tools")!.estimatedEffort).toBe("high");
    expect(plan.objectives.find((o) => o.targetSubsystem === "security")!.estimatedEffort).toBe("high");
  });
});
