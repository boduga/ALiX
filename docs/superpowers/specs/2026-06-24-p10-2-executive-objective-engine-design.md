# P10.2 — Executive Objective Engine Design

> **Status:** SDS — approved for planning
> **Builds on:** P10.0 (ExecutiveHealthReport), P10.1 (ExecutivePriorityReport), P9.6 (InvestigationRecommendation)
> **Risk level:** LOW — additive only, new artifact + generator + dashboard panel, no existing schema changes
> **Phase in executive stack:** Layer 3 of 5 (Measure → Prioritize → Investigate → **Set Objectives** → Plan → Execute → Review)

## Core framing

**P10.0 answers:** What is unhealthy?
**P10.1 answers:** What deserves attention?
**P9.6 answers:** What requires investigation?
**P10.2 answers:** What should ALiX accomplish next?

P10.2 generates strategic objectives — not mutations, not patches, not configuration changes. An `ExecutiveObjective` is a durable strategic **contract** that P10.3 (Planning), P10.4 (Execution), and P10.5 (Review) consume without schema redesign. However, P10.2 **reports** are computed ephemerally each dashboard run — persistence begins in P10.3 when plans need stable objective IDs.

## Layer stack

```
ExecutiveHealthReport (P10.0)    → "What is unhealthy?"
        │
        ▼
ExecutivePriorityReport (P10.1)  → "What matters most?"
        │
        ▼
InvestigationQueue (P9.6)        → "What requires investigation?"
        │
        ▼
ExecutiveObjective Engine (P10.2)→ "What should ALiX accomplish?"
        │
        ▼
ExecutiveObjective[]             → 0–8, at most one per subsystem
```

## Data model

### ExecutiveObjectiveType

```typescript
export type ExecutiveObjectiveType =
  | "stabilize"      // System health is actively degrading — restore to acceptable threshold
  | "investigate"    // P9.6 findings require operator diagnosis
  | "improve"        // Healthy system with measurable opportunity
  | "maintain";      // Everything healthy — preserve the state
```

Future types (P10.3+): `expand`, `retire`, `consolidate`, `protect`, `optimize`.

### ExecutiveObjectiveStatus

```typescript
export type ExecutiveObjectiveStatus =
  | "proposed"     // Newly generated, not yet accepted
  | "accepted"     // Operator has acknowledged this objective
  | "active"       // Being worked on (plan exists)
  | "completed"    // Objective achieved
  | "superseded";  // Replaced by a newer/higher-priority objective
```

### ExecutiveObjective

```typescript
export interface ExecutiveObjective {
  id: string;
  title: string;
  description: string;

  objectiveType: ExecutiveObjectiveType;
  status: ExecutiveObjectiveStatus;

  /** Inherited from P10.1 — executive urgency. */
  priorityScore: number;
  /** Computed by P10.2 — strategic importance. */
  objectiveScore: number;

  rationale: string;
  evidenceRefs: string[];
  suggestedActions: string[];

  /** Subsystem(s) this objective targets. */
  targetSubsystems: ExecutiveSubsystemName[];

  /** P9.6 investigation ids that support this objective. */
  supportingInvestigations: string[];

  /** Explicit provenance — for explainability. */
  derivedFrom: {
    priorityReportGeneratedAt: string;  // P10.1 reports are ephemeral; generatedAt is the authoritative key
    investigationIds: string[];
  };

  blockers: string[];
  generatedAt: string;
}
```

### Provenance chain

```
Objective
  └── came from
        └── Priority Report (P10.1)
              └── came from
                    └── Executive Health (P10.0)
```

### Timestamp rule

`generatedAt` on the `ExecutiveObjectiveReport` must be inherited from the health report timestamp (`healthReport.generatedAt`), not a fresh `new Date()` inside the objective engine. This ensures all four dashboard reports share the same generation timestamp.

## Invariant: at most one objective per subsystem

**Rule:** The objective engine generates **0–8 objectives**, at most **one primary objective per subsystem**. Empty subsystems (no data, no adapters) produce no objective. This prevents synthetic objectives and keeps the strategic surface clean.

Within the 0–8 set, multiple objectives can target the same subsystem in future phases (e.g., a `stabilize` and an `improve` for governance), but P10.2 generates exactly one per subsystem, choosing the highest-priority type.

## Objective classification rules

| Type | Condition | Example |
|------|-----------|---------|
| `stabilize` | Health score < 80 AND priorityScore in top 3 for 3+ consecutive windows | "Restore governance score above 90" |
| `investigate` | Has ≥1 open investigation in P9.6 queue matching this subsystem | "Investigate chain restoration (3 open investigations)" |
| `improve` | Health ≥ 80, trend stable, observable opportunity | "Increase learning automation coverage" |
| `maintain` | Health ≥ 90, no investigations, trend flat/positive | "Maintain security at score 97" |

Resolution order: `stabilize > investigate > improve > maintain`. If a subsystem qualifies for multiple types, the highest-priority type wins.

## Objective scoring

Formula:

```
objectiveScore =
      priorityScore      × 0.40    (from P10.1 — executive urgency)
    + healthImpact       × 0.30    (100 - healthScore, subsystem deficit)
    + persistenceScore   × 0.20    (how many consecutive windows elevated)
    + investigationPressure × 0.10 (count of open investigations)
```

All inputs normalized to 0–100. Output is 0–100. Higher = more strategically important.

**Terminology:**
- `priorityScore` — inherited from P10.1, not recomputed
- `healthImpact` — subsystem deficit (not "severity", which is already used in investigations)
- `persistenceScore` — how long the priority has been elevated (not "ageScore")
- `investigationPressure` — operational load from P9.6

## ObjectiveGenerator

Pure function (no store writes during generation — the caller persists):

```typescript
export function buildObjectiveReport(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  investigations: InvestigationRecommendation[],
): ExecutiveObjectiveReport
```

Returns `ExecutiveObjectiveReport`:

```typescript
export interface ExecutiveObjectiveReport {
  schemaVersion: "p10.2.0";
  generatedAt: string;
  windowDays: number;
  objectives: ExecutiveObjective[];  // sorted by objectiveScore descending
}
```

### Generation pipeline

```
For each subsystem in rankedSubsystems:
  1. Fetch priority entry from P10.1
  2. Fetch open investigations from P9.6 filtered to this subsystem
  3. Classify: stabilize > investigate > improve > maintain
  4. Compute objectiveScore
  5. Build ExecutiveObjective
  6. Collect into report
```

## Dashboard integration

The executive dashboard grows from 2 panels to 4:

```
Executive Dashboard
  ├── Health Summary    (P10.0)
  ├── Priorities        (P10.1)
  ├── Objectives        (P10.2)   ← NEW
  └── Investigations    (P9.6)
```

Objectives panel sorted by `objectiveScore` descending — most strategically important work first.

CLI: `alix executive dashboard` shows all 4 panels. JSON mode includes all 4 report types.

## File structure

```
Create:
  src/executive/objective-engine.ts       — ExecutiveObjective types + buildObjectiveReport
  tests/executive/objective-engine.vitest.ts

Modify:
  src/cli/commands/executive-dashboard-renderer.ts  — add Objectives panel
  src/cli/commands/executive-dashboard-handler.ts   — read P9.6 investigations, pass to generator
  tests/cli/commands/executive-dashboard-cli.vitest.ts
  tests/executive/executive-sentinels.vitest.ts     — if needed
```

No new store — objectives are computed fresh each dashboard run, not persisted (mirrors P10.0 health reports). Persistence is a P10.3 concern when planning depends on stable objective IDs.

## Relationship to P10.3–P10.5

`ExecutiveObjective` is the durable contract:

```
P10.2  ExecutiveObjective     (strategy)
P10.3  + ExecutionPlan        (planning — depends on objective)
P10.4  + WorkflowExecution    (orchestration — executes the plan)
P10.5  + ObjectiveEvaluation  (review — did the objective achieve its goal?)
```

No schema redesign between phases. P10.3 adds planning fields alongside the objective, not inside it.

## Acceptance criteria

1. `ExecutiveObjective` type matches the data model exactly (separate `priorityScore` / `objectiveScore`)
2. `ExecutiveObjectiveType` supports all 4 strategies; `ExecutiveObjectiveStatus` supports all 5 lifecycle states
3. `derivedFrom` provenance present on every objective
4. At most one objective per subsystem (0–8 total)
5. Classification logic correctly selects highest-priority type per subsystem
6. `objectiveScore` formula uses the 4-component weighted formula with correct terminology
7. Objectives sorted by `objectiveScore` descending in the report
8. Dashboard renders all 4 panels with objectives panel prominent
9. CLI `--json` includes all 4 reports
10. All existing tests pass — no schema changes to P10.0/P10.1/P9.6 types

## Explicitly out of scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Objective persistence / store | P10.3 | Planning needs stable IDs; P10.2 is ephemeral compute |
| Execution plan generation | P10.3 | Planning is a separate phase |
| Workflow execution | P10.4 | Orchestration layer |
| Objective evaluation / closed-loop | P10.5 | Review layer |
| Additional objective types (expand, retire, etc.) | P10.3+ | New phase, new strategies |
| Dynamic blast radius | Deferred enhancements | After executive loop completes |
| Operator urgency overrides | Deferred enhancements | After executive loop completes |
