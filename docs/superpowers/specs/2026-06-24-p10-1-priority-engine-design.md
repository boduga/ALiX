# P10.1 — Weighted Priority Engine

> **Status:** SDS approved
> **Spec home:** `docs/superpowers/specs/2026-06-24-p10-1-priority-engine-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-24-p10-1-priority-engine.md`
> **Governs:** branch from `main` at HEAD.
> **Risk level:** Low — additive transformation layer; no P10.0 schema changes.

## Core framing

P10.0 answers "what is unhealthy?" P10.1 answers **"what matters most?"** — adding trend and blast radius to raw health scores so the executive ranking reflects urgency, not just severity.

This is the priority substrate that P10.2 (Objective Generator) and P9.6 (InvestigationRecommendation) will consume.

## The formula

```
priorityScore = healthDeficit * 0.60 + trendScore * 0.25 + blastRadius * 0.15
```

All inputs are 0–100. Output is 0–100. Higher = higher priority.

## Core invariants

1. **P10.0 `ExecutiveHealthReport` is unchanged.** P10.1 produces a separate `ExecutivePriorityReport` as an enriched/derived layer on top.
2. **The TrendStore is the only new write path.** It may append snapshots to `.alix/executive/trends.jsonl`. Everything else remains read-only.
3. **Trend snapshots are append-only.** The priority engine never modifies an existing snapshot. Snapshot pruning is deferred.
4. **All three factor scores are 0–100 integers.**
5. **No new mutation paths, no new evidence types.** The P10 sentinel is extended with a scoped write exception for `src/executive/trend-store.ts:save` — the only approved P10.1 write path. All other P10.1 files remain fully read-only and are added to the sentinel scan list.

## Types

```ts
export interface ExecutivePriorityEntry {
  subsystem: ExecutiveSubsystemName;
  healthScore: number;       // 0..100, from P10.0
  healthDeficit: number;     // 100 - healthScore
  trendScore: number;        // 0..100
  blastRadius: number;       // 0..100, from static table
  priorityScore: number;     // 0..100, weighted composite
  summary: string;           // one-line: e.g. "Governance score 91, priority 38.8"
}

export interface ExecutivePriorityReport {
  schemaVersion: "p10.1.0";
  generatedAt: string;
  windowDays: number;
  priorities: ExecutivePriorityEntry[];  // sorted descending by priorityScore
}
```

## Factor 1 — healthDeficit (60% weight)

Computed directly from P10.0 subsystem scores. No new data source.

```ts
healthDeficit = 100 - score;
```

A score of 55 → deficit 45 (high priority). A score of 95 → deficit 5 (low priority).

## Factor 2 — trendScore (25% weight)

Derived from `.alix/executive/trends.jsonl` — an append-only snapshot store that records each P10.1 run's subsystem scores.

### Snapshot schema

```ts
interface ExecutiveTrendSnapshot {
  id: string;
  generatedAt: string;
  windowDays: number;
  subsystemScores: Record<ExecutiveSubsystemName, number>;
}
```

### Trend computation

Read the most recent prior snapshot. Compute delta = currentScore - priorScore.

```
trendScore = clamp(50 - delta * 5, 0, 100)
```

| Scenario | delta | trendScore | Meaning |
|----------|-------|------------|---------|
| Sharp decline | -25 | 100 | Urgent — getting worse |
| Mild decline | -5 | 75 | Worsening |
| Stable | 0 | 50 | No change |
| Mild improvement | +5 | 25 | Improving |
| Strong improvement | +15 | 0 | Not urgent |

**If no prior snapshot exists (first run):** `trendScore = 25` (neutral-low — no history means no trend signal).

## Factor 3 — blastRadius (15% weight)

Static config table, hardcoded in the priority engine. No runtime dependencies. No GitNexus dependency.

```ts
const BLAST_RADIUS: Record<ExecutiveSubsystemName, number> = {
  governance: 100,
  security:    90,
  learning:    75,
  memory:      70,
  adaptation:  65,
  workflow:    60,
  agents:      50,
  tools:       40,
};
```

Governance and security are highest because a breakdown there cascades everywhere. Tools are lowest because a failed tool call is contained.

## Architecture (2 components)

### 1. Priority engine — `src/executive/priority-engine.ts`

Pure read function. Consumes `ExecutiveHealthReport` (P10.0) and optional prior snapshot. Returns `ExecutivePriorityReport`.

```ts
export function computePriorityScore(
  healthDeficit: number,
  trendScore: number,
  blastRadius: number,
): number;

export async function computeExecutivePriorities(
  healthReport: ExecutiveHealthReport,
  opts: { cwd: string },
): Promise<ExecutivePriorityReport>;
```

The async variant reads the trend snapshot from the TrendStore.

### 2. Trend store — `src/executive/trend-store.ts`

Reads and appends trend snapshots from `.alix/executive/trends.jsonl`. Thin wrapper over `readFileSync` / `writeFileSync` / `appendFileSync`.

```ts
export class ExecutiveTrendStore {
  constructor(private readonly dir: string) {}

  /** Load the most recent snapshot (null if none exist). */
  async loadLatest(): Promise<ExecutiveTrendSnapshot | null>;

  /** Append a new snapshot from the current health report. */
  async save(report: ExecutiveHealthReport): Promise<ExecutiveTrendSnapshot>;
}
```

The `save` method constructs a snapshot from the health report's subsystem scores and appends it to the JSONL file.

### CLI integration

Priority scoring runs automatically as part of `alix executive dashboard`. The handler:

1. Calls `buildExecutiveHealthReport(opts)` (P10.0 — unchanged)
2. Calls `computeExecutivePriorities(healthReport, { cwd })` (P10.1 — new)
3. Calls `renderExecutiveDashboard(healthReport, priorityReport, { jsonMode })` (renderer updated)

No separate `--priorities` flag needed — the dashboard always shows priority-ranked output. The renderer signature becomes:

```ts
export function renderExecutiveDashboard(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  opts?: { jsonMode?: boolean },
): void;
```

### Dashboard display

The text renderer adds a "Trend" column to panel 0. **Note:** the example below shows `trendScore = 0` for all subsystems, which represents an improving or stable prior window. On first run (no prior snapshot), `trendScore = 25` (neutral-low).

```
Executive Health Summary
Overall Score: 78

Subsystem      Score   Trend   Blast   Pri      Status
Governance     91      0       100     32.4     🟢 healthy
Security       95      0       90      26.5     🟢 healthy
Learning       76      0       75      35.3     🟡 warning
Memory         70      0       70      40.0     🟡 warning
Workflow       79      0       60      28.6     🟡 warning
Adaptation     88      0       65      26.3     🟢 healthy
Agents         82      0       50      25.0     🟢 healthy
Tools          54      0       40      38.4     🔴 critical
```

Panel 1 (priorities) can show either the P10.0 top-3 worst or the P10.1 top-3 priority — recommend P10.1 ranking here.

## File layout (9 files)

| # | Path | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/executive/priority-engine.ts` | NEW | `computePriorityScore` + `computeExecutivePriorities` |
| 2 | `src/executive/trend-store.ts` | NEW | `ExecutiveTrendStore` — load/save trend snapshots to `.alix/executive/trends.jsonl` |
| 3 | `src/executive/executive-health.ts` | MODIFY | Export `ExecutiveSubsystemName` if not already exported (verify) |
| 4 | `src/cli/commands/executive-dashboard-renderer.ts` | MODIFY | Add priority column to panel 0; sort by priority in panel 1 |
| 5 | `src/cli/commands/executive-dashboard-handler.ts` | MODIFY | Call priority engine + trend store after aggregator |
| 6 | `tests/executive/priority-engine.vitest.ts` | NEW | Unit tests for formula + edge cases (6-8 tests) |
| 7 | `tests/executive/trend-store.vitest.ts` | NEW | Unit tests for snapshot read/write/fallback (3-4 tests) |
| 8 | `docs/superpowers/specs/2026-06-24-p10-1-priority-engine-design.md` | NEW | This spec |
| 9 | `docs/superpowers/plans/2026-06-24-p10-1-priority-engine.md` | NEW | Implementation plan (post-approval) |

## Testing

### Priority engine (6-8 tests) — `tests/executive/priority-engine.vitest.ts`

1. `computePriorityScore` with known inputs → expected output
2. healthDeficit = 100 - score (boundary at 0, 100)
3. trendScore with delta > +10 → 0 (improving)
4. trendScore with delta < -10 → 100 (deteriorating)
5. trendScore with delta = 0 → 50 (stable)
6. trendScore with no prior snapshot → 25 (neutral-low)
7. blast radius table covers all 8 subsystems (structural test)
8. Full E2E: executive report → priority compute → sorted output

### Trend store (3-4 tests) — `tests/executive/trend-store.vitest.ts`

1. Save snapshot → loadLatest returns it
2. Multiple snapshots → loadLatest returns the most recent
3. Empty store → loadLatest returns null
4. Snapshot round-trip: save → load → subsystemScores match

## Explicitly out of scope (P10.1)

- **P10.2 Objective Generator** — executive recommendations from priority engine (next phase)
- **P9.6 InvestigationRecommendation** — deferred; becomes a consumer of P10.1 priority
- **Blast radius dynamic computation** — static table; dynamic (file-import graph) deferred
- **Operator urgency override** — a future flag-layer on top of priority
- **Trend snapshot pruning** — snapshots accumulate; pruning is a separate maintenance phase
- **Reversibility scoring** — deferred to P10.2 or P9.6 integration

## Tag and PR conventions

- Branch: `feature/p10-1-priority-engine`
- PR title: `P10.1 — Weighted Priority Engine (trend + blast radius)`
- Tag on merge: `alix-p10-1-complete`
