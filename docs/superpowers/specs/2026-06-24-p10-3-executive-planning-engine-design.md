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

### ExecutionStep

```typescript
export type ExecutionStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface ExecutionStep {
  /** 1-based step number in the overall plan sequence. */
  stepNumber: number;
  /** Short action description (operator-facing). */
  action: string;
  /** Subsystem this step operates on. */
  targetSubsystem: string;
  /** 1-based step numbers this step depends on (subsystem-local only). */
  dependsOn: number[];
  status: ExecutionStepStatus;
  /** The objective that generated this step. */
  objectiveId: string;
  riskLevel: "low" | "medium" | "high";
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
}
```

`planStatus` defaults to `"draft"` for every P10.3 plan. P10.4 transitions it.
`rationale` is set when there are no objectives to plan (e.g., `"No executive objectives available to plan."`).

## Step Templates

Per-objective-type step decomposition. Hardcoded switch with exhaustiveness checking:

| `objectiveType` | Steps | Risk |
|---|---|---|
| `stabilize` | 1. Diagnose root causes | high |
| | 2. Create remediation proposal | high |
| | 3. Apply remediation | high |
| `investigate` | 1. Triage open investigations | medium |
| | 2. Assign investigation ownership | medium |
| | 3. Resolve investigations | medium |
| `improve` | 1. Audit subsystem metrics | low |
| | 2. Identify optimization targets | low |
| | 3. Implement improvements | low |
| `maintain` | 1. Schedule health check | low |
| | 2. Review baseline metrics | low |
| | 3. Update documentation | low |

When an objective targets multiple subsystems (`targetSubsystems.length > 1`), one step sequence is generated per subsystem. Each sequence gets its own `stepNumber` range and points back to the same `objectiveId`.

The switch has a `default` branch with `assertNever(obj.objectiveType)` to catch missing cases at compile time.

## Dependency Resolution

Rules applied in `resolveLocalDependencies()`:

1. **Intra-objective:** steps within the same objective already have `dependsOn` set by the template (diagnose → propose → apply).

2. **Same subsystem, same type:** `stabilize`'s "Apply remediation" blocks all `improve`/`maintain` steps on the same subsystem that come after it.

3. **Same subsystem, different type:** No additional cross-objective dependencies unless a `stabilize` is present (rule 2).

4. **Cross-subsystem:** No dependencies ever. `stabilize(governance)` does not block `improve(memory)`.

Function returns new step objects — never mutates inputs in place.

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
    1. Diagnose root causes              high   [blocker for 2, 3]
    2. Create remediation proposal       high   [blocked by 1]
    3. Apply remediation                 high   [blocked by 2]

  memory: (Y steps)
    4. Audit subsystem metrics           low
    5. Identify optimization targets     low   [blocked by 4]

  ...
```

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
