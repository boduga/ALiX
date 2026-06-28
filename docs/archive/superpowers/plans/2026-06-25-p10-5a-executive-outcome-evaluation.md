# P10.5a — Executive Outcome Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision (post-review fixes applied):** ✅
> 1. All `it()` blocks have real assertions — no placeholder/comment-only tests
> 2. `plan_not_found` only in CLI wrapper, not in pure evaluator's `EvaluationStatus`
> 3. `diagnose_root_cause` belongs to stabilize (not investigate) — checked first
> 4. Fixtures verified against current `PersistedExecutionPlan` (planStatus exists via `ExecutionPlan`, runtime status via `PlanExecutionState.status`)
> 5. ESM imports only — no `require()` calls
> 6. Temp dirs use `mkdtempSync(join(tmpdir(), "..."))`
> 7. No stray duplicated commit blocks

**Goal:** On-demand `alix executive evaluate <planId>` CLI command that compares subsystem health before/after plan execution and classifies outcomes.

**Architecture:** Pure read-only evaluator. TrendStore gains `findBaseline(before)` (O(n) JSONL scan). A new `outcome-evaluator.ts` module exports `evaluatePlanOutcome()` pure function + types. CLI handler wires PlanStore, StateStore, TrendStore together.

**Tech Stack:** TypeScript, Vitest, existing P10.0-4 infrastructure.

## Global Constraints

- No writes to any store (pure read-only evaluation)
- No new plan types or schema changes (no PersistedExecutionPlan modification)
- No new evidence types
- No ExecutionEngine hooks
- `findBaseline(before)` returns null when no snapshot ≤ `before` (fail-closed)
- `evaluatePlanOutcome` returns `evaluationStatus: "insufficient_data"` when baseline or current is null
- `plan_not_found` lives in the CLI handler only — the pure evaluator receives a plan object and cannot return this status
- Outcome classification: improved (≥+5, none ≤-5), degraded (≤-5, none ≥+5), mixed (both ≥+5 and ≤-5), unchanged (all |delta|<5)
- CLI output: terminal table by default, full JSON report with `--json`
- New files must be added to sentinel EXECUTIVE_FILES allowlist

**Note on dual PlanStatus types:**
- `PersistedExecutionPlan` has `planStatus: "draft" | "ready" | "blocked"` (static plan state, inherited from `ExecutionPlan`)
- `PlanExecutionState` has `status: PlanStatus` with values including `"completed"`, `"running"`, `"failed"`, etc. (runtime lifecycle state)
- The evaluator checks `state.status` (runtime) for the "not executed" guard — this is the correct one

---

### Task 1: TrendStore.findBaseline() method + tests

**Files:**
- Modify: `src/executive/trend-store.ts` — add `findBaseline(before)` method
- Test: `tests/executive/trend-store.vitest.ts` — add findBaseline tests

**Interfaces:**
- Consumes: existing `ExecutiveTrendSnapshot`, existing JSONL file format
- Produces: `ExecutiveTrendStore.findBaseline(before: string): Promise<ExecutiveTrendSnapshot | null>`

- [ ] **Step 1: Write the failing tests first**

Add to `tests/executive/trend-store.vitest.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSnapshot(generatedAt: string, scores: Record<string, number>) {
  return {
    id: `snap-${generatedAt}`,
    generatedAt,
    windowDays: 7,
    subsystemScores: scores,
  };
}

describe("ExecutiveTrendStore.findBaseline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trend-test-"));
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("returns the snapshot whose generatedAt exactly matches before", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const snapshot = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 50 });
    const filePath = join(tmpDir, "trends.jsonl");
    writeFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.generatedAt).toBe("2026-06-15T00:00:00.000Z");
  });

  it("returns the most recent snapshot before the given time", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const filePath = join(tmpDir, "trends.jsonl");
    const older = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 30 });
    const newer = makeSnapshot("2026-06-10T00:00:00.000Z", { workflow: 40 });
    writeFileSync(filePath, [older, newer].map(s => JSON.stringify(s)).join("\n") + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.generatedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(result!.subsystemScores.workflow).toBe(40);
  });

  it("returns null when no snapshot is before the given time", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const snapshot = makeSnapshot("2026-06-20T00:00:00.000Z", { workflow: 50 });
    const filePath = join(tmpDir, "trends.jsonl");
    writeFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf-8");
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).toBeNull();
  });

  it("returns null when trends.jsonl does not exist", async () => {
    const store = new ExecutiveTrendStore(tmpDir);
    const result = await store.findBaseline("2026-06-15T00:00:00.000Z");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/trend-store.vitest.ts --reporter=verbose`
Expected: FAIL — `findBaseline` method not yet defined.

- [ ] **Step 3: Implement findBaseline**

Add to `src/executive/trend-store.ts` after `loadLatest()`:

```typescript
  /**
   * Find the most recent snapshot with generatedAt <= before.
   * Iterates the JSONL, O(n) in snapshot count.
   * Returns null if no snapshot satisfies the constraint (fail-closed).
   */
  async findBaseline(before: string): Promise<ExecutiveTrendSnapshot | null> {
    const path = join(this.dir, TRENDS_FILE);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;

    const lines = content.split("\n").filter(l => l.trim());
    let best: ExecutiveTrendSnapshot | null = null;

    for (const line of lines) {
      try {
        const snap = JSON.parse(line) as ExecutiveTrendSnapshot;
        if (snap.generatedAt <= before) {
          if (!best || snap.generatedAt > best.generatedAt) {
            best = snap;
          }
        }
      } catch {
        // malformed line — skip silently
      }
    }

    return best;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/trend-store.vitest.ts --reporter=verbose`
Expected: PASS — all 4 findBaseline tests green, plus any pre-existing trend-store tests.

- [ ] **Step 5: Commit**

```bash
git add src/executive/trend-store.ts tests/executive/trend-store.vitest.ts
git commit -m "feat(p10-5a): add TrendStore.findBaseline() method"
```

---

### Task 2: Outcome evaluator types + pure function + unit tests

**Files:**
- Create: `src/executive/outcome-evaluator.ts`
- Test: `tests/executive/outcome-evaluator.vitest.ts`

**Interfaces:**
- Consumes: `PersistedExecutionPlan`, `PlanExecutionState`, `ExecutiveTrendSnapshot` (x2 for baseline + current)
- Produces: `evaluatePlanOutcome(plan, state, baseline, current): ExecutiveOutcomeEvaluationReport` — pure function

**Public types in outcome-evaluator.ts:**

```typescript
export type EvaluationStatus =
  | "completed"
  | "insufficient_data"
  | "plan_not_executed";
// NOTE: plan_not_found lives only in the CLI handler — the pure
// evaluator receives a plan object, so it cannot return this status.

export type OutcomeClassification =
  | "improved"
  | "degraded"
  | "unchanged"
  | "mixed";

export interface SubsystemDelta {
  subsystem: ExecutiveSubsystemName;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

export interface ObjectiveOutcome {
  objectiveId: string;
  objectiveType: ExecutiveObjectiveType;
  targetSubsystems: string[];
  subsystemDeltas: SubsystemDelta[];
  aggregateDelta: number;
  outcome: OutcomeClassification;
}

export interface ExecutiveOutcomeEvaluationReport {
  schemaVersion: "p10.5.0";
  generatedAt: string;
  planId: string;
  planStatus: PlanStatus;
  evaluationStatus: EvaluationStatus;
  baselineSnapshotId?: string;
  baselineGeneratedAt?: string;
  currentSnapshotId?: string;
  currentGeneratedAt?: string;
  evaluatedSubsystems: ExecutiveSubsystemName[];
  objectives: ObjectiveOutcome[];
  overallDelta: number;
  warnings: string[];
}

export function evaluatePlanOutcome(
  plan: PersistedExecutionPlan,
  state: PlanExecutionState,
  baseline: ExecutiveTrendSnapshot | null,
  current: ExecutiveTrendSnapshot | null,
): ExecutiveOutcomeEvaluationReport;
```

- [ ] **Step 1: Write failing tests**

Create `tests/executive/outcome-evaluator.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluatePlanOutcome } from "../../src/executive/outcome-evaluator.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { PlanExecutionState } from "../../src/executive/executive-plan-types.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

// -----------------------------------------------------------------------
// Factory helpers
// -----------------------------------------------------------------------

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "s1",
    stepNumber: 1,
    title: "Test step",
    action: "diagnose_root_cause",
    objectiveId: "obj-1",
    targetSubsystem: "workflow",
    riskLevel: "medium",
    objectiveScore: 0,
    priorityScore: 0,
    status: "pending",
    dependsOn: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<PersistedExecutionPlan> = {}): PersistedExecutionPlan {
  return {
    id: "plan-1",
    steps: [],
    objectives: ["obj-1"],
    generatedAt: "2026-06-10T00:00:00.000Z",
    windowDays: 7,
    planStatus: "ready",  // inherited from ExecutionPlan (draft|ready|blocked)
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "hash",
    ...overrides,
  };
}

function makeCompletedState(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
  return {
    planId: "plan-1",
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: "2026-06-10T00:00:00.000Z", completedAt: "2026-06-15T00:00:00.000Z" },
    ...overrides,
  };
}

function makeSnapshot(generatedAt: string, scores: Record<string, number>): ExecutiveTrendSnapshot {
  return {
    id: `snap-${generatedAt}`,
    generatedAt,
    windowDays: 7,
    subsystemScores: scores as any,
  };
}

// -----------------------------------------------------------------------
// Classification tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — classification", () => {
  it("classifies improved when all objective target subsystems have delta >= +5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("improved");
    expect(obj!.aggregateDelta).toBeGreaterThanOrEqual(5);
    expect(result.overallDelta).toBe(40);
  });

  it("classifies degraded when all delta <= -5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 80 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 30 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("degraded");
  });

  it("classifies unchanged when all |delta| < 5", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 55 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 57 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("unchanged");
  });

  it("classifies mixed when at least one delta >= +5 and at least one delta <= -5", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 70 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80, governance: 30 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.outcome).toBe("mixed");
  });

  it("classifies improved when one subsystem improves and another is unchanged", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 60 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80, governance: 62 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("completed");
    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    // workflow=+40 (>=+5), governance=+2 (|<5|): at least one >=+5, none <=-5 → improved
    expect(obj!.outcome).toBe("improved");
  });
});

// -----------------------------------------------------------------------
// Fail-closed tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — fail-closed guards", () => {
  it("returns plan_not_executed when plan status is 'running'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "running" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluationStatus).toBe("plan_not_executed");
    expect(result.objectives).toHaveLength(0);
  });

  it("returns plan_not_executed when plan status is 'draft'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "draft" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns plan_not_executed when plan status is 'blocked'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "blocked" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns plan_not_executed when plan status is 'cancelled'", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "cancelled" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("plan_not_executed");
  });

  it("returns insufficient_data when baseline is null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70 });

    const result = evaluatePlanOutcome(plan, state, null, current);

    expect(result.evaluationStatus).toBe("insufficient_data");
    expect(result.warnings).toContain("No baseline snapshot found");
  });

  it("returns insufficient_data when current is null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 50 });

    const result = evaluatePlanOutcome(plan, state, baseline, null);

    expect(result.evaluationStatus).toBe("insufficient_data");
    expect(result.warnings).toContain("No current snapshot found");
  });

  it("returns insufficient_data when both snapshots are null", () => {
    const plan = makePlan();
    const state = makeCompletedState({ status: "completed" });

    const result = evaluatePlanOutcome(plan, state, null, null);

    expect(result.evaluationStatus).toBe("insufficient_data");
  });
});

// -----------------------------------------------------------------------
// Output shape tests
// -----------------------------------------------------------------------

describe("evaluatePlanOutcome — output shape", () => {
  it("includes snapshot metadata in the report", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.baselineSnapshotId).toBe(baseline.id);
    expect(result.baselineGeneratedAt).toBe(baseline.generatedAt);
    expect(result.currentSnapshotId).toBe(current.id);
    expect(result.currentGeneratedAt).toBe(current.generatedAt);
  });

  it("computes overallDelta as mean of all subsystem deltas", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "apply_remediation", objectiveId: "obj-2", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2], objectives: ["obj-1", "obj-2"] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 60 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 70, governance: 50 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    // workflow +30, governance -10 → mean = (+30 + -10) / 2 = +10
    expect(result.overallDelta).toBe(10);
  });

  it("populates evaluatedSubsystems from step target subsystems", () => {
    const step1 = makeStep({ id: "s1", action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const step2 = makeStep({ id: "s2", stepNumber: 2, action: "diagnose_root_cause", objectiveId: "obj-1", targetSubsystem: "governance" });
    const plan = makePlan({ steps: [step1, step2] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40, governance: 50 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 60, governance: 55 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    expect(result.evaluatedSubsystems).toContain("workflow");
    expect(result.evaluatedSubsystems).toContain("governance");
    expect(result.evaluatedSubsystems.length).toBe(2);
  });

  it("infers objectiveType from step actions (stabilize for apply_remediation)", () => {
    const step = makeStep({ action: "apply_remediation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 80 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.objectiveType).toBe("stabilize");
  });

  it("infers objectiveType as maintain when no recognizable actions exist", () => {
    const step = makeStep({ action: "update_documentation", objectiveId: "obj-1", targetSubsystem: "workflow" });
    const plan = makePlan({ steps: [step] });
    const state = makeCompletedState();
    const baseline = makeSnapshot("2026-06-01T00:00:00.000Z", { workflow: 40 });
    const current = makeSnapshot("2026-06-15T00:00:00.000Z", { workflow: 42 });

    const result = evaluatePlanOutcome(plan, state, baseline, current);

    const obj = result.objectives.find(o => o.objectiveId === "obj-1");
    expect(obj).toBeDefined();
    expect(obj!.objectiveType).toBe("maintain");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executive/outcome-evaluator.vitest.ts --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Create outcome-evaluator.ts**

Create `src/executive/outcome-evaluator.ts` with:

```typescript
/**
 * P10.5a — Executive Outcome Evaluation.
 *
 * Pure function that compares subsystem health before and after a plan
 * executed and classifies per-objective outcomes.
 *
 * @module
 */

import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { PlanExecutionState, PlanStatus } from "./executive-plan-types.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import type { ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveObjectiveType } from "./objective-engine.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EvaluationStatus =
  | "completed"
  | "insufficient_data"
  | "plan_not_executed";
// NOTE: plan_not_found lives only in the CLI handler — the pure
// evaluator receives a plan object, so it cannot return this status.

export type OutcomeClassification =
  | "improved"
  | "degraded"
  | "unchanged"
  | "mixed";

export interface SubsystemDelta {
  subsystem: ExecutiveSubsystemName;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

export interface ObjectiveOutcome {
  objectiveId: string;
  objectiveType: ExecutiveObjectiveType;
  targetSubsystems: string[];
  subsystemDeltas: SubsystemDelta[];
  aggregateDelta: number;
  outcome: OutcomeClassification;
}

export interface ExecutiveOutcomeEvaluationReport {
  schemaVersion: "p10.5.0";
  generatedAt: string;
  planId: string;
  planStatus: PlanStatus;
  evaluationStatus: EvaluationStatus;
  baselineSnapshotId?: string;
  baselineGeneratedAt?: string;
  currentSnapshotId?: string;
  currentGeneratedAt?: string;
  evaluatedSubsystems: ExecutiveSubsystemName[];
  objectives: ObjectiveOutcome[];
  overallDelta: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPROVE_THRESHOLD = 5;
const DEGRADE_THRESHOLD = -5;

// ---------------------------------------------------------------------------
// Type inference from step actions
// ---------------------------------------------------------------------------
// PersistedExecutionPlan only stores objective IDs (strings), not full
// ExecutiveObjective objects. Infer objective type from step actions:
//   stabilize: diagnose_root_cause → create_remediation_proposal → apply_remediation
//   investigate: triage_investigations, assign_investigation_ownership, resolve_investigations
//   improve: audit_metrics, identify_optimization_targets, implement_improvements
//   maintain: schedule_health_check, review_baseline_metrics, update_documentation

const STABILIZE_ACTIONS = new Set([
  "diagnose_root_cause", "create_remediation_proposal", "apply_remediation",
]);
const INVESTIGATE_ACTIONS = new Set([
  "triage_investigations", "assign_investigation_ownership", "resolve_investigations",
]);
const IMPROVE_ACTIONS = new Set([
  "audit_metrics", "identify_optimization_targets", "implement_improvements",
]);
const MAINTAIN_ACTIONS = new Set([
  "schedule_health_check", "review_baseline_metrics", "update_documentation",
]);

function inferObjectiveType(
  steps: PersistedExecutionPlan["steps"],
  objectiveId: string,
): ExecutiveObjectiveType {
  const objectiveSteps = steps.filter(s => s.objectiveId === objectiveId);
  const actions = new Set(objectiveSteps.map(s => s.action));
  if (actions.size === 0) return "maintain";
  for (const a of actions) if (STABILIZE_ACTIONS.has(a)) return "stabilize";
  for (const a of actions) if (INVESTIGATE_ACTIONS.has(a)) return "investigate";
  for (const a of actions) if (IMPROVE_ACTIONS.has(a)) return "improve";
  return "maintain";
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifyOutcome(deltas: SubsystemDelta[]): OutcomeClassification {
  const hasImproved = deltas.some(d => d.delta >= IMPROVE_THRESHOLD);
  const hasDegraded = deltas.some(d => d.delta <= DEGRADE_THRESHOLD);

  if (hasImproved && hasDegraded) return "mixed";
  if (hasImproved) return "improved";
  if (hasDegraded) return "degraded";
  return "unchanged";
}

function computeDelta(
  subsystem: ExecutiveSubsystemName,
  baseline: ExecutiveTrendSnapshot,
  current: ExecutiveTrendSnapshot,
): SubsystemDelta | null {
  const baselineScore = baseline.subsystemScores[subsystem];
  const currentScore = current.subsystemScores[subsystem];
  if (baselineScore === undefined || currentScore === undefined) return null;
  return {
    subsystem,
    baselineScore,
    currentScore,
    delta: currentScore - baselineScore,
  };
}

// ---------------------------------------------------------------------------
// Not-executed statuses (plans that never reached a terminal outcome)
// ---------------------------------------------------------------------------

const NOT_EXECUTED_STATUSES: PlanStatus[] = [
  "draft", "running", "blocked", "cancelled", "rejected",
];

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the outcome of an executed plan by comparing subsystem health
 * before and after execution.
 *
 * Pure function — no side effects, no store access, no writes.
 *
 * Returns plan_not_executed if the plan never reached 'completed' or 'failed'.
 * Returns insufficient_data if baseline or current snapshots are missing.
 */
export function evaluatePlanOutcome(
  plan: PersistedExecutionPlan,
  state: PlanExecutionState,
  baseline: ExecutiveTrendSnapshot | null,
  current: ExecutiveTrendSnapshot | null,
): ExecutiveOutcomeEvaluationReport {
  const generatedAt = new Date().toISOString();

  // ── Guard: plan not in a terminal/executed state ─────────────
  if (NOT_EXECUTED_STATUSES.includes(state.status)) {
    return {
      schemaVersion: "p10.5.0",
      generatedAt,
      planId: plan.id,
      planStatus: state.status,
      evaluationStatus: "plan_not_executed",
      evaluatedSubsystems: [],
      objectives: [],
      overallDelta: 0,
      warnings: [`Plan has status "${state.status}" — not yet executed`],
    };
  }

  // ── Guard: insufficient data ─────────────────────────────────
  if (!baseline || !current) {
    return {
      schemaVersion: "p10.5.0",
      generatedAt,
      planId: plan.id,
      planStatus: state.status,
      evaluationStatus: "insufficient_data",
      evaluatedSubsystems: [],
      objectives: [],
      overallDelta: 0,
      warnings: [!baseline ? "No baseline snapshot found" : "No current snapshot found"].filter(Boolean),
    };
  }

  // ── Derive target subsystems from plan steps ─────────────────
  const subsystemSet = new Set<ExecutiveSubsystemName>();
  const objectiveSubsystems = new Map<string, ExecutiveSubsystemName[]>();

  for (const step of plan.steps) {
    subsystemSet.add(step.targetSubsystem as ExecutiveSubsystemName);
    const subs = objectiveSubsystems.get(step.objectiveId) ?? [];
    if (!subs.includes(step.targetSubsystem as ExecutiveSubsystemName)) {
      subs.push(step.targetSubsystem as ExecutiveSubsystemName);
    }
    objectiveSubsystems.set(step.objectiveId, subs);
  }

  // ── Compute per-objective outcomes ───────────────────────────
  const objectives: ObjectiveOutcome[] = [];

  for (const [objectiveId, subsystems] of objectiveSubsystems) {
    const deltas = subsystems
      .map(s => computeDelta(s, baseline, current))
      .filter((d): d is SubsystemDelta => d !== null);

    if (deltas.length === 0) continue;

    const aggregateDelta = Math.round(
      deltas.reduce((sum, d) => sum + d.delta, 0) / deltas.length,
    );

    objectives.push({
      objectiveId,
      objectiveType: inferObjectiveType(plan.steps, objectiveId),
      targetSubsystems: subsystems,
      subsystemDeltas: deltas,
      aggregateDelta,
      outcome: classifyOutcome(deltas),
    });
  }

  // ── Compute overall metrics ──────────────────────────────────
  const allDeltas = objectives.flatMap(o => o.subsystemDeltas);
  const overallDelta = allDeltas.length > 0
    ? Math.round(allDeltas.reduce((sum, d) => sum + d.delta, 0) / allDeltas.length)
    : 0;

  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: plan.id,
    planStatus: state.status,
    evaluationStatus: "completed",
    baselineSnapshotId: baseline.id,
    baselineGeneratedAt: baseline.generatedAt,
    currentSnapshotId: current.id,
    currentGeneratedAt: current.generatedAt,
    evaluatedSubsystems: Array.from(subsystemSet),
    objectives,
    overallDelta,
    warnings: [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executive/outcome-evaluator.vitest.ts --reporter=verbose`
Expected: PASS — all tests green.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/executive/outcome-evaluator.ts tests/executive/outcome-evaluator.vitest.ts
git commit -m "feat(p10-5a): add outcome-evaluator.ts pure function + unit tests"
```

---

### Task 3: CLI evaluate subcommand + integration test

**Files:**
- Create: `src/cli/commands/executive-evaluate-handler.ts` — handler logic (follows `runDashboard` pattern)
- Modify: `src/cli/commands/executive.ts` — add `evaluate` case + import
- Test: `tests/cli/commands/executive-evaluate-cli.vitest.ts`

**Interfaces:**
- Consumes: `EvaluationStatus` (includes "plan_not_found" — CLI-only), `PlanStore.load(id)`, `ExecutionStateStore.load(id)`, `ExecutiveTrendStore.findBaseline`, `ExecutiveTrendStore.loadLatest`, `evaluatePlanOutcome`
- Produces: `alix executive evaluate <planId>` CLI command with terminal table + `--json` output

- [ ] **Step 1: Write the failing integration test**

Create `tests/cli/commands/executive-evaluate-cli.vitest.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { handleExecutiveCommand } from "../../../src/cli/commands/executive.js";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "eval-cli-test-"));
  const execDir = join(tmpDir, ".alix", "executive");
  const plansDir = join(execDir, "plans");
  mkdirSync(plansDir, { recursive: true });

  // Create plan JSON
  const plan = {
    id: "test-plan-1",
    steps: [{
      id: "s1", stepNumber: 1, title: "Test step",
      action: "diagnose_root_cause",
      targetSubsystem: "workflow",
      objectiveId: "stabilize-workflow",
      dependsOn: [], status: "completed",
      priorityScore: 80, objectiveScore: 80,
    }],
    objectives: ["stabilize-workflow"],
    generatedAt: "2026-06-10T00:00:00.000Z",
    windowDays: 7,
    planStatus: "ready",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "hash",
  };
  writeFileSync(join(plansDir, "test-plan-1.json"), JSON.stringify(plan), "utf-8");

  // Create state
  const state = {
    planId: "test-plan-1",
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: "2026-06-10T00:00:00.000Z", completedAt: "2026-06-15T00:00:00.000Z" },
  };
  writeFileSync(join(plansDir, "test-plan-1.state.json"), JSON.stringify(state), "utf-8");

  // Create trends.jsonl with baseline + current
  const baseline = {
    id: "snap-baseline", generatedAt: "2026-06-01T00:00:00.000Z", windowDays: 7,
    subsystemScores: { workflow: 40, governance: 60 },
  };
  const current = {
    id: "snap-current", generatedAt: "2026-06-15T00:00:00.000Z", windowDays: 7,
    subsystemScores: { workflow: 80, governance: 55 },
  };
  writeFileSync(join(execDir, "trends.jsonl"),
    [baseline, current].map(s => JSON.stringify(s)).join("\n") + "\n", "utf-8");

  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(() => {
  vi.restoreAllMocks();
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe("executive evaluate CLI", () => {
  it("outputs evaluation table for a completed plan with data", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleExecutiveCommand(["evaluate", "test-plan-1"]);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("test-plan-1");
    expect(output).toContain("completed");
    expect(output).toContain("improved");

    logSpy.mockRestore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("outputs JSON when --json flag is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await handleExecutiveCommand(["evaluate", "test-plan-1", "--json"]);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("completed");
    expect(parsed.planId).toBe("test-plan-1");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shows error when planId is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await handleExecutiveCommand(["evaluate"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage"));

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shows plan_not_found when plan does not exist", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleExecutiveCommand(["evaluate", "nonexistent-plan"]);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("plan_not_found");

    logSpy.mockRestore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("shows insufficient_data when no trends.jsonl exists", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "eval-empty-"));
    vi.spyOn(process, "cwd").mockReturnValue(emptyDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await handleExecutiveCommand(["evaluate", "test-plan-1"]);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("insufficient_data");

    logSpy.mockRestore();
    exitSpy.mockRestore();
    if (existsSync(emptyDir)) rmSync(emptyDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/commands/executive-evaluate-cli.vitest.ts --reporter=verbose`
Expected: FAIL — module `executive-evaluate-handler.ts` not found, or `evaluate` case not implemented.

- [ ] **Step 3: Create evaluate handler**

Create `src/cli/commands/executive-evaluate-handler.ts`:

```typescript
/**
 * P10.5a — Executive evaluate CLI handler.
 *
 * Handles `alix executive evaluate <planId> [--json]`.
 * Wires PlanStore, StateStore, TrendStore together, calls pure
 * evaluatePlanOutcome, and renders the result.
 *
 * @module
 */

import { join } from "node:path";
import { PlanStore } from "../../executive/plan-store.js";
import { ExecutionStateStore } from "../../executive/execution-state-store.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { evaluatePlanOutcome } from "../../executive/outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";

const PLANS_DIR = join(".alix", "executive", "plans");
const EXECUTIVE_DIR = join(".alix", "executive");

export async function handleEvaluate(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const planId = args.find(a => !a.startsWith("--"));

  if (!planId) {
    console.error("Usage: alix executive evaluate <planId> [--json]");
    process.exit(1);
  }

  try {
    const cwd = process.cwd();
    const planStore = new PlanStore(join(cwd, PLANS_DIR));
    const stateStore = new ExecutionStateStore(join(cwd, PLANS_DIR));
    const trendStore = new ExecutiveTrendStore(join(cwd, EXECUTIVE_DIR));

    const plan = planStore.load(planId);
    const state = stateStore.load(planId);
    const [baseline, current] = await Promise.all([
      trendStore.findBaseline(plan.generatedAt),
      trendStore.loadLatest(),
    ]);

    const report = evaluatePlanOutcome(plan, state, baseline, current);

    if (jsonMode) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      renderEvaluationReport(report);
    }
  } catch (e: any) {
    if (e.message?.includes("not found") || e.message?.includes("does not exist")) {
      const report: ExecutiveOutcomeEvaluationReport = {
        schemaVersion: "p10.5.0",
        generatedAt: new Date().toISOString(),
        planId,
        planStatus: "draft",
        evaluationStatus: "plan_not_found",
        evaluatedSubsystems: [],
        objectives: [],
        overallDelta: 0,
        warnings: [`Plan "${planId}" not found`],
      };
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderFailClosed(report);
      }
      return;
    }
    console.error(`Evaluation failed: ${e.message}`);
    process.exit(1);
  }
}

function renderEvaluationReport(report: ExecutiveOutcomeEvaluationReport): void {
  if (report.evaluationStatus !== "completed") {
    renderFailClosed(report);
    return;
  }

  console.log(`Plan: ${report.planId}`);
  console.log(`Status: ${report.planStatus}`);
  console.log(`Evaluation: ${report.evaluationStatus}`);
  console.log(`Baseline: ${report.baselineGeneratedAt ?? "—"}`);
  console.log(`Current:  ${report.currentGeneratedAt ?? "—"}`);
  console.log("");

  const header = "Objective".padEnd(24) + "| Type".padEnd(16) + "| Subsystem".padEnd(14)
    + "| Before".padEnd(8) + "| After".padEnd(7) + "| Δ".padEnd(5) + "| Outcome";
  console.log(header);
  console.log("─".repeat(header.length));

  for (const obj of report.objectives) {
    for (let i = 0; i < obj.subsystemDeltas.length; i++) {
      const d = obj.subsystemDeltas[i];
      const label = i === 0 ? obj.objectiveId.slice(0, 23) : "";
      const typeLabel = i === 0 ? obj.objectiveType.slice(0, 14) : "";
      const deltaStr = `${d.delta >= 0 ? "+" : ""}${d.delta}`;
      console.log(
        `${label.padEnd(24)}| ${typeLabel.padEnd(14)}| ${d.subsystem.padEnd(12)}| ${String(d.baselineScore).padEnd(6)}| ${String(d.currentScore).padEnd(5)}| ${deltaStr.padEnd(3)}| ${obj.outcome}`,
      );
    }
  }

  console.log("");
  console.log(`Overall Δ: ${report.overallDelta >= 0 ? "+" : ""}${report.overallDelta}  (${report.objectives.length} objectives, ${report.evaluatedSubsystems.length} subsystems evaluated)`);
}

function renderFailClosed(report: ExecutiveOutcomeEvaluationReport): void {
  console.log(`Plan: ${report.planId}`);
  console.log(`Status: ${report.planStatus ?? "—"}`);
  console.log(`Evaluation: ${report.evaluationStatus}`);
  for (const w of report.warnings) {
    console.log(`Reason: ${w}`);
  }
}
```

- [ ] **Step 4: Wire evaluate into executive.ts**

Add to imports in `src/cli/commands/executive.ts`:

```typescript
import { handleEvaluate } from "./executive-evaluate-handler.js";
```

Add a case in `handleExecutiveCommand` switch (before `default`):

```typescript
    case "evaluate":
      return handleEvaluate(rest);
```

Update the default error message:

```typescript
console.error("Available: dashboard, plan, evaluate");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cli/commands/executive-evaluate-cli.vitest.ts --reporter=verbose`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Run focused evaluator tests to confirm no regression**

Run: `npx vitest run tests/executive/outcome-evaluator.vitest.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add src/cli/commands/executive.ts src/cli/commands/executive-evaluate-handler.ts tests/cli/commands/executive-evaluate-cli.vitest.ts
git commit -m "feat(p10-5a): add evaluate CLI subcommand with terminal + JSON output"
```

---

### Task 4: Sentinel allowlist + final verification

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` — add `outcome-evaluator.ts` to EXECUTIVE_FILES array

- [ ] **Step 1: Add outcome-evaluator.ts to sentinel allowlist**

In `tests/executive/executive-sentinels.vitest.ts`, find the `EXECUTIVE_FILES` array and add:

```typescript
  // P10.5a files
  "src/executive/outcome-evaluator.ts",
```

- [ ] **Step 2: Run sentinel + all executive tests**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter=verbose
npx vitest run tests/executive/ tests/cli/commands/executive-evaluate-cli.vitest.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 3: Full suite + tsc**

```bash
npx tsc --noEmit
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: All tests pass, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "chore(p10-5a): add outcome-evaluator.ts to sentinel allowlist"
```
