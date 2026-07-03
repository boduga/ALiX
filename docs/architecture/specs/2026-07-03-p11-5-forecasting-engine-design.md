# P11.5 — Forecasting Engine Design Spec

> **Status:** Draft — review corrections pending  
> **Phase:** P11.5  
> **Consumes:** `UpdatedConfidenceModel` (P11.4), `StrategicPlan` (P11.3), historical subsystem score snapshots  
> **Produces:** `HealthForecast`  
> **Forecast horizon:** 1–3 windows out  
> **Determinism:** Fully deterministic. No LLM, no probabilistic inference.

---

## 1. Context

P11.4 Learning Engine produces an `UpdatedConfidenceModel` — per-subsystem, per-mechanism confidence adjustments based on observed score movement after strategic objectives are completed or left incomplete. It answers *"how reliable are our causal models?"* but does not project what will happen next.

P11.5 Forecasting Engine consumes the `UpdatedConfidenceModel` plus historical score data and the current `StrategicPlan`, and produces a `HealthForecast` — per-subsystem projected health scores over a configurable forward window (1–3 windows), with confidence intervals shaped by the confidence model.

### Pipeline position

```
StrategicPlan (P11.3) ──────────┐
                                ▼
UpdatedConfidenceModel (P11.4) ──► Forecasting Engine (P11.5)
                                │
                                ▼
Score Snapshot History ────────┘    HealthForecast
                                        │
                                        ▼
                              Next planning cycle (P11.3)
                              (feed-forward for improved urgency)
```

### Stage boundary rule

P11.5's output `HealthForecast` is a typed, persisted, advisory artifact. It does not trigger any automated action, does not modify any prior P11 artifact, and does not self-correct its own projection model. The forecast feeds forward to the next planning cycle as an optional input for improved urgency scoring.

---

## 2. Forecast Model

### 2.1 Score projection method

For each subsystem, the forecast computes a projected score N windows out (v1 default: 3 windows) using:

1. **Baseline trajectory**: The average score delta per window over the last `trendWindow` windows of observed data.
2. **Confidence-adjusted spread**: The `UpdatedConfidenceModel` provides per-mechanism confidence values that widen or narrow the forecast interval.
   - Higher confidence → narrower forecast interval (more certain).
   - Lower confidence → wider forecast interval (less certain).
3. **Trajectory dampening**: Projections are mean-reverting — they trend toward the subsystem's historical mean score over long horizons to prevent unbounded divergence.

### 2.2 Forward window

The forecast horizon is configurable:
- Default: 3 windows forward
- Each window is `evaluationWindowMs` (from `LearningEngineConfig`, default 7 days)
- The forecast produces one projected score per window

---

## 3. Type Model

### 3.1 ScoreProjection

```typescript
export interface ScoreProjection {
  /** The subsystem being forecast. */
  targetSubsystem: CorrelationSubsystemId;
  /** Current health score at forecast time. */
  currentScore: number;
  /** Whether a planning objective targets this subsystem. */
  hasActiveObjective: boolean;
  /**
   * Projected score for each forward window.
   * Index 0 = next window (W1), 1 = second forward window (W2), etc.
   */
  projectedScores: number[];
  /**
   * Lower bound of the confidence interval per window.
   * Aligned with projectedScores: index 0 = W1 lower bound.
   */
  lowerBound: number[];
  /**
   * Upper bound of the confidence interval per window.
   * Aligned with projectedScores: index 0 = W1 upper bound.
   */
  upperBound: number[];
  /**
   * The confidence value used for this subsystem's forecast.
   * Derived from UpdatedConfidenceModel if available, else 0.5.
   */
  forecastConfidence: number;
  /**
   * Observed average score delta per window (used as trend basis).
   */
  observedDeltaPerWindow: number;
  /**
   * Number of historical data points used to compute the trend.
   */
  observationCount: number;
}
```

### 3.2 HealthForecast

```typescript
export interface HealthForecast {
  schemaVersion: "p11.5.0";
  /** Unique forecast ID, e.g. `forecast-{safeTimestamp}`. */
  forecastId: string;
  generatedAt: string;
  /** Links to the source confidence model that shaped this forecast. */
  sourceConfidenceModelId: string | null;
  /** Links to the source plan for traceability. */
  sourcePlanId: string;
  /** Propagated for P11 chain traceability. */
  rootCauseAnalysisId: string;
  /** Propagated for P11 chain traceability. */
  correlationGraphId: string;
  /** Per-subsystem projections, one entry per evaluated subsystem. */
  projections: ScoreProjection[];
  /**
   * Number of forward windows projected.
   * Default: 3
   */
  forecastWindows: number;
  /** Window duration in milliseconds (from LearningEngineConfig). */
  windowDurationMs: number;
  meta: {
    /** Number of subsystems with forecasts. */
    subsystemsForecast: number;
    /**
     * Number of subsystems whose forecast confidence is
     * "high" (>= 0.7), "medium" (>= 0.4), or "low" (< 0.4).
     */
    highConfidenceForecasts: number;
    mediumConfidenceForecasts: number;
    lowConfidenceForecasts: number;
    /** Number of historical windows used for trend computation. */
    trendWindow: number;
  };
}
```

### 3.3 ForecastingEngineConfig

```typescript
export interface ForecastingEngineConfig {
  /**
   * Number of forward windows to project.
   * Default: 3. Valid range: 1–3.
   */
  forecastWindows: number;
  /**
   * Number of historical windows to use for trend computation.
   * Default: 5. Must be >= 2.
   */
  trendWindow: number;
  /**
   * Dampening factor for long-horizon projections (0-1).
   * Higher = more mean reversion.
   * Default: 0.3
   */
  dampeningFactor: number;
  /**
   * Window duration in milliseconds.
   * Default: 7 days (604800000 ms).
   */
  windowDurationMs: number;
  /**
   * Confidence threshold for "high" classification.
   * Default: 0.7. Must be > mediumConfidenceThreshold.
   */
  highConfidenceThreshold: number;
  /**
   * Confidence threshold for "medium" classification.
   * Default: 0.4. Must be < highConfidenceThreshold.
   */
  mediumConfidenceThreshold: number;
}
```

Validated on use:
- `forecastWindows` clamped to [1, 3]
- `trendWindow >= 2`
- `dampeningFactor` clamped to [0, 1]
- `windowDurationMs > 0`
- `highConfidenceThreshold > mediumConfidenceThreshold`
- Both thresholds within [0, 1]

### 3.4 ForecasterError

```typescript
export class ForecasterError extends Error {
  readonly code = "FORECASTER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ForecasterError";
  }
}
```

---

## 4. Algorithm: `buildHealthForecast()`

### 4.1 Signature

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

Where `ForecastingObservationContext` provides deterministic timestamps:

```typescript
export interface ForecastingObservationContext {
  generatedAt: string;
}
```

### 4.2 Steps

**Step 1 — Collect subsystems to forecast**

Start with all subsystems that appear in:
- `plan.objectives[].targetSubsystem` (has active objective)
- `confidenceModel.updates[].targetSubsystem` (has confidence data)
- `currentScores` keys (has current score data)

Deduplicate to a unique set. For each subsystem, determine the current score:
- If `currentScores` has an entry: use it.
- If not, fall back to the last value in `scoreHistory` for that subsystem.
- If neither exists: **skip that subsystem** — no projection can start without a score origin.

If no subsystems remain after filtering: return a `HealthForecast` with empty `projections[]`.

**Step 2 — Compute trend per subsystem**

For each subsystem:
- Look up `scoreHistory.get(subsystem)`, which is an array of scores in chronological order (oldest first).
- Slice to the last `config.trendWindow` entries: `const history = rawHistory.slice(-config.trendWindow)` — this ensures a deterministic window regardless of how much history is available.
- If fewer than 2 data points exist in the sliced window: no trend can be computed. Set `observedDeltaPerWindow = 0` and `observationCount = history.length`.
- If 2+ data points exist: compute the average delta per window:
  - `totalDelta = lastScore - firstScore`
  - `observedDeltaPerWindow = totalDelta / (scoreHistory.length - 1)`
  - `observationCount = scoreHistory.length`

**Step 3 — Determine forecast confidence**

For each subsystem:
- Find all matching confidence values from `confidenceModel`:
  - Filter `confidenceModel.updates` for entries whose `targetSubsystem` matches.
  - If multiple updates exist for the same subsystem, compute the **average** `resultingConfidence` across all matching updates, rounded to 3 decimals. Averaging is preferred over "latest" because the forecast is subsystem-level (aggregate).
- If no matching confidence model entry exists: use a default confidence of `0.5`.

**Step 4 — Compute projected scores**

For each subsystem, for each forward window `w` (0-indexed, up to `config.forecastWindows`):
- `baseProjectedScore = currentScore + observedDeltaPerWindow * (w + 1)`
- Apply dampening: `projectedScore = baseProjectedScore * (1 - dampeningFactor * w / forecastWindows) + meanScore * (dampeningFactor * w / forecastWindows)`
  - Where `meanScore = 80` (default healthy baseline; can be derived from historical data).
- Clamp to `[0, 100]`.
- Store in `projectedScores[w]`.

**Step 5 — Compute confidence intervals**

For each subsystem:
- Spread factor: `spread = (1 - forecastConfidence) * 15` — lower confidence = wider spread.
- For each window `w`:
  - `lowerBound[w] = clamp(projectedScores[w] - spread * (1 + w * 0.2), 0, 100)`
  - `upperBound[w] = clamp(projectedScores[w] + spread * (1 + w * 0.2), 0, 100)`
- The spread grows with each forward window (`w * 0.2` factor), reflecting increasing uncertainty over time.

**Step 6 — Build meta and return**

```typescript
// Confidence classification
const highConf = projections.filter(p => p.forecastConfidence >= 0.7).length;
const medConf = projections.filter(p => p.forecastConfidence >= 0.4 && p.forecastConfidence < 0.7).length;
const lowConf = projections.filter(p => p.forecastConfidence < 0.4).length;

return {
  schemaVersion: "p11.5.0",
  forecastId: "forecast-" + sanitizeTimestamp(context.generatedAt),
  generatedAt: context.generatedAt,
  sourceConfidenceModelId: confidenceModel?.modelId ?? null,
  sourcePlanId: plan.planId,
  rootCauseAnalysisId: plan.rootCauseAnalysisId,
  correlationGraphId: plan.correlationGraphId,
  projections,
  forecastWindows: config.forecastWindows,
  windowDurationMs: config.windowDurationMs,
  meta: {
    subsystemsForecast: projections.length,
    highConfidenceForecasts: highConf,
    mediumConfidenceForecasts: medConf,
    lowConfidenceForecasts: lowConf,
    trendWindow: config.trendWindow,
  },
};
```

### 4.3 Confidence-model/plan mismatch

If the latest `UpdatedConfidenceModel` has a `sourcePlanId` that does not match the current plan's `planId`, ignore the confidence model entirely and forecast with default confidence `0.5`. This means:

```typescript
if (confidenceModel !== null && confidenceModel.sourcePlanId !== plan.planId) {
  confidenceModel = null; // treat as unavailable
}
```

This avoids failing forecasting just because the learning engine has not caught up to the latest plan. The forecast is still produced — it simply has wider confidence intervals.

### 4.4 Edge cases

- **Empty confidence model** (`null`): All forecasts use default confidence `0.5`. No error — the forecast simply has wider intervals.
- **No score history**: `observedDeltaPerWindow = 0`, trend is flat. Projection holds current score constant with widening intervals.
- **Single historical data point**: Treated as no trend (need 2+ points). Flat projection.
- **Subsystem in plan but not in confidence model**: Uses default confidence `0.5`. The plan objective still gets a forecast.
- **Subsystem in confidence model but not in plan**: Still gets a forecast — the learning engine may have data for subsystems not currently prioritized.
- **No subsystems found**: Return empty `projections[]` with `subsystemsForecast: 0`.

---

## 5. Engine Orchestrator: `ForecastingEngine`

### 5.1 Interface

```typescript
export class ForecastingEngine {
  constructor(
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly confidenceModelStore: ConfidenceModelStore,
    private readonly healthForecastStore: HealthForecastStore,
    private readonly scoreSnapshotProvider: ScoreSnapshotProvider,
    private readonly config: ForecastingEngineConfig,
  ) {}

  async run(): Promise<HealthForecast> { ... }
  async loadLatestForecast(): Promise<HealthForecast | null> { ... }
}
```

### 5.2 `run()` flow

1. Load latest `StrategicPlan` via `strategicPlanStore.loadLatest()`.
2. If null: throw `ForecasterError("No strategic plan available. Run 'alix executive strategic-plan' first.")`.
3. Load latest `UpdatedConfidenceModel` via `confidenceModelStore.loadLatest()` (may be null — optional dependency).
4. Load historical score snapshots via `scoreSnapshotProvider`:
   - `loadCurrentScores()` for current scores.
   - `loadScoresAt()` for each past window in `config.trendWindow` to build `scoreHistory`.
5. Build `ForecastingObservationContext`.
6. Call pure function `buildHealthForecast(plan, confidenceModel, scoreHistory, currentScores, context, config)`.
7. Save forecast via `HealthForecastStore.save(forecast)`.
8. Return forecast.

### 5.3 `loadLatestForecast()` flow

Delegates to `HealthForecastStore.loadLatest()`.

---

## 6. Persistence: `HealthForecastStore`

### 6.1 Storage format

Append-only JSONL at `.alix/forecasting/health-forecasts.jsonl`. Each line is one `HealthForecast` JSON object.

Same pattern as `StrategicPlanStore` / `ConfidenceModelStore`:
- `save(forecast)` — append line, validate before write
- `loadLatest()` — last line, parse, validate
- `loadById(id)` — scan for matching `forecastId`
- `list()` — return metadata summaries

### 6.2 Validation on load

- `schemaVersion === "p11.5.0"`
- `forecastId`, `sourcePlanId`, `rootCauseAnalysisId`, `correlationGraphId` non-empty strings
- `sourceConfidenceModelId` non-null must be non-empty string; null is allowed (no confidence model available)
- `generatedAt` valid ISO 8601 timestamp
- `projections` is an array; empty projections are valid when no subsystems are available for forecasting
- Each `ScoreProjection`:
  - `targetSubsystem` must be a valid `CorrelationSubsystemId` (one of: memory, workflow, skills, agents, tools, security, governance, adaptation)
  - `projectedScores`, `lowerBound`, `upperBound` arrays with same length
  - All score values within `[0, 100]`
  - `forecastConfidence` within `[0, 1]`
  - `observationCount >= 0`
- `forecastWindows > 0`
- Throw `ForecasterError` on invalid data (fail-closed)

### 6.3 ForecastModelSummary

```typescript
export interface HealthForecastSummary {
  forecastId: string;
  generatedAt: string;
  sourceConfidenceModelId: string;
  sourcePlanId: string;
  subsystemsForecast: number;
  highConfidenceForecasts: number;
  mediumConfidenceForecasts: number;
  lowConfidenceForecasts: number;
  forecastWindows: number;
}
```

---

## 7. CLI: `alix executive forecast`

### 7.1 Command structure

```
alix executive forecast [--json] [--latest]
```

### 7.2 Modes

| Flag | Behavior |
|---|---|
| (no flags) | Run forecasting engine (load plan + model + history → project → save → print summary) |
| `--json` | Run forecasting engine, save, print full JSON forecast |
| `--latest` | Load last saved forecast, print summary |
| `--latest --json` | Load last saved forecast, print full JSON |

### 7.3 Summary output

```
Health Forecast
Forecast: forecast-20260703T120000000Z
Source plan: strat-20260703T120000000Z
Source confidence model: lrn-20260703T120000000Z
Windows: 3 forward

Subsystem      | Current | W1     | W2     | W3     | Confidence
memory         | 65      | 68±5   | 70±7   | 71±9   | high (0.79)
workflow       | 61      | 63±8   | 64±11  | 65±14  | med (0.55)
agents         | 88      | 87±3   | 86±4   | 85±5   | high (0.85)
security       | 93      | 93±3   | 93±4   | 93±5   | high (0.91)
```

---

## 8. Integration with P11 Pipeline

### 8.1 Feed-forward to planning

The `HealthForecast` feeds forward to the next P11.3 planning cycle. When a forecast is available, the planning engine can:
- Adjust urgency scores: a subsystem projected to decline urgently needs attention even if its current score is acceptable.
- Adjust confidence: a forecast with high confidence in a subsystem's decline reinforces the causal model.

This feed-forward is advisory — the planning engine is not required to use it.

### 8.2 Feed-back from outcome observation

When P11.4 processes new outcomes, the forecast serves as a baseline:
- "The forecast predicted a score of 70±7, and the actual score was 73" → the model was slightly pessimistic.
- This delta between forecast and actual could be a future input to the learning engine (deferred beyond v1).

---

## 9. Test Plan

### 9.1 Pure function tests (`build-health-forecast.vitest.ts` — 10 tests)

| # | Test | Verifies |
|---|---|---|
| T1 | Forecast for a subsystem with trend and confidence model | Happy path |
| T2 | Forecast with no confidence model (null) uses default 0.5 | Optional dependency |
| T3 | No score history produces flat projection | Missing data |
| T4 | Single data point treated as no trend | Insufficient data |
| T5 | Confidence intervals widen with distance | Uncertainty growth |
| T6 | Confidence intervals narrow with high confidence | Certainty effect |
| T7 | No subsystems found returns empty projections | Empty state |
| T8 | Scores clamped to [0, 100] | Boundary safety |
| T9 | Dampening mean-reverts over long horizons | Long-term behavior |
| T10 | Forecast confidence classification (high/medium/low) | Meta counts |

### 9.2 Engine tests (`forecasting-engine.vitest.ts` — 3 tests)

| # | Test | Verifies |
|---|---|---|
| T11 | Returns forecast when plan and model exist | Happy path |
| T12 | Throws when no plan exists | Error handling |
| T13 | loadLatestForecast returns null when empty | Empty state |

### 9.3 Store tests (`health-forecast-store.vitest.ts` — 4 tests)

| # | Test | Verifies |
|---|---|---|
| T14 | Save + loadLatest round-trip | Persistence |
| T15 | loadLatest returns last saved forecast | Ordering |
| T16 | Throws on invalid schema version | Validation |
| T17 | loadLatest returns null when file missing | Empty state |

### 9.4 CLI handler tests (`executive-forecast-handler.vitest.ts` — 2 tests)

| # | Test | Verifies |
|---|---|---|
| T18 | `--latest` without saved forecast prints message | Graceful fallback |
| T19 | Default mode runs engine and prints summary | Integration |

---

## 10. Non-Goals

- **Counterfactual / "what-if" branching**: P11.5 produces a single trajectory. Multiple intervention scenarios are a future refinement.
- **Probabilistic forecasting**: P11.5 is fully deterministic. No Monte Carlo, no Bayesian inference.
- **LLM-based prognosis**: No LLM used for forecast narrative generation.
- **Automated escalation**: Forecasts do not trigger alerts, actions, or plan modifications.
- **Multi-model ensembling**: P11.5 uses a single projection method. Ensemble methods are a future refinement.
- **Real-time forecasting**: On-demand only (`alix executive forecast`). No watch mode.
- **Forecast accuracy tracking**: Comparing forecast to actual outcomes is deferred to P11.4+ / a future learning cycle refinement.
- **Correlation-aware cross-subsystem forecasts**: Each subsystem is projected independently. Cross-subsystem effects (fixing A improves B) are not modeled.

---

## 11. File Map

| File | Purpose |
|---|---|
| `src/forecasting/forecasting-types.ts` | Type definitions: `HealthForecast`, `ScoreProjection`, `ForecastingEngineConfig`, `ForecastingObservationContext`, `HealthForecastSummary`, `ForecasterError` |
| `src/forecasting/forecasting-config.ts` | Default config export |
| `src/forecasting/build-health-forecast.ts` | Pure function `buildHealthForecast()` |
| `src/forecasting/health-forecast-store.ts` | Append-only JSONL store with validation |
| `src/forecasting/forecasting-engine.ts` | Orchestrator |
| `src/cli/commands/executive-forecast-handler.ts` | CLI handler for `alix executive forecast` |
| `tests/forecasting/build-health-forecast.vitest.ts` | 10 pure function tests |
| `tests/forecasting/forecasting-engine.vitest.ts` | 3 engine tests |
| `tests/forecasting/health-forecast-store.vitest.ts` | 4 store tests |
| `tests/forecasting/executive-forecast-handler.vitest.ts` | 2 CLI tests |
