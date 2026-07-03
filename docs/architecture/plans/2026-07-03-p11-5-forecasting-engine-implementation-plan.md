# P11.5 — Forecasting Engine Implementation Plan

> **Status:** Draft
> **Phase:** P11.5
> **Depends on:** P11.3 (StrategicPlan, StrategicPlanStore), P11.4 (UpdatedConfidenceModel, ConfidenceModelStore, ScoreSnapshotProvider)
> **Total tasks:** 8
> **Total tests:** 19

---

## Task 1 — Types and config

**Files:** `src/forecasting/forecasting-types.ts`, `src/forecasting/forecasting-config.ts`, `src/forecasting/score-snapshot-adapter.ts`

### Steps

1. Create `src/forecasting/forecasting-types.ts` with:
   - `ScoreProjection` interface:
     - `targetSubsystem: CorrelationSubsystemId`
     - `currentScore: number`
     - `hasActiveObjective: boolean`
     - `projectedScores: number[]` — index 0 = W1 (next window)
     - `lowerBound: number[]` — aligned with projectedScores
     - `upperBound: number[]` — aligned with projectedScores
     - `forecastConfidence: number` — within [0, 1]
     - `observedDeltaPerWindow: number`
     - `observationCount: number`
   - `HealthForecast` interface:
     - `schemaVersion: "p11.5.0"`
     - `forecastId: string` — `forecast-{safeTimestamp}`
     - `generatedAt: string`
     - `sourceConfidenceModelId: string | null`
     - `sourcePlanId: string`
     - `rootCauseAnalysisId: string`
     - `correlationGraphId: string`
     - `projections: ScoreProjection[]`
     - `forecastWindows: number`
     - `windowDurationMs: number`
     - `meta`: `{ subsystemsForecast, highConfidenceForecasts, mediumConfidenceForecasts, lowConfidenceForecasts, trendWindow }`
   - `ForecastingEngineConfig` interface:
     - `forecastWindows: number` — default 3, validated [1, 3] (throws ForecasterError on invalid)
     - `trendWindow: number` — default 5, must be >= 2
     - `dampeningFactor: number` — default 0.3, validated [0, 1] (throws ForecasterError on invalid)
     - `windowDurationMs: number` — default 604800000 (7 days)
     - `highConfidenceThreshold: number` — default 0.7
     - `mediumConfidenceThreshold: number` — default 0.4
   - `ForecastingObservationContext` interface:
     - `generatedAt: string`
   - `HealthForecastSummary` interface:
     - `forecastId, generatedAt, sourcePlanId`
     - `sourceConfidenceModelId: string | null`
     - `subsystemsForecast, highConfidenceForecasts, mediumConfidenceForecasts, lowConfidenceForecasts, forecastWindows`
   - `ForecasterError` class (extends Error, code `"FORECASTER_ERROR"`)

2. Create `src/forecasting/score-snapshot-adapter.ts` with a simple v1 adapter implementing `ScoreSnapshotProvider`:
   - `loadScoresAt(timestamp)` — loads a snapshot from the existing baseline/trend data; returns empty Map when no data is available
   - `loadCurrentScores()` — wraps existing P10.10 baseline providers or returns empty Map (stub for v1, same pattern as P11.4)
   - The adapter is a thin wrapper to keep the engine testable; real score history integration is deferred

3. Create `src/forecasting/forecasting-config.ts` with `DEFAULT_FORECASTING_CONFIG` export

### Key design decisions

- `sourceConfidenceModelId` is `string | null` — null when no confidence model exists or model/plan mismatch
- `projectedScores`, `lowerBound`, `upperBound` are always same-length arrays (1 entry per forward window)
- Empty `projections[]` is valid (no subsystems available for forecasting)

### Verification

- `npm run typecheck` passes
- Confirm types importable and self-consistent

---

## Task 2 — Pure function: `buildHealthForecast()`

**File:** `src/forecasting/build-health-forecast.ts`

### Steps

1. Implement:
```typescript
function buildHealthForecast(
  plan: StrategicPlan,
  confidenceModel: UpdatedConfidenceModel | null,
  scoreHistory: Map<CorrelationSubsystemId, number[]>,
  currentScores: Map<CorrelationSubsystemId, number>,
  context: ForecastingObservationContext,
  config: ForecastingEngineConfig,
): HealthForecast
```

2. Input validation:
   - `plan.schemaVersion === "p11.3.0"`
   - `plan.planId` and `plan.generatedAt` non-empty
   - `context.generatedAt` valid ISO 8601 timestamp (parses to valid Date) — ensures stable `forecastId` generation
   - Validate config bounds: `forecastWindows` [1,3], `trendWindow >= 2`, `dampeningFactor` [0,1], `windowDurationMs > 0`, thresholds valid
   - Handle confidence model mismatch with `effectiveConfidenceModel`:
```typescript
const effectiveConfidenceModel =
  confidenceModel?.sourcePlanId === plan.planId ? confidenceModel : null;
```
   - All downstream steps (collecting subsystems, looking up confidence values) use `effectiveConfidenceModel`, never the raw input

3. Algorithm (4 steps from the spec):
   - **Step 1 — Collect subsystems**: Deduplicate from plan objectives, confidence model updates, and current scores. For each, resolve current score using fallback chain: `currentScores → scoreHistory last → active plan objective.currentScore → skip`.
   - **Step 2 — Compute trend**: Slice raw history to last `config.trendWindow` entries. Average delta per window. Flat projection if < 2 data points.
   - **Step 3 — Determine forecast confidence**: Average `resultingConfidence` across all matching confidence model updates for the subsystem. Default 0.5 if none.
   - **Step 4 — Project scores with dampening**: Project each forward window with mean-reverting dampening toward 80. Clamp to [0, 100].
   - **Step 5 — Confidence intervals**: Spread = `(1 - forecastConfidence) * 15`, grows by `w * 0.2` per window. Clamp bounds to [0, 100].
   - **Step 6 — Build meta**: High/medium/low confidence counts, remaining metadata. Return `HealthForecast`.

4. Helpers:
   - `sanitizeTimestamp(iso: string): string` — same pattern as P11.3/P11.4
   - `clamp(value, min, max)` — shared pattern
   - `roundTo3(value)` — 3 decimal rounding

### Key design decisions

- Pure function — no I/O, no `Date.now()`, no `Math.random()`. All timestamps from `context`.
- `dampeningFactor` applied as: `projected = base * (1 - dampening * w / N) + meanScore * (dampening * w / N)`
- Mean score defaults to 80 (healthy baseline)
- Confidence intervals grow with each forward window (`w * 0.2`)

### Verification

- `npm run typecheck` passes
- All 10 pure function tests pass

---

## Task 3 — Store: `HealthForecastStore`

**File:** `src/forecasting/health-forecast-store.ts`

### Steps

1. Implement `HealthForecastStore` class (same JSONL pattern as `ConfidenceModelStore`):
   - `constructor(dir: string)` — `.alix/forecasting` as default
   - `save(forecast)` — validate, append to `health-forecasts.jsonl`
   - `loadLatest()` — read last line, parse, validate
   - `loadById(id)` — scan for matching `forecastId`
   - `list()` — return `HealthForecastSummary[]`

2. Validation (fail-closed with `ForecasterError`):
   - `schemaVersion === "p11.5.0"`
   - `forecastId`, `sourcePlanId`, `rootCauseAnalysisId`, `correlationGraphId` non-empty strings
   - `sourceConfidenceModelId` non-null → must be non-empty string; null allowed
   - `generatedAt` valid ISO 8601 timestamp
   - `projections` is an array (empty is valid)
   - Each `ScoreProjection`:
     - `targetSubsystem` valid `CorrelationSubsystemId` (one of the 8 subsystem names)
     - `projectedScores`, `lowerBound`, `upperBound` arrays with same length
     - Score values within [0, 100]
     - `forecastConfidence` within [0, 1]
     - `observationCount >= 0`
     - `currentScore` within [0, 100]
     - `observedDeltaPerWindow` is finite
     - `hasActiveObjective` is boolean
     - `lowerBound.length === forecastWindows`
     - `upperBound.length === forecastWindows`
   - `forecastWindows > 0` and <= 3
   - Cross-field: `projectedScores.length === forecastWindows`

### Verification

- `npm run typecheck` passes
- All 4 store tests pass

---

## Task 4 — Engine orchestrator: `ForecastingEngine`

**File:** `src/forecasting/forecasting-engine.ts`

### Steps

1. Implement `ForecastingEngine` class:
   - Constructor: `strategicPlanStore`, `confidenceModelStore`, `healthForecastStore`, `scoreSnapshotProvider`, `config`
   - `run()`:
     - Load latest `StrategicPlan` — throw `ForecasterError` if null
     - Load latest `UpdatedConfidenceModel` — null is valid (optional)
     - Load current scores via `scoreSnapshotProvider.loadCurrentScores()`
     - Load historical scores: iterate `i = trendWindow - 1` down to `0`, computing each snapshot timestamp as `generatedAt - i * windowDurationMs`, calling `loadScoresAt(timestamp)` for each. Then build each subsystem's score array in chronological order (oldest → newest, matching the iteration order from `i = trendWindow - 1` down to `0`).
     - Build `ForecastingObservationContext`
     - Call pure `buildHealthForecast()`
     - Save via `healthForecastStore.save(forecast)`
     - Return forecast
   - `loadLatestForecast()` — delegate to store

### Verification

- `npm run typecheck` passes
- All 3 engine tests pass

---

## Task 5 — CLI handler

**File:** `src/cli/commands/executive-forecast-handler.ts`

### Steps

1. Implement `handleForecastCommand(args: string[])`:
   - Parse `--json`, `--latest` flags
   - `--latest` mode: load last saved forecast, print summary or JSON
   - Default mode: construct stores at `.alix/forecasting`, `.alix/planning`, `.alix/learning`, and `ScoreSnapshotProvider`, run engine, save, print summary
   - Error handling: `ForecasterError` → structured error, generic catch-all

2. `printForecastSummary(forecast, isJson)` function:
   - JSON mode: full JSON dump
   - Summary mode: table with subsystem, current, dynamic `W1` through `W{forecastWindows}`, confidence. Column count adapts to the forecast window count — a 1-window forecast shows `W1`, a 3-window forecast shows `W1 / W2 / W3`.

3. Register in `executive.ts`:
   - Add `case "forecast":` with dynamic import
   - Add "forecast" to default-case available subcommands list

### Verification

- `npm run typecheck` passes
- CLI smoke test: `npx tsx src/cli/alix.ts executive forecast --latest` prints helpful message
- `npx tsx src/cli/alix.ts executive forecast --json --latest` outputs JSON

---

## Task 6 — Pure function tests (10 tests)

**File:** `tests/forecasting/build-health-forecast.vitest.ts`

| # | Test | Input | Expected |
|---|---|---|---|
| T1 | Forecast with trend and confidence model | 3 subsystems, 5 history points, confidence 0.8 | Projected scores trending, narrow intervals |
| T2 | Forecast with null confidence model | model=null | Default 0.5 confidence, wider intervals |
| T3 | No score history | empty history | Flat projection at current score |
| T4 | Single history data point | 1 history entry | Treated as no trend, flat projection |
| T5 | Intervals widen with distance | confidence=0.5 | W1 spread < W2 spread < W3 spread |
| T6 | Intervals narrow with high confidence | confidence=0.95 | Narrower than low confidence |
| T7 | No subsystems found | empty plan, null model, empty scores | Empty projections, subsystemsForecast=0 |
| T8 | Scores clamped to [0, 100] | extreme deltas | All projected scores within bounds |
| T9 | Dampening mean-reverts | long horizon | Projection trends toward 80 |
| T10 | Confidence classification counts | 3 projections at 0.8, 0.55, 0.3 | 1 high, 1 medium, 1 low |

### Helper factories

- `makePlan(objectives)` — minimum StrategicPlan
- `makeConfidenceModel(updates)` — minimum UpdatedConfidenceModel
- `makeProjection(subsystem, scores, bounds?)` — convenience

---

## Task 7 — Store, engine, and CLI tests (9 tests)

**Files:** `tests/forecasting/health-forecast-store.vitest.ts` (4), `tests/forecasting/forecasting-engine.vitest.ts` (3), `tests/forecasting/executive-forecast-handler.vitest.ts` (2)

### HealthForecastStore tests

| # | Test | Expected |
|---|---|---|
| T11 | Save + loadLatest round-trip | Same forecast returned |
| T12 | loadLatest returns last of two saves | Second save returned |
| T13 | loadLatest from non-existent file | null |
| T14 | Invalid schema version throws | ForecasterError |

### ForecastingEngine tests

| # | Test | Expected |
|---|---|---|
| T15 | run returns forecast when plan exists | Forecast with projections |
| T16 | run throws when no plan exists | ForecasterError |
| T17 | loadLatestForecast returns null when empty | null |

### CLI handler tests

| # | Test | Expected |
|---|---|---|
| T18 | `--latest` without saved forecast prints message | Helpful message, no crash |
| T19 | Default mode without plan prints error | Error with guidance |

---

## Task 8 — Final full-gate verification

After all tasks complete:

```bash
npm run typecheck
npx vitest run tests/forecasting/
npx vitest run
npm run build
```

Expected: typecheck clean, 19 tests passing across `tests/forecasting/`, full suite green, build clean.

---

## Execution Order

```
Task 1 (types + config)
  ├── Task 2 (pure function)
  ├── Task 3 (store)
  │      └── Task 4 (orchestrator)
  │             └── Task 5 (CLI handler)
  ├── Task 6 (pure function tests — 10 tests)
  ├── Task 7 (store + engine + CLI tests — 9 tests)
  └── Task 8 (final full-gate verification)
```

Tasks 2 and 3 are independent after Task 1. Task 4 depends on both. Write pure function tests (T1-T10) immediately after Task 2 to catch projection and boundary bugs early. Tasks 7 is the final verification layer.

After all tasks: typecheck clean, 19 tests passing, full suite green, build clean, CLI smoke clean.
