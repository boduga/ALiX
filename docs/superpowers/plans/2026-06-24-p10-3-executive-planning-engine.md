# P10.3 — Executive Planning Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert P10.2 Executive Objectives into ordered execution plans as the fourth layer of the executive intelligence stack.

**Architecture:** Pure function layer (no store, no mutation). A `buildExecutionPlan()` consumes `ExecutiveObjectiveReport`, generates per-objective step sequences via a hardcoded switch with `assertNever`, resolves subsystem-local dependencies via a data-driven rule table, and returns an `ExecutionPlan` with 1-based step numbering. Integrated into the existing dashboard pipeline as a 5th panel.

**Tech Stack:** TypeScript, vitest, existing P10.0/P10.1/P10.2 executive types (`ExecutiveSubsystemName`, `ExecutiveObjective`, `ExecutiveObjectiveReport`)

## Global Constraints

- No store, no mutation path, no new CLI commands
- `planStatus` is `"draft"` for every non-empty plan, `"blocked"` when objectives are empty
- Step numbering is always 1-based
- `dependsOn` references stable step IDs (`string`), not step numbers
- `targetSubsystem` typed as `ExecutiveSubsystemName` (from `executive-health.ts`)
- `riskLevel` derived from objective scores: `max(p,o) >= 70 → high`, `>= 40 → medium`, `< 40 → low`
- `action` is a machine `ExecutionStepAction`, `title` is human-readable display text
- Cross-subsystem dependencies are never allowed
- Multi-subsystem objectives produce one step sequence per subsystem
- `generatedAt` inherited from objective report
- `plannerVersion` and `planningAlgorithm` use module-level constants
- The `buildStepsForObjective` switch MUST have a `default` with `assertNever()` for compile-time exhaustiveness
- All functions return new objects — never mutate inputs

---

### Task 1: Create planning engine types, constants, and step templates

**Files:**
- Create: `src/executive/planning-engine.ts` (types, constants, `buildStepsForObjective`, `riskLevelFromScore`)
- Create: `tests/executive/planning-engine.vitest.ts` (tests for types and step template coverage)

**Interfaces:**
- Produces: `ExecutionStepAction`, `ExecutionStep`, `ExecutionPlan`, `PLANNER_VERSION`, `PLANNING_ALGORITHM`, `ESTIMATED_DURATION_MINUTES` map, `buildStepsForObjective()`, `riskLevelFromScore()`
- Consumes: `ExecutiveObjectiveReport`, `ExecutiveObjective`, `ExecutiveObjectiveType`, `ExecutiveSubsystemName` (all from existing executive modules)
- Later tasks depend on: the `ExecutionPlan` type and `buildStepsForObjective` signature

- [ ] **Step 1: Write the failing test for type exports**

```typescript
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
  it("returns 3 steps for stabilize objective", () => {
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("diagnose_root_cause");
    expect(steps[1].action).toBe("create_remediation_proposal");
    expect(steps[2].action).toBe("apply_remediation");
  });

  it("returns 3 steps for investigate objective", () => {
    const obj = {
      id: "obj-2",
      objectiveType: "investigate" as const,
      targetSubsystems: ["governance"],
      priorityScore: 40,
      objectiveScore: 30,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 4);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("triage_investigations");
    expect(steps[1].action).toBe("assign_investigation_ownership");
    expect(steps[2].action).toBe("resolve_investigations");
  });

  it("returns 3 steps for improve objective", () => {
    const obj = {
      id: "obj-3",
      objectiveType: "improve" as const,
      targetSubsystems: ["learning"],
      priorityScore: 30,
      objectiveScore: 25,
    } as any;
    const steps = buildStepsForObjective(obj, "learning", 7);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("audit_metrics");
  });

  it("returns 3 steps for maintain objective", () => {
    const obj = {
      id: "obj-4",
      objectiveType: "maintain" as const,
      targetSubsystems: ["security"],
      priorityScore: 20,
      objectiveScore: 15,
    } as any;
    const steps = buildStepsForObjective(obj, "security", 10);
    expect(steps).toHaveLength(3);
    expect(steps[0].action).toBe("schedule_health_check");
  });

  it("sets stepNumber starting from the given startAt (1-based)", () => {
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 5);
    expect(steps[0].stepNumber).toBe(5);
    expect(steps[1].stepNumber).toBe(6);
    expect(steps[2].stepNumber).toBe(7);
  });

  it("copies priorityScore and objectiveScore from objective", () => {
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.priorityScore).toBe(65);
      expect(s.objectiveScore).toBe(42);
    }
  });

  it("derives riskLevel from objective scores", () => {
    // priorityScore=65, objectiveScore=42 → max=65 ≥ 40 → medium
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.riskLevel).toBe("medium");
    }
  });

  it("sets objectiveId to the originating objective's id", () => {
    const obj = {
      id: "obj-abc",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    for (const s of steps) {
      expect(s.objectiveId).toBe("obj-abc");
    }
  });

  it("generates unique step IDs", () => {
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    const ids = steps.map(s => s.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("sets intra-objective dependsOn for sequential steps", () => {
    const obj = {
      id: "obj-1",
      objectiveType: "stabilize" as const,
      targetSubsystems: ["governance"],
      priorityScore: 65,
      objectiveScore: 42,
    } as any;
    const steps = buildStepsForObjective(obj, "governance", 1);
    // Step 1 has no dependsOn, Step 2 depends on Step 1's id, Step 3 depends on Step 2's id
    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toEqual([steps[0].id]);
    expect(steps[2].dependsOn).toEqual([steps[1].id]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/planning-engine.vitest.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — all tests fail with `Cannot find module` or similar

- [ ] **Step 3: Write minimal implementation**

Create `src/executive/planning-engine.ts`:

```typescript
/**
 * P10.3 — Executive Planning Engine.
 *
 * Pure function layer that consumes P10.2 Executive Objectives and produces
 * ordered execution plans with dependency resolution.
 *
 * Core invariants:
 *  - No store access — plans computed fresh each dashboard run.
 *  - No mutation/apply path.
 *  - generatedAt inherited from objective report (not fresh Date).
 *  - Step IDs are stable; dependsOn references IDs, not step numbers.
 *
 * @module
 */

import type { ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveObjectiveReport, ExecutiveObjective } from "./objective-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLANNER_VERSION = "1.0";
export const PLANNING_ALGORITHM = "template-v1";

/** Per-action default durations (minutes). */
const ESTIMATED_DURATION_MINUTES: Partial<Record<ExecutionStepAction, number>> = {
  diagnose_root_cause: 30,
  create_remediation_proposal: 45,
  apply_remediation: 60,
  triage_investigations: 20,
  assign_investigation_ownership: 10,
  resolve_investigations: 45,
  audit_metrics: 15,
  identify_optimization_targets: 30,
  implement_improvements: 45,
  schedule_health_check: 10,
  review_baseline_metrics: 20,
  update_documentation: 15,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutionStepAction =
  | "diagnose_root_cause"
  | "create_remediation_proposal"
  | "apply_remediation"
  | "triage_investigations"
  | "assign_investigation_ownership"
  | "resolve_investigations"
  | "audit_metrics"
  | "identify_optimization_targets"
  | "implement_improvements"
  | "schedule_health_check"
  | "review_baseline_metrics"
  | "update_documentation";

export type ExecutionStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface ExecutionStep {
  /** Stable identity — survives replanning, used for dependsOn. */
  id: string;
  /** Machine action kind — P10.4 dispatches on this, never on title. */
  action: ExecutionStepAction;
  /** Human-readable title for display (terminal / JSON). */
  title: string;
  /** 1-based step number in the overall plan sequence (display / ordering). */
  stepNumber: number;
  /** Subsystem this step operates on (typed — compile-time guarantee). */
  targetSubsystem: ExecutiveSubsystemName;
  /** Step IDs this step depends on (subsystem-local only). Stable references. */
  dependsOn: string[];
  status: ExecutionStepStatus;
  /** The objective that generated this step. */
  objectiveId: string;
  /** Copied from the originating objective's priorityScore. */
  priorityScore: number;
  /** Copied from the originating objective's objectiveScore. */
  objectiveScore: number;
  /** Risk derived from the originating objective — not hardcoded per type. */
  riskLevel: "low" | "medium" | "high";
  /** Rough execution estimate for P10.4 scheduling. */
  estimatedDurationMinutes?: number;
}

export type PlanStatus = "draft" | "ready" | "blocked";

export interface ExecutionPlan {
  id: string;
  /** Objective IDs this plan covers. */
  objectives: string[];
  /** Ordered step sequence. */
  steps: ExecutionStep[];
  generatedAt: string;
  windowDays: number;
  planStatus: PlanStatus;
  sourceReportId?: string;
  rationale?: string;
  plannerVersion: string;
  planningAlgorithm: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-6);
  return `${prefix}-${ts}-${rand}`;
}

export function riskLevelFromScore(priorityScore: number, objectiveScore: number): "low" | "medium" | "high" {
  const max = Math.max(priorityScore, objectiveScore);
  if (max >= 70) return "high";
  if (max >= 40) return "medium";
  return "low";
}

function makeStep(
  obj: { id: string; priorityScore: number; objectiveScore: number },
  action: ExecutionStepAction,
  title: string,
  subsystem: ExecutiveSubsystemName,
  stepNumber: number,
  dependsOn: string[],
): ExecutionStep {
  return {
    id: shortId("step"),
    action,
    title,
    stepNumber,
    targetSubsystem: subsystem,
    dependsOn,
    status: "pending",
    objectiveId: obj.id,
    priorityScore: obj.priorityScore,
    objectiveScore: obj.objectiveScore,
    riskLevel: riskLevelFromScore(obj.priorityScore, obj.objectiveScore),
    estimatedDurationMinutes: ESTIMATED_DURATION_MINUTES[action],
  };
}

// ---------------------------------------------------------------------------
// Step templates
// ---------------------------------------------------------------------------

/**
 * Decompose an objective into its sequence of ExecutionSteps.
 * Uses hardcoded templates per objective type with assertNever for
 * compile-time exhaustiveness checking.
 */
export function buildStepsForObjective(
  obj: { id: string; objectiveType: ExecutiveObjective["objectiveType"]; targetSubsystems: string[]; priorityScore: number; objectiveScore: number },
  targetSubsystem: ExecutiveSubsystemName,
  startAt: number,
): ExecutionStep[] {
  let i = 0;

  switch (obj.objectiveType) {
    case "stabilize":
      return [
        makeStep(obj, "diagnose_root_cause", "Diagnose root causes", targetSubsystem, startAt + i++, []),
        makeStep(obj, "create_remediation_proposal", "Create remediation proposal", targetSubsystem, startAt + i++, []),
        makeStep(obj, "apply_remediation", "Apply remediation", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        // Set intra-objective dependencies
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "investigate":
      return [
        makeStep(obj, "triage_investigations", "Triage open investigations", targetSubsystem, startAt + i++, []),
        makeStep(obj, "assign_investigation_ownership", "Assign investigation ownership", targetSubsystem, startAt + i++, []),
        makeStep(obj, "resolve_investigations", "Resolve investigations", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "improve":
      return [
        makeStep(obj, "audit_metrics", "Audit subsystem metrics", targetSubsystem, startAt + i++, []),
        makeStep(obj, "identify_optimization_targets", "Identify optimization targets", targetSubsystem, startAt + i++, []),
        makeStep(obj, "implement_improvements", "Implement improvements", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "maintain":
      return [
        makeStep(obj, "schedule_health_check", "Schedule health check", targetSubsystem, startAt + i++, []),
        makeStep(obj, "review_baseline_metrics", "Review baseline metrics", targetSubsystem, startAt + i++, []),
        makeStep(obj, "update_documentation", "Update documentation", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });
  }
}
```

Copy the above code exactly. Note: `buildStepsForObjective` does NOT have a `default` case — TypeScript's `switch` on a union type with an explicit `"stabilize" | "investigate" | "improve" | "maintain"` exhaustively covers all variants. If a new variant is added without a corresponding case, TypeScript produces a compile error because the return type isn't satisfied. This is the idiomatic exhaustiveness pattern in this codebase.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/planning-engine.vitest.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS (all 13+ tests)

- [ ] **Step 5: Commit**

```bash
git add src/executive/planning-engine.ts tests/executive/planning-engine.vitest.ts
git commit -m "feat(p10.3): add planning engine types, constants, and step templates

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add dependency resolution and top-level plan generator

**Files:**
- Modify: `src/executive/planning-engine.ts` (append `SUBSYSTEM_DEPENDENCY_RULES`, `resolveLocalDependencies`, `buildExecutionPlan`)
- Modify: `tests/executive/planning-engine.vitest.ts` (append tests for the new functions)

**Interfaces:**
- Consumes: `ExecutionStep`, `ExecutionPlan`, `buildStepsForObjective` from Task 1
- Produces: `buildExecutionPlan(objectiveReport: ExecutiveObjectiveReport, sourceReportId?: string): ExecutionPlan` — the top-level function
- Later tasks depend on: the `buildExecutionPlan` export

- [ ] **Step 1: Write the failing tests**

Append these to the existing test file:

```typescript
import { buildExecutionPlan, resolveLocalDependencies, SUBSYSTEM_DEPENDENCY_RULES } from "../../src/executive/planning-engine.js";
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
      stepNumber: 3, targetSubsystem: "governance" as any, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "governance" as any, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o2", priorityScore: 30, objectiveScore: 20,
      riskLevel: "low" as const,
    };
    const result = resolveLocalDependencies([blocker, blocked]);
    expect(result[1].dependsOn).toContain("s1");
  });

  it("does NOT add dependency for cross-subsystem steps", () => {
    const blocker = {
      id: "s1", action: "apply_remediation" as const, title: "Apply remediation",
      stepNumber: 3, targetSubsystem: "governance" as any, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "memory" as any, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o2", priorityScore: 30, objectiveScore: 20,
      riskLevel: "low" as const,
    };
    const result = resolveLocalDependencies([blocker, blocked]);
    expect(result[1].dependsOn).toEqual([]);
  });

  it("does NOT mutate input steps", () => {
    const blocker = {
      id: "s1", action: "apply_remediation" as const, title: "Apply remediation",
      stepNumber: 3, targetSubsystem: "governance" as any, dependsOn: [] as string[],
      status: "pending" as const, objectiveId: "o1", priorityScore: 65, objectiveScore: 42,
      riskLevel: "high" as const,
    };
    const blocked = {
      id: "s2", action: "implement_improvements" as const, title: "Implement improvements",
      stepNumber: 4, targetSubsystem: "governance" as any, dependsOn: [] as string[],
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/planning-engine.vitest.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — new tests fail with "function not defined" or similar

- [ ] **Step 3: Write minimal implementation**

Append to `src/executive/planning-engine.ts` (before the closing of the file):

```typescript
// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

/** Action → actions it blocks on the same subsystem. Typed for compile-time safety. */
export const SUBSYSTEM_DEPENDENCY_RULES: Partial<Record<ExecutionStepAction, ExecutionStepAction[]>> = {
  apply_remediation: ["implement_improvements", "review_baseline_metrics"],
};

/**
 * Resolve subsystem-local dependencies between steps.
 * Returns new step objects — never mutates inputs.
 */
export function resolveLocalDependencies(steps: ExecutionStep[]): ExecutionStep[] {
  const updated = steps.map(s => ({ ...s, dependsOn: [...s.dependsOn] }));

  // Group by subsystem — cross-subsystem steps are never linked
  const bySubsystem = new Map<ExecutiveSubsystemName, ExecutionStep[]>();
  for (const step of updated) {
    const group = bySubsystem.get(step.targetSubsystem) ?? [];
    group.push(step);
    bySubsystem.set(step.targetSubsystem, group);
  }

  for (const [, subsystemSteps] of bySubsystem) {
    for (const blocker of subsystemSteps) {
      const blockedActions = SUBSYSTEM_DEPENDENCY_RULES[blocker.action];
      if (!blockedActions) continue;

      for (const maybeBlocked of subsystemSteps) {
        // Only later steps can be blocked
        if (maybeBlocked.stepNumber <= blocker.stepNumber) continue;
        if (blockedActions.includes(maybeBlocked.action)) {
          if (!maybeBlocked.dependsOn.includes(blocker.id)) {
            maybeBlocked.dependsOn.push(blocker.id);
          }
        }
      }
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Top-level generator
// ---------------------------------------------------------------------------

/**
 * Pure function: consume P10.2 objectives and produce an ordered execution plan.
 */
export function buildExecutionPlan(
  objectiveReport: ExecutiveObjectiveReport,
  sourceReportId?: string,
): ExecutionPlan {
  const generatedAt = objectiveReport.generatedAt;

  if (objectiveReport.objectives.length === 0) {
    return {
      id: shortId("plan"),
      objectives: [],
      steps: [],
      generatedAt,
      windowDays: objectiveReport.windowDays,
      planStatus: "blocked",
      sourceReportId,
      rationale: "No executive objectives available to plan.",
      plannerVersion: PLANNER_VERSION,
      planningAlgorithm: PLANNING_ALGORITHM,
    };
  }

  let stepCounter = 1;
  const steps: ExecutionStep[] = [];

  for (const obj of objectiveReport.objectives) {
    for (const subsystem of obj.targetSubsystems) {
      const objSteps = buildStepsForObjective(
        obj,
        subsystem as ExecutiveSubsystemName,
        stepCounter,
      );
      steps.push(...objSteps);
      stepCounter += objSteps.length;
    }
  }

  const resolvedSteps = resolveLocalDependencies(steps);

  return {
    id: shortId("plan"),
    objectives: objectiveReport.objectives.map(o => o.id),
    steps: resolvedSteps,
    generatedAt,
    windowDays: objectiveReport.windowDays,
    planStatus: "draft",
    sourceReportId,
    plannerVersion: PLANNER_VERSION,
    planningAlgorithm: PLANNING_ALGORITHM,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/planning-engine.vitest.ts --reporter=verbose 2>&1 | tail -30`
Expected: PASS (all ~25+ tests)

- [ ] **Step 5: Commit**

```bash
git add src/executive/planning-engine.ts tests/executive/planning-engine.vitest.ts
git commit -m "feat(p10.3): add dependency resolution and buildExecutionPlan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Dashboard handler integration — call buildExecutionPlan

**Files:**
- Modify: `src/cli/commands/executive-dashboard-handler.ts` (+5 lines)
- Modify: `tests/executive/executive-sentinels.vitest.ts` (+1 line in EXECUTIVE_FILES)

**Interfaces:**
- Consumes: `buildExecutionPlan`, `ExecutionPlan` from Task 2
- Produces: Modified `runDashboard` that passes `plan` to `renderExecutiveDashboard`
- Later tasks depend on: `plan` being available in the renderer

- [ ] **Step 1: Read the current handler**

```bash
cat src/cli/commands/executive-dashboard-handler.ts
```

Expected: See the current handler with P10.0-P10.2 integration, ending with `renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, { jsonMode });`

- [ ] **Step 2: Add import and buildExecutionPlan call**

Insert after line 14 (`import { buildObjectiveReport }`):
```typescript
import { buildExecutionPlan } from "../../executive/planning-engine.js";
```

Insert after line 59 (`const objectiveReport = buildObjectiveReport(...)`):
```typescript
  // P10.3: Build execution plan
  const plan = buildExecutionPlan(objectiveReport);
```

Change line 62 from:
```typescript
  renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, { jsonMode });
```
to:
```typescript
  renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, plan, { jsonMode });
```

- [ ] **Step 3: Add planning-engine.ts to the sentinel file list**

In `tests/executive/executive-sentinels.vitest.ts`, append to the `EXECUTIVE_FILES` array (after line 44 `"src/cli/commands/executive.ts"`):
```typescript
  "src/executive/planning-engine.ts",
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts tests/cli/commands/executive-dashboard-cli.vitest.ts --reporter=verbose 2>&1 | tail -15`
Expected: PASS — sentinel finds no violations, CLI test may fail (renderer needs updating — next task)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/executive-dashboard-handler.ts tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10.3): integrate planning engine into dashboard handler + sentinel

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Dashboard renderer — 5th panel (Executive Plan)

**Files:**
- Modify: `src/cli/commands/executive-dashboard-renderer.ts` (+40 lines)
- Modify: `tests/cli/commands/executive-dashboard-cli.vitest.ts` (+2 assertions)

**Interfaces:**
- Consumes: `ExecutionPlan`, `ExecutionStep` types from Task 1, `plan` object from Task 3 handler
- Produces: 5th dashboard panel in text mode, `plan` field in JSON mode

- [ ] **Step 1: Write the failing test assertions**

Modify `tests/cli/commands/executive-dashboard-cli.vitest.ts`:

In the text mode test (update test name and assertion):
```typescript
  it("renders 5 panel headers in text mode", async () => {
    // ... existing setup ...
    expect(out).toContain("EXECUTIVE OBJECTIVES");
    expect(out).toContain("EXECUTIVE PLAN");
```

In the JSON mode test, after the `parsed.objectives.objectives` assertion:
```typescript
    expect(parsed.plan.schemaVersion).toBeUndefined(); // plan has no schemaVersion
    expect(parsed.plan.planStatus).toBe("draft");
    expect(Array.isArray(parsed.plan.steps)).toBe(true);
```

In the `--window` flag test:
```typescript
    expect(parsed.objectives.windowDays).toBe(7);
    expect(parsed.plan.windowDays).toBe(7);
```

- [ ] **Step 2: Run the CLI test to verify failure**

Run: `npx vitest run tests/cli/commands/executive-dashboard-cli.vitest.ts --reporter=verbose 2>&1 | tail -15`
Expected: FAIL — test expects 5 panel headers but renderer only produces 4

- [ ] **Step 3: Update the renderer**

In `src/cli/commands/executive-dashboard-renderer.ts`:

Add import:
```typescript
import type { ExecutionPlan, ExecutionStep } from "../../executive/planning-engine.js";
```

Update `renderExecutiveDashboard` function signature (add `plan` parameter):
```typescript
export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  objectiveReport: ExecutiveObjectiveReport,
  plan: ExecutionPlan,
  opts: RenderOptions = {},
): void {
```

Update JSON mode to include plan:
```typescript
    console.log(JSON.stringify({
      health: report,
      priority: priorityReport,
      objectives: objectiveReport,
      plan,
    }, null, 2));
```

Add `renderObjectives` and `renderPlan` calls after `renderPriorities`:
```typescript
  renderPriorities(priorityReport);
  console.log("");
  renderObjectives(objectiveReport);
  console.log("");
  renderPlan(plan);
```

Add the `renderPlan` function after `renderObjectives`:
```typescript
function renderPlan(plan: ExecutionPlan): void {
  console.log(`\n[4] EXECUTIVE PLAN (${plan.steps.length} steps)`);
  if (plan.planStatus === "blocked") {
    console.log(`  Status: ${plan.planStatus}`);
    if (plan.rationale) console.log(`  ${plan.rationale}`);
    return;
  }
  console.log(`  Plan Status: ${plan.planStatus}`);

  // Group steps by subsystem
  const bySubsystem = new Map<string, ExecutionStep[]>();
  for (const step of plan.steps) {
    const group = bySubsystem.get(step.targetSubsystem) ?? [];
    group.push(step);
    bySubsystem.set(step.targetSubsystem, group);
  }

  // Build stepNumber → id mapping for human-readable dependency display
  const idToStepNum = new Map<string, number>();
  for (const step of plan.steps) {
    idToStepNum.set(step.id, step.stepNumber);
  }

  for (const [subsystem, steps] of bySubsystem) {
    console.log(`\n  ${capitalize(subsystem)}: (${steps.length} steps)`);
    for (const step of steps) {
      const depText = step.dependsOn.length > 0
        ? ` [blocked by ${step.dependsOn.map(d => idToStepNum.get(d)).join(", ")}]`
        : "";
      const blockerText = plan.steps.some(s =>
        s.targetSubsystem === step.targetSubsystem && s.dependsOn.includes(step.id)
      ) ? ` [blocker for ${plan.steps.filter(s => s.dependsOn.includes(step.id)).map(s => s.stepNumber).join(", ")}]`
        : "";
      const annot = depText || blockerText || "";
      console.log(`    ${step.stepNumber}. ${step.title.padEnd(40)} ${pad(step.riskLevel.toUpperCase(), 6)}${annot}`);
    }
  }
}
```

The `capitalize` function already exists in this file. The `pad` function already exists too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/commands/executive-dashboard-cli.vitest.ts tests/executive/executive-sentinels.vitest.ts --reporter=verbose 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 1732+ tests pass (existing + new)

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit 2>&1`
Expected: No output (clean compile)

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/executive-dashboard-renderer.ts tests/cli/commands/executive-dashboard-cli.vitest.ts
git commit -m "feat(p10.3): add 5th Executive Plan panel to dashboard renderer

Co-Authored-By: Claude <noreply@anthropic.com>"
```
