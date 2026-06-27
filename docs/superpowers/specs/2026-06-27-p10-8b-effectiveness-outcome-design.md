# P10.8b — Recommendation Effectiveness + ProposalEffectiveness Join

> **Status:** Design spec — approved, ready for implementation planning.
> **Builds on:** P10.8a (`RecommendationEntry`, `SignalCalibration`, `EffectivenessResult`), P5.2b (`EffectivenessStore`, `ProposalEffectivenessReport`, `EffectivenessRecommendation`).
> **Risk:** LOW. Read-only analyzer — pure function + one more store join. No mutation, no new stores, no schema changes to persisted types.
> **Branch:** Off `main` (P10.8a already merged).

## Reasoning

P10.8a told us *whether operators acted on recommendations* (did they bridge? approve? apply?). It stops at the proposal lifecycle boundary:

```
recommendation ──bridge──▶ proposal ──apply──▶ applied ──❓ what happened next?
```

P10.8b crosses that boundary. For recommendations that reached `applied`, it joins to `EffectivenessStore` to answer: *did the applied proposal actually improve things?* The proposal's `ProposalEffectivenessReport.recommendation` (keep/revert/investigate) is the ground-truth outcome signal from P5.2b.

**Three-slice progression (restated):**
- **P10.8a:** operator responsiveness — did they pick it up?
- **P10.8b:** proposal outcome — after applying, did it help?
- **P10.8c:** subsystem health — did the recommendation's target subsystem measurably improve?

## Architecture

```
alix executive recommendation-effectiveness [--report <id>] [--since <days>] [--threshold <days>] [--json]
        │
        ├─ RecommendationReportStore.list() → load() each      ── P10.7b (read)
        ├─ ProposalStore.load(proposalId) for each bridged rec ── adaptation (read)
        ├─ EffectivenessStore.list() → Map<proposalId, outcome> ── P5.2b (read) ← NEW
        ├─ classifyRecommendation() → disposition               ── pure (unchanged)
        ├─ applyEffectivenessData() → effectivenessOutcome      ── pure (NEW)
        ├─ computeRecommendationEffectiveness() → calibrations  ── pure (extended)
        └─ render terminal tables or JSON
```

The join is **always-on**. If `.alix/adaptation/effectiveness/` is missing or empty, all applied recommendations get `effectivenessOutcome: "no_data"` — graceful degradation, no flag needed.

## The join

```
RecommendationEntry.proposalId
    ↓
EffectivenessStore.load(proposalId)  (via .list() + Map)
    ↓
ProposalEffectivenessReport.recommendation  →  "keep" | "revert" | "investigate"
    ↓
effectivenessOutcome
```

`EffectivenessStore.list()` returns all `ProposalEffectivenessReport` objects. The handler builds `Map<proposalId, EffectivenessOutcome>` once, then enriches each `RecommendationEntry` whose `disposition === "applied"` and `proposalId` is present.

## New type

```ts
export type EffectivenessOutcome = "keep" | "revert" | "investigate" | "no_data";
```

`no_data` means the proposal was applied but no effectiveness report exists in the store (never assessed, or assessment not yet run).

## Changes to existing types

### RecommendationEntry

New optional field:

```ts
export interface RecommendationEntry {
  // ... existing fields unchanged ...
  disposition: RecommendationDisposition;
  /** P10.8b: effectiveness outcome from ProposalEffectivenessReport.
   *  Only present when disposition === "applied".
   *  "keep" | "revert" | "investigate" from ProposalEffectivenessReport.recommendation.
   *  "no_data" when no effectiveness report exists for this proposal. */
  effectivenessOutcome?: EffectivenessOutcome;
  ageDays: number;
}
```

### SignalCalibration

Four new counters and two new derived metrics:

```ts
export interface SignalCalibration {
  // ... existing fields unchanged ...
  applied: number;           // unchanged — stays as total applied
  // P10.8b: effectiveness breakdown of applied recommendations
  appliedKeep: number;
  appliedRevert: number;
  appliedInvestigate: number;
  appliedNoData: number;
  /** appliedKeep / (appliedKeep + appliedRevert + appliedInvestigate), [0..1], 2-decimal.
   *  NaN (no assessed recs) → 0. */
  effectivenessRate: number;
  /** (appliedKeep + appliedRevert + appliedInvestigate) /
   *  (appliedKeep + appliedRevert + appliedInvestigate + appliedNoData), [0..1], 2-decimal.
   *  NaN (no applied recs) → 0. */
  effectivenessCoverage: number;
  // ... existing fields unchanged ...
  bridgedCount: number;
  actionRate: number;
}
```

**Metrics rationale (from design approval):**
- `effectivenessRate` excludes `appliedNoData` from the denominator — missing data should not unfairly lower the rate.
- `effectivenessCoverage` tracks what fraction of applied recs have effectiveness data — a process-health metric ("are we actually assessing proposals?").
- Together: `effectivenessRate` = quality of outcomes; `effectivenessCoverage` = thoroughness of assessment.

### EffectivenessResult

No structural changes. The `signalCalibration` array automatically gains the new fields.

### ClassifyInput

No changes. The classification logic doesn't need the effectiveness outcome (classification is orthogonal — the disposition tells us lifecycle state, outcome tells us effectiveness).

## New pure function

```ts
export function applyEffectivenessData(
  entries: readonly RecommendationEntry[],
  outcomeByProposalId: ReadonlyMap<string, EffectivenessOutcome>,
): RecommendationEntry[];
```

**Logic:**
```
for each entry:
  if entry.disposition === "applied" AND entry.proposalId is set:
      outcome = outcomeByProposalId.get(entry.proposalId)
      entry.effectivenessOutcome = outcome ?? "no_data"
  else:
      entry.effectivenessOutcome = undefined
```

Returns new entries (does not mutate input — pure, no side effects).

The function is separate from `classifyRecommendation` because:
1. The disposition doesn't depend on effectiveness data (orthogonal axes).
2. The handler could skip the effectiveness join entirely and still get correct dispositions — the function is additive.
3. Test isolation: effectiveness tests don't need to re-test classification.

## Changes to `computeRecommendationEffectiveness`

The aggregation function gains effectiveness tallying in its per-signal loop. After the existing `switch (entry.disposition)` block, if `disposition === "applied"` and `entry.effectivenessOutcome` is set, increment the matching counter:

```
after the existing switch block:

if entry.disposition === "applied" and entry.effectivenessOutcome:
    switch entry.effectivenessOutcome:
        case "keep":        cal.appliedKeep++; break
        case "revert":      cal.appliedRevert++; break
        case "investigate": cal.appliedInvestigate++; break
        case "no_data":     cal.appliedNoData++; break
```

After the actionRate computation loop, compute effectiveness metrics per signal:

```
const assessedCount = cal.appliedKeep + cal.appliedRevert + cal.appliedInvestigate;
cal.effectivenessRate = assessedCount > 0
    ? round2(cal.appliedKeep / assessedCount)
    : 0;
cal.effectivenessCoverage = (assessedCount + cal.appliedNoData) > 0
    ? round2(assessedCount / (assessedCount + cal.appliedNoData))
    : 0;
```

The `round2` helper already exists in the module.

## CLI handler changes

### 1. Import EffectivenessStore

```ts
import { EffectivenessStore } from "../../adaptation/effectiveness-store.js";
import type { EffectivenessOutcome } from "../../executive/recommendation-effectiveness.js";
```

### 2. Load effectiveness data (after proposal loading, before classification)

```ts
const effectivenessStore = new EffectivenessStore(
  join(cwd, ".alix", "adaptation", "effectiveness"),
);
const outcomeMap = new Map<string, EffectivenessOutcome>();
try {
  const effectivenessReports = await effectivenessStore.list();
  for (const rep of effectivenessReports) {
    // Maps ProposalEffectivenessReport.recommendation ("keep"|"revert"|"investigate") to EffectivenessOutcome
    outcomeMap.set(rep.proposalId, rep.recommendation as EffectivenessOutcome);
  }
} catch {
  // Graceful degradation: effectiveness store missing or corrupt → all applied recs get no_data
}
```

### 3. Apply effectiveness data (after building entries, before aggregation)

```ts
const entriesWithEffectiveness = applyEffectivenessData(entries, outcomeMap);
const result = computeRecommendationEffectiveness(entriesWithEffectiveness, thresholdDays, generatedAt);
```

### 4. Terminal render: new columns

Replace the existing calibration table with:

```
Signal                Total  Unrev  Stale  Await  Appr  Applied  Rej  Fail  Miss  Kept  Rvt  Inv  NoD  EffRt  Cov
────────────────────────────────────────────────────────────────────────────────────────────────────────────────
degrading_trend       12     3      4      2      0     5        1     0     1      3     1    0    1    0.75   0.80
persistent_instability 4     1      2      0      0     1        0     0     0      0     0    1    0    0.00   1.00
improving_trend       2      0      2      0      0     0        0     0     0      0     0    0    0    —      —
```

- Kept/Rvt/Inv/NoD only shown for signals with `applied > 0`.
- If no signal has any applied recommendations, the effectiveness columns are hidden entirely (P10.8a-compatible output).
- `EffRt` shown as `—` when assessedCount === 0 (no applied recs with effectiveness data).
- `Cov` shown as `—` when applied === 0.

### 5. JSON output

JSON gains `effectivenessOutcome` on each `RecommendationEntry` and the four new fields + two new metrics in each `SignalCalibration`. No structural changes to `EffectivenessResult`.

## Sentinel

No sentinel changes needed. All files being modified are already in `EXECUTIVE_FILES`:
- `src/executive/recommendation-effectiveness.ts` — already listed (P10.8a)
- `src/cli/commands/executive-effectiveness-handler.ts` — already listed (P10.8a)

The handler pattern is `EffectivenessStore.list()` (read-only) → no `ProposalStore.save` or forbidden symbols. The existing sentinel allows `ProposalStore.load(` — reading proposals is already permitted. `EffectivenessStore` doesn't appear in the forbidden list because it was never added (read-only store).

## File structure

| File | Change |
|---|---|
| `src/executive/recommendation-effectiveness.ts` | Add `EffectivenessOutcome` type, `applyEffectivenessData()` pure function, extend `RecommendationEntry`, `SignalCalibration`. Extend `computeRecommendationEffectiveness()` tallying. |
| `src/cli/commands/executive-effectiveness-handler.ts` | Import `EffectivenessStore`, load effectiveness data, call `applyEffectivenessData()`, update terminal render. |
| `tests/executive/recommendation-effectiveness.vitest.ts` | Add `applyEffectivenessData` tests, effectiveness-aware `SignalCalibration` tests. |
| `tests/cli/commands/executive-effectiveness-cli.vitest.ts` | Add effectiveness-aware CLI tests. |

No new files. No new stores. No changes to `executive.ts` routing.

## Test plan

### Pure function tests (`recommendation-effectiveness.vitest.ts`)

**`applyEffectivenessData`:**
- Applies effectivenessOutcome to applied entries with proposalId in map
- Leaves non-applied entries untouched
- Applied entry with proposalId NOT in map → `no_data`
- Applied entry with no proposalId → no effectivenessOutcome set
- Empty entries array → empty array
- Empty map → all applied recs get `no_data`

**`computeRecommendationEffectiveness` (effectiveness extensions):**
- Zero entries → `no_data` (unchanged from P10.8a)
- Mixed dispositions across signals → correct appliedKeep/Revert/Investigate/NoData per signal
- `effectivenessRate`: excludes no_data from denominator; NaN → 0
- `effectivenessCoverage`: includes no_data in denominator; NaN → 0
- No applied recs → effectiveness fields are all 0
- All applied recs have effectiveness data → coverage 1.00

### CLI tests (`executive-effectiveness-cli.vitest.ts`)

- Terminal table shows effectiveness columns when applied recs exist → Kept/Rvt/Inv/NoD/EffRt/Cov rendered
- Terminal table hides effectiveness columns when no applied recs → P10.8a-compatible output
- JSON output includes `effectivenessOutcome` on entries
- JSON SignalCalibration includes all new fields
- Effectiveness store missing → graceful degradation (all applied recs `no_data`)
- Effectiveness empty → all applied recs `no_data`
- Some proposals have effectiveness data, some don't → correct split

## Open questions / edge cases

1. **What if `ProposalEffectivenessReport.recommendation` is stale?** The report is the ground truth at assessment time. If it says "keep" but the proposal was later reverted, that's a P5 concern. P10.8b reads the latest snapshot — it's a point-in-time join.

2. **What if multiple effectiveness reports exist for the same proposal?** `EffectivenessStore` stores one file per proposalId — the last save wins. This is consistent with P5.2b's design (rerunning assessment overwrites the previous report).

3. **Effectiveness data and --since / --threshold**: Effectiveness data doesn't have its own age filter. The same `--since` that filters recommendation reports also limits which proposals have effectiveness data (since effectiveness is computed shortly after apply). No separate effectiveness window needed.

## Hard governance boundary (restated)

```
P10.8b computes and reports.
P10.8b does not write.
P10.8b does not mutate persisted recommendations.
P10.8b does not create proposals.
P10.8b does not trigger effectiveness assessment (that's P5's job).
```
