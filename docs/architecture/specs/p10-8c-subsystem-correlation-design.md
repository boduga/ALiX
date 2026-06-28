# P10.8c — Subsystem-Delta Correlation Design

> **Status:** Design spec — approved, ready for implementation planning.
> **Builds on:** P10.7b (`RecommendationReportStore`), P10.8a (`RecommendationEntry`), P10.5b (`OutcomeReportStore`, `SubsystemDelta`).
> **Risk:** LOW. Read-only analyzer — pure function + store joins. No mutation, no new stores, no proposal creation.
> **Branch:** Off `main` (P10.8b already merged).

## Reasoning

P10.8a measured operator responsiveness (did they act on recommendations?).
P10.8b measured proposal outcome (did the applied proposal help?).
**P10.8c measures subsystem health** (did the recommendation's target subsystem measurably improve after the recommendation was made?).

The join is by **subsystem name + time window** — there is no direct link from recommendation to outcome report. The correlation is causal-adjacent: recommendations predict degradation, and later outcome reports measure whether that prediction was followed by improvement or continued decline.

> **P10.8c computes correlation, not proof of causation.**

## Architecture

```
alix executive subsystem-correlation [--report <id>] [--mode strict|loose] [--lag <days>] [--json]
        │
        ├─ RecommendationReportStore.list() → load() each
        ├─ OutcomeReportStore.list() → load() completed reports
        ├─ For each recommendation, find matching outcome SubsystemDeltas:
        │      strict: outcome.generatedAt > rec.generatedAt
        │          AND outcome.generatedAt ≤ rec.generatedAt + lagDays
        │          AND SubsystemDelta.subsystem === rec.subsystem
        │      loose: outcome.generatedAt inside analysis window
        │          AND SubsystemDelta.subsystem === rec.subsystem
        ├─ computeSubsystemCorrelation() → SubsystemCorrelationReport     (pure)
        └─ render terminal tables or JSON
```

## Timing model

Two modes controlled by `--mode`:

| Mode | Include condition | Use case |
|---|---|---|
| `strict` (default) | `generatedAt > rec.generatedAt AND generatedAt ≤ rec.generatedAt + lagDays` | Causal direction — recommendation before outcome |
| `loose` | `generatedAt` inside the analysis window (same `--since` filter as P10.8a) | Exploratory audit when timing is fuzzy |

Default `--lag` = 30 days. The lag window prevents old future outcomes from being wrongly attributed to a recommendation forever.

## New types

```ts
export type CorrelationMode = "strict" | "loose";

export interface SubsystemCorrelationEntry {
  /** Recommendation identity */
  reportId: string;
  generatedAt: string;
  recIndex: number;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  /** Outcome report data (the following SubsystemDelta) */
  outcomeReportId: string;
  outcomeGeneratedAt: string;
  baselineScore: number;     // SubsystemDelta.baselineScore
  currentScore: number;      // SubsystemDelta.currentScore
  delta: number;             // SubsystemDelta.delta
  lagDays: number;           // days between rec.generatedAt and outcome.generatedAt
}

export interface SubsystemCorrelation {
  subsystem: string;
  recommendationCount: number;          // recs about this subsystem
  outcomeReportCount: number;           // outcome reports that could correlate
  correlationCount: number;             // recs with at least one matched outcome
  uncorrelatedRecommendationCount: number; // recs with no matching outcome in window
  averageDelta: number;                 // mean delta of all matched correlations
  improvingCount: number;               // matched correlations where delta > 0
  degradingCount: number;               // matched correlations where delta < 0
  unchangedCount: number;               // matched correlations where delta === 0
  netDelta: number;                     // sum of all correlation deltas
}

export interface SignalCorrelation {
  signal: string;
  recommendationCount: number;          // recs with this signal
  correlationCount: number;             // recs with at least one matched outcome
  averageDelta: number;                 // mean delta across correlated recs
  improvingRate: number;                // improvingCount / correlationCount, [0..1]
  coverageRate: number;                 // correlationCount / recommendationCount, [0..1]
}

export interface SubsystemCorrelationReport {
  correlationStatus: "ok" | "no_data";
  correlationMode: CorrelationMode;
  correlationLagDays: number;
  reportCount: number;
  totalRecommendations: number;
  correlatedRecommendations: number;
  subsystemCorrelations: SubsystemCorrelation[];
  signalCorrelations: SignalCorrelation[];
  correlations: SubsystemCorrelationEntry[];
  loadWarnings: string[];
}
```

**Key distinction:** `uncorrelatedRecommendationCount` tracks recommendations that had no matching outcome report within the lag window. This distinguishes "the signal was bad" from "there wasn't enough follow-up data yet" — a critical guard for actionability.

**`coverageRate`** on SignalCorrelation answers the same question per signal: of the recommendations with this signal, what fraction had matching outcome data? Low coverage means the signal needs more observation time, not that it's wrong.

## Pure functions

### `computeSubsystemCorrelation()`

```ts
export function computeSubsystemCorrelation(
  recommendations: readonly RecommendationEntry[],
  outcomeReports: readonly ExecutiveOutcomeEvaluationReport[],
  correlationMode: CorrelationMode,
  correlationLagDays: number,
  generatedAt: string,
): SubsystemCorrelationReport
```

**Logic:**
1. Filter outcome reports to `evaluationStatus === "completed"`.
2. For each recommendation, find matching outcome reports where a SubsystemDelta exists for the recommendation's subsystem and the timing condition holds.
3. Build `SubsystemCorrelationEntry[]` — one per match (a single recommendation may match multiple outcome reports).
4. Aggregate by subsystem → `SubsystemCorrelation[]`.
5. Aggregate by signal → `SignalCorrelation[]`.

### `matchSubsystemOutcomes()`

```ts
function matchSubsystemOutcomes(
  rec: RecommendationEntry,
  reports: readonly ExecutiveOutcomeEvaluationReport[],
  mode: CorrelationMode,
  lagDays: number,
): Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }>
```

Filters logic:
```
for each report:
  for each objective in report.objectives:
    for each sd in objective.subsystemDeltas:
      if sd.subsystem !== rec.subsystem: continue
      if mode === "strict":
        if report.generatedAt ≤ rec.generatedAt: continue
        if report.generatedAt > rec.generatedAt + lagDays * MS_PER_DAY: continue
      // else loose: no time gate beyond the analysis window
      yield { report, delta: sd }
```

### `aggregateBySubsystem()`

Groups entries by `subsystem`, computes per-subsystem metrics.

### `aggregateBySignal()`

Groups entries by `signal`, computes per-signal metrics.

## CLI interface

```bash
alix executive subsystem-correlation [--report <id>] [--mode strict|loose] [--lag <days>] [--json]
```

**Defaults:** `--mode strict --lag 30`

**Terminal output:**

```
Subsystem Correlation Report (strict, 30 day lag)
Generated: 2026-06-27T12:00:00.000Z
Reports: 4 | Recommendations: 18 | Correlated: 12

Subsystem        Recs  Outcomes  Correlated  Uncorr  AvgDelta  Improv  Degrade  NetDelta
workflow         8     4         6           2       +1.2      4       2        +7.2
routing          4     3         3           1       -0.8      1       2        -2.4
learning         2     1         2           0       +0.5      1       0        +0.5

Signal                Recs  Correlated  AvgDelta  ImproveRate  Coverage
degrading_trend       8     7           +0.8      57%          88%
persistent_instability 4     3           -0.4      33%          75%
low_confidence        2     0           —         —            0%
```

**Per-entry detail** (shown when no `--json` and `--report <id>` given):

```
Report           Generated    Subsystem  Signal               Outcome    Lag  Delta
rec-wf-20260625  2026-06-25  workflow   degrading_trend      outcome-a  2d   +1.5
rec-wf-20260625  2026-06-25  workflow   degrading_trend      outcome-b  5d   -0.3
rec-rt-20260620  2026-06-20  routing    persistent_instability outcome-c  10d  -2.1
```

**JSON output** — full `SubsystemCorrelationReport`.

## Routing

Add to `src/cli/commands/executive.ts`:

```ts
case "subsystem-correlation": {
  const { handleSubsystemCorrelationCommand } = await import(
    "./executive-subsystem-correlation-handler.js"
  );
  return handleSubsystemCorrelationCommand(rest);
}
```

Subcommand list updated to include `subsystem-correlation`.

## Sentinel

Two new files:
- `src/executive/subsystem-correlation.ts` — pure correlation functions + types
- `src/cli/commands/executive-subsystem-correlation-handler.ts` — CLI handler (reads, no writes)

Both added to `EXECUTIVE_FILES`. No write exceptions — the handler only reads stores (load/list). No `ProposalStore.save`, no `RecommendationReportStore.save`.

## File structure

| File | Responsibility |
|---|---|
| `src/executive/subsystem-correlation.ts` | **Create** — types, `computeSubsystemCorrelation()`, `matchSubsystemOutcomes()`, aggregation |
| `src/cli/commands/executive-subsystem-correlation-handler.ts` | **Create** — CLI handler: load reports/outcomes, call pure functions, render |
| `src/cli/commands/executive.ts` | **Modify** — add `case "subsystem-correlation"` + update subcommand list |
| `tests/executive/subsystem-correlation.vitest.ts` | **Create** — pure function tests |
| `tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts` | **Create** — CLI integration tests |
| `tests/executive/executive-sentinels.vitest.ts` | **Modify** — add 2 new files to `EXECUTIVE_FILES` |

## Test plan

### Pure function tests (`subsystem-correlation.vitest.ts`)

**`matchSubsystemOutcomes`:**
- Matches subsystem across objectives within a report
- Strict mode: excludes outcomes generatedAt ≤ rec.generatedAt
- Strict mode: excludes outcomes beyond lag window
- Loose mode: includes all outcomes in analysis window regardless of timing
- No matching subsystem → empty result
- Empty reports array → empty result

**`computeSubsystemCorrelation`:**
- No recommendations → `no_data`
- No outcome reports → `no_data`
- Mixed matching → correct SubsystemCorrelation counts
- Per-subsystem `averageDelta`, `netDelta`, `improvingCount`, `degradingCount` correct
- Multiple correlations for same recommendation → counted correctly
- `uncorrelatedRecommendationCount` correctly reflects recs with no match
- `lagDays` correctly computed as floor of time difference

**Per-signal aggregation:**
- Aggregate by signal with correct averageDelta
- `improvingRate` = improvingCount / correlationCount
- `coverageRate` = correlationCount / recommendationCount
- All outcomes are `no_data` → coverageRate 0

### CLI tests (`executive-subsystem-correlation-cli.vitest.ts`)
- Terminal table renders subsystem correlations
- JSON output includes all fields
- `--mode loose` changes filtering behavior
- `--lag` custom window works
- `--report <id>` single report analysis
- No outcome reports → clean `no_data` result
- Sentinels pass for new files

## Hard governance boundary

```
P10.8c computes and reports correlation.
P10.8c does not write.
P10.8c does not mutate persisted recommendations or outcome reports.
P10.8c does not create proposals.
P10.8c does not trigger outcome evaluation.
```

## Open questions / edge cases

1. **Multiple SubsystemDeltas per recommendation** — A recommendation about "workflow" may match multiple outcome reports that each have a workflow delta. Each match produces a separate `SubsystemCorrelationEntry`. The per-subsystem `averageDelta` is the mean of all entries for that subsystem.

2. **`coverageRate` vs `correlationCount`** — `coverageRate` is at the signal level (`correlationCount / recommendationCount`). A signal with high coverage but low improvingRate is a real problem. A signal with low coverage is just under-observed.

3. **Recommendations with no proposalId** — The correlation is by subsystem + time, not by proposal lifecycle. Unbridged recommendations still appear in the correlation analysis — they're recommendations about a subsystem, and we can still check if that subsystem improved regardless of whether the recommendation was acted on. This is intentional: it measures whether the recommendation *signal itself* was predictive, independent of operator action.

4. **Multiple signals per subsystem** — A subsystem may have recommendations with different signals (e.g., `degrading_trend` and `persistent_instability`). Both appear as separate entries in `signalCorrelations`, and the subsystem correlation aggregates across all signals for that subsystem.
