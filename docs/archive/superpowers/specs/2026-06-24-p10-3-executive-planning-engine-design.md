# P10.3 — Executive Planning Engine Design Spec

> **Status:** Draft design spec
> **Consumes:** P10.2 `ExecutiveObjectiveReport`  
> **Produces:** P10.3 `ExecutionPlan`  
> **Risk:** LOW — additive, pure functions, no store, no mutation path

## Overview

P10.3 converts P10.2 Executive Objectives into ordered execution plans.
It is the fourth layer of the executive intelligence stack:

```
P10.0  Health         (measurement)
P10.1  Priority       (prioritization)
P9.6   Investigations (operator work queue)
P10.2  Objectives     (strategy — what to achieve)
P10.3  Plans          (planning — how to achieve it)  ← this spec
P10.4  Execution      (orchestration)
P10.5  Review         (closed-loop evaluation)
```

**Architectural boundary:** P10.3 decides *how* to achieve what P10.2 decided *what* to achieve. P10.3 computes an ordered plan. P10.4 persists, approves, and executes it.

## Types

All types live in a new file `src/executive/planning-engine.ts`.
Uses `ExecutiveSubsystemName` from `executive-health.ts` (P10.0).

### Type helpers

```typescript
/** Machine-readable action kind — P10.4 uses this, never the display title. */
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
```

### ExecutionStep

```typescript
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
```

### ExecutionPlan

```typescript
export interface ExecutionPlan {
  id: string;
  /** Objective IDs this plan covers. */
  objectives: string[];
  /** Ordered step sequence. */
  steps: ExecutionStep[];
  generatedAt: string;
  windowDays: number;
  planStatus: "draft" | "ready" | "blocked";
  sourceReportId?: string;
  rationale?: string;
  plannerVersion: string;
  planningAlgorithm: string;
}
```

`plannerVersion` is a module-level constant (`PLANNER_VERSION = "1.0"`); `planningAlgorithm` is similarly a constant (`PLANNING_ALGORITHM = "template-v1"`). These enable unambiguous comparison as planning heuristics evolve (template-v2, AI planner, etc). Constants prevent drift across modules.

`planStatus` defaults to `"draft"` for every P10.3 plan. P10.4 transitions it.
`rationale` is set when there are no objectives to plan (e.g., `"No executive objectives available to plan."`).

## Constants

```typescript
export const PLANNER_VERSION = "1.0";
export const PLANNING_ALGORITHM = "template-v1";
```

Named constants avoid drift across modules and make version bumps explicit.

## Step Templates

Per-objective-type step decomposition. Hardcoded switch with exhaustiveness checking.
Each step defines both a machine `action` (P10.4 dispatches on this) and a `title` (display only).

| `objectiveType` | Steps (action / title) |
|---|---|
| `stabilize` | `diagnose_root_cause` / "Diagnose root causes" |
| | `create_remediation_proposal` / "Create remediation proposal" |
| | `apply_remediation` / "Apply remediation" |
| `investigate` | `triage_investigations` / "Triage open investigations" |
| | `assign_investigation_ownership` / "Assign investigation ownership" |
| | `resolve_investigations` / "Resolve investigations" |
| `improve` | `audit_metrics` / "Audit subsystem metrics" |
| | `identify_optimization_targets` / "Identify optimization targets" |
| | `implement_improvements` / "Implement improvements" |
| `maintain` | `schedule_health_check` / "Schedule health check" |
| | `review_baseline_metrics` / "Review baseline metrics" |
| | `update_documentation` / "Update documentation" |

### Risk level derivation

`riskLevel` is derived from the objective's scores — not hardcoded per type:

| `priorityScore` or `objectiveScore` | `riskLevel` |
|---|---|
| ≥ 70 | `high` |
| ≥ 40 | `medium` |
| < 40 | `low` |

This keeps one source of truth. If P10.2 later produces a high-scoring `improve` objective, P10.3 correctly assigns `high` risk instead of silently defaulting to `low`.

When an objective targets multiple subsystems (`targetSubsystems.length > 1`), one step sequence is generated per subsystem. Each sequence gets its own `stepNumber` range and points back to the same `objectiveId`.

The switch has a `default` branch with `assertNever(obj.objectiveType)` to catch missing cases at compile time.

## Dependency Resolution

Rules are declared as data, not embedded in code:

```typescript
/** Action → actions it blocks on the same subsystem. Typed for compile-time safety. */
const SUBSYSTEM_DEPENDENCY_RULES: Partial<Record<ExecutionStepAction, ExecutionStepAction[]>> = {
  apply_remediation: ["implement_improvements", "review_baseline_metrics"],
};
```

A generic `resolveLocalDependencies(steps)` function:

1. Groups steps by `targetSubsystem`.
2. Checks `SUBSYSTEM_DEPENDENCY_RULES` for each step: if a step's `action` appears as a key, all later steps on the same subsystem whose action is in the value list get that step's `id` added to their `dependsOn`.
3. **Intra-objective** dependencies are already set by the template (diagnose → propose → apply).
4. **Cross-subsystem:** No dependencies ever. `stabilize(governance)` does not block `improve(memory)`.

Function returns new step objects — never mutates inputs in place.

When a new blocker relationship is needed (e.g., `investigate` steps block `apply`), a single line is added to the rules table — no code change in the resolver.

## Top-Level Generator

```typescript
export function buildExecutionPlan(
  objectiveReport: ExecutiveObjectiveReport,
  sourceReportId?: string,
): ExecutionPlan
```

- If `objectives.length === 0`: returns `planStatus: "blocked"` with rationale.
- Otherwise: iterates objectives in their existing order (already sorted by `objectiveScore` desc), generates steps per (objective, subsystem), resolves dependencies, returns `planStatus: "draft"`.
- Step numbering is **1-based**.
- `generatedAt` inherited from `objectiveReport.generatedAt`.
- `windowDays` inherited from `objectiveReport.windowDays`.
- `plannerVersion` uses the module constant `PLANNER_VERSION`.
- `planningAlgorithm` uses the module constant `PLANNING_ALGORITHM`.
- Each step copies `priorityScore` and `objectiveScore` from its originating objective.
- `riskLevel` is derived from the objective's scores (see derivation table above).
- `estimatedDurationMinutes` is a per-action default (e.g., `diagnose_root_cause` → 30, `apply_remediation` → 60, `audit_metrics` → 15). Exact values defined as a lookup table in the generator.

## Integration

No new CLI command. Plan is generated as part of the existing dashboard pipeline:

```typescript
// In executive-dashboard-handler.ts:
const objectiveReport = buildObjectiveReport(healthReport, priorityReport, investigations);
const plan = buildExecutionPlan(objectiveReport);
renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, plan, { jsonMode });
```

### Renderer — 5th Panel

```text
[4] EXECUTIVE PLAN (N steps)
  Plan Status: draft | ready | blocked

  governance: (X steps)
    1. Diagnose root causes              high   [blocker for 2]
    2. Create remediation proposal       high   [blocked by 1]
    3. Apply remediation                 high   [blocked by 2]

  memory: (Y steps)
    4. Audit subsystem metrics           low
    5. Identify optimization targets     low   [blocked by 4]

  ...
```

Dependencies reference step IDs internally but render as step numbers for readability.

JSON envelope:

```json
{
  "health": { ... },
  "priority": { ... },
  "objectives": { ... },
  "plan": { ... }
}
```

### Empty Plan Case

When no objectives exist, the plan panel shows:

```text
[4] EXECUTIVE PLAN (0 steps)
  Status: blocked
  No executive objectives available to plan.
```

## Store

None. Plans are computed fresh each dashboard run. P10.4 introduces persistence.

## Tests (~8–10)

| # | Test | Expected |
|---|------|----------|
| 1 | 8 objectives → 24 steps, 1-based numbering | `planStatus: "draft"`, step 1..24 |
| 2 | Empty objectives | `planStatus: "blocked"` with rationale |
| 3 | Multi-subsystem objective produces multiple step sequences | 2x steps for that objective |
| 4 | Stabilize → apply blocks improve → implement on same subsystem | `dependsOn` includes the apply step |
| 5 | Cross-subsystem independence | No dependencies across different subsystems |
| 6 | Each objective type produces correct step count | 3 per (objective, subsystem) |
| 7 | All steps have `pending` status | All `status === "pending"` |
| 8 | `generatedAt` inherited from objective report | Matches `objectiveReport.generatedAt` |
| 9 | `planStatus: "draft"` for non-empty plan | Set correctly |
| 10 | Source report ID is forwarded | If passed, appears in plan |

## Files

| File | Action | Lines |
|---|---|---|
| `src/executive/planning-engine.ts` | Create | ~180 |
| `tests/executive/planning-engine.vitest.ts` | Create | ~150 |
| `src/cli/commands/executive-dashboard-handler.ts` | Modify | +5 |
| `src/cli/commands/executive-dashboard-renderer.ts` | Modify | +40 |
| `tests/cli/commands/executive-dashboard-cli.vitest.ts` | Modify | +2 |
| `tests/executive/executive-sentinels.vitest.ts` | Modify | +1 |

## Risk Assessment

- **LOW.** Additive only.
- No schema changes to existing types.
- No new store or mutation path.
- No new CLI commands.
- Follows the established P10.1/P10.2 pattern (pure function, dashboard integration).
- Existing sentinel covers new file (file list needs one entry).
