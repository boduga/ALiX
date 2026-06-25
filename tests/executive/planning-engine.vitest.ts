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
