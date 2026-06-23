# P8.5b — Learning Dashboard Design Spec (SDS)

> **Status:** SDS only — awaiting review before implementation plan.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-23-p8-5b-learning-dashboard-design.md`
> **Branch:** `feature/p8.5b-learning-dashboard`, off `main` at HEAD (squash of PR #113, `11c2488a`).
> **Risk level:** LOW — read-only consumer of already-proven data. No new stores, no new adapters, no mutation surface.

## Goal

Provide operators with a terminal dashboard that surfaces learning health, calibration quality, and provenance observability — reusing the same `assembleProposalExplanation` assembler that powers `alix explain proposal <id>`.

No second explanation engine. No business logic in the UI. The assembler is the single source of truth for explanation data; the dashboard is a renderer.

## Core invariants (non-negotiable)

### Invariant 1 — Read-only

```text
Dashboard reads.
Dashboard never writes.
```

Dashboard consumes from:
- `LearningStore` (signals and profiles)
- `assembleProposalExplanation` (ProposalExplanation view models)

Dashboard NEVER:
- Creates proposals
- Mutates learning state
- Invokes refresh orchestrator
- Writes to any store
- Modifies adapter state

### Invariant 2 — Bounded scan

```text
DashboardAggregator MUST NOT invoke
assembleProposalExplanation concurrently
for an unbounded proposal set.

Maximum proposal scan count: 20 (default), configurable via --limit.
```

P8.5c explain is operator-facing (single proposal).
P8.5b dashboard is potentially recurring (--poll mode).
Bounded scans keep future scaling under control regardless of LearningStore size.

## Command surface

```bash
alix learning dashboard [--window <days>] [--limit <n>] [--json]
```

- `--window <days>` — default 90. How far back to look for signals/profiles.
- `--limit <n>` — default 20. Maximum proposals scanned for aggregated explanation integrity data. Bounded by Invariant 2.
- `--json` — machine-readable output of all panels as a single JSON object.

**Terminal rendering approach:** Standard terminal output. Sections separated by horizontal rules with Unicode box-drawing. Color coding for alerts (green = healthy, yellow = degraded, red = critical).

## The 5 panels

### Panel 1 — Explanation Integrity

Reuses `explanationIntegrity` from the assembler:

```text
╔══════════════════════════════════════════════════╗
║  EXPLANATION INTEGRITY                          ║
║                                                  ║
║  Overall Span: 90 days                          ║
║  Total Explanations: 14                         ║
║  Average Completeness: 83.3%                    ║
║  Best Layer: Outcome (100%)                     ║
║  Weakest Layer: Governance (71%)                ║
║                                                  ║
║  Layer Availability:                             ║
║    Outcome:       100% ████████████████████      ║
║    Recommendation: 93%  ███████████████████      ║
║    Risk:           86%  █████████████████         ║
║    Governance:     71%  ██████████████           ║
║    Learning:       79%  ████████████████         ║
║    Calibration:    64%  █████████████             ║
║                                                  ║
║  Evidence Chain: Used in 81% of explanations    ║
║  Fallback Joins:  3%                             ║
║  Incomplete Chains:  2 proposals                 ║
╚══════════════════════════════════════════════════╝
```

Data source: iterate `assembleProposalExplanation` for N recent proposals, aggregate `explanationIntegrity` across them.

### Panel 2 — Calibration Health

Per-adapter signal distribution from LearningStore:

```text
╔══════════════════════════════════════════════════╗
║  CALIBRATION HEALTH                              ║
║                                                  ║
║  Recommendation Adapter                          ║
║    Signals: 24  (14 overconfidence, 10 under)    ║
║    Profiles Active: 3                            ║
║    Last Refresh: 2026-06-23 08:15 UTC            ║
║                                                  ║
║  Risk Adapter                                    ║
║    Signals: 18  (9 overfire, 7 miss, 2 ignored)  ║
║    Last Refresh: 2026-06-23 08:15 UTC            ║
║                                                  ║
║  Governance Adapter                              ║
║    Signals: 12  (5 high-pv, 4 high-fp, 3 miss)  ║
║    Last Refresh: 2026-06-23 08:15 UTC            ║
║    Note: Low fidelity (concernsRaised inferred)  ║
╚══════════════════════════════════════════════════╝
```

Data source: `LearningStore.querySignals({ windowDays })` aggregated by adapter. Signal counts by `signalType`.

### Panel 3 — Learning Signal Explorer

Filterable view of individual signals:

```text
╔══════════════════════════════════════════════════╗
║  LEARNING SIGNALS (filtered)                     ║
║                                                  ║
║  Adapter: all                                    ║
║  Type: all                                       ║
║                                                  ║
║  Sig | Adapter       | Type            | Stren   ║
║  ─────────────────────────────────────────────   ║
║  ls-1| recommendation | overconfidence  | 0.7    ║
║  ls-2| risk           | overfire        | 0.5    ║
║  ls-3| governance     | high-pv         | 0.8    ║
║  ...                                            ║
║                                                  ║
║  Total: 54 signals                               ║
╚══════════════════════════════════════════════════╝
```

Data source: `LearningStore.querySignals({ windowDays, signalTypes?, limit? })`. For P8.5b, filtering is via `--adapter` and `--signal-type` CLI flags (no interactive filtering). Future phases can add interactive mode.

### Panel 4 — Join Path Analysis

Provenance quality distribution across all explanations:

```text
╔══════════════════════════════════════════════════╗
║  JOIN PATH ANALYSIS                              ║
║                                                  ║
║  All Layers (across N explanations):             ║
║    Evidence Chain        ████████████████  78%   ║
║    Direct ID             ████              16%   ║
║    Proposal Fallback     ▏                   3%   ║
║    String Heuristic      ▏                   3%   ║
║                                                  ║
║  Worst Layer: Governance (12% EvidenceChain)    ║
║  Best Layer:  Outcome (100% ProposalFallback)   ║
║                                                  ║
║  ⚠  1 layer used string heuristic               ║
║     (Governance — Learning layer only)           ║
╚══════════════════════════════════════════════════╝
```

Data source: iterate `assembleProposalExplanation`, aggregate per-layer `joinPath` distribution. This metadata already exists — the dashboard just counts it.

### Panel 5 — Chain Integrity Alerts

Operational visibility into broken chains:

```text
╔══════════════════════════════════════════════════╗
║  CHAIN INTEGRITY ALERTS                          ║
║                                                  ║
║  🔴 CRITICAL                                     ║
║    Proposal prop-42: Outcome exists,             ║
║    Recommendation: MISSING (stale direct-id)     ║
║                                                  ║
║  🟡 WARNING                                       ║
║    Proposal prop-18: Risk score exists,          ║
║    Governance review: MISSING                    ║
║                                                  ║
║  ℹ️ INFO                                          ║
║    Proposal prop-7: Chain references missing     ║
║    artifact rec-MISSING (incompleteChainLayers)  ║
║                                                  ║
║  2 proposals with integrity warnings             ║
╚══════════════════════════════════════════════════╝
```

Data source: iterate `assembleProposalExplanation` for recent proposals, flag any where `explanationIntegrity.incompleteChainLayers > 0` OR where a core layer (Outcome/Recommendation/Risk/Governance) is `not_available` while a downstream layer exists.

Severity classification:
- **CRITICAL**: Outcome exists, Recommendation missing (broken direct-id)
- **WARNING**: Risk or Governance missing while other layers present
- **INFO**: Incomplete chain layers (EvidenceChain references missing artifact)

## Architecture

```text
LearningStore ──────────► DashboardAggregator ──► Terminal Renderer
                             │                          │
assembleProposalExplanation ──┘                          │
                                                         ▼
                                                  JSON (--json mode)
```

**DashboardAggregator** — a pure aggregation function that:
1. Reads signals + profiles from `LearningStore`
2. Calls `assembleProposalExplanation` for N recent proposals (configurable, default 20)
3. Aggregates `explanationIntegrity` across them
4. Computes panel data (join path distribution, layer availability percentages, chain integrity alerts)
5. Returns a `DashboardReport` view model

**New file:** `src/learning/learning-dashboard.ts` — contains the `DashboardAggregator`. Pure read-only aggregation, no mutation surface.

**No new store.** The dashboard is ephemeral (like `ProposalExplanation`). On termination, it's gone.

## Health bands (coverage thresholds)

P8.5c introduced explanation completeness. P8.5b reports it. P9 will govern it. Define explicit health bands now so all consumers share one interpretation:

```ts
export interface CoverageThresholds {
  /** >= 90% — displayed green. */
  healthy: number;
  /** >= 75% — displayed yellow. */
  degraded: number;
  /** < 75% — displayed red. */
  critical: number;
}
```

`dashboardIntegrityScore` maps to these thresholds in the renderer:
- >= 90 → GREEN (all systems nominal)
- >= 75 → YELLOW (degraded — investigate weak layers)
- < 75 → RED (critical — chain integrity or explanation coverage failing)

## Data model

```ts
export interface DashboardReport {
  schemaVersion: "p8.5b.0";
  generatedAt: string;
  windowDays: number;
  proposalsScanned: number;
  /** Single synthetic health score (0-100). Derived from:
   * - explanation completeness (weighted 40%)
   * - evidence chain usage (weighted 30%)
   * - missing layer penalty (weighted 20%)
   * - alert count penalty (weighted 10%)
   * Operators read this first; P9 consumes it as a governance input signal. */
  dashboardIntegrityScore: number;
  explanationIntegrity: AggregatedIntegrity;
  calibrationHealth: CalibrationHealthPanel;
  signals: SignalExplorerPanel;
  joinPathAnalysis: JoinPathPanel;
  chainAlerts: ChainAlertPanel;
}

export interface AggregatedIntegrity {
  totalExplanations: number;
  averageCompleteness: number;
  bestLayer: string;
  worstLayer: string;
  layerAvailability: Record<string, number>;  // percentage per layer
  /** Raw counts alongside percentages — prevents 50% from meaning both 1/2 and 500/1000. */
  layerAvailabilityCounts: Record<string, { present: number; missing: number }>;
  evidenceChainUsage: number;                  // percentage
  fallbackJoinRate: number;                    // percentage
  incompleteChainCount: number;
}

export interface CalibrationHealthPanel {
  adapters: {
    name: string;
    signalCount: number;
    signalTypes: Record<string, number>;
    profileCount: number;
    lastRefresh: string | null;
    note?: string;        // e.g. "Low fidelity (inferred)"
  }[];
}

export interface SignalExplorerPanel {
  totalSignals: number;
  signals: { id: string; adapter: string; type: string; strength: number }[];
}

export interface JoinPathPanel {
  distribution: Record<string, number>;  // percentage per joinPath value (all layers)
  /** Per-layer breakdown of join path distribution. Global 80% can hide
   * per-layer story (e.g. Governance 15% pulls down a 100% Outcome rate). */
  joinPathByLayer: Record<string, Record<string, number>>;
  bestLayer: { name: string; rate: number };
  worstLayer: { name: string; rate: number };
  heuristicLayers: { layer: string; count: number }[];
}

export interface ChainAlertPanel {
  critical: ChainAlert[];
  warnings: ChainAlert[];
  infos: ChainAlert[];
  totalAlerts: number;
}

export interface ChainAlert {
  proposalId: string;
  severity: "critical" | "warning" | "info";
  message: string;
}
```

## CLI integration

Wire into `src/cli/commands/learning.ts` as `case "dashboard"` calling `runDashboard(args)`.

## Acceptance criteria

### Functional

```text
Given a LearningStore with signals + profiles and at least one proposal
with outcomes/recommendations/risk/reviews:

alix learning dashboard

Renders 5 panels with non-zero values in each.
```

### Read-only invariant

```text
Given any LearningStore state:

alix learning dashboard
alix learning dashboard --json

Performs zero writes to any store.
Verifed by sentinel test.
```

### JSON output

```text
alix learning dashboard --json

Returns a single JSON object matching DashboardReport interface.
```

## Out of scope

| Feature | Reason |
|---|---|
| Web UI | Terminal is the ALiX surface for P8.5b. Web UI is a future concern. |
| Interactive filter mode | Future. P8.5b uses CLI flags for filtering. |
| Poll/live-refresh mode (`--poll`) | Deferred. P8.5b ships single-render only. Terminal refresh loops add complexity with little value for first release. |
| Persistent dashboard state | Ephemeral only. Every render is a fresh aggregation. |
| Alert persistence | Chain alerts are computed on render, not stored. |
| P9 governance integration | Dashboard is a data source for P9, not itself a governor. |

## File structure

```text
src/learning/dashboard-integrity-score.ts        # Pure helper: computeDashboardIntegrityScore(...)
src/learning/learning-dashboard.ts              # DashboardAggregator + types
src/cli/commands/dashboard-renderer.ts           # Terminal renderer (terminal boxes, ANSI)
tests/learning/learning-dashboard.vitest.ts     # Aggregator tests
```

No modifications to: assembler, existing stores, types, adapter code, refresh orchestrator, or Explain CLI.

## What this proves for P9

| P9 capability | Proven by P8.5b |
|---|---|
| Adapter trustworthiness | Calibration Health panel shows per-adapter signal distribution |
| Signal-to-outcome correlation | Signal Explorer + Integrity panel — signal presence vs layer completeness |
| Governance lens effectiveness | Governance calibration health (low fidelity note) |
| Provenance quality | Join Path Analysis — "what % of joins used Evidence Chain vs heuristic" |
| Chain alerting | Chain Integrity Alerts — operational visibility into broken chains |

The dashboard turns existing metadata into decision-grade visibility without adding any new authority surface.
