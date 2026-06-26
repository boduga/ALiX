# P10.6 — Learning Engine (Design)

> **Status:** Design spec — ready for implementation plan.
> **Builds on:** P10.5b `OutcomeReportStore` (unchanged), P10.5a `ExecutiveOutcomeEvaluationReport` (unchanged).
> **Risk level:** LOW — read-only analytics, pure aggregation function, no evidence, no engine hooks, no store changes.

## Precision

- Percentage rates (`successRate`, `mixedRate`, `degradationRate`, `unchangedRate`) are stored as numeric values (e.g., `0.583` for 58.3%) in JSON and rendered with one decimal place (e.g., `58.3%`) in the terminal table.
- `averageDelta` is stored as a numeric value with one decimal place.
- All rates are computed from `occurrenceCount`, not `inputReportCount` or `analyzedReportCount`.

## Hard governance boundary

```
P10.6 may read OutcomeReportStore (list + load).
P10.6 may read ExecutiveOutcomeEvaluationReport.
P10.6 must not modify OutcomeReportStore.
P10.6 must not modify OutcomeReportStore's types.
P10.6 must not add evidence types.
P10.6 must not modify the execution engine.
P10.6 must not modify the outcome evaluator.
P10.6 must be read-only — no mutation of persisted state.
```

## 1. Output surface

Single CLI subcommand:

```
alix executive learn trends [--window N] [--json]
```

- `--window N` — analyze the last N reports globally (default: 10, min: 1)
- `--json` — output as JSON (default: terminal table)

Terminal table example:

```
$ alix executive learn trends --window 10

Executive Learning Trends (last 10 plans)
Generated: 2026-06-26T05:00:00.000Z

Subsystem       Occurrences  Success  Mixed  Degraded  Avg Δ
workflow        12           58.3%    16.7%  8.3%      +6.4
governance      9            33.3%    22.2%  22.2%     -1.2
learning        6            50.0%    33.3%  0.0%      +3.1

Objective Type  Occurrences  Success  Mixed  Degraded  Avg Δ
stabilize       9            66.7%    11.1%  11.1%     +8.2
improve         6            33.3%    33.3%  16.7%     +1.5

Input: 12 reports | Skipped: 2 (evaluationStatus ≠ completed)
```

## 2. Data flow

```
outcomeStore.list()
  → sort by generatedAt desc
  → slice(0, window)
  → for each: outcomeStore.load(reportId)
  → full ExecutiveOutcomeEvaluationReport[]

computeLearningTrends(reports, opts)
  ↓
  filter reports where evaluationStatus === "completed"
  for each completed report:
    for each objective in report.objectives:
      track objectiveType → outcome, aggregateDelta
      for each subsystemDelta in objective.subsystemDeltas:
        track subsystem → delta, outcome

  produce grouped dimension metrics:
    subsystemTrends:  group by subsystem name
    objectiveTrends:  group by objectiveType string

  sort subsystemTrends by averageDelta desc
  sort objectiveTrends by averageDelta desc

  return TrendResult
```

### Metric definition (per dimension)

| Metric | Source | Computation |
|--------|--------|-------------|
| `occurrenceCount` | dimension group size | Count of occurrences across all windowed reports. Each report contributes at most one occurrence per unique subsystem within each of its objectives. |
| `successRate` | outcome per occurrence | `count(outcome === "improved") / total` |
| `mixedRate` | outcome per occurrence | `count(outcome === "mixed") / total` |
| `degradationRate` | outcome per occurrence | `count(outcome === "degraded") / total` |
| `unchangedRate` | outcome per occurrence | `count(outcome === "unchanged") / total` |
| `averageDelta` | dimension-specific | Subsystem: mean of `subsystemDeltas[].delta`. Objective: mean of `aggregateDelta` |

### Window semantics

`window = last N reports globally`, then aggregate those reports.

- `outcomeStore.list()` returns all reports sorted by `generatedAt desc`
- Slice to `min(window, reports.length)`
- Load full reports for the sliced range
- Filter to `evaluationStatus === "completed"` before aggregating
- The remaining reports (non-completed) are counted in `skippedReportCount`

This is deterministic: the same store at the same point in time always produces the same window.

## 3. Architecture

### 3a. Pure aggregation function

```
src/executive/learning-engine.ts
```

```ts
export interface LearnTrendsOptions {
  window: number;
}

export interface SubsystemTrend {
  subsystem: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export interface ObjectiveTrend {
  objectiveType: string;
  occurrenceCount: number;
  successRate: number;
  mixedRate: number;
  degradationRate: number;
  unchangedRate: number;
  averageDelta: number;
}

export interface TrendResult {
  trendStatus: "ok" | "insufficient_data";
  generatedAt: string;
  window: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  totalImproved: number;
  totalMixed: number;
  totalDegraded: number;
  totalUnchanged: number;
  subsystemTrends: SubsystemTrend[];
  objectiveTrends: ObjectiveTrend[];
  warnings: string[];
}

export function computeLearningTrends(
  reports: ExecutiveOutcomeEvaluationReport[],
  opts: LearnTrendsOptions,
): TrendResult
```

The function:
- Is **pure** — no I/O, no side effects
- Receives already-loaded `ExecutiveOutcomeEvaluationReport[]`
- Filters to `evaluationStatus === "completed"`
- Groups by subsystem and objectiveType
- Computes per-group metrics using the source column from §2
- Sorts by `averageDelta desc`
- Returns `TrendResult`

**Corner cases:**
- Empty `reports` array → `trendStatus: "insufficient_data"`, empty trends
- All reports non-completed → `trendStatus: "insufficient_data"`, `analyzedReportCount: 0`, `skippedReportCount: inputReportCount`
- Report with 0 objectives → contributes to `inputReportCount` but adds no dimension data (counted as analyzed, not skipped)
- Report with 0 `subsystemDeltas` in its objectives → subsystem dimension gets no contribution from this report; other dimensions unaffected

### 3b. CLI handler

```
src/cli/commands/executive-learn-handler.ts
```

Responsible for:
1. Constructing `OutcomeReportStore` (read-only path: `.alix/executive/outcomes`)
2. Calling `outcomeStore.list()` and `outcomeStore.load()` for the window range
3. Calling `computeLearningTrends(reports, opts)`
4. Rendering terminal table or `JSON.stringify(trendResult)`

```ts
export async function handleLearnCommand(args: string[]): Promise<void>
```

### 3c. CLI routing

In `src/cli/commands/executive.ts`, add a new case:

```ts
case "learn": {
  const { handleLearnCommand } = await import("./executive-learn-handler.js");
  return handleLearnCommand(args);
}
```

## 4. Sentinel plan

No new write exceptions. Both new files are pure read-only:

- `src/executive/learning-engine.ts` — pure function, no I/O. Add to `EXECUTIVE_FILES` allowlist.
- `src/cli/commands/executive-learn-handler.ts` — only calls `list()`/`load()`, no write APIs. Add to `EXECUTIVE_FILES` allowlist.

If the sentinel linter detects forbidden imports (e.g., `writeFileSync` transitively from `OutcomeReportStore`), add a minimal scoped exception. Expected outcome: no exception needed.

## 5. Files changed

| Action | Path | Notes |
|--------|------|-------|
| **Create** | `src/executive/learning-engine.ts` | Pure `computeLearningTrends()` + types |
| **Create** | `src/cli/commands/executive-learn-handler.ts` | Thin CLI handler |
| **Modify** | `src/cli/commands/executive.ts` | Add `"learn"` case routing |
| **Modify** | `tests/executive/executive-sentinels.vitest.ts` | Add new files to `EXECUTIVE_FILES` |
| **Create** | `tests/executive/learning-engine.vitest.ts` | 9+ pure unit tests |
| **Create** | `tests/cli/commands/executive-learn-cli.vitest.ts` | 5+ integration tests |

### Files NOT modified

- `src/executive/outcome-store.ts` — read only
- `src/executive/outcome-evaluator.ts` — untouched
- `src/executive/execution-engine.ts` — untouched
- No protected type files (ADR-0004)

## 6. Test plan

### Unit tests (`learning-engine.vitest.ts`)

- Computes subsystem trends per-subsystem from `subsystemDeltas[]`
- Computes objective trends per-objectiveType from `aggregateDelta`
- Classifies success/mixed/degraded/unchanged correctly from `outcome`
- Filters out non-completed reports
- Returns `insufficient_data` for empty input
- Returns `insufficient_data` when all reports are non-completed
- `skippedReportCount` matches input - analyzed difference
- Window slicing — only N of M reports analyzed
- Sorts by `averageDelta desc`
- Report with no objectives → contributes to analyzed count but not to dimensions

### Integration tests (`executive-learn-cli.vitest.ts`)

- Terminal table renders with correct headers and data
- `--json` produces valid parsed JSON with expected shape
- `--window 5` limits analysis to 5 reports
- `--json` includes `skippedReportCount` when non-completed reports exist
- Empty store → CLI outputs `insufficient_data` JSON without crash
- **Corrupt report resilience**: pre-existing report file with bad contentHash → warning to stderr, remaining valid reports still analyzed, JSON output remains valid

## 7. Deferred to P10.6b

- Dashboard panel integration (reuses the same `computeLearningTrends()`)
- Recommendation feedback loop (P10.6c)
- Automated period comparison (`--compare` flag)

## 8. Risk

**LOW** — read-only analytics layer. No new evidence types, no engine hooks, no store mutation, no protected type file changes, no change to the plan approval gate or proposal bridge. Pure function is trivially testable.
