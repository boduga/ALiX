# P10.7a — Recommendation Engine Design

> **Status:** Design spec — ready for implementation planning.
> **Builds on:** P10.6 Learning Engine (`computeLearningTrends`, `TrendResult`).
> **Risk:** LOW. Read-only analytics layer — no mutation, no proposal creation, no engine hooks.
> **Branch:** `feature/p10-7a-recommendation-engine` (off `main` at `alix-p10-6-complete`).

## Architecture

```
OutcomeReportStore  ──►  computeLearningTrends()  ──►  TrendResult
        │                                                │
        └──────────┐                              ┌──────┘
                   ▼                              ▼
        computeRecommendations(trends, reports?)
                   │
                   ▼
        RecommendationDraft[]
                   │
        CLI: alix executive recommend [--window N] [--json]
```

Three-layer separation:

| Layer | Responsibility |
|---|---|
| `computeLearningTrends()` | Aggregate historical outcomes — unchanged from P10.6 |
| `computeRecommendations()` | Detect actionable signals from trends |
| CLI handler | Load reports, compose pipeline, render output |

**Architectural invariants:**
- Pure function — no disk access, no mutation, no side effects
- No proposal creation — recommendations are advisory only
- No engine hooks — no automatic triggers
- No dashboard — presentation deferred to P10.6b or later

## Types

```ts
export type RecommendationSignal =
  | "degrading_trend"
  | "persistent_instability"
  | "improving_trend"
  | "low_confidence";

export type RecommendationSeverity = "info" | "low" | "medium" | "high";

export interface RecommendationDraft {
  subsystem: string;
  signal: RecommendationSignal;
  severity: RecommendationSeverity;
  recommendation: string;
  confidence: number;
  occurrenceCount: number;
  averageDelta: number;
  evidenceReportIds?: string[];
}

export const RECOMMENDATION_OK = "ok";
export const RECOMMENDATION_INSUFFICIENT_DATA = "insufficient_data";

export interface RecommendationResult {
  recommendationStatus: typeof RECOMMENDATION_OK | typeof RECOMMENDATION_INSUFFICIENT_DATA;
  generatedAt: string;
  requestedWindow: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  subsystemRecommendations: RecommendationDraft[];
  warnings: string[];       // recommendation/analysis warnings
  loadWarnings: string[];   // corrupt or failed outcome-report loads from the CLI pipeline
}
```

## Signal Detection

Lightweight heuristics per `TrendResult.subsystemTrends[]`. Only subsystems with actionable signals are emitted. `stable_performance` is never emitted in P10.7a (no signal → no draft).

| Condition | Signal | Severity | Confidence heuristic |
|---|---|---|---|
| `averageDelta < -1` AND `degradationRate > 0.3` | `degrading_trend` | `high` if `avgDelta < -3`, else `medium` | `min(0.95, abs(avgDelta) * 0.15 + degradationRate * 0.4 + min(occurrenceCount/10, 0.2))` |
| `averageDelta > 1` AND `successRate > 0.5` | `improving_trend` | `info` | `min(0.95, avgDelta * 0.1 + successRate * 0.4 + min(occurrenceCount/10, 0.2))` |
| `mixedRate > 0.4` AND `occurrenceCount >= 3` | `persistent_instability` | `medium` | `min(0.9, mixedRate * 0.5 + min(occurrenceCount/10, 0.3))` |
| `occurrenceCount <= 2` | `low_confidence` | `low` | `min(0.3, occurrenceCount * 0.1)` |

**Precedence (a subsystem matches at most one signal):**

```
1. low_confidence        (occurrenceCount <= 2)
2. degrading_trend
3. persistent_instability
4. improving_trend
5. else → no draft
```

Reason: with too little data, avoid overclaiming degradation or improvement. A low-occurrence subsystem that also has a negative `averageDelta` is classified `low_confidence`, not `degrading_trend`.

**Confidence rounding:** every confidence value is rounded to two decimals (`round2`) before being placed on the draft. Terminal renders `0.72`; JSON carries the numeric `0.72`.

**Sort order:** `confidence desc → |averageDelta| desc → subsystem asc`

## Recommendation Text

Deterministic templates per `(signal, severity)` — no LLM calls:

| Signal | Severity | Template |
|---|---|---|
| `degrading_trend` | high | `Investigate {subsystem} regressions` |
| `degrading_trend` | medium | `Monitor {subsystem} for continued degradation` |
| `persistent_instability` | medium | `Review {subsystem} for stability improvements` |
| `improving_trend` | info | `Continue current {subsystem} optimizations` |
| `low_confidence` | low | `Collect more data on {subsystem} before acting` |

## Function Signature

```ts
export function computeRecommendations(
  trends: TrendResult,
  reports?: ExecutiveOutcomeEvaluationReport[],
  generatedAt: string = new Date().toISOString(),
): RecommendationResult;
```

- `trends` is required — signal detection reads subsystem trends and overall trend status.
- `reports` is optional — reserved for future evidence examples (e.g., exemplar report IDs).
- `generatedAt` is injectable — keeps tests fully deterministic (same pattern as P10.6).
- When `trends.trendStatus` is `"insufficient_data"`, returns `recommendationStatus: "insufficient_data"` with empty recommendations.
- When no subsystem crosses an actionable threshold, returns `recommendationStatus: "ok"` with empty recommendations.

## CLI Interface

```
alix executive recommend [--window N] [--json]
```

**Terminal table:**

```
Subsystem        Signal                 Severity  Confidence  Occurrences  Avg Δ  Recommendation
workflow         degrading_trend        high      0.72        8            -3.2   Investigate workflow regressions
routing          persistent_instability medium    0.55        5            -0.8   Review routing stability
memory_cache     improving_trend        info      0.41        4            +2.1   Continue current optimization
anomaly_detector low_confidence         low       0.15        1            -1.0   Collect more data before acting
```

**Empty terminal output:**

```
No recommendations generated.
Recommendation status: ok
Analyzed reports: 10
```

**JSON output:**

```json
{
  "recommendationStatus": "ok",
  "generatedAt": "2026-06-26T12:00:00.000Z",
  "requestedWindow": 10,
  "inputReportCount": 12,
  "analyzedReportCount": 10,
  "skippedReportCount": 2,
  "subsystemRecommendations": [
    {
      "subsystem": "workflow",
      "signal": "degrading_trend",
      "severity": "high",
      "recommendation": "Investigate workflow regressions",
      "confidence": 0.72,
      "occurrenceCount": 8,
      "averageDelta": -3.2
    }
  ],
  "warnings": [],
  "loadWarnings": []
}
```

## Routing

Add to `executive.ts`:

```ts
case "recommend": {
  const { handleRecommendCommand } = await import(
    "./executive-recommend-handler.js"
  );
  return handleRecommendCommand(rest);
}
```

Subcommand list updated to include `recommend`.

## Sentinel

Add `src/executive/recommendation-engine.ts` and `src/cli/commands/executive-recommend-handler.ts` to the executive purity sentinel. No write exceptions — read-only files only.

## File Structure

| File | Responsibility |
|---|---|
| `src/executive/recommendation-engine.ts` | Pure `computeRecommendations()` function, types, constants, signal detection, templates |
| `src/cli/commands/executive-recommend-handler.ts` | CLI handler — load reports, compose pipeline, render terminal/JSON |
| `src/cli/commands/executive.ts` | Add `case "recommend"` + update subcommand list |
| `tests/executive/recommendation-engine.vitest.ts` | Pure function tests |
| `tests/cli/commands/executive-recommend-cli.vitest.ts` | CLI integration tests |
| `tests/executive/executive-sentinels.vitest.ts` | Add new files to sentinel |

## Test Plan

### Pure function tests (recommendation-engine.vitest.ts)
- Degrading trend detection (high and medium severity)
- Improving trend detection
- Persistent instability detection
- Low confidence detection
- Insufficient data passthrough from TrendResult
- Empty recommendations for stable/no-signal data
- Sort order: confidence desc → |delta| desc → subsystem asc
- Confidence bounds: 0–1 (and rounded to two decimals)
- Severity mapping: degrading_trend high vs medium boundary
- Precedence: low_confidence wins over degrading/improving when occurrenceCount <= 2

### CLI tests (executive-recommend-cli.vitest.ts)
- Terminal table rendering with recommendations
- JSON output structure
- Empty/stable results display
- Insufficient data display
- Window limiting
- Corrupt report handling

### Sentinel
- Both new files added to EXECUTIVE_FILES, no write exceptions
