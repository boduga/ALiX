# P11.3 — Strategic Planning Engine Implementation Plan

> **Status:** Draft
> **Phase:** P11.3
> **Depends on:** P11.2 (RootCauseAnalysis, RootCauseStore, RootCauseAnalysis type)
> **Total tasks:** 8

---

## Task 1 — Types and config

**Files:** `src/planning/planning-types.ts`, `src/planning/planning-config.ts`

### Steps

1. Create `src/planning/planning-types.ts` with:
   - `EffortEstimate` type union: `"low" | "medium" | "high"`
   - `StrategicImpact` type union: `"direct" | "indirect" | "compound"`
   - `PlanStatus` type union: `"ok" | "no_degradation" | "insufficient_analysis" | "no_objectives"`
   - `PlanningObjective` interface with fields:
     - `id: string` — `strat-obj-{safeTimestamp}-{index}`
     - `targetSubsystem: CorrelationSubsystemId` — the degraded subsystem (symptom-objective model)
     - `targetMetric: string | null`
     - `topCauseSubsystem: CorrelationSubsystemId | null`
     - `currentScore: number`
     - `urgencyScore: number` — integer 0–100
     - `expectedImpact: StrategicImpact`
     - `improvesSubsystems: CorrelationSubsystemId[]`
     - `estimatedEffort: EffortEstimate`
     - `effortRationale: string`
     - `prerequisites: string[]` — references to other objective IDs in the same plan
     - `confidence: number | null` — 0–1 or null
     - `mechanism: CausalMechanism | null`
     - `sourceFindingSubsystem: CorrelationSubsystemId`
     - `rationale: string`
   - `StrategicPlan` interface:
     - `schemaVersion: "p11.3.0"`
     - `planId: string` — `strat-{safeTimestamp}`
     - `generatedAt: string`
     - `rootCauseAnalysisId: string`
     - `correlationGraphId: string`
     - `status: PlanStatus`
     - `objectives: PlanningObjective[]`
     - `meta: { totalSubsystemsEvaluated, prioritizedObjectives, objectivesLow, objectivesMedium, objectivesHigh }`
   - `PlanningEngineConfig` interface with:
     - `maxObjectives: number` — default 8
     - `minUrgencyScore: number` — default 15
     - `effortOverrides?: Partial<Record<CausalMechanism, EffortEstimate>>`
   - `StrategicPlanSummary` interface:
     - `planId, generatedAt, status, objectives, objectivesHigh, objectivesMedium, objectivesLow`
   - `PlanningEngineError` class (extends Error, code "PLANNING_ENGINE_ERROR")

2. Create `src/planning/planning-config.ts` with:
   - `DEFAULT_PLANNING_CONFIG` export

### Key design decisions

- Imports `CorrelationSubsystemId` from `"../correlation/correlation-types.js"` and `CausalMechanism` from `"../reasoning/reasoning-types.js"`
- All new types are in `src/planning/` to keep P11 boundaries clean
- `urgencyScore` is integer 0–100 (not float) for deterministic comparison
- `confidence` is `null` for no-cause findings (not 0, which would mean "zero confidence in an existing cause")

### Verification

- `npm run typecheck` passes
- Confirm types are importable and self-consistent

---

## Task 2 — Pure function: `buildStrategicPlan()`

**File:** `src/planning/build-strategic-plan.ts`

### Steps

1. Implement `buildStrategicPlan(analysis: RootCauseAnalysis, config: PlanningEngineConfig): StrategicPlan`

2. Logic (11 steps from the spec):
   - `generatedAt` is derived from `analysis.generatedAt` — repeated builds from the same analysis produce stable output
   - **Step 1**: Input validation — map `analysis.status` to `PlanStatus`
     - `insufficient_history` / `stale` → `"insufficient_analysis"`, empty objectives, return
     - `no_degradation` → `"no_degradation"`, empty objectives, return
     - `insufficient_edges` / `ok` → proceed
   - **Step 2**: Build `Map<primarySubsystem, CausalFinding>` index
   - **Step 3**: Build downstream dependency map: for each finding, collect which subsystems list it as a cause (`Map<causeSubsystem, degraded[]>`)
   - **Step 4**: Compute urgency score per finding using the composite formula
   - **Step 5**: Sort by urgency desc, filter by `minUrgencyScore`, cap at `maxObjectives`
   - **Step 6**: Determine `StrategicImpact` from downstream dependency count (0→direct, 1→indirect, 2+→compound)
   - **Step 7**: Estimate effort per mechanism with `effortOverrides` support
   - **Step 8**: Populate `topCauseSubsystem` from top `likelyCause`
   - **Step 9**: Assign prerequisites — if `A.targetSubsystem === B.topCauseSubsystem` and `A.urgencyScore >= B.urgencyScore`, add `A.id` to `B.prerequisites`
   - **Step 10**: Generate rationale text per template
   - **Step 11**: Assemble `StrategicPlan`

3. Helper:
   - `sanitizeTimestamp(iso: string): string` — strips non-alphanumeric characters for ID generation (e.g. `"2026-07-03T12:00:00.000Z"` → `"20260703T120000000Z"`)

### Key design decisions

- `planId = "strat-" + sanitizeTimestamp(generatedAt)`
- `objectiveId = "strat-obj-" + sanitizeTimestamp(generatedAt) + "-" + index`
- Urgency formula weights: severity 40%, confidence 35%, impact breadth 25%
- Impact breadth capped at 3+ for urgency score (max weight: 25)
- No-cause findings get max urgency of 25 (severity-only, no confidence/impact bonuses)
- Prerequisites only assigned when cause has >= urgency of effect (urgency-dominant ordering)
- `insufficient_edges` with objectives → status `"ok"`; without → `"no_objectives"`
- `sanitizeTimestamp` is a simple pure function — no crypto, no random

### Verification

- `npm run typecheck` passes
- All 10 pure function tests pass

---

## Task 3 — Store: `StrategicPlanStore`

**File:** `src/planning/strategic-plan-store.ts`

### Steps

1. Implement `StrategicPlanStore` class:
   - `constructor(dir: string)` — `.alix/planning` as default
   - `save(plan: StrategicPlan): Promise<void>` — append JSON line to `strategic-plans.jsonl`
   - `loadLatest(): Promise<StrategicPlan | null>` — read last line from JSONL
   - `loadById(id: string): Promise<StrategicPlan | null>` — scan for matching ID
   - `list(): Promise<StrategicPlanSummary[]>` — return metadata for all plans

2. Validation on load:
   - Parse JSON
   - Verify `schemaVersion === "p11.3.0"`
   - Verify `objectives` is an array
   - Verify each objective has a valid `targetSubsystem`
   - Field-level constraints:
     - `urgencyScore` is integer 0–100
     - `confidence` is null or number 0–1
     - `estimatedEffort` is `"low"` | `"medium"` | `"high"`
     - `expectedImpact` is `"direct"` | `"indirect"` | `"compound"`
     - `prerequisites` entries reference objective `id` values that exist in the same plan
     - `rootCauseAnalysisId` is non-empty string
     - `correlationGraphId` is non-empty string
   - File reading filters blank lines: `lines = raw.split("\n").filter(line => line.trim().length > 0)` so trailing newlines from append-only writes are handled
   - Throw `PlanningEngineError` on invalid data (fail-closed)

### Verification

- `npm run typecheck` passes
- All 4 store tests pass

---

## Task 4 — Engine orchestrator: `PlanningEngine`

**File:** `src/planning/planning-engine.ts`

### Steps

1. Implement `PlanningEngine` class:
   - `constructor(rootCauseStore, strategicPlanStore, config?)`
   - `run(): Promise<StrategicPlan>` — load analysis → pure function → save → return
   - `loadLatest(): Promise<StrategicPlan | null>` — delegate to store
   - Error: no root cause analysis → throw `PlanningEngineError`
   - No separate error handling needed for stale/insufficient_analysis — `buildStrategicPlan` returns a valid plan artifact with empty objectives and the corresponding status. Only missing or unreadable data throws.

2. Test with mock `RootCauseStore` returning known analyses

### Verification

- `npm run typecheck` passes
- All 3 engine tests pass

---

## Task 5 — CLI handler

**File:** `src/cli/commands/executive-strategic-plan-handler.ts`

### Steps

1. Implement `handleStrategicPlanCommand(args: string[])`:
   - Parse `--json`, `--latest` flags
   - `--latest` mode: load latest plan, print summary or JSON
   - Default mode: construct `RootCauseStore` at `.alix/reasoning`, `StrategicPlanStore` at `.alix/planning`, then engine with `DEFAULT_PLANNING_CONFIG`, run, save, print summary
   - Error handling: `PlanningEngineError` for structured errors, generic catch-all

2. `printStrategicPlanSummary(plan, isJson)` function:
   - JSON mode: full JSON dump
   - Summary mode: table format matching P11.2's reason handler style

3. Register in `src/cli/commands/executive.ts`:
   - Add `case "strategic-plan":` with dynamic import
   - Add "strategic-plan" to the default-case available subcommands list

### Verification

- `npm run typecheck` passes
- CLI smoke test: `npx tsx src/cli/alix.ts executive strategic-plan --latest` prints helpful message
- `npx tsx src/cli/alix.ts executive strategic-plan --json --latest` outputs JSON (or error about no data)

---

## Task 6 — Pure function tests (10 tests)

**File:** `tests/planning/build-strategic-plan.vitest.ts`

### Test cases

| # | Test | Input | Expected |
|---|---|---|---|
| T1 | objectives for degraded subsystems | 2 degraded findings with causes | 2 objectives, sorted by urgency desc |
| T2 | urgency ordering | findings with urgency 82 and 31 | 82 comes first |
| T3 | causal dependency creates prerequisites | memory causes workflow, both degraded | workflow has memory as prerequisite |
| T4 | `no_degradation` when all healthy | analysis.status=no_degradation | status=no_degradation, empty objectives |
| T5 | `insufficient_history` returns `insufficient_analysis` | analysis.status=insufficient_history | status=insufficient_analysis, empty |
| T6 | no-cause findings get low urgency | finding with empty likelyCauses | urgency <= 25, no prerequisites |
| T7 | maxObjectives cap | 5 degraded findings, maxObjectives=3 | at most 3 objectives |
| T8 | minUrgencyScore filter | findings with urgency 10, 42, min=15 | only 42 survives |
| T9 | StrategicImpact classification | objective with 0/1/2+ dependents | direct/indirect/compound respectively |
| T10 | effort estimation per mechanism | 4 findings with different mechanisms | each gets correct default effort |

### Helper utilities

- `makeAnalysis(config?)` — build a `RootCauseAnalysis` with specified findings for testing
- `makeFinding(subsystem, score, causes?)` — convenience factory
- `makeCause(subsystem, confidence, mechanism)` — convenience factory

---

## Task 7 — Store and engine tests (7 tests)

**Files:** `tests/planning/strategic-plan-store.vitest.ts` (4 tests), `tests/planning/planning-engine.vitest.ts` (3 tests)

### StrategicPlanStore tests

| # | Test | Expected |
|---|---|---|
| T11 | save + loadLatest round-trip | Returns same plan |
| T12 | loadLatest returns last of two saves | Returns second save |
| T13 | loadLatest from non-existent file | Returns null |
| T14 | invalid JSON throws PlanningEngineError | Error thrown |
| T15 | invalid schemaVersion throws | PlanningEngineError |
| T16 | invalid urgencyScore (101) throws | PlanningEngineError |
| T17 | invalid confidence (-0.1) throws | PlanningEngineError |
| T18 | invalid prerequisite reference throws | PlanningEngineError |

### PlanningEngine tests

| # | Test | Expected |
|---|---|---|
| T19 | run returns plan when analysis exists | Plan with correct status |
| T20 | run throws when no analysis | PlanningEngineError |
| T21 | loadLatest returns null when empty | null |

---

## Task 8 — CLI handler test (2 tests)

**File:** `tests/planning/executive-strategic-plan-handler.vitest.ts`

| # | Test | Expected |
|---|---|---|
| T22 | `--latest` without saved plan prints message | Prints helpful message, no crash |
| T23 | Default mode runs and prints summary | Prints plan summary |

---

## Execution Order

```
Task 1 (types + config)
  ├── Task 2 (pure function)
  ├── Task 3 (store)
  │      └── Task 4 (orchestrator)
  │             └── Task 5 (CLI handler)
  ├── Task 6 (pure function tests)
  ├── Task 7 (store + engine tests)
  └── Task 8 (CLI handler tests)
```

Tasks 2 and 3 are independent after Task 1. Task 4 depends on both. Write pure function tests (T1-T10) immediately after Task 2 to catch scoring and prerequisite bugs early. Tasks 7-8 are the final verification layer.

After all tasks:
```bash
npm run typecheck
npx vitest run tests/planning/ 2>&1 | tail -10
npx vitest run
npm run build
npx tsx src/cli/alix.ts executive strategic-plan --latest
npx tsx src/cli/alix.ts executive strategic-plan --json --latest
```

Expected: typecheck clean, 23 tests passing, CLI prints helpful "no plan" message.

---

