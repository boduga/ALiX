# P10.8 — Recommendation Effectiveness Intelligence Design

> **Status:** Design spec — approved, ready for implementation planning.
> **Builds on:** P10.7b (`RecommendationReportStore`, `ExecutiveRecommendation`), P10.7c (`proposalId` + `governanceStatus` bridge fields), `ProposalStore` (adaptation domain).
> **Risk:** LOW. Read-only analyzer — no mutation, no proposal creation, no engine hooks.
> **Branch:** TBD (off `main` after P10.7c + PR #131 merged).

## Architecture

```
alix executive recommendation-effectiveness [--report <id>] [--since <days>] [--threshold <days>] [--json]
        │
        ├─ RecommendationReportStore.list() → load() each (filter by --since)  ── P10.7b (read)
        ├─ collect every ExecutiveRecommendation, tagged with reportId + generatedAt
        ├─ for each bridged rec: ProposalStore.load(proposalId) → proposal.status  ── adaptation (read)
        ├─ classifyRecommendation() → RecommendationDisposition (8 states)       ── pure
        ├─ computeRecommendationEffectiveness() → SignalCalibration[]            ── pure
        └─ render terminal tables or JSON
```

Three-layer separation:

| Layer | Responsibility |
|---|---|
| `classifyRecommendation()` | One recommendation → one disposition state |
| `computeRecommendationEffectiveness()` | Many classified entries → per-signal calibration aggregate |
| CLI handler | Load reports/proposals, compute age, call pure functions, render |

**Architectural invariants (read-only):**
- No writes to any store. Dispositions are computed but never persisted.
- No proposal creation, no approval/application.
- No engine hooks, no evaluation, no calibration feedback until P10.8b+.
- The analyzer joins only `RecommendationReportStore` + `ProposalStore`. Richer signals (EffectivenessStore, OutcomeReportStore) deferred to P10.8b/P10.8c.

## Hard governance boundary

```
P10.8a computes and reports.
P10.8a does not write.
P10.8a does not mutate dispositions, outcomeConfidence, or outcomeSummary on persisted recommendations.
P10.8a does not create proposals.
```

Persistence of calibrated confidence is reserved for a future write slice. The analyzer only *reads* — it answers "what happened to recommendations?" not "did the recommendation improve health?" (P10.8c).

## Disposition model (8 evidence-based states)

| Condition | Disposition | Category |
|---|---|---|
| No proposalId, age < threshold | `unreviewed` | Unbridged |
| No proposalId, age ≥ threshold | `stale` | Unbridged |
| ProposalId + status `pending` | `awaiting_review` | Bridged |
| ProposalId + status `approved` | `approved_pending_apply` | Bridged |
| ProposalId + status `applied` | `applied` | Bridged |
| ProposalId + status `rejected` | `rejected` | Bridged |
| ProposalId + status `failed` | `failed` | Bridged |
| ProposalId + ProposalStore.load() returns null | `proposal_missing` | Bridged (integrity gap) |

**Design rationale:**
- `ignored` is NOT inferred from age alone — it implies human intent the data model cannot observe. Reserved for a future explicit dismiss/archive action (P10.8b+).
- `unreviewed` vs `stale` is purely time-based (objective fact).
- `proposal_missing` is a distinct integrity-gap state: the recommendation *was* bridged (it has a `proposalId`), but the downstream proposal artifact is missing or corrupt. Surfaced as both a disposition count and a `loadWarnings` entry with the specific id + rec index + report id for investigation.
- `stale` vs `rejected` = materially different signal: stale means "operators aren't picking these up"; rejected means "operators reviewed and disagreed." Calibration keeps them separate.

## Classification function

```ts
export type RecommendationDisposition =
  | "unreviewed"
  | "stale"
  | "awaiting_review"
  | "approved_pending_apply"
  | "applied"
  | "rejected"
  | "failed"
  | "proposal_missing";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface ClassifyInput {
  /** The executive recommendation data. */
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  /** `undefined` if not bridged; the bridged proposalId otherwise. */
  proposalId?: string;
  /** The proposal's current lifecycle status (from ProposalStore.load),
   *  or `null` if the proposal file was not found / corrupt. */
  proposalStatus?: ProposalStatus | null;
  /** Days since the report was generated. Only affects `unreviewed`/`stale`. */
  ageDays: number;
}

export function classifyRecommendation(
  input: ClassifyInput,
  staleThresholdDays: number = 7,
): RecommendationDisposition;
```

Logic:
```
if input.proposalId === undefined:
    return input.ageDays < staleThresholdDays ? "unreviewed" : "stale"

# bridged — proposalStatus is ProposalStatus | null | undefined
if input.proposalStatus === null || input.proposalStatus === undefined:
    return "proposal_missing"

switch input.proposalStatus:
    case "pending":  return "awaiting_review"
    case "approved": return "approved_pending_apply"
    case "applied":  return "applied"
    case "rejected": return "rejected"
    case "failed":   return "failed"
```

- `ageDays` is computed in the CLI (`now - report.generatedAt`) and passed to the pure function — keeps tests deterministic. Only unbridged recs read `ageDays`; bridged recs never use it.
- `proposalStatus` is fetched by the CLI handler (via `ProposalStore.load`), then passed to the pure classifier. `null` means the load returned null (file missing); `undefined` means the rec has no proposalId.

## Aggregation function

```ts
export interface SignalCalibration {
  signal: string;
  total: number;
  unreviewed: number;
  stale: number;
  awaitingReview: number;
  approvedPendingApply: number;
  applied: number;
  rejected: number;
  failed: number;
  proposalMissing: number;
  /** Sum of all 6 bridged states (awaitingReview + approvedPendingApply +
   *  applied + rejected + failed + proposalMissing). */
  bridgedCount: number;
  /** bridgedCount / total, [0..1], 2-decimal rounded. */
  actionRate: number;
}

export const EFFECTIVENESS_OK = "ok";
export const EFFECTIVENESS_NO_DATA = "no_data";

export interface EffectivenessResult {
  effectivenessStatus: typeof EFFECTIVENESS_OK | typeof EFFECTIVENESS_NO_DATA;
  generatedAt: string;
  staleThresholdDays: number;
  reportCount: number;
  totalRecommendations: number;
  signalCalibration: SignalCalibration[];
  recommendations: RecommendationEntry[];
  loadWarnings: string[];
}

export interface RecommendationEntry {
  reportId: string;
  generatedAt: string;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendation: string;
  proposalId?: string;
  disposition: RecommendationDisposition;
  ageDays: number;
}
```

## CLI Interface

```
alix executive recommendation-effectiveness [--report <id>] [--since <days>] [--threshold <days>] [--json]
```

- `--report <id>`: analyze a specific report. Omitted → all reports, filtered by `--since`.
- `--since <days>`: only reports generated in the last N days (default: 30). Named `--since` (not `--window`) to avoid collision with P10.6's window-as-report-count semantics.
- `--threshold <days>`: the `unreviewed`/`stale` boundary (default: 7).
- `--json`: emit full `EffectivenessResult` as JSON.

**Terminal output:**

```
Recommendation Effectiveness (last 30 days)
Generated: 2026-06-27T12:00:00.000Z | Stale threshold: 7 days | 5 reports, 18 recommendations

Signal                Total  Bridged  Await  A-Pend  Applied  Rejected  Failed  PMiss  Unrev  Stale  ActionR
degrading_trend       12     5         2      0       1        1         0       1      3      4      0.42
persistent_instability 4     1         0      0       0        0         0       1      1      2      0.25
improving_trend       2      0         0      0       0        0         0       0      0      2      0.00

Per-recommendation detail:
Report            Generated    Subsystem  Signal                Disp                Age  proposalId
rec-2026-06-26    2026-06-26  workflow   degrading_trend       applied              1d  prop-...
rec-2026-06-20    2026-06-20  workflow   degrading_trend       stale               12d  —
rec-2026-06-10    2026-06-10  routing    persistent_instability proposal_missing    17d  prop-...
```

- **Sort:** reports newest-first; within each report, original recIndex order.
- **`actionRate`** is the headline metric: how often do operators bridge recommendations of this signal type?
- **Warning for missing proposals** (emitted to stderr, also in `loadWarnings`):
  `proposal not found: <proposalId> (rec index <n> in report <reportId>)`
- **`--json`** includes `loadWarnings` array so programmatic consumers can flag missing proposals.

## Routing

Add to `src/cli/commands/executive.ts`:

```ts
case "recommendation-effectiveness": {
  const { handleEffectivenessCommand } = await import(
    "./executive-effectiveness-handler.js"
  );
  return handleEffectivenessCommand(rest);
}
```

Subcommand list updated to include `recommendation-effectiveness`.

## Sentinel

Three new files:
- `src/executive/recommendation-effectiveness.ts` — pure classification + aggregation functions, types
- `src/cli/commands/executive-effectiveness-handler.ts` — CLI handler (reads, no writes)

Both added to `EXECUTIVE_FILES`. **No write exceptions** — the handler only reads stores (load/list). No `ProposalStore.save`, no `RecommendationReportStore.save`.

The handler imports `ProposalStore` for load only (read pattern, same as P10.7c handler).

## File structure

| File | Responsibility |
|---|---|
| `src/executive/recommendation-effectiveness.ts` | Pure: types, `classifyRecommendation()`, `computeRecommendationEffectiveness()`, `SignalCalibration`, `EffectivenessResult` |
| `src/cli/commands/executive-effectiveness-handler.ts` | CLI handler: load reports/proposals, compute age, call pure functions, render terminal/JSON |
| `src/cli/commands/executive.ts` | Add `case "recommendation-effectiveness"` + update subcommand list |
| `tests/executive/recommendation-effectiveness.vitest.ts` | Pure function tests |
| `tests/cli/commands/executive-effectiveness-cli.vitest.ts` | CLI integration tests |
| `tests/executive/executive-sentinels.vitest.ts` | Add 2 new files to `EXECUTIVE_FILES` |

## Test plan

### Pure function tests (recommendation-effectiveness.vitest.ts)
- `classifyRecommendation`: all 8 dispositions covered
- Unbridged: `unreviewed` (age < threshold), `stale` (age ≥ threshold)
- Bridged: each of 5 `ProposalStatus` values maps correctly
- `proposal_missing`: proposalId present but `proposalStatus` is `null` / load failed
- `proposal undefined`: input with no proposalId (bridged branch not reached)
- Default threshold (7) + custom threshold
- `computeRecommendationEffectiveness`: zero entries → `no_data`, empty calibrations
- Mixed dispositions across multiple signals → correct per-signal tallies + `actionRate`
- `actionRate`: includes `proposalMissing` in `bridgedCount`
- `sortRecommendations`: newest-first by `generatedAt`, recIndex order within same report
- `loadWarnings`: populated from `proposal_missing` recs with descriptive format

### CLI tests (executive-effectiveness-cli.vitest.ts)
- Terminal table rendering with per-signal calibration + per-rec detail
- JSON output structure (full `EffectivenessResult`)
- `--since` filtering of reports
- `--threshold` custom boundary
- Single `--report` vs all reports
- `proposal_missing` warning printed (terminal + JSON + stderr warning)
- No proposals exist → all unbridged recs → `actionRate: 0` for all signals
- No reports in store → clean `no_data` result
- Corrupt report handling (excluded from analysis, valid reports still processed)

### Sentinel
- Both new files added to `EXECUTIVE_FILES`; no scoped exceptions.
- Sentinel test count increases by 2.
- Verify handler's `ProposalStore.load(` (read-only) passes the sentinel (forbidden substring is `ProposalStore.save`, class-method — `load(list/ for a ProposalStore instance is clean).
