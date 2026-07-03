# P11.3 — Strategic Planning Engine Design Spec

> **Status:** Approved ✅  
> **Phase:** P11.3  
> **Consumes:** `RootCauseAnalysis` (P11.2)  
> **Produces:** `StrategicPlan`  
> **Determinism:** Fully deterministic. No LLM, no probabilistic inference.

---

## 1. Context

P11.2 Reasoning Engine produces a `RootCauseAnalysis` — per-degraded-subsystem findings that name the most likely causes, the mechanism of causation, the driving metric, and a recommended action. It answers *"what is wrong and why"* but not *"what should we fix first."*

P11.3 Strategic Planning Engine consumes the `RootCauseAnalysis` and produces a `StrategicPlan`: a prioritized, cross-subsystem set of planning objectives ranked by strategic urgency, causal ordering, and estimated effort. This is the first P11 stage that reasons about priority across subsystems rather than within a single subsystem.

### Stage boundary rule

P11.3's output `StrategicPlan` is itself a typed, persisted artifact consumed by P11.4 (Learning Engine). P11.3 does not mutate anything — it reads the current root cause analysis and writes a new plan. The plan is advisory; it does not trigger any action. Remediation execution remains the domain of P10.4 (Execution Orchestration) and P9 (Governance).

---

## 2. Type Model

### 2.1 EffortEstimate

```typescript
/**
 * Estimated effort to address a planning objective.
 *
 * "low"   — Isolated investigation or minor adjustment.
 * "medium" — Cross-subsystem inspection or config change.
 * "high"   — Complex root cause requiring coordinated changes across subsystems.
 */
export type EffortEstimate = "low" | "medium" | "high";
```

### 2.2 StrategicImpact

```typescript
/**
 * The breadth of downstream benefit from completing this objective.
 *
 * "direct"   — No other degraded subsystem depends on this objective's target.
 * "indirect" — Exactly one other degraded subsystem depends on this objective's target.
 * "compound" — Two or more other degraded subsystems depend on this objective's target.
 */
export type StrategicImpact = "direct" | "indirect" | "compound";
```

### 2.3 PlanStatus

```typescript
export type PlanStatus =
  | "ok"                    // Normal strategic plan with objectives
  | "no_degradation"        // No subsystems degraded — no objectives needed
  | "insufficient_analysis" // RootCauseAnalysis status prevents planning
  | "no_objectives";        // Degradation exists but no actionable objectives
```

### 2.4 PlanningObjective

```typescript
export interface PlanningObjective {
  /** Stable objective ID, e.g. `strat-obj-{safeTimestamp}-{index}`. */
  id: string;
  /**
   * The degraded subsystem being planned for (symptom-objective model).
   * This is the primarySubsystem from the CausalFinding — the subsystem that
   * is degraded. The strategic lever to inspect may be topCauseSubsystem
   * (if a cause was identified), but the objective owns the degradation.
   */
  targetSubsystem: CorrelationSubsystemId;
  /**
   * The driving metric (drift item ID) to address.
   * Copied from CausalFinding.drivingMetric.
   */
  targetMetric: string | null;
  /**
   * The subsystem identified as the most likely cause, if any.
   * Copied from the top LikelyCause.causeSubsystem.
   * When non-null, inspection should start here.
   */
  topCauseSubsystem: CorrelationSubsystemId | null;
  /** Current health score of the target subsystem. */
  currentScore: number;
  /**
   * Composite urgency score 0–100.
   * Higher = more urgent. Combines current score (lower is worse),
   * cause confidence, and impact breadth.
   */
  urgencyScore: number;
  /** The breadth of downstream benefit from completing this objective. */
  expectedImpact: StrategicImpact;
  /** Subsystems expected to improve as a side effect of fixing this one. */
  improvesSubsystems: CorrelationSubsystemId[];
  /** Estimated effort to address this objective. */
  estimatedEffort: EffortEstimate;
  /** Human-readable rationale for the effort estimate. */
  effortRationale: string;
  /** IDs of objectives that must be completed before this one. */
  prerequisites: string[];
  /** Confidence propagated from the top LikelyCause (0–1). Null if no cause found. */
  confidence: number | null;
  /** The causal mechanism of the top LikelyCause. Null if no cause found. */
  mechanism: CausalMechanism | null;
  /**
   * Links to the source CausalFinding's primarySubsystem.
   * Used for traceability back to the RootCauseAnalysis finding.
   */
  sourceFindingSubsystem: CorrelationSubsystemId;
  /** Human-readable rationale for inclusion and priority. */
  rationale: string;
}
```

### 2.5 StrategicPlan

```typescript
export interface StrategicPlan {
  schemaVersion: "p11.3.0";
  /** Unique plan ID, e.g. `strat-{safeTimestamp}`. */
  planId: string;
  generatedAt: string;
  /** Links to the source RootCauseAnalysis that produced this plan. */
  rootCauseAnalysisId: string;
  /** Propagated from the RootCauseAnalysis for traceability. */
  correlationGraphId: string;
  /** Overall plan status. */
  status: PlanStatus;
  /** Ranked planning objectives (most urgent first). */
  objectives: PlanningObjective[];
  meta: {
    totalSubsystemsEvaluated: number;
    prioritizedObjectives: number;
    objectivesLow: number;
    objectivesMedium: number;
    objectivesHigh: number;
  };
}
```

### 2.6 PlanningEngineConfig

```typescript
export interface PlanningEngineConfig {
  /**
   * Maximum number of objectives to include in a single plan.
   * Default: 8 (covers all degraded subsystems in a healthy system).
   */
  maxObjectives: number;
  /**
   * Minimum urgency score for an objective to be included.
   * Default: 15 (filters out negligible degradations).
   */
  minUrgencyScore: number;
  /**
   * Effort overrides per causal mechanism.
   * When set, replaces the default effort mapping for that mechanism.
   */
  effortOverrides?: Partial<Record<CausalMechanism, EffortEstimate>>;
}
```

### 2.7 StrategicPlanSummary

```typescript
export interface StrategicPlanSummary {
  planId: string;
  generatedAt: string;
  status: PlanStatus;
  objectives: number;
  objectivesHigh: number;
  objectivesMedium: number;
  objectivesLow: number;
}
```

### 2.8 Errors

```typescript
export class PlanningEngineError extends Error {
  readonly code = "PLANNING_ENGINE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "PlanningEngineError";
  }
}
```

---

## 3. Algorithm: `buildStrategicPlan()`

### 3.1 Signature

```typescript
function buildStrategicPlan(
  analysis: RootCauseAnalysis,
  config: PlanningEngineConfig,
): StrategicPlan
```

Pure function, no side effects, no I/O. Fully deterministic.

### 3.2 Constants

```typescript
const DEFAULT_MAX_OBJECTIVES = 8;
const DEFAULT_MIN_URGENCY_SCORE = 15;
const PLANNER_VERSION = "1.0";
const PLANNING_ALGORITHM = "priority-v1";
```

### 3.3 Steps

**Step 1 — Input validation**

Map `analysis.status` to `PlanStatus`:

| `analysis.status` | Plan status | Behavior |
|---|---|---|
| `"insufficient_history"` | `"insufficient_analysis"` | Return empty objectives |
| `"stale"` | `"insufficient_analysis"` | Return empty objectives |
| `"no_degradation"` | `"no_degradation"` | Return empty objectives |
| `"insufficient_edges"` | Continue | Proceed — limited evidence reflected via `confidence: null`, `mechanism: null` |
| `"ok"` | Continue | Proceed normally |

**Step 2 — Build findings index**

Index `analysis.findings` by `primarySubsystem` for fast lookup:
```
Map<CorrelationSubsystemId, CausalFinding>
```

**Step 3 — Downstream dependency map**

For each finding, collect which subsystems list it as a cause in their `likelyCauses`:
```
Map<CorrelationSubsystemId, CorrelationSubsystemId[]>
```
Key = causeSubsystem, Value = list of degraded subsystems that depend on it.

The count of entries per key determines `StrategicImpact`:
- 0 entries → `"direct"`
- 1 entry → `"indirect"`
- 2+ entries → `"compound"`

**Step 4 — Compute urgency score per finding**

For each `CausalFinding` with at least one `likelyCause`, compute:

```
severityComponent   = (100 - currentScore) / 100                    // 0.0–1.0, higher when worse
confidenceComponent = topCause.confidence                           // 0.0–1.0 from causal analysis
impactComponent     = count of downstream dependents                // 0..N

urgencyScore = floor(
  severityComponent * 40 +       // severity is 40% of the score
  confidenceComponent * 35 +     // confidence is 35%
  min(impactComponent / 3, 1) * 25  // impact breadth is 25%, capped at 3+
)
```

For findings with no `likelyCause` (empty `likelyCauses[]`):
```
urgencyScore = floor((100 - currentScore) / 100 * 25)  // max 25 — isolated, no dependencies
```

The subsystem counts as `improvesSubsystems` for each downstream subsystem that lists it as a cause.

**Step 5 — Sort and cap**

1. Sort findings by `urgencyScore` descending (most urgent first).
2. Filter out findings with `urgencyScore < config.minUrgencyScore`.
3. Take top `config.maxObjectives` findings.

If no findings survive the filter:
- If any findings existed but all were filtered: plan `status: "no_objectives"`, empty objectives, return.
- If no findings existed (none passed Step 4): plan `status: "no_objectives"`, empty objectives, return.

**Step 6 — Determine expected impact**

For each surviving finding, look up its entry in the downstream dependency map (Step 3):

| Downstream count | StrategicImpact |
|---|---|
| 0 | `"direct"` |
| 1 | `"indirect"` |
| 2+ | `"compound"` |

`improvesSubsystems` = the list of downstream dependents from Step 3.

**Step 7 — Estimate effort**

Default effort mapping per `CausalMechanism` of the top cause:

| Mechanism | Default effort | Rationale |
|---|---|---|
| `temporal_cascade` | `"medium"` | Single causal chain — inspect changes in cause subsystem |
| `concurrent_degradation` | `"high"` | Shared root cause requires system-level investigation |
| `inverse_correlation` | `"high"` | Potential conflict between subsystems — needs careful tradeoff |
| `degradation_chain` | `"high"` | Spans multiple subsystems — coordinated fix required |
| No cause found | `"low"` | Isolated investigation of the subsystem itself |

If `config.effortOverrides` has an entry for the mechanism, it takes precedence.

**Step 8 — Populate `topCauseSubsystem`**

For each objective:
- If the finding has at least one `likelyCause`: `topCauseSubsystem = likelyCauses[0].causeSubsystem`
- Otherwise: `topCauseSubsystem = null`

**Step 9 — Assign prerequisites**

For each objective `A` whose `targetSubsystem` equals another objective `B`'s `topCauseSubsystem`:

- If `A.urgencyScore >= B.urgencyScore`: `B.prerequisites.push(A.id)`
  (fix the cause first; higher or equal urgency cause becomes prerequisite)
- If `A.urgencyScore < B.urgencyScore`: no prerequisite relationship
  (the effect may be more urgent despite the causal link; let urgency win)

This handles the common case: if memory causes workflow degradation and both are degraded, the memory objective becomes a prerequisite for the workflow objective — unless the workflow degradation is independently more urgent.

**Step 10 — Generate rationale**

Per-objective rationale template:

| Scenario | Rationale template |
|---|---|
| Has cause (any mechanism) | `"{targetSubsystem} degraded (score: {currentScore}). Address {targetMetric}. Priority: {urgencyScore}/100."` |
| No cause found | `"{targetSubsystem} degraded (score: {currentScore}) with no identified cause. Independent investigation needed. Priority: {urgencyScore}/100."` |

**Step 11 — Assemble and return**

Set plan status:
- If `analysis.status === "insufficient_edges"` and objectives exist: `"ok"`
- If `analysis.status === "insufficient_edges"` and no objectives: `"no_objectives"`
- Otherwise: `"ok"` when objectives exist, `"no_objectives"` when none survive.

Build plan object with:
- `planId = "strat-" + sanitizedTimestamp(generatedAt)` where `sanitizedTimestamp` removes non-alphanumeric characters
- `analysisId` for `rootCauseAnalysisId`
- Propagated `correlationGraphId`

---

## 4. Engine Orchestrator: `PlanningEngine`

### 4.1 Interface

```typescript
export class PlanningEngine {
  constructor(
    private readonly rootCauseStore: RootCauseStore,
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly config: PlanningEngineConfig,
  ) {}

  async run(): Promise<StrategicPlan> { ... }
  async loadLatest(): Promise<StrategicPlan | null> { ... }
}
```

### 4.2 `run()` flow

1. Load latest `RootCauseAnalysis` via `rootCauseStore.loadLatest()`
2. If null: throw `PlanningEngineError("No root cause analysis available. Run 'alix executive reason' first.")`
3. Call `buildStrategicPlan(analysis, config)` — pure function
4. Save plan via `strategicPlanStore.save(plan)`
5. Return plan

### 4.3 `loadLatest()` flow

Delegates to `StrategicPlanStore.loadLatest()` — reads the last persisted plan without re-running.

---

## 5. Persistence: `StrategicPlanStore`

### 5.1 Storage format

Append-only JSONL at `.alix/planning/strategic-plans.jsonl`. Each line is one `StrategicPlan` JSON object.

Same pattern as `RootCauseStore` (P11.2):
- `save(plan)` — append line to JSONL
- `loadLatest()` — read last line, parse, return
- `loadById(id)` — scan for matching ID
- `list()` — return `StrategicPlanSummary[]` metadata for all plans

### 5.2 Validation on load

- Parse JSON
- Verify `schemaVersion === "p11.3.0"`
- Verify `objectives` is an array
- Verify each objective has a valid `targetSubsystem`
- Validate field-level constraints:
  - `urgencyScore` is integer 0–100
  - `confidence` is `null` or number 0–1
  - `estimatedEffort` is one of `"low"`, `"medium"`, `"high"`
  - `expectedImpact` is one of `"direct"`, `"indirect"`, `"compound"`
  - `prerequisites` entries reference `id` values that exist in the same plan's `objectives[]`
  - `rootCauseAnalysisId` is non-empty string
  - `correlationGraphId` is non-empty string
- Throw `PlanningEngineError` on invalid data (fail-closed)

---

## 6. CLI: `alix executive strategic-plan`

### 6.1 Command structure

```
alix executive strategic-plan [--json] [--latest]
```

`strategic-plan` is a single hyphenated subcommand (distinct from P10.3's existing `plan` subcommand which handles execution plan lifecycle).

### 6.2 Modes

| Flag | Behavior |
|---|---|
| (no flags) | Run planning engine (load analysis → plan → save → print summary) |
| `--json` | Run planning engine, save, print full JSON plan |
| `--latest` | Load last saved plan without re-running, print summary |
| `--latest --json` | Load last saved plan, print full JSON |

### 6.3 Summary output

```
Strategic Plan
Status: ok
Generated: 2026-07-03T12:00:00.000Z
Root cause analysis: <analysisId>
Objectives: 3 prioritized

  # | subsystem | urgency | effort   | impact    | top cause
  1 | memory    | 82      | high     | compound  | (root cause)
  2 | workflow  | 64      | medium   | indirect  | memory
  3 | tools     | 31      | low      | direct    | (none)
```

### 6.4 Error handling

- `PlanningEngineError` → print error message, exit 1
- No root cause analysis → print "Run 'alix executive reason' first.", exit 1
- Corrupted JSONL → print error, exit 1

### 6.5 Registration

Add `case "strategic-plan"` to `src/cli/commands/executive.ts` with dynamic import pattern:

```typescript
case "strategic-plan": {
  const { handleStrategicPlanCommand } = await import(
    "./executive-strategic-plan-handler.js"
  );
  return handleStrategicPlanCommand(rest);
}
```

Update the `default` case's available subcommands list.

---

## 7. Test Plan

### 7.1 Pure function tests (`build-strategic-plan.vitest.ts` — 10 tests)

| # | Test | Verifies |
|---|---|---|
| T1 | Returns objectives for analysis with degraded subsystems | Happy path — objectives match findings |
| T2 | Priorities degraded subsystems by urgency score | Sorting correctness |
| T3 | Causal dependency creates prerequisites | Objective pulling from dependent finding |
| T4 | No degradation returns `no_degradation` status | Input validation |
| T5 | `insufficient_history` returns `insufficient_analysis` | Input validation |
| T6 | Findings with no causes get low urgency and no prerequisites | No-cause handling |
| T7 | Max objectives cap is respected | Output bound |
| T8 | Min urgency score filter works | Threshold filter |
| T9 | StrategicImpact classification (direct/indirect/compound) | All three values reachable and testable |
| T10 | Effort estimation per mechanism | Default effort mapping |

### 7.2 Engine tests (`strategic-planning-engine.vitest.ts` — 3 tests)

| # | Test | Verifies |
|---|---|---|
| T11 | Returns plan when analysis exists | Happy path |
| T12 | Throws when no analysis exists | Error handling |
| T13 | loadLatest returns null when no plans exist | Empty state |

### 7.3 Store tests (`strategic-plan-store.vitest.ts` — 4 tests)

| # | Test | Verifies |
|---|---|---|
| T14 | Save + loadLatest round-trips correctly | Persistence |
| T15 | loadLatest returns last saved plan | JSONL ordering |
| T16 | Throws on invalid schema version | Validation |
| T17 | Returns null when file does not exist | Empty state |

### 7.4 CLI handler test (`executive-strategic-plan-handler.vitest.ts` — 2 tests)

| # | Test | Verifies |
|---|---|---|
| T18 | `--latest` without saved plan prints message | Graceful fallback |
| T19 | Default mode runs engine and prints summary | Integration |

---

## 8. Non-Goals

- **Remediation execution**: P11.3 produces an advisory plan only. Execution is P10.4 / P9.
- **LLM-based planning**: P11.3 is fully deterministic. No LLM or probabilistic inference is used.
- **Replacement of P10.3**: P10.3 Execution Planning (breakdown into executable steps) is a separate concern that operates downstream of P11.3's strategic prioritization.
- **Feedback incorporation**: Outcome-aware priority adjustment is P11.4 (Learning Engine).
- **Multi-graph trend analysis**: P11.3 operates on the latest RootCauseAnalysis only.
- **Resource allocation**: P11.3 does not model developer capacity or time constraints.
- **What-if simulation**: Forecasting alternate intervention outcomes is P11.5.
- **Real-time planning**: On-demand only (`alix executive strategic-plan`). No watch mode.
- **Cross-plan comparison**: Historical plan comparison is a future concern beyond P11.3.

---

## 9. File Map

| File | Purpose |
|---|---|
| `src/planning/planning-types.ts` | Type definitions: `StrategicPlan`, `PlanningObjective`, `EffortEstimate`, `StrategicImpact`, `PlanStatus`, `PlanningEngineConfig`, `StrategicPlanSummary`, `PlanningEngineError` |
| `src/planning/planning-config.ts` | Default config export |
| `src/planning/build-strategic-plan.ts` | Pure function `buildStrategicPlan(analysis, config) → StrategicPlan` |
| `src/planning/strategic-plan-store.ts` | Append-only JSONL store with `save`, `loadLatest`, `loadById`, `list` |
| `src/planning/planning-engine.ts` | Orchestrator: loads analysis → calls pure function → saves |
| `src/cli/commands/executive-strategic-plan-handler.ts` | CLI handler for `alix executive strategic-plan` |
| `tests/planning/build-strategic-plan.vitest.ts` | 10 pure function tests |
| `tests/planning/planning-engine.vitest.ts` | 3 engine tests |
| `tests/planning/strategic-plan-store.vitest.ts` | 4 store tests |
| `tests/planning/executive-strategic-plan-handler.vitest.ts` | 2 CLI tests |
