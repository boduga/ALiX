# P11.4 — Learning Engine Implementation Plan

> **Status:** Draft
> **Phase:** P11.4
> **Depends on:** P11.3 (StrategicPlan, StrategicPlanStore, StrategicPlan type), P10 baseline providers or score snapshot adapter
> **Total tasks:** 8
> **Total tests:** 21

---

## Task 1 — Types and config

**Files:** `src/learning/learning-types.ts`, `src/learning/learning-config.ts`

### Steps

1. Create `src/learning/learning-types.ts` with:
   - `LearningSignal` type union: `"score_improvement" | "no_action_improvement" | "completed_no_improvement" | "deferred_recurrence"`
   - `ConfidenceUpdate` interface with fields:
     - `targetSubsystem: CorrelationSubsystemId`
     - `mechanism: CausalMechanism | null`
     - `signal: LearningSignal`
     - `scoreDelta: number`
     - `completed: boolean`
     - `urgencyScoreAtPlanning: number`
     - `adjustment: number` — within `[-0.05, 0.05]`
     - `resultingConfidence: number` — within `[0.05, 0.95]`
     - `sourceObjectiveId: string`
     - `sourcePlanId: string`
     - `observedAt: string` — ISO timestamp
   - `UpdatedConfidenceModel` interface:
     - `schemaVersion: "p11.4.0"`
     - `modelId: string` — `lrn-{safeTimestamp}`
     - `generatedAt: string`
     - `sourcePlanId: string`
     - `rootCauseAnalysisId: string` — propagated from StrategicPlan
     - `correlationGraphId: string` — propagated from StrategicPlan
     - `updates: ConfidenceUpdate[]`
     - `meta`: `{ primarySignal, secondarySignal, recurrenceLearningEnabled, objectivesEvaluated, objectivesWithSignals, objectivesSkipped, objectivesWithoutSignal, baselineTimestamp, evaluationTimestamp }`
     - `summary`: `{ positiveUpdates, negativeUpdates, zeroAdjustmentUpdates, averageAdjustment }`
     - `mechanismAdjustments: Array<{ mechanism: CausalMechanism; samples: number; averageAdjustment: number }>`
   - `LearningOutcomeRecord` interface:
     - `sourceObjectiveId?: string`
     - `sourcePlanId?: string`
     - `targetSubsystem?: CorrelationSubsystemId`
     - `completed: boolean`
     - `completedAt?: string`
     - `status?: "completed" | "abandoned" | "failed" | "unknown"`
   - `LearningObservationContext` interface:
     - `generatedAt: string`
     - `baselineTimestamp: string`
     - `evaluationTimestamp: string`
   - `LearningEngineConfig` interface:
     - `maxPositiveAdjustment: number` — default 0.05
     - `maxNegativeAdjustment: number` — default 0.05
     - `minConfidence: number` — default 0.05
     - `maxConfidence: number` — default 0.95
     - `minImprovementDelta: number` — default 5
     - `evaluationWindowMs: number` — default `7 * 24 * 60 * 60 * 1000`
   - `ConfidenceModelSummary` interface:
     - `modelId, generatedAt, sourcePlanId`
     - `objectivesEvaluated, objectivesWithSignals, objectivesSkipped, objectivesWithoutSignal`
     - `updates, positiveUpdates, negativeUpdates, zeroAdjustmentUpdates`
   - `LearningOutcomeStore` interface:
     - `list(): Promise<LearningOutcomeRecord[]>`
   - `ScoreSnapshotProvider` interface:
     - `loadScoresAt(timestamp: string): Promise<Map<CorrelationSubsystemId, number>>`
     - `loadCurrentScores(): Promise<Map<CorrelationSubsystemId, number>>`
   - `LearningEngineError` class (extends Error, code `"LEARNING_ENGINE_ERROR"`)

2. Create `src/learning/learning-config.ts` with:
   - `DEFAULT_LEARNING_CONFIG` export — all defaults as specified above

### Key design decisions

- Imports `CorrelationSubsystemId` from `"../correlation/correlation-types.js"` and `CausalMechanism` from `"../reasoning/reasoning-types.js"` for type alignment with P11.1–P11.3
- `deferred_recurrence` is in the union but v1 never emits it (enforced by `recurrenceLearningEnabled === false` guard)
- `adjustment` is the per-cycle delta, `resultingConfidence` is the resulting value — both bounded
- `objectivesWithoutSignal` is distinct from `objectivesSkipped`: skipped = missing data, withoutSignal = evaluated but no learnable outcome

### Verification

- `npm run typecheck` passes
- Confirm types are importable and self-consistent

---

## Task 2 — Pure function: `buildConfidenceModel()`

**File:** `src/learning/build-confidence-model.ts`

### Steps

1. Implement `buildConfidenceModel(plan: StrategicPlan, outcomes: LearningOutcomeRecord[], baselineScores: Map<CorrelationSubsystemId, number>, currentScores: Map<CorrelationSubsystemId, number>, context: LearningObservationContext, config: LearningEngineConfig): UpdatedConfidenceModel`

2. Logic (7 steps from the spec):
   - **Step 1 — Input validation**:
     - Validate plan has `schemaVersion === "p11.3.0"`, non-empty `planId`, non-empty `generatedAt`
     - Validate timestamp ordering: `context.baselineTimestamp <= context.evaluationTimestamp`, `context.generatedAt <= context.evaluationTimestamp`
     - Empty plan → return model with all-zero meta counters and empty `updates[]`
   - **Step 2 — Match objectives to outcomes**:
     - Filter out outcomes with mismatched `sourcePlanId` (if present)
     - Exact `sourceObjectiveId` match (latest `completedAt` wins if duplicates)
     - Fallback by `targetSubsystem` only when exactly one plan objective targets that subsystem
     - No match → treat as incomplete
   - **Step 3 — Compute score deltas**:
     - `baselineScore = baselineScores.get(target) ?? objective.currentScore`
     - If `currentScores` has no entry for target: **skip** (increment `skippedCount`, no update)
     - `scoreDelta`, `improved = scoreDelta >= minImprovementDelta`
   - **Step 4 — Classify learning signal** using the 4-case matrix (v1 never emits `deferred_recurrence`)
   - **Step 5 — Compute adjustment** per the learning rules:
     - `score_improvement`: `+maxPositiveAdjustment * min(scoreDelta / 10, 1)`
     - `completed_no_improvement`: `-maxNegativeAdjustment`
     - `no_action_improvement`: `0` (audit-only)
     - No signal: no update emitted
   - **Step 6 — Apply confidence bounds**:
     - If `objective.confidence === null`: skip (increment `skippedCount`)
     - `resultingConfidence = clamp(originalConfidence + adjustment, minConfidence, maxConfidence)`
   - **Step 7 — Assemble**:
     - Compute `summary` rollup (positive/negative/zero counts, averageAdjustment)
     - Compute `mechanismAdjustments` per-mechanism rollup
     - Build `meta` with all four evaluation counters
     - Return `UpdatedConfidenceModel` with propagated `rootCauseAnalysisId` and `correlationGraphId`

3. Helpers:
   - `sanitizeTimestamp(iso: string): string` — reused pattern from P11.3
   - `clamp(value: number, min: number, max: number): number`
   - `roundTo3(value: number): number` — round to 3 decimal places

### Key design decisions

- Pure function — no I/O, no `Date.now()`, no `Math.random()`. All timestamps come from `context`.
- Missing current score → skip, never treat as "no improvement" (avoids penalizing completed objectives with missing data)
- `confidence: null` → skip update (no confidence to adjust), still counted in `objectivesEvaluated`
- `skippedCount` accumulator tracks objectives skipped in Step 3 (missing score) and Step 6 (confidence null)
- `objectivesWithoutSignal = plan.objectives.length - updates.length - skippedCount`

### Verification

- `npm run typecheck` passes
- All 12 pure function tests pass

---

## Task 3 — Store: `ConfidenceModelStore`

**File:** `src/learning/confidence-model-store.ts`

### Steps

1. Implement `ConfidenceModelStore` class:
   - `constructor(dir: string)` — `.alix/learning` as default
   - `save(model: UpdatedConfidenceModel): Promise<void>` — append JSON line to `confidence-models.jsonl`
   - `loadLatest(): Promise<UpdatedConfidenceModel | null>` — read last line from JSONL
   - `loadById(id: string): Promise<UpdatedConfidenceModel | null>` — scan for matching ID
   - `list(): Promise<ConfidenceModelSummary[]>` — return metadata for all models

2. Validation on load:
   - Parse JSON
   - Verify `schemaVersion === "p11.4.0"`
   - Verify `modelId`, `sourcePlanId`, `rootCauseAnalysisId`, `correlationGraphId` are non-empty strings
   - Verify `generatedAt`, `meta.baselineTimestamp`, `meta.evaluationTimestamp` are valid ISO 8601
   - Verify `updates` is an array
   - Per update: `targetSubsystem` valid, `sourceObjectiveId` non-empty, `sourcePlanId` non-empty, `observedAt` valid ISO 8601, `signal` valid `LearningSignal`, `adjustment` within `[-0.05, 0.05]`, `resultingConfidence` within `[0.05, 0.95]`
   - Verify `meta.recurrenceLearningEnabled === false` and no update uses `"deferred_recurrence"`
   - Cross-field: every `update.sourcePlanId === model.sourcePlanId`, summary counts match `updates.length`, `meta.objectivesWithSignals === updates.length`, `meta.objectivesEvaluated >= objectivesWithSignals + objectivesSkipped`, all numeric values finite
   - File reading filters blank lines: `lines = raw.split("\n").filter(line => line.trim().length > 0)`
   - Throw `LearningEngineError` on invalid data (fail-closed)

### Verification

- `npm run typecheck` passes
- All 4 store tests pass

---

## Task 4 — Engine orchestrator: `LearningEngine`

**File:** `src/learning/learning-engine.ts`

### Steps

1. Implement `LearningEngine` class:
   - `constructor(strategicPlanStore, confidenceModelStore, outcomeStore: LearningOutcomeStore, scoreSnapshotProvider: ScoreSnapshotProvider, config?)`
   - `run(): Promise<UpdatedConfidenceModel>`:
     - Load latest `StrategicPlan`
     - If null → throw `LearningEngineError`
     - If zero objectives → return model with all-zero counters
     - Load outcome records via `outcomeStore.list()`
     - Load baseline scores at `plan.generatedAt` via `scoreSnapshotProvider.loadScoresAt(plan.generatedAt)`
     - Load current scores via `scoreSnapshotProvider.loadCurrentScores()`
     - Build `context: LearningObservationContext`
     - Call `buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config)`
     - Save model
     - Return model
   - `loadLatestModel(): Promise<UpdatedConfidenceModel | null>` — delegate to store

2. Test with mock `StrategicPlanStore`, `LearningOutcomeStore`, and `ScoreSnapshotProvider`

### Verification

- `npm run typecheck` passes
- All 3 engine tests pass

---

## Task 5 — CLI handler

**File:** `src/cli/commands/executive-learn-handler.ts`

### Steps

1. Implement `handleLearnCommand(args: string[])`:
   - Parse `--json`, `--latest` flags
   - `--latest` mode: load latest confidence model, print summary or JSON
   - Default mode: construct store adapters at `.alix/learning`, `.alix/planning`, and `ScoreSnapshotProvider` (wrapping P10.10 baseline providers or in-memory snapshot), then engine with `DEFAULT_LEARNING_CONFIG`, run, save, print summary
   - Error handling: `LearningEngineError` for structured errors, generic catch-all

2. `printConfidenceModelSummary(model, isJson)` function:
   - JSON mode: full JSON dump
   - Summary mode: table format with columns for target subsystem, score delta, completed, signal, adjustment

3. Register in `src/cli/commands/executive.ts`:
   - Add `case "learn":` with dynamic import
   - Add "learn" to the default-case available subcommands list

### Verification

- `npm run typecheck` passes
- CLI smoke test: `npx tsx src/cli/alix.ts executive learn --latest` prints helpful message
- `npx tsx src/cli/alix.ts executive learn --json --latest` outputs JSON (or error about no data)

---

## Task 6 — Pure function tests (12 tests)

**File:** `tests/learning/build-confidence-model.vitest.ts`

### Test cases

| # | Test | Input | Expected |
|---|---|---|---|
| T1 | Completed + score improved | objective completed, Δ=+8 | signal=`score_improvement`, adjustment=`+0.04` |
| T2 | Completed + no improvement | objective completed, Δ=0 | signal=`completed_no_improvement`, adjustment=`-0.05` |
| T3 | Not completed + score improved | not completed, Δ=+12 | signal=`no_action_improvement`, adjustment=`0` (audit) |
| T4 | Not completed + no improvement | not completed, Δ=0 | No update emitted |
| T5 | Completed + degraded (Δ negative) | completed, Δ=-5 | signal=`completed_no_improvement`, adjustment=`-0.05` |
| T6 | Objective with confidence:null | confidence=null, completed, Δ=+8 | No update, counted in skippedCount |
| T7 | Adjustment clamped at boundary | Δ=+20 (would give +0.10) | adjustment=`+0.05` (max) |
| T8 | Resulting confidence clamped | base=0.03, adj=+0.04 (would give 0.07) | `resultingConfidence=0.07` (within bounds) |
| T9 | Empty plan | zero objectives | All-zero meta, empty updates |
| T10 | No outcome records | all incomplete defaults | No completions, all evaluated |
| T11 | Score delta at threshold | Δ=5 exactly | improved=true (>= threshold) |
| T12 | Multiple objectives | 3 objectives, mixed outcomes | Ordered updates, correct counters |

### Helper utilities

- `makePlan(objectives)` — build a minimal `StrategicPlan` with specified objectives
- `makeObjective(subsystem, score, confidence?, mechanism?)` — convenience factory
- `makeOutcome(objectiveId, completed, scoreDelta?)` — convenience factory
- `makeContext()` — build a deterministic `LearningObservationContext`

---

## Task 7 — Store and engine tests (7 tests)

**Files:** `tests/learning/confidence-model-store.vitest.ts` (4 tests), `tests/learning/learning-engine.vitest.ts` (3 tests)

### ConfidenceModelStore tests

| # | Test | Expected |
|---|---|---|
| T13 | save + loadLatest round-trip | Returns same model |
| T14 | loadLatest returns last of two saves | Returns second save |
| T15 | loadLatest from non-existent file | Returns null |
| T16 | Invalid schema version throws | LearningEngineError |

### LearningEngine tests

| # | Test | Expected |
|---|---|---|
| T17 | run returns model when plan and outcomes exist | Model with correct updates |
| T18 | run throws when no plan exists | LearningEngineError |
| T19 | loadLatestModel returns null when empty | null |

---

## Task 8 — CLI handler test (2 tests)

**File:** `tests/learning/executive-learn-handler.vitest.ts`

| # | Test | Expected |
|---|---|---|
| T20 | `--latest` without saved model prints message | Prints helpful message, no crash |
| T21 | Default mode runs and prints summary | Prints model summary |

---

## Execution Order

```
Task 1 (types + config)
  ├── Task 2 (pure function)
  ├── Task 3 (store)
  │      └── Task 4 (orchestrator)
  │             └── Task 5 (CLI handler)
  ├── Task 6 (pure function tests — 12 tests)
  ├── Task 7 (store + engine tests — 7 tests)
  └── Task 8 (CLI handler tests — 2 tests)
```

Tasks 2 and 3 are independent after Task 1. Task 4 depends on both. Write pure function tests (T1-T12) immediately after Task 2 to catch scoring and adjustment bugs early. Tasks 7-8 are the final verification layer.

After all tasks:
```bash
npm run typecheck
npx vitest run tests/learning/ 2>&1 | tail -10
npx vitest run
npm run build
```

Expected: typecheck clean, 21 tests passing across `tests/learning/`, full suite (2540+) green, build clean.

---
