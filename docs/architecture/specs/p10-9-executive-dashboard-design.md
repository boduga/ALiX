# P10.9 — Executive Dashboard Design

> **Status:** Spec — approved for implementation planning.
>
> **Builds on:** P10.6 (`ExecutiveTrendStore`), P10.7 (`RecommendationReportStore`), P10.8a (`RecommendationEntry`, disposition), P10.8b (`EffectivenessOutcome`, `applyEffectivenessData`), P10.8c (`SubsystemCorrelationReport`, `ConfidenceBucket`).
>
> **Risk:** LOW. Read-only composition layer. No new stores, no mutation, no analytics computation.
>
> **Branch:** Off `main`.

---

## 1. Reasoning

P10.6–P10.8c produced five independent intelligence streams:

| Milestone | Intelligence | Output |
|-----------|-------------|--------|
| P10.6 | Trend | Subsystem health scores over time |
| P10.7 | Recommendation | Signal-based improvement suggestions |
| P10.8a | Operator response | Disposition classification per rec |
| P10.8b | Proposal effectiveness | Keep/revert/investigate outcomes |
| P10.8c | Predictive correlation | Signal-to-subsystem delta matching |

**P10.9 composes these into a single cockpit**, making five reports feel like one coherent system. It is the **Executive Presentation Layer** — the canonical `ExecutiveDashboardReport` is the executive state model, and the CLI dashboard is merely the first renderer of that model.

### Design goals

- **30-second decisions:** an operator should assess system health, pipeline state, and immediate alerts in under 30 seconds.
- **Drill-down traceability:** every KPI → subsystem → recommendation → proposal → outcome report.
- **Composition only:** P10.9 performs no new analysis. It sorts, ranks, filters, groups, and renders.
- **Renderer-agnostic:** the report model supports terminal, JSON, and future renderers (REST, web UI, Markdown) without modification.

---

## 2. Architecture

```
Stores
      │
      ▼
Analytics (P10.6–P10.8c)
      │
      ▼
ExecutiveDashboardSnapshot         ← loadDashboardSnapshot() (I/O)
      │
      ▼
Dashboard Builder (pure)           ← buildDashboardReport()
      │
      ▼
ExecutiveDashboardReport           ← canonical state model
      │
      ├── TerminalRenderer
      ├── JsonRenderer
      ├── REST API (future)
      ├── Web UI (future)
      └── Automation / LLM consumers
```

### Data flow

1. **Loader** (`loadDashboardSnapshot`) — async I/O: loads TrendStore, RecommendationReportStore, OutcomeReportStore, ProposalStore, effectiveness directory data. Returns `ExecutiveDashboardSnapshot`.
2. **Builder** (`buildDashboardReport`) — pure function: takes `ExecutiveDashboardSnapshot`, runs 7 sub-builders, returns `ExecutiveDashboardReport`.
3. **Renderer** (`TerminalDashboardRenderer` / `JsonDashboardRenderer`) — renders the report object. Terminal uses box-drawing and unicode. JSON serializes directly.

---

## 3. Core types

```ts
// ─────────────────────────────────────────────────────────────────────
// Panel identifiers
// ─────────────────────────────────────────────────────────────────────

export type DashboardPanelId =
  | "summary"
  | "health"
  | "pipeline"
  | "effectiveness"
  | "signal-reliability"
  | "integrity";

// ─────────────────────────────────────────────────────────────────────
// Row types (one per panel)
// ─────────────────────────────────────────────────────────────────────

export interface ExecutiveSummaryRow {
  label: string;                // "Response Rate"
  value: string;                // "62%"
  previous: string;             // "58%"  (prior period)
  severity: "ok" | "warning" | "critical";
  source: string;               // upstream metric key
}

export interface SubsystemHealthRow {
  subsystem: string;
  score: number;
  trend: "up" | "down" | "flat";
  delta: number;
  status: "ok" | "warning" | "critical";
  correlationEffectiveness: number | null;  // from P10.8c
}

export interface PipelineRow {
  signal: string;
  total: number;
  unreviewed: number;
  stale: number;
  applied: number;
  actionRate: number;
  effectivenessRate: number | null;
}

export interface ProposalEffectivenessRow {
  action: string;               // e.g. "update_agent_card"
  kept: number;
  reverted: number;
  investigated: number;
  noData: number;
  effectivenessRate: number;
  coverage: number;
}

export interface SignalReliabilityRow {
  signal: string;
  coverageRate: number;
  improvingRate: number;
  status: "ok" | "warning" | "critical";
  confidenceBuckets: ConfidenceBucket[];
}

export interface IntegrityRow {
  metric: string;
  value: string | number;
  status: "ok" | "warning" | "critical";
}

// ─────────────────────────────────────────────────────────────────────
// Panel abstraction
// ─────────────────────────────────────────────────────────────────────

export interface DashboardPanel<T> {
  id: DashboardPanelId;
  title: string;
  rows: readonly T[];
  empty: boolean;
}

/**
 * Discriminated union over all panel types. Renderers dispatch on
 * `panel.id` (compile-time safe) to determine column layout and
 * row rendering. Adding a new panel type is a new union member.
 */
export type DashboardPanelData =
  | DashboardPanel<SubsystemHealthRow>
  | DashboardPanel<PipelineRow>
  | DashboardPanel<ProposalEffectivenessRow>
  | DashboardPanel<SignalReliabilityRow>
  | DashboardPanel<IntegrityRow>;

// ─────────────────────────────────────────────────────────────────────
// Extension point for P11+
// ─────────────────────────────────────────────────────────────────────

/**
 * A dashboard extension adds a panel from outside the core model.
 * P11/P12 subsystems register themselves without modifying
 * ExecutiveDashboardReport core.
 */
export interface DashboardExtension {
  id: string;
  panel: DashboardPanelData;
}

// ─────────────────────────────────────────────────────────────────────
// Alerts
// ─────────────────────────────────────────────────────────────────────

/**
 * First-class alert object, reusable beyond the dashboard.
 * The correlationKey enables deduplication when multiple analytics
 * engines report the same underlying issue.
 */
export interface ExecutiveAlert {
  severity: "ok" | "warning" | "critical";
  source: string;               // "stale" | "degrading" | "low-coverage" | "unavailable"
  subsystem?: string;
  recommendationId?: string;
  proposalId?: string;
  correlationKey?: string;
  message: string;
  action: string;               // human-readable: "review", "investigate", "reclassify"
}

// ─────────────────────────────────────────────────────────────────────
// Loader types
// ─────────────────────────────────────────────────────────────────────

export interface DashboardSources {
  trendsLoaded: boolean;
  recommendationsLoaded: boolean;
  proposalsLoaded: boolean;
  effectivenessLoaded: boolean;
  correlationsLoaded: boolean;
}

/**
 * The raw executive data at one point in time. Created by the loader
 * (loadDashboardSnapshot) and consumed by the pure builder
 * (buildDashboardReport). Defined explicitly so implementers don't
 * invent their own snapshot shape.
 */
export interface ExecutiveDashboardSnapshot {
  trends: ExecutiveTrendSnapshot | null;
  effectivenessResult: EffectivenessResult | null;
  subsystemCorrelationReport: SubsystemCorrelationReport | null;
  outcomeReports: ExecutiveOutcomeEvaluationReport[];
  proposalStatusMap: Map<string, ProposalStatus | null>;
  effectivenessOutcomeMap: Map<string, EffectivenessOutcome>;
  loadWarnings: string[];
  windowDays: number;
}

export interface DashboardBuilderOptions {
  subsystemFilter?: string;
  brief: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────

export interface DashboardMetadata {
  generatedAt: string;
  windowDays: number;
  trendSnapshotAge: number | null;          // ms since latest snapshot
  recommendationWindow: number;
  correlationMode: string;
  correlationLagDays: number;
  subsystemFilter?: string;
  schemaVersion: 1;                         // bump on breaking schema changes
  dashboardVersion: "p10.9.0";             // milestone version string
  sources: DashboardSources;
  loadWarnings: string[];
}

export interface UpstreamMetrics {
  responseRate: number | null;
  effectivenessRate: number | null;
  correlationCoverage: number | null;
  improvingSubsystems: number;
  degradingSubsystems: number;
  unaddressedCount: number;
}

// ─────────────────────────────────────────────────────────────────────
// Canonical report
// ─────────────────────────────────────────────────────────────────────

/**
 * The canonical executive state model.
 * CLI dashboard is the first renderer; REST endpoints, web UIs,
 * automation, and LLM consumers are natural future consumers.
 *
 * Build order: load snapshot → build panels → derive alerts → derive summary.
 * Summary is last so it can reduce over already-built panel data.
 */
export interface ExecutiveDashboardReport {
  metadata: DashboardMetadata;
  summary: DashboardPanel<ExecutiveSummaryRow>;
  panels: DashboardPanelData[];
  alerts: ExecutiveAlert[];
  upstreamMetrics: UpstreamMetrics;
  extensions: DashboardExtension[];   // empty in P10.9, populated by P11+
}
```

---

## 4. Panel definitions

Six panels in a 3-column × 2-row grid, with a full-width Executive Summary bar above.

### Panel 1 — Executive Summary (full-width top bar)

**Always present.** Extracts KPI values from upstream P10.6–P10.8c outputs — never computes them. Each KPI shows a severity status icon (`✅` / `⚠️` / `🔴`).

### Panel 2 — Subsystem Health (col 1, row 1)

Renders per-subsystem scores from `ExecutiveTrendSnapshot.subsystemScores`. Adds trend direction (`↑` / `↓` / `→`) and numerical delta. Sorted by descending severity (critical first), then subsystem name. Thresholds: ≥60 ✅, ≥40 ⚠️, <40 🔴.

### Panel 3 — Recommendation Pipeline (col 2, row 1)

Per-signal disposition breakdown from `SignalCalibration[]` (P10.8a). Columns: signal, total, unreviewed, stale, applied, action rate, effectiveness rate. Sorted by descending total recommendations. Only renders signals with `total > 0`.

### Panel 4 — Proposal Effectiveness (col 3, row 1)

Per-signal effectiveness outcomes from P10.8b (`appliedKeep`, `appliedRevert`, `appliedInvestigate`, `appliedNoData`, `effectivenessRate`, `effectivenessCoverage`). Only renders if at least one signal has `applied > 0`. Sorted by descending effectiveness rate.

### Panel 5 — Signal Reliability (col 1, row 2)

Per-signal correlation metrics from P10.8c `SignalCorrelation[]`. Columns: signal, coverage rate, improving rate, status. Thresholds: ≥60% ✅, ≥30% ⚠️, <30% 🔴. Sorted by descending coverage rate.

### Panel 6 — System Integrity (col 2–3, row 2)

Always renders. Shows dashboard-level metadata quality: reports loaded, recommendations, correlated percentage, effectiveness coverage, trend coverage, missing proposals. Tells the operator whether the dashboard is trustworthy. Even with all-zero values, the panel renders with an explanatory note.

### Alerts section (below panels)

Derived from stale/unreviewed recommendations (P10.8a), degrading subsystems (P10.6), low correlation coverage (P10.8c), and missing proposal data. Sorted by severity (critical first), then source. Maximum 10 alerts shown.

---

## 5. Builder functions

```ts
function buildDashboardReport(
  snapshot: ExecutiveDashboardSnapshot,
  options: DashboardBuilderOptions,
): ExecutiveDashboardReport
```

**Build order** (strict, enforced by function composition):

1. Load snapshot (loader, I/O)
2. Build panels (6 sub-builders)
3. Derive alerts (over panels data)
4. Derive summary (reduces over panels + alerts — done last to prevent metric drift)
5. Assemble report

Internally delegates to seven sub-builders:

```ts
function buildSummaryPanel(data, panels, alerts): DashboardPanel<ExecutiveSummaryRow>
function buildHealthPanel(data): DashboardPanel<SubsystemHealthRow>
function buildPipelinePanel(data): DashboardPanel<PipelineRow>
function buildEffectivenessPanel(data): DashboardPanel<ProposalEffectivenessRow>
function buildSignalReliabilityPanel(data): DashboardPanel<SignalReliabilityRow>
function buildIntegrityPanel(data): DashboardPanel<IntegrityRow>
function buildAlerts(data, panels): ExecutiveAlert[]
```

Each sub-builder is independently testable. All are pure — no I/O, no store access.

---

## 6. CLI interface

```bash
alix executive dashboard [--brief] [--json] [--subsystem <name>] [--since <days>]
```

| Flag | Default | Effect |
|------|---------|--------|
| _(no args)_ | — | Full 6-panel terminal dashboard |
| `--brief` | off | Executive Summary + Alerts only (30-second cockpit). With `--json`, renders `ExecutiveDashboardReport` with only summary and alerts populated; panels are empty. |
| `--json` | off | Raw `ExecutiveDashboardReport` as JSON |
| `--subsystem <name>` | none | All panels filtered to one subsystem |
| `--since <days>` | 30 | Analysis window for recommendation reports |

### Terminal output layout (default)

```
╔══════════════════════════════════════════════════════════════╗
║ Executive Dashboard                    schema: 1  p10.9.0  ║
╚══════════════════════════════════════════════════════════════╝

 [1] Executive Summary (5 of 8 subsystems)
 ─────────────────────────────────────────────────────────────
  Metric                     Status     Value  Previous
  Subsystems improving      · ✅       4/5    3/5
  Subsystems degrading      · ✅       1/5    2/5
  Response rate              · ⚠️      62%    58%
  Effectiveness rate         · ✅       78%    71%
  Correlation coverage       · ✅       91%    85%
  Unaddressed alerts         · 🔴       12     8

 [2] Subsystem Health      [3] Pipeline        [4] Effectiveness
 workflow  ↑  72 ✅        degrading 24 67%    update_card  71% ✅
 memory    →  65 ✅        persist   12 83%    adjust_skl  80% ✅
 security  ↓  48 ⚠️        low_conf   6 50%    (1 empty)    —

 [5] Signal Reliability     [6] System Integrity (always)
 degrading  ✓ 88% ✅        Reports loaded .... 42
 low_conf   ✗ 22% 🔴        Recommendations ... 138
 persist    ⚠ 45% ⚠️        Correlated ....... 91%

 Alerts (3)
 ─────────────────────────────────────────────────────────────
  severity  source        subsystem   message
 ● critical stale         workflow    age 14d, unreviewed
 ● warning  degrading     security    score -3.5 in 7d window
 ● warning  low-coverage  learning    signal at 22% coverage
```

### `--brief` output

```
Executive Dashboard (brief)              p10.9.0  2026-06-28
─────────────────────────────────────────────────────────────
  Subsystems improving       · ✅  4/5
  Subsystems degrading       · ✅  1/5
  Response rate               · ⚠️  62%
  Effectiveness rate          · ✅  78%
  Correlation coverage        · ✅  91%
  Unaddressed alerts          · 🔴  12

  Alerts (3)
  ...
```

### `--json` output

Full `ExecutiveDashboardReport` serialized to JSON. Error cases return the same schema shape with `empty: true` panels and an alert instead of a bare `{ok: false}` object.

### Error modes

| Condition | Terminal | JSON |
|-----------|----------|------|
| No data | "No executive data available." | All panels empty, alert: `"run executive analytics"` |
| Partial failure | Render available panels + warning | `metadata.sources.*` indicates which stores failed |
| Subsystem not found | Empty panels + info line | All panels empty, `subsystemFilter` preserved, alert included |

---

## 7. Stable panel ordering

Panels always render in this fixed order — the renderer must never sort dynamically. This ensures operators build muscle memory across sessions.

```
1. Executive Summary      (full width, always visible)
2. Subsystem Health       (col 1, row 1)
3. Recommendation Pipeline (col 2, row 1)
4. Proposal Effectiveness  (col 3, row 1)
5. Signal Reliability     (col 1, row 2)
6. System Integrity       (col 2–3, row 2)
7. Alerts                 (full width, below panels)
```

Future panels append to this list; they do not reorder existing panels. The `DashboardPanel.order` field exists for P11 extensions, not for P10.9 core panels.

---

## 8. Hard governance boundary

> **Executive Dashboard Rule:** P10.9 MUST NOT perform trend analysis, confidence calculations, effectiveness calculations, recommendation generation, or correlation analysis. All numerical values originate from upstream analytics (P10.6–P10.8c). P10.9 may only **filter, sort, group, rank, aggregate, and render**.

```
P10.9 composes and presents.

P10.9 does not compute analytics.
P10.9 does not call trend/confidence/correlation engines.
P10.9 does not write to stores.
P10.9 does not create proposals.
P10.9 does not access stores directly.
```

**Allowed:** weighted averages, sorting, ranking, filtering, grouping, extracting upstream metric values.
**Forbidden:** trend analysis, confidence calculation, correlation computation, disposition classification, prediction.

The loader performs all I/O. The builder is 100% pure. Renderers never compute metrics. Analytics engines never know the dashboard exists.

---

## 8. File structure

| File | Responsibility | New/Modify |
|------|---------------|------------|
| `src/executive/executive-dashboard.ts` | Types, `buildDashboardReport()` + 7 sub-builders | **Create** |
| `src/executive/executive-dashboard-loader.ts` | `loadDashboardSnapshot()` — async I/O, loads all stores | **Create** |
| `src/cli/commands/executive-dashboard-handler.ts` | CLI entry point, `TerminalDashboardRenderer`, `JsonDashboardRenderer` | **Modify** (extends existing P10.0 handler) |
| `src/cli/commands/executive.ts` | Extend existing `case "dashboard"` routing | **Modify** |
| `tests/executive/executive-dashboard.vitest.ts` | Pure builder tests (7 sub-builders × 1–2 tests = ~10 tests) | **Create** |
| `tests/cli/commands/executive-dashboard-cli.vitest.ts` | Integration tests (JSON, brief, terminal, partial data, subsystem filter) | **Create** |
| `tests/executive/executive-sentinels.vitest.ts` | Add new files to `EXECUTIVE_FILES` | **Modify** |

---

## 9. Test plan

### Pure builder tests (`executive-dashboard.vitest.ts`)

- **buildSummaryPanel** — extracts correct values from mock snapshot; all-zero snapshot renders summary with zeros, not a crash.
- **buildHealthPanel** — correct subsystem ordering (critical first); trend direction from delta.
- **buildPipelinePanel** — sorted by descending total; empty snapshot → panel.empty === true.
- **buildEffectivenessPanel** — correct effectivenessRate aggregation; no applied data → panel.empty === true.
- **buildSignalReliabilityPanel** — status threshold mapping (≥60% ok, ≥30% warning, <30% critical).
- **buildIntegrityPanel** — always renders; all-zero snapshot produces IntegrityRow[] with zero values and status: ok.
- **buildAlerts** — stale recommendations create critical alerts; degrading subsystems create warning alerts; empty snapshot → empty alerts array.

### CLI integration tests (`executive-dashboard-cli.vitest.ts`)

- **default output** — terminal table renders all six panels with expected headers.
- **JSON output** — full `ExecutiveDashboardReport` serialized, `metadata.schemaVersion === 1`.
- **brief output** — Executive Summary + Alerts only (no panel section headers).
- **partial data** — one store unavailable → metadata.sources false, remaining panels render.
- **subsystem filter** — all panels scoped to one subsystem.

### Sentinel

Both new files (`executive-dashboard.ts`, `executive-dashboard-loader.ts`) added to `EXECUTIVE_FILES`. Loader must allow `writeFileSync`/`mkdirSync`/`readdirSync` for store reads within its existing exception scope.

---

## 10. P10.9b — deferred concerns

These are explicitly deferred from P10.9a for scope control:

- **Plain ASCII rendering** (`--plain` / `--no-unicode`). Deferred to P10.9b unless Windows CI requires it.
- **Historical trend charts** in terminal (sparklines). Deferred — current panel shows latest snapshot only.
- **Interactive drill-down** (TUI with cursors). Deferred — `--subsystem` flag provides filtering.
- **Cost/resource panels.** Deferred to P11 (no analytics exist yet).
- **Web UI / REST API.** Deferred — the `ExecutiveDashboardReport` schema is designed for these; renderers are trivial to add.

---

## 11. Design record

| Date | Change |
|------|--------|
| 2026-06-28 | Initial spec — panel architecture, CLI interface, pure composition model |

---

*This specification is approved and ready for implementation planning.*
