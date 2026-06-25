/**
 * P10.3 — Executive Planning Engine tests.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import type { ExecutionStepAction, ExecutionStep, ExecutionPlan, ExecutionStepStatus } from "../../src/executive/planning-engine.js";
import { PLANNER_VERSION, PLANNING_ALGORITHM, buildStepsForObjective, riskLevelFromScore } from "../../src/executive/planning-engine.js";

describe("planning engine types and constants", () => {
  it("exports PLANNER_VERSION as 1.0", () => {
    expect(PLANNER_VERSION).toBe("1.0");
  });

  it("exports PLANNING_ALGORITHM as template-v1", () => {
    expect(PLANNING_ALGORITHM).toBe("template-v1");
  });
});

describe("riskLevelFromScore", () => {
  it("returns high for scores >= 70", () => {
    expect(riskLevelFromScore(70, 50)).toBe("high");
    expect(riskLevelFromScore(50, 70)).toBe("high");
    expect(riskLevelFromScore(85, 90)).toBe("high");
  });

  it("returns medium for scores >= 40", () => {
    expect(riskLevelFromScore(40, 30)).toBe("medium");
    expect(riskLevelFromScore(30, 40)).toBe("medium");
    expect(riskLevelFromScore(55, 55)).toBe("medium");
  });

  it("returns low for scores < 40", () => {
    expect(riskLevelFromScore(10, 20)).toBe("low");
    expect(riskLevelFromScore(0, 0)).toBe("low");
    expect(riskLevelFromScore(39, 39)).toBe("low");
  });
});

describe("buildStepsForObjective", () => {
  function makeObj(overrides: Partial<{
    id: string;
    objectiveType: "stabilize" | "investigate" | "improve" | "maintain";
    targetSubsystems: string[];
    priorityScore: number;
    objectiveScore: number;
  }> = {}): Parameters<typeof buildStepsForObjective>[0] {
    return {
      id: "obj-1",
      objectiveType: "stabilize",
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
      ...overrides,
    };
  }

  it("returns 3 steps for stabilize objective", () => {
    const obj = makeObj({ objectiveType: "stabilize" });
    const steps = buildStepsForObjective(obj, "governance", 1);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("diagnose_root_cause");
    expect(steps[1].action).toBe("create_remediation_proposal");
    expect(steps[2].action).toBe("apply_remediation");
  });

  it("returns 3 steps for investigate objective", () => {
    const obj = makeObj({ objectiveType: "investigate", priorityScore: 40, objectiveScore: 30 });
    const steps = buildStepsForObjective(obj, "governance", 4);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("triage_investigations");
    expect(steps[1].action).toBe("assign_investigation_ownership");
    expect(steps[2].action).toBe("resolve_investigations");
  });

  it("returns 3 steps for improve objective", () => {
    const obj = makeObj({ objectiveType: "improve", targetSubsystems: ["learning"], priorityScore: 30, objectiveScore: 25 });
    const steps = buildStepsForObjective(obj, "learning", 7);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("audit_metrics");
  });

  it("returns 3 steps for maintain objective", () => {
    const obj = makeObj({ objectiveType: "maintain", targetSubsystems: ["security"], priorityScore: 20, objectiveScore: 15 });
    const steps = buildStepsForObjective(obj, "security", 10);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("schedule_health_check");
  });

  it("sets stepNumber starting from the given startAt (1-based)", () => {
    const obj = makeObj();
    const steps = buildStepsForObjective(obj, "governance", 5);
    expect(steps[0].stepNumber).toBe(5);
    expect(steps[1].stepNumber).toBe(6);
    expect(steps[2].stepNumber).toBe(7);
  });

  it("copies priorityScore and objectiveScore from objective", () => {
    const obj = makeObj();
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.priorityScore).toBe(65);
      expect(s.objectiveScore).toBe(42);
    }
  });

  it("derives riskLevel from objective scores", () => {
    const obj = makeObj();
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.riskLevel).toBe("medium");
    }
  });

  it("sets objectiveId to the originating objective's id", () => {
    const obj = makeObj({ id: "obj-abc" });
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.objectiveId).toBe("obj-abc");
    }
  });

  it("generates unique step IDs", () => {
    const obj = makeObj();
    const steps = buildStepsForObjective(obj, "governance", 1);
    const ids = steps.map(s => s.id);
    // IDs are deterministic: step-{obj.id}-{subsystem}-{action}
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("step-obj-1-governance-diagnose_root_cause");
  });

  it("sets intra-objective dependsOn for sequential steps", () => {
    const obj = makeObj();
    const steps = buildStepsForObjective(obj, "governance", 1);
    // Step 1 has no dependsOn, Step 2 depends on Step 1's id, Step 3 depends on Step 2's id
    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toEqual([steps[0].id]);
    expect(steps[2].dependsOn).toEqual([steps[1].id]);
  });
});

// ---------------------------------------------------------------------------
// Task 2: Dependency resolution and buildExecutionPlan
// ---------------------------------------------------------------------------

import { buildExecutionPlan, resolveLocalDependencies, SUBSYSTEM_DEPENDENCY_RULES } from "../../src/executive/planning-engine.js";
import type { ExecutiveSubsystemName } from "../../src/executive/executive-health.js";
import type { ExecutiveObjectiveReport } from "../../src/executive/objective-engine.js";

describe("SUBSYSTEM_DEPENDENCY_RULES", () => {
  it("defines apply_remediation as blocking implement_improvements and review_baseline_metrics", () => {
    expect(SUBSYSTEM_DEPENDENCY_RULES.apply_remediation).toContain("implement_improvements");
    expect(SUBSYSTEM_DEPENDENCY_RULES.apply_remediation).toContain("review_baseline_metrics");
  });
});

describe("resolveLocalDependencies", () => {
  it("adds dependency when a blocking step precedes a blocked step on the same subsystem", () => {
    const blocker = {
      id: "s1", action: "apply_remediation" as const, title: "Apply remediation",
      stepNumber: 3, targetSubsystem: "governance" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "governance" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o2", priorityScore: 30, objectiveScore: 20,
      riskLevel: "low" as const,
    };
    const result = resolveLocalDependencies([blocker, blocked]);
    expect(result[1].dependsOn).toContain("s1");
  });

  it("does NOT add dependency for cross-subsystem steps", () => {
    const blocker = {
      id: "s1", action: "apply_remediation" as const, title: "Apply remediation",
      stepNumber: 3, targetSubsystem: "governance" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "memory" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o2", priorityScore: 30, objectiveScore: 20,
      riskLevel: "low" as const,
    };
    const result = resolveLocalDependencies([blocker, blocked]);
    expect(result[1].dependsOn).toEqual([]);
  });

  it("does NOT mutate input steps", () => {
    const blocker = {
      id: "s1", action: "apply_remediation" as const, title: "Apply remediation",
      stepNumber: 3, targetSubsystem: "governance" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "governance" as ExecutiveSubsystemName, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o2", priorityScore: 30, objectiveScore: 20,
      riskLevel: "low" as const,
    };
    const originalDependsOn = [...blocked.dependsOn];
    resolveLocalDependencies([blocker, blocked]);
    expect(blocked.dependsOn).toEqual(originalDependsOn);
  });
});

describe("buildExecutionPlan", () => {
  function makeObjectiveReport(overrides: Partial<ExecutiveObjectiveReport> = {}): ExecutiveObjectiveReport {
    return {
      schemaVersion: "p10.2.0",
      generatedAt: "2026-06-24T12:00:00.000Z",
      windowDays: 90,
      objectives: [
        {
          id: "obj-gov", objectiveType: "stabilize", status: "proposed",
          priorityScore: 65, objectiveScore: 42,
          title: "Stabilize Governance", description: "", rationale: "",
          evidenceRefs: [], suggestedActions: [],
          targetSubsystems: ["governance"],
          supportingInvestigations: [], derivedFrom: { priorityReportGeneratedAt: "", investigationIds: [] },
          blockers: [], generatedAt: "",
        },
        {
          id: "obj-sec", objectiveType: "maintain", status: "proposed",
          priorityScore: 20, objectiveScore: 15,
          title: "Maintain Security", description: "", rationale: "",
          evidenceRefs: [], suggestedActions: [],
          targetSubsystems: ["security"],
          supportingInvestigations: [], derivedFrom: { priorityReportGeneratedAt: "", investigationIds: [] },
          blockers: [], generatedAt: "",
        },
      ],
      ...overrides,
    };
  }

  it("returns plan with planStatus: draft for non-empty objectives", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.planStatus).toBe("draft");
  });

  it("returns plan with planStatus: blocked and rationale for empty objectives", () => {
    const report = makeObjectiveReport({ objectives: [] });
    const plan = buildExecutionPlan(report);
    expect(plan.planStatus).toBe("blocked");
    expect(plan.rationale).toBeDefined();
    expect(plan.steps).toHaveLength(0);
  });

  it("produces 3 steps per (objective, subsystem)", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    // 2 objectives, each with 1 subsystem → 6 steps
    expect(plan.steps).toHaveLength(6);
  });

  it("numbers steps starting from 1", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.steps[0].stepNumber).toBe(1);
    expect(plan.steps[plan.steps.length - 1].stepNumber).toBe(plan.steps.length);
  });

  it("generates stable step IDs", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    const ids = plan.steps.map(s => s.id);
    expect(ids.every(id => id.startsWith("step-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("copies objective IDs to plan.objectives", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.objectives).toContain("obj-gov");
    expect(plan.objectives).toContain("obj-sec");
  });

  it("inherits generatedAt from objective report", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.generatedAt).toBe("2026-06-24T12:00:00.000Z");
  });

  it("inherits windowDays from objective report", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.windowDays).toBe(90);
  });

  it("sets plannerVersion and planningAlgorithm from constants", () => {
    const plan = buildExecutionPlan(makeObjectiveReport());
    expect(plan.plannerVersion).toBe("1.0");
    expect(plan.planningAlgorithm).toBe("template-v1");
  });

  it("forwards sourceReportId when provided", () => {
    const plan = buildExecutionPlan(makeObjectiveReport(), "report-abc");
    expect(plan.sourceReportId).toBe("report-abc");
  });

  it("produces deterministic plan IDs for identical inputs", () => {
    const report = makeObjectiveReport();
    const plan1 = buildExecutionPlan(report);
    const plan2 = buildExecutionPlan(report);
    expect(plan1.id).toBe(plan2.id);
  });

  it("generates multi-subsystem steps when objective targets multiple subsystems", () => {
    const report = makeObjectiveReport({
      objectives: [
        {
          id: "obj-multi", objectiveType: "stabilize", status: "proposed",
          priorityScore: 65, objectiveScore: 42,
          title: "Multi", description: "", rationale: "",
          evidenceRefs: [], suggestedActions: [],
          targetSubsystems: ["governance", "memory"],
          supportingInvestigations: [], derivedFrom: { priorityReportGeneratedAt: "", investigationIds: [] },
          blockers: [], generatedAt: "",
        },
      ],
    });
    const plan = buildExecutionPlan(report);
    // 1 objective × 2 subsystems × 3 steps = 6 steps
    expect(plan.steps).toHaveLength(6);
    const subsystems = [...new Set(plan.steps.map(s => s.targetSubsystem))];
    expect(subsystems).toContain("governance");
    expect(subsystems).toContain("memory");
  });
});
