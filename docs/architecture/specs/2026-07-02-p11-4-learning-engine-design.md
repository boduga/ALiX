# P11.4 — Learning Engine Design Spec

> **Status:** Approved ✅  
> **Phase:** P11.4  
> **Consumes:** `StrategicPlan` (P11.3), subsystem score history, plan completion signals  
> **Produces:** `UpdatedConfidenceModel`  
> **Signal hierarchy:** Score improvement (primary), plan completion (secondary), reduced recurrence (deferred)  
> **Determinism:** Fully deterministic. No LLM, no probabilistic inference.

---

## 1. Context

P11.3 Strategic Planning Engine produces a `StrategicPlan` — a ranked set of planning objectives with urgency scores, confidence estimates, causal mechanisms, and prerequisite ordering. It answers *"what should we fix and in what order"* but does not learn from whether those predictions were correct.

P11.4 Learning Engine closes the observation loop. It consumes the `StrategicPlan` plus observed subsystem health outcomes and plan completion signals, and produces an `UpdatedConfidenceModel` — a set of confidence adjustments per subsystem and per causal mechanism.

The core design principle:

> P11.4 should not "learn" from whether a plan was merely created. It should learn from observed health movement after a strategic objective was completed or left incomplete.

### Pipeline position

```
Correlation Engine    (P11.1) — CorrelationGraph
        │
        ▼
Reasoning Engine     (P11.2) — RootCauseAnalysis
        │
        ▼
Planning Engine      (P11.3) — StrategicPlan
        │
        ▼
Learning Engine      (P11.4) — UpdatedConfidenceModel
        │
        ▼
Forecasting          (P11.5) — HealthForecast
```

### Stage boundary rule

P11.4's output `UpdatedConfidenceModel` is a typed, persisted artifact consumed by downstream stages (P11.5 Forecasting). It does not mutate any historical artifact — no rewriting of prior `RootCauseAnalysis` or `StrategicPlan` records. The updated confidence model is applied at the point of *future* analysis, not retroactively.

---

## 2. Signal Hierarchy

P11.4 distinguishes three signal types with an explicit priority order. The first two are active in v1; recurrence is deferred.

| Priority | Signal | Active in v1 | Data source |
|---|---|---|---|
| Primary | **Score improvement** | ✅ Yes | Baseline provider snapshots before/after objective window |
| Secondary | **Plan completion** | ✅ Yes | Outcome records / execution state |
| Deferred | **Reduced recurrence** | ❌ Explicitly deferred | Requires multiple observation windows of the same subsystem |

### 2.1 Primary signal: Subsystem score improvement

The strongest available signal. If a strategic objective targets subsystem `X`, and `X`'s health score improves after the objective is completed (or left incomplete), that is evidence about whether the plan's causal model was correct.

Score improvement is measured as the delta between the subsystem score at plan generation time and the subsystem score at the evaluation point (a configurable window after the objective was resolved or abandoned).

**Attribution rule**: Score improvement is attributed to the objective that targeted the subsystem, not to any prerequisite objective or downstream effect. Causal attribution beyond the direct target is deferred to P11.5 (Forecasting).

### 2.2 Secondary signal: Plan completion

Whether a planning objective was actually completed. This discriminates between:
- "We fixed the right thing and it helped" (completed + score improved)
- "We fixed the right thing but it didn't help" (completed + no improvement)
- "Something else fixed it" (not completed + score improved)
- "Nothing happened" (not completed + no improvement)

Completion is a binary signal per objective, sourced from outcome records in the execution/remediation pipeline.

### 2.3 Deferred signal: Reduced recurrence

Whether a subsystem that was degraded, then improved, stays healthy over subsequent observation windows. This is the strongest signal (the problem stopped coming back) but requires the longest observation period and the most data.

Explicitly deferred from v1. The `meta.recurrenceLearningEnabled` field is `false` and will be toggled when P11.4+ or a future phase adds recurrence observation.

---

## 3. Type Model

### 3.1 LearningSignal

```typescript
/**
 * The type of observed outcome that triggers a confidence update.
 *
 * "score_improvement"            — Subsystem health score increased after objective resolution.
 * "no_action_improvement"        — Score improved even though the objective was not completed.
 * "completed_no_improvement"     — Objective was completed but score did not improve.
 * "deferred_recurrence"           — Reserved for future recurrence observation.
 */
export type LearningSignal =
  | "score_improvement"
  | "no_action_improvement"
  | "completed_no_improvement"
  | "deferred_recurrence";
```

### 3.2 ConfidenceUpdate

```typescript
export interface ConfidenceUpdate {
  /** The subsystem that was targeted by the objective. */
  targetSubsystem: CorrelationSubsystemId;
  /** The causal mechanism that was identified (if any). */
  mechanism: CausalMechanism | null;
  /** The learning signal that triggered this update. */
  signal: LearningSignal;
  /** The observed score delta (positive = improvement). */
  scoreDelta: number;
  /** Whether the objective was completed. */
  completed: boolean;
  /** The urgency score of the objective at plan time. */
  urgencyScoreAtPlanning: number;
  /**
   * The confidence adjustment to apply.
   * Positive = increase confidence in this mechanism for this subsystem.
   * Negative = decrease confidence.
   * Bounds: -0.05 to +0.05 per cycle.
   */
  adjustment: number;
  /**
   * Confidence after applying this adjustment.
   * Clamped to [0.05, 0.95].
   */
  resultingConfidence: number;
  /** Links to the source objective. */
  sourceObjectiveId: string;
  /** Links to the source plan. */
  sourcePlanId: string;
  /** ISO timestamp of the learning observation. */
  observedAt: string;
}
```

### 3.3 UpdatedConfidenceModel

```typescript
export interface UpdatedConfidenceModel {
  schemaVersion: "p11.4.0";
  /** Unique model ID, e.g. `lrn-{safeTimestamp}`. */
  modelId: string;
  generatedAt: string;
  /** Links to the source plan that produced this learning data. */
  sourcePlanId: string;
  /** Propagated from StrategicPlan for P11 chain traceability. */
  rootCauseAnalysisId: string;
  /** Propagated from StrategicPlan for P11 chain traceability. */
  correlationGraphId: string;
  /** Ordered list of confidence updates from this learning cycle. */
  updates: ConfidenceUpdate[];
  meta: {
    primarySignal: "score_improvement";
    /**
     * Plan completion is represented via the `completed` boolean on each
     * ConfidenceUpdate. It is a secondary signal (influences classification)
     * but is not emitted as a standalone confidence-changing signal.
     */
    secondarySignal: "plan_completion";
    /** Explicitly deferred. Always false in v1. */
    recurrenceLearningEnabled: false;
      /**
     * Number of plan objectives inspected this learning cycle.
     * All objectives in the plan are inspected; this count equals
     * plan.objectives.length in a normal run.
     */
    objectivesEvaluated: number;
    /**
     * Number of objectives that produced a ConfidenceUpdate record.
     * May be less than objectivesEvaluated when objectives are
     * skipped (missing current score) or have confidence: null.
     */
    objectivesWithSignals: number;
    /**
     * Number of objectives skipped (no ConfidenceUpdate produced)
     * due to missing current score or confidence: null.
     */
    objectivesSkipped: number;
    /**
     * Number of objectives that were evaluated but produced no
     * learnable signal (e.g. no action + no improvement).
     * Does NOT overlap with objectivesSkipped — these objectives
     * had all required data but the outcome did not fire a signal.
     */
    objectivesWithoutSignal: number;
    /** Timestamp of the earliest subsystem score used as baseline. */
    baselineTimestamp: string;
    /** Timestamp of the latest subsystem score used as evaluation. */
    evaluationTimestamp: string;
  };
  /**
   * Rollup summary of this learning cycle.
   * Provided for downstream consumers (P11.5 Forecasting) to quickly
   * consume the model without recomputing aggregates.
   */
  summary: {
    positiveUpdates: number;
    negativeUpdates: number;
    zeroAdjustmentUpdates: number;
    averageAdjustment: number;
  };
  /**
   * Per-mechanism adjustment rollup.
   * Useful for identifying which causal mechanisms are over/under-confident.
   */
  mechanismAdjustments: Array<{
    mechanism: CausalMechanism;
    samples: number;
    averageAdjustment: number;
  }>;
}
```

### 3.4 LearningOutcomeRecord

```typescript
/**
 * Minimal outcome record for a planning objective.
 *
 * Imported from the execution/remediation pipeline or created as an
 * adapter. The matching rules ensure unambiguous attribution:
 *
 * 1. Exact sourceObjectiveId match — always used if present.
 * 2. targetSubsystem fallback — only when exactly one objective
 *    in the plan targets that subsystem. If zero or multiple objectives
 *    match, no outcome is recorded for any of them.
 * 3. No match — objective treated as incomplete.
 */
export interface LearningOutcomeRecord {
  /** Exact-match preferred. */
  sourceObjectiveId?: string;
  sourcePlanId?: string;
  /**
   * Fallback — only used when exactly one plan objective targets
   * this subsystem (avoids ambiguous attribution).
   */
  targetSubsystem?: CorrelationSubsystemId;
  /** Whether the objective was completed. */
  completed: boolean;
  completedAt?: string;
  status?: "completed" | "abandoned" | "failed" | "unknown";
}
```

### 3.5 LearningObservationContext

```typescript
/**
 * Explicit observation context injected into the pure function.
 *
 * All timestamps are provided by the caller (orchestrator) so the
 * pure function remains deterministic — no Date.now() internally.
 */
export interface LearningObservationContext {
  generatedAt: string;
  baselineTimestamp: string;
  evaluationTimestamp: string;
}
```

### 3.6 LearningEngineConfig

```typescript
export interface LearningEngineConfig {
  /**
   * Maximum positive confidence adjustment per learning cycle.
   * Default: 0.05
   */
  maxPositiveAdjustment: number;
  /**
   * Maximum negative confidence adjustment per learning cycle.
   * Default: 0.05
   */
  maxNegativeAdjustment: number;
  /**
   * Lower bound for confidence values.
   * Default: 0.05
   */
  minConfidence: number;
  /**
   * Upper bound for confidence values.
   * Default: 0.95
   */
  maxConfidence: number;
  /**
   * Minimum score delta to register as an improvement signal.
   * Scores must increase by at least this amount to count as "improved".
   * Default: 5 (on a 0–100 scale).
   */
  minImprovementDelta: number;
  /**
   * Window in milliseconds after objective resolution to evaluate score change.
   * Default: 7 days (604800000 ms).
   */
  evaluationWindowMs: number;
}
```

### 3.7 ConfidenceModelSummary

```typescript
export interface ConfidenceModelSummary {
  modelId: string;
  generatedAt: string;
  sourcePlanId: string;
  /** Total number of objectives inspected. */
  objectivesEvaluated: number;
  /** Number of objectives that produced a ConfidenceUpdate. */
  objectivesWithSignals: number;
  /** Number of objectives skipped (missing score or confidence: null). */
  objectivesSkipped: number;
  /** Number of objectives evaluated but with no learnable signal. */
  objectivesWithoutSignal: number;
  /** Total number of confidence updates in this model. */
  updates: number;
  positiveUpdates: number;
  negativeUpdates: number;
  zeroAdjustmentUpdates: number;
}
```

### 3.8 LearningOutcomeStore

```typescript
/**
 * Minimal outcome store adapter for the LearningEngine.
 *
 * Implemented by the execution/remediation outcome store or a
 * bridging adapter. Returns all outcome records; the engine
 * filters by sourcePlanId and matching priority.
 */
export interface LearningOutcomeStore {
  list(): Promise<LearningOutcomeRecord[]>;
}
```

### 3.9 LearningEngineError

```typescript
export class LearningEngineError extends Error {
  readonly code = "LEARNING_ENGINE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "LearningEngineError";
  }
}
```

---

## 4. Algorithm: `buildConfidenceModel()`

### 4.1 Signature

```typescript
function buildConfidenceModel(
  plan: StrategicPlan,
  outcomes: LearningOutcomeRecord[],
  baselineScores: Map<CorrelationSubsystemId, number>,
  currentScores: Map<CorrelationSubsystemId, number>,
  context: LearningObservationContext,
  config: LearningEngineConfig,
): UpdatedConfidenceModel
```

Pure function, no side effects, no I/O. Fully deterministic.

### 4.2 Constants

```typescript
const DEFAULT_MAX_POSITIVE_ADJUSTMENT = 0.05;
const DEFAULT_MAX_NEGATIVE_ADJUSTMENT = 0.05;
const DEFAULT_MIN_CONFIDENCE = 0.05;
const DEFAULT_MAX_CONFIDENCE = 0.95;
const DEFAULT_MIN_IMPROVEMENT_DELTA = 5;
const DEFAULT_EVALUATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
```

### 4.3 Steps

**Step 1 — Input validation**

Validate the `StrategicPlan`:
- Must have `schemaVersion === "p11.3.0"`
- Must have at least one objective (empty plans produce no updates)
- Must have non-empty `planId` and `generatedAt`

Validate outcome/score data:
- `outcomes` array may be empty (no completion data = all objectives treated as incomplete)
- `baselineScores` may be empty; missing baseline falls back to `objective.currentScore`
- `currentScores` may be empty; missing current score means no score delta can be observed → skip that objective entirely (no `ConfidenceUpdate` emitted, so a completed objective is not unfairly penalized with a "no improvement" label) 

Validate timestamp ordering:
- `context.baselineTimestamp` must be ≤ `context.evaluationTimestamp`
- `context.generatedAt` must be ≤ `context.evaluationTimestamp`
- If any timestamp ordering is violated, throw `LearningEngineError`.

If the plan contains zero objectives: return an `UpdatedConfidenceModel` with empty `updates[]`, `meta.objectivesEvaluated: 0`, `meta.objectivesWithSignals: 0`, `meta.objectivesSkipped: 0`, and `meta.objectivesWithoutSignal: 0`.

**Step 2 — Match objectives to outcomes**

For each objective in `plan.objectives`, find the matching outcome record using the defined priority:
1. **Filter by `sourcePlanId`** — if `outcome.sourcePlanId` is present and does not equal `plan.planId`, ignore that outcome entirely. This is a defensive guard even though the orchestrator pre-filters.
2. **Exact `sourceObjectiveId` match** — always used when present. If multiple outcome records match the same `sourceObjectiveId`, use the one with the latest `completedAt` timestamp. If `completedAt` is missing or tied, use the last record in store order (most recent write). This reflects that execution state evolves over time.
3. **Fallback by `targetSubsystem`** — only when no `sourceObjectiveId` match exists AND exactly one objective in the plan targets that subsystem. Zero or multiple objectives matching the subsystem → treated as no outcome (avoids ambiguous attribution).
4. **No match** — treat as incomplete (completed = false).

**Step 3 — Compute score deltas**

A `skippedCount` accumulator is maintained across steps 3 and 6.

For each objective:
- `baselineScore = baselineScores.get(objective.targetSubsystem) ?? objective.currentScore`
- If `currentScores` has no entry for this subsystem: **skip this objective entirely**. Increment `skippedCount`. No `ConfidenceUpdate` is emitted because no score delta can be observed. This prevents a completed objective from being unfairly penalized as "no improvement" when the data just hasn't arrived yet.
- `currentScore = currentScores.get(objective.targetSubsystem)`
- `scoreDelta = currentScore - baselineScore`
- `improved = scoreDelta >= config.minImprovementDelta`

**Step 4 — Classify the learning signal**

V1 never emits `"deferred_recurrence"` — it is reserved for future use when `recurrenceLearningEnabled` toggles to `true`.

| Completed | Score improved | LearningSignal |
|---|---|---|
| `true` | `true` | `"score_improvement"` |
| `true` | `false` | `"completed_no_improvement"` |
| `false` | `true` | `"no_action_improvement"` |
| `false` | `false` | *(no update)* | Insufficient signal |

If no outcome record exists and score did not improve: emit no update (insufficient signal).

**Step 5 — Compute confidence adjustment**

Apply the core learning rules:

| Signal | Adjustment | Rationale |
|---|---|---|
| `score_improvement` | `+maxPositiveAdjustment * min(scoreDelta / 10, 1)` | Proportionally reward correct predictions |
| `completed_no_improvement` | `-maxNegativeAdjustment` | Full negative — we acted and it didn't help |
| `no_action_improvement` | `0` | No adjustment — improvement without following the plan does not validate the model. Emitted as audit record only. |
| *(no update — no improvement, no action)* | `0` | Insufficient signal — nothing to learn from |

Adjustment is clamped to `[-maxNegativeAdjustment, +maxPositiveAdjustment]`.

**Step 6 — Apply confidence bounds**

For each objective's existing confidence:
- If `objective.confidence === null` (no cause identified): skip producing a `ConfidenceUpdate` entirely. Increment `skippedCount`. The objective counts toward `meta.objectivesEvaluated` and `meta.objectivesSkipped` but no adjustment is possible.
- Otherwise: `newConfidence = clamp(objective.confidence + adjustment, minConfidence, maxConfidence)`

The adjustment on `resultingConfidence` is computed against the *original* confidence from the plan, so multiple learning cycles produce independent per-cycle adjustments rather than compounding.

**Step 7 — Assemble and return**

```typescript
// Compute rollup summary
const summary = {
  positiveUpdates: updates.filter((u) => u.adjustment > 0).length,
  negativeUpdates: updates.filter((u) => u.adjustment < 0).length,
  zeroAdjustmentUpdates: updates.filter((u) => u.adjustment === 0).length,
  averageAdjustment:
    updates.length > 0
      ? roundTo3(updates.reduce((s, u) => s + u.adjustment, 0) / updates.length)
      : 0,
};

// Compute per-mechanism rollup
const byMechanism = new Map<string, { samples: number; total: number }>();
for (const u of updates) {
  const key = u.mechanism ?? "__none__";
  const entry = byMechanism.get(key) ?? { samples: 0, total: 0 };
  entry.samples++;
  entry.total += u.adjustment;
  byMechanism.set(key, entry);
}
const mechanismAdjustments = Array.from(byMechanism.entries())
  .filter(([key]) => key !== "__none__")
  .map(([mechanism, data]) => ({
    mechanism: mechanism as CausalMechanism,
    samples: data.samples,
    averageAdjustment: roundTo3(data.total / data.samples),
  }));

return {
  schemaVersion: "p11.4.0",
  modelId: "lrn-" + sanitizeTimestamp(context.generatedAt),
  generatedAt: context.generatedAt,
  sourcePlanId: plan.planId,
  rootCauseAnalysisId: plan.rootCauseAnalysisId,
  correlationGraphId: plan.correlationGraphId,
  updates,  // ordered by signal type: score_improvement first
  meta: {
    primarySignal: "score_improvement",
    secondarySignal: "plan_completion",
    recurrenceLearningEnabled: false,
    objectivesEvaluated: plan.objectives.length,
    objectivesWithSignals: updates.length,
    objectivesSkipped: skippedCount,  // count of objectives skipped (missing score or confidence: null)
    objectivesWithoutSignal: plan.objectives.length - updates.length - skippedCount,
    baselineTimestamp: context.baselineTimestamp,
    evaluationTimestamp: context.evaluationTimestamp,
  },
  summary,
  mechanismAdjustments,
};
```

---

## 5. Learning Rules: Detailed Matrix

### 5.1 Decision matrix

| Scenario | Completed? | Score Δ ≥ threshold? | Signal | Adjustment | Rationale |
|---|---|---|---|---|---|
| Fix worked | ✅ Yes | ✅ Yes | `score_improvement` | `+0.05 * min(Δ/10, 1)` | Correct model — reward proportionally |
| Fix ineffective | ✅ Yes | ❌ No | `completed_no_improvement` | `-0.05` | Model was wrong — full penalty |
| Recovery without action | ❌ No | ✅ Yes | `no_action_improvement` | `0` (audit only) | Improvement without following plan does not validate model |
| No action, no change | ❌ No | ❌ No | *(none)* | — | Insufficient information |
| Completed, degraded | ✅ Yes | Δ < 0 | `completed_no_improvement` | `-0.05` | Model was wrong — full penalty (worse than expected) |

### 5.2 Adjustment bounds

| Parameter | Value | Applies to |
|---|---|---|
| Max per-cycle positive | `+0.05` | All positive adjustments |
| Max per-cycle negative | `-0.05` | All negative adjustments |
| Confidence lower bound | `0.05` | Resulting confidence |
| Confidence upper bound | `0.95` | Resulting confidence |
| Min improvement Δ | `5` | Score threshold on 0–100 scale |

### 5.3 Edge cases

- **No outcome data for an objective**: Treated as incomplete. If score improved → `no_action_improvement` (audit record, 0 adjustment). If no improvement → no update.
- **Objective with `confidence: null`**: Counts toward `meta.objectivesEvaluated` and `meta.objectivesSkipped` but does **not** produce a `ConfidenceUpdate` record. There is no confidence value to adjust.
- **Multiple objectives with `confidence: null`**: All count toward `objectivesEvaluated` and `objectivesSkipped`; none produce updates.
- **Missing current score for a subsystem**: Counts toward `objectivesEvaluated` and `objectivesSkipped`. No `ConfidenceUpdate` emitted (no score delta to observe).
- **Evaluated but no signal**: Objectives that have all required data (confidence, scores) but the outcome yields no signal (no action + no improvement) count toward `objectivesEvaluated` and `objectivesWithoutSignal`. They are not in `objectivesSkipped` — they were fully processed, there was just nothing to learn.
- **Score delta exactly at threshold**: `>=` comparison, so exactly `5` counts as improved.
- **Negative score delta (further degradation)**: Treated as "no improvement". If completed → `completed_no_improvement` with full negative adjustment.
- **Multiple objectives targeting the same subsystem**: Each objective produces its own `ConfidenceUpdate`. No deduplication at this layer — P11.5 (Forecasting) handles aggregation.
- **Zero objectives in plan**: Return empty `updates[]`, `meta.objectivesEvaluated: 0`, `meta.objectivesWithSignals: 0`, `meta.objectivesSkipped: 0`, `meta.objectivesWithoutSignal: 0`.

---

## 6. Engine Orchestrator: `LearningEngine`

### 6.1 Interface

```typescript
/**
 * Adapter for loading subsystem health scores at specific points in time.
 *
 * Implemented by the baseline provider layer (P10.10) or a simple in-memory
 * snapshot store. In v1, the baseline timestamp defaults to the plan's
 * generatedAt time; when no historical data is available, falls back to
 * the score captured in the plan objective (currentScore).
 */
export interface ScoreSnapshotProvider {
  loadScoresAt(timestamp: string): Promise<Map<CorrelationSubsystemId, number>>;
  loadCurrentScores(): Promise<Map<CorrelationSubsystemId, number>>;
}

export class LearningEngine {
  constructor(
    private readonly strategicPlanStore: StrategicPlanStore,
    private readonly confidenceModelStore: ConfidenceModelStore,
    private readonly outcomeStore: LearningOutcomeStore,
    private readonly scoreSnapshotProvider: ScoreSnapshotProvider,
    private readonly config: LearningEngineConfig,
  ) {}

  async run(): Promise<UpdatedConfidenceModel> { ... }
  async loadLatestModel(): Promise<UpdatedConfidenceModel | null> { ... }
}
```

### 6.2 `run()` flow

1. Load latest `StrategicPlan` via `strategicPlanStore.loadLatest()`
2. If null: throw `LearningEngineError("No strategic plan available. Run 'alix executive strategic-plan' first.")`
3. If plan has zero objectives: return model with empty `updates[]`, `meta.objectivesEvaluated: 0`, `meta.objectivesWithSignals: 0`, `meta.objectivesSkipped: 0`, `meta.objectivesWithoutSignal: 0` (nothing to learn from)
4. Load outcome records via `outcomeStore.list()` — filter to records referencing the latest plan
5. Load baseline scores at plan `generatedAt` via `scoreSnapshotProvider.loadScoresAt(plan.generatedAt)`; fall back to `objective.currentScore` per subsystem when no historical snapshot exists
6. Load current scores via `scoreSnapshotProvider.loadCurrentScores()`
7. Build `context: LearningObservationContext = { generatedAt, baselineTimestamp, evaluationTimestamp }` — all caller-provided, ensuring determinism
8. Call `buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config)` — pure function
9. Save model via `confidenceModelStore.save(model)`
10. Return model

### 6.3 `loadLatestModel()` flow

Delegates to `ConfidenceModelStore.loadLatest()` — reads the last persisted model without re-running.

---

## 7. Persistence: `ConfidenceModelStore`

### 7.1 Storage format

Append-only JSONL at `.alix/learning/confidence-models.jsonl`. Each line is one `UpdatedConfidenceModel` JSON object.

Same pattern as `StrategicPlanStore` (P11.3):
- `save(model)` — append line to JSONL, validate before write
- `loadLatest()` — read last line, parse, return
- `loadById(id)` — scan for matching ID
- `list()` — return metadata summaries

### 7.2 Validation on load

- Parse JSON
- Verify `schemaVersion === "p11.4.0"`
- Verify `modelId` is non-empty string
- Verify `sourcePlanId` is non-empty string
- Verify `generatedAt` is a valid ISO 8601 timestamp (parses to valid Date)
- Verify `meta.baselineTimestamp` is a valid ISO 8601 timestamp
- Verify `meta.evaluationTimestamp` is a valid ISO 8601 timestamp
- Verify `updates` is an array
- Verify each `ConfidenceUpdate`:
  - `targetSubsystem` is a valid `CorrelationSubsystemId`
  - `sourceObjectiveId` is a non-empty string
  - `sourcePlanId` is a non-empty string
  - `observedAt` is a valid ISO 8601 timestamp
  - `signal` is a valid `LearningSignal`
  - `adjustment` is number within `[-0.05, 0.05]`
  - `resultingConfidence` is number within `[0.05, 0.95]`
- Verify `meta.recurrenceLearningEnabled === false`
- Verify no update uses signal `"deferred_recurrence"`: if any `ConfidenceUpdate.signal === "deferred_recurrence"` while `recurrenceLearningEnabled === false`, throw `LearningEngineError`
- Verify `summary` exists and:
  - `summary.positiveUpdates + summary.negativeUpdates + summary.zeroAdjustmentUpdates === updates.length`
  - `summary.averageAdjustment` is a finite number
- Verify `mechanismAdjustments` is an array and each entry:
  - `samples > 0`
  - `averageAdjustment` is a finite number
- Verify cross-field consistency:
  - Every `update.sourcePlanId === model.sourcePlanId` (no orphan updates)
  - `summary.positiveUpdates + summary.negativeUpdates + summary.zeroAdjustmentUpdates === updates.length`
  - `meta.objectivesWithSignals === updates.length`
  - `meta.objectivesEvaluated >= meta.objectivesWithSignals + meta.objectivesSkipped`
  - All `adjustment` and `resultingConfidence` values are finite numbers
- Throw `LearningEngineError` on invalid data (fail-closed)

---

## 8. CLI: `alix executive learn`

### 8.1 Command structure

```
alix executive learn [--json] [--latest]
```

### 8.2 Modes

| Flag | Behavior |
|---|---|
| (no flags) | Run learning engine (load plan → load outcomes → compute → save → print summary) |
| `--json` | Run learning engine, save, print full JSON model |
| `--latest` | Load last saved confidence model without re-running, print summary |
| `--latest --json` | Load last saved model, print full JSON |

### 8.3 Summary output

```
Confidence Model
Model: lrn-20260703T120000000Z
Source plan: strat-20260703T120000000Z
Objectives evaluated: 3
Signals: score_improvement (primary), completed (secondary)

Target subsystem    | Score Δ | Completed | Signal                   | Adjustment
memory              | +8      | yes       | score_improvement        | +0.04
agents              | +2      | yes       | completed_no_improvement | -0.05
security            | +12     | no        | no_action_improvement    | 0 (audit)
```

### 8.4 Error handling

- `LearningEngineError` → print error message, exit 1
- No strategic plan → print "Run 'alix executive strategic-plan' first.", exit 1
- No outcome data → print warning, continue with empty outcomes
- No score history for a subsystem → use `objective.currentScore` as baseline

### 8.5 Registration

Add `case "learn"` to `src/cli/commands/executive.ts` with dynamic import pattern:

```typescript
case "learn": {
  const { handleLearnCommand } = await import(
    "./executive-learn-handler.js"
  );
  return handleLearnCommand(rest);
}
```

Update the `default` case's available subcommands list.

---

## 9. Test Plan

### 9.1 Pure function tests (`build-confidence-model.vitest.ts` — 12 tests)

| # | Test | Verifies |
|---|---|---|
| T1 | Completed objective with score improvement produces `score_improvement` and positive adjustment | Happy path — primary signal |
| T2 | Completed objective with no improvement produces `completed_no_improvement` and negative adjustment | Secondary signal, negative outcome |
| T3 | Incomplete objective with score improvement produces `no_action_improvement` with zero adjustment | Audit-only signal |
| T4 | Incomplete objective with no score improvement produces no update | Insufficient signal |
| T5 | Completed objective with further degradation produces full negative adjustment | Worse-than-expected outcome |
| T6 | Objective with `confidence: null` is skipped | No-confidence guard |
| T7 | Adjustment is clamped to max boundaries | ±0.05 bound |
| T8 | Resulting confidence is clamped to [0.05, 0.95] | Confidence bounds |
| T9 | Empty plan produces empty updates array | Plan with zero objectives |
| T10 | No outcome records defaults all objectives to incomplete | Missing data fallback |
| T11 | Score delta exactly at threshold counts as improvement | Boundary condition |
| T12 | Multiple objectives produce ordered updates | Multi-objective plan |

### 9.2 Engine tests (`learning-engine.vitest.ts` — 3 tests)

| # | Test | Verifies |
|---|---|---|
| T13 | Returns model when plan and outcomes exist | Happy path |
| T14 | Throws when no plan exists | Error handling |
| T15 | loadLatestModel returns null when no models | Empty state |

### 9.3 Store tests (`confidence-model-store.vitest.ts` — 4 tests)

| # | Test | Verifies |
|---|---|---|
| T16 | Save + loadLatest round-trips correctly | Persistence |
| T17 | loadLatest returns last saved model | JSONL ordering |
| T18 | Throws on invalid schema version | Validation |
| T19 | Returns null when file does not exist | Empty state |

### 9.4 CLI handler test (`executive-learn-handler.vitest.ts` — 2 tests)

| # | Test | Verifies |
|---|---|---|
| T20 | `--latest` without saved model prints message | Graceful fallback |
| T21 | Default mode runs engine and prints summary | Integration |

---

## 10. Non-Goals

- **Historical artifact rewriting**: P11.4 does not modify any prior `RootCauseAnalysis`, `StrategicPlan`, or `CorrelationGraph`. The model is applied forward only.
- **Automated execution changes**: P11.4 produces an advisory confidence model only. No automatic adjustments to planning thresholds, no self-modifying configuration.
- **Recurrence learning**: Reduced recurrence observation is explicitly deferred. The `meta.recurrenceLearningEnabled` field is `false` and future phases will toggle it.
- **Cross-subsystem attribution**: Score improvement is attributed to the objective targeting that subsystem. Causal chains (objective A fixed, so B improved as a side effect) are not modeled — that is P11.5 (Forecasting).
- **LLM-based learning**: P11.4 is fully deterministic. No LLM or probabilistic inference is used.
- **Confidence aggregation across plans**: Each learning cycle is independent. Cross-plan trend analysis is a future concern.
- **Real-time learning**: On-demand only (`alix executive learn`). No watch mode or continuous observation.
- **Confidence decay**: Models do not automatically lose confidence over time. Time-based decay is a future refinement.
- **Feedback loop detection**: P11.4 does not detect whether its own updates cause oscillations in the planning system. That is a P12-level concern.

---

## 11. File Map

| File | Purpose |
|---|---|
| `src/learning/learning-types.ts` | Type definitions: `UpdatedConfidenceModel`, `ConfidenceUpdate`, `LearningSignal`, `LearningEngineConfig`, `LearningEngineError` |
| `src/learning/learning-config.ts` | Default config export |
| `src/learning/build-confidence-model.ts` | Pure function `buildConfidenceModel(plan, outcomes, baselineScores, currentScores, context, config) → UpdatedConfidenceModel` |
| `src/learning/confidence-model-store.ts` | Append-only JSONL store with `save`, `loadLatest`, `loadById`, `list` |
| `src/learning/learning-engine.ts` | Orchestrator: loads plan/outcomes/scores → calls pure function → saves |
| `src/cli/commands/executive-learn-handler.ts` | CLI handler for `alix executive learn` |
| `tests/learning/build-confidence-model.vitest.ts` | 12 pure function tests |
| `tests/learning/learning-engine.vitest.ts` | 3 engine tests |
| `tests/learning/confidence-model-store.vitest.ts` | 4 store tests |
| `tests/learning/executive-learn-handler.vitest.ts` | 2 CLI tests |

---

## 12. Integration with P11 Pipeline

### 12.1 Downstream consumer: P11.5 Forecasting

`UpdatedConfidenceModel` is consumed by P11.5 (Forecasting) to weight health predictions. Higher confidence in a mechanism → more weight on that mechanism's historical pattern when forecasting. Lower confidence → more conservative forecast bounds.

### 12.2 Feed-forward to future planning cycles

The confidence model does not directly modify P11.3's algorithm. Instead, it is consumed as input by the next planning cycle:

```
Cycle N:  Plan(old confidence model) → Learn(plan, outcomes) → UpdatedConfidenceModel
Cycle N+1: Plan(UpdatedConfidenceModel) → Learn(new plan, new outcomes) → UpdatedConfidenceModel
```

The mechanism for applying confidence from the model into the next planning cycle is a P11.5+ concern (the "how to feed the model back into planning" question). In v1, the model is advisory — it records what was learned without enforcing any threshold changes.

### 12.3 Observability

- `alix executive learn` CLI for manual triggering
- Models persisted as append-only JSONL for audit trail
- Each `ConfidenceUpdate` links to its source objective and plan for full traceability
