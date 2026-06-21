# P6.6 — Decision Governance Observability

> **Status:** Spec
> **Slice:** P6.6a Pipeline Health Report (first of three: 6a = observe from existing state, 6b = instrument decision events, 6c = aggregate from event traces)
> **Builds on:** P6.0–P6.5a (all P6 layers)
> **Risk level:** LOW — read-only, no mutation, no new stores
> **Core invariant:** Observe ≠ Instrument. P6.6a answers "what can we learn from existing state before adding new event traces?"

## Core Framing

**Core question:** Can ALiX summarize the health and activity of its decision-support pipeline without adding new storage?

P6 (Context → Risk → Recommendation → Queue → Brief → Review) is now architecturally complete. Each layer produces artifacts, but there is no aggregated view of pipeline health. P6.6a provides a read-only health report over existing persisted stores and computed artifacts.

**This is not P6.6b.** P6.6a observes from existing state only. P6.6b (future) adds decision-specific evidence events. P6.6c (future) aggregates from event traces.

### Sequence

```
P6.6a = observe from existing state  ← THIS SLICE
P6.6b = instrument new decision events
P6.6c = aggregate from event traces
```

Each phase adds precision only where the previous phase reveals blind spots.

## Data Sources (Read-Only)

| Metric | Source | Notes |
|--------|--------|-------|
| Proposal counts by status | `ProposalStore.list()` | All proposals |
| Window-scoped proposals | `ProposalStore.list()` filtered by created/applied dates | pending + within `--window` |
| Effectiveness reports | `EffectivenessStore.list()` | Count only |
| Intelligence reports | `IntelligenceStore.list()` | Count only |
| Lifecycle events | `EvidenceStore.query()` | Count only |
| Stale proposals | `DecisionContextBuilder.build()` per scoped proposal | `ageDays > 30` |
| Broken lineage | `DecisionContextBuilder.build()` per scoped proposal | `lineageCompleteness === "broken"` |
| Confidence (context) | `DecisionContext.confidence` | Per scoped proposal, averaged |
| Confidence (risk) | `RiskScoreBuilder.build()` per scoped proposal | Computed on demand, averaged |
| Confidence (recommendation) | `RecommendationEngine.recommend()` per scoped proposal | Computed on demand, averaged |
| Data freshness | `DecisionContext.dataFreshness` | Min/max across scoped proposals |
| Strategic brief | `StrategicBriefBuilder.build()` with same window | Reuses existing builder |
| Governance review capability | Static flag | P6.5a presence detected at runtime |

All stores are read via their existing APIs. No new schema, no new evidence types, no writes. If a store is unavailable, the report captures that as a health signal (see Health Computation).

## PipelineHealthReport Artifact

```typescript
interface PipelineHealthReport extends DecisionArtifact {
  windowDays: 30 | 90 | 180;
  health: "healthy" | "degraded" | "attention_needed";

  /** Proposal lifecycle counts — all proposals */
  proposalCounts: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };

  /** Scoped to pending proposals + those within the window */
  scopedProposals: {
    total: number;

    /** Proposals where ageDays > 30 */
    staleProposals: number;

    /** Proposals where lineageCompleteness === "broken" */
    brokenLineage: number;

    /** Per-layer confidence averaged across scoped proposals */
    confidence: {
      contextAvg: number;
      riskAvg?: number;
      recommendationAvg?: number;
      sampleSize: number;
    };

    /** Data freshness range across scoped proposals */
    dataFreshness: {
      newestDays: number | null;
      oldestDays: number | null;
    };
  };

  /** Total stored effectiveness reports */
  effectivenessReports: number;

  /** Total stored intelligence reports */
  intelligenceReports: number;

  /** Total lifecycle evidence events */
  lifecycleEvents: number;

  /** Strategic brief for this window — computed on demand */
  strategicBrief: {
    available: boolean;
    confidence: number | null;
    findings: number;
  };

  /** Governance review capability (P6.5a) */
  governanceReview: {
    frameworkAvailable: boolean;
    liveLensExecutionAvailable: false;
    persistedReviews: false;
  };
}
```

### Health Computation

Priority: `attention_needed` > `degraded` > `healthy`. Worst wins.

**attention_needed:**
- ProposalStore unavailable (cannot observe foundational pipeline state)
- `brokenLineage > 0`

**degraded:**
- Non-foundational store unavailable (EvidenceStore, EffectivenessStore, IntelligenceStore)
- `staleProposals > 0`
- Strategic brief unavailable while `enoughData` exists: `scopedProposals.total > 0 OR effectivenessReports > 0 OR intelligenceReports > 0 OR lifecycleEvents > 0`
- `confidence.sampleSize > 0` AND (`contextAvg < 0.3` OR `recommendationAvg < 0.3`)

**healthy:**
- None of the above conditions met

### Warnings (inherited from DecisionArtifact)

Warnings are emitted for:
- `staleProposals > 0` — "N stale proposals exceed 30 days without activity"
- `brokenLineage > 0` — "N proposal(s) have broken lineage — decision context is incomplete"
- Strategic brief unavailable with enough data — "Strategic brief unavailable — pipeline lacks long-horizon synthesis"
- Store unavailable — "EffectivenessStore unavailable — effectiveness data not observable"

## CLI Shape

```bash
alix decision status                  # Default window = 30 days
alix decision status --window 90      # 90-day window
alix decision status --json           # Full PipelineHealthReport as JSON
alix decision status --window 180 --json
```

### Terminal output (default mode)

```
alix decision status --window 30
═══════════════════════════════════════
Pipeline Health — Last 30 days: degraded

Proposals: 12 total (5 pending, 4 applied, 2 approved, 1 rejected)
  ⚠ Stale: 2 (>30 days)  |  Broken lineage: 1

Confidence:
  Context: 0.78 avg (n=7)  |  Risk: 0.65 avg  |  Recommendation: 0.72 avg
  Strategic brief: 0.85 (3 findings)

Activity:
  Effectiveness reports: 14  |  Intelligence reports: 3  |  Lifecycle events: 89

Governance review: Framework ready (P6.5a). Lenses deferred (P6.5b).

⚠ 2 stale proposals exceed 30 days without activity
⚠ 1 proposal has broken lineage — decision context is incomplete
```

### Terminal output (empty system)

```
alix decision status --window 30
═══════════════════════════════════════
Pipeline Health — Last 30 days: healthy

Proposals: 0 total

Confidence:
  No proposals in window

Governance review: Framework ready (P6.5a). Lenses deferred (P6.5b)
```

## Error Handling

- **Store unavailable at construction:** Catch per-store initialization in `buildDecisionInfrastructure`. Log warning. Report metric as unavailable (signal, not crash).
- **Individual proposal build failure:** `DecisionContextBuilder.build()` failure for one proposal logs a warning, skips that proposal, continues. Does not fail the report.
- **Empty stores:** Reported as zeros. Health = `healthy` (no data means nothing is broken, no blind spots).
- **Window with no data:** `scopedProposals.total = 0`, health = `healthy`, warning: "No proposals in window"
- **P6.5a not installed:** `governanceReview.frameworkAvailable = false` — the report adapts to what's installed without crashing.

## Performance

`DecisionContextBuilder.build()` is called per scoped proposal. For `--window 30` with 50 pending proposals, that's up to 50 builder calls. Each call reads stores (ProposalStore, EvidenceStore, EffectivenessStore, IntelligenceStore) and runs lineage resolution.

To keep `alix decision status` predictable:
- Window is capped at 180 days
- Scoped proposals are processed sequentially with per-item error isolation
- `--json` mode uses the same code path — no additional overhead
- If the builder call exceeds 500ms per proposal on average, the report logs a warning but still completes

## File Structure

**Create:**
- `src/adaptation/pipeline-health-types.ts` — `PipelineHealthReport` interface, `PipelineHealthStatus` type
- `src/adaptation/pipeline-health-builder.ts` — `PipelineHealthBuilder` class: reads stores, computes metrics, returns report
- `tests/adaptation/pipeline-health-builder.vitest.ts` — unit tests for health computation, confidence aggregation, warnings
- `tests/adaptation/pipeline-health-types.vitest.ts` — type shape tests

**Modify:**
- `src/cli/commands/decision.ts` — Add `case "status":` that calls `runStatus()`, update usage string

**No new stores. No new evidence types. No writes.**

## Acceptance Criteria

**P6.6a (must pass):**
1. `alix decision status` renders terminal output with header, proposal counts, confidence bands, activity counts, governance capability
2. `alix decision status --json` outputs full `PipelineHealthReport` as JSON
3. `alix decision status --window 90` adjusts scoped proposal window
4. `health` is `attention_needed` when `brokenLineage > 0`
5. `health` is `attention_needed` when ProposalStore is unavailable
6. `health` is `degraded` when `staleProposals > 0`
7. `health` is `degraded` when strategic brief unavailable with enough data
8. `health` is `healthy` for an empty system (no proposals)
9. Stores with zero data report as zeros without error
10. Per-proposal build failures skip that proposal without failing the report
11. `warnings` array is populated for stale proposals, broken lineage, unavailable stores
12. All existing tests pass (no changes to existing pipeline behavior)

## Explicitly Out of Scope (P6.6a)

| Feature | Destination | Reason |
|---------|-------------|--------|
| Decision-specific evidence events (`decision_context_built`, etc.) | P6.6b | Changes evidence model |
| Event trace aggregation | P6.6c | Requires P6.6b events |
| Historical trend data (week-over-week) | Future | Requires persistence — P6.6a is stateless |
| Alert thresholds / notification | Future | P6.6a exposes health; consumers decide thresholds |
| Performance benchmarking of pipeline layers | Future | P6.6a measures pipeline health, not latency |
| Per-proposal drill-down in status output | Future | `alix decision status` is aggregate; use `alix decision context` for per-proposal |
| Charts, dashboards, visualization | Future | P6.6a provides structured data (`--json`) for any frontend |
