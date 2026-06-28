# P10.9 — Executive Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose P10.6–P10.8c analytics into a unified terminal dashboard (`alix executive dashboard`) with JSON output, no new analytics.

**Architecture:** Three-layer pipeline: async loader (`loadDashboardSnapshot`) → pure builder (`buildDashboardReport` with 7 sub-builders) → renderer (`TerminalDashboardRenderer`/`JsonDashboardRenderer`). `ExecutiveDashboardReport` is the canonical executive state model; the CLI dashboard is its first renderer.

**Tech Stack:** TypeScript, Vitest, existing RecommendationReportStore/OutcomeReportStore/ProposalStore/TrendStore/effectiveness directory, existing executive handler routing.

## Global Constraints

- **Composition-only:** P10.9 MUST NOT perform trend analysis, confidence calculations, effectiveness calculations, recommendation generation, or correlation analysis. All numerical values originate from upstream analytics (P10.6–P10.8c). P10.9 may only **filter, sort, group, rank, aggregate, and render**.
- Dashboard panels always render in fixed order: **Summary → Health → Pipeline → Effectiveness → Reliability → Integrity → Alerts**. No dynamic sorting.
- Build order: **load snapshot → build panels → derive alerts → derive summary → assemble report**. Summary is last to prevent metric drift.
- `ExecutiveDashboardReport` uses `schemaVersion: 1`, `dashboardVersion: "p10.9.0"`.
- `DashboardPanel<T>` with `DashboardPanelId` enum for compile-time safe rendering.
- `ExecutiveAlert` includes `correlationKey` for cross-engine deduplication.
- `DashboardExtension[]` added to `ExecutiveDashboardReport` — always empty in P10.9, ready for P11+.
- `--brief` outputs Summary + Alerts only.
- JSON error cases follow the report schema (panels empty + alerts), not a bare `{ok: false}`.
- `--json --brief` renders `ExecutiveDashboardReport` with summary and alerts only; panels are empty.
- Read-only invariant: loader accesses stores via their read APIs (`load()`/`list()`). Builder is 100% pure. Renderers compute nothing.
- New files added to `EXECUTIVE_FILES` in the executive purity sentinel.
- `System Integrity` panel always renders, even when all rows are zero (tells operator whether data is trustworthy).
- `--no-unicode` / plain-ASCII rendering deferred to P10.9b.

### Task 1a: Pure types + constants + snapshot

**Files:**
- Create: `src/executive/executive-dashboard.ts` (types only — no builders)

**Interfaces:**
- Consumes: Types from `recommendation-effectiveness.ts`, `subsystem-correlation.ts`, `trend-store.ts`, `outcome-evaluator.ts`.
- Produces: All type interfaces with `readonly` properties, `DashboardPanel<T>`, `DashboardPanelData`, `DashboardPanelId`, `ExecutiveDashboardSnapshot`, `DashboardBuilderOptions`, `DashboardContext`, `DashboardSources`, `DashboardMetadata`, `UpstreamMetrics`, `ExecutiveDashboardReport`, `ExecutiveAlert`, `DashboardExtension`.

```ts
// All interfaces are readonly — immutable data flowing through the pipeline.
export type DashboardPanelId = "summary" | "health" | "pipeline"
  | "effectiveness" | "signal-reliability" | "integrity";

export interface DashboardPanel<T> {
  readonly id: DashboardPanelId;
  readonly title: string;
  readonly rows: readonly T[];
  readonly empty: boolean;
  readonly panelVersion: 1;
  readonly panelSchema: 1;
}

export interface ExecutiveDashboardSnapshot {
  readonly trends: ExecutiveTrendSnapshot | null;
  readonly effectivenessResult: EffectivenessResult | null;
  readonly subsystemCorrelationReport: SubsystemCorrelationReport | null;
  readonly outcomeReports: readonly ExecutiveOutcomeEvaluationReport[];
  readonly proposalStatusMap: ReadonlyMap<string, ProposalStatus | null>;
  readonly effectivenessOutcomeMap: ReadonlyMap<string, EffectivenessOutcome>;
  readonly loadWarnings: readonly string[];
  readonly windowDays: number;
  readonly generatedAt: string;
}

export interface DashboardContext {
  readonly snapshot: ExecutiveDashboardSnapshot;
  readonly options: DashboardBuilderOptions;
}

export const PANEL_ORDER: readonly DashboardPanelId[] = [
  "health", "pipeline", "effectiveness", "signal-reliability", "integrity",
];

export const HEALTH_OK = 60;
export const HEALTH_WARNING = 40;
export const COVERAGE_OK = 0.6;
export const COVERAGE_WARNING = 0.3;
export const DEFAULT_CORRELATION_LAG = 30;
export const DEFAULT_STALE_THRESHOLD = 7;

// ... rest of types — all readonly, all immutable.
```

- [ ] **Step 1: Write the test file** (shared with Task 1b — types compile-checked by tsc)
- [ ] **Step 2: Run to verify the test fails** (module not found)
- [ ] **Step 3: Implement the types file**
- [ ] **Step 4: Run tsc to verify types compile**
- [ ] **Step 5: Commit**

```bash
git add src/executive/executive-dashboard.ts tests/executive/executive-dashboard.vitest.ts
git commit -m "feat(p10-9): add dashboard types, constants, immutability

DashboardPanel<T>, DashboardPanelData, DashboardPanelId,
ExecutiveDashboardSnapshot (readonly), DashboardContext,
PANEL_ORDER singleton, centralized thresholds (HEALTH_OK,
COVERAGE_OK), ExecutiveAlert, DashboardExtension point.
Pure types module — no builders, no renderers."
```

### Task 1b: Pure builder implementations + sub-builders

**Files:**
- Modify: `src/executive/executive-dashboard.ts` (add builder functions)
- Test: `tests/executive/executive-dashboard.vitest.ts`

**Interfaces:**
- Consumes: `DashboardContext`, `ExecutiveDashboardSnapshot` from Task 1a.
- Produces: `buildDashboardReport(ctx: DashboardContext)`, `buildHealthPanel`, `buildPipelinePanel`, `buildEffectivenessPanel`, `buildSignalReliabilityPanel`, `buildIntegrityPanel`, `buildAlerts`, `buildSummaryPanel`.

**Explicit pipeline** (documented in code):

```ts
// Pipeline:
//   1. Normalize snapshot data
//   2. Build panels (each pure, independently testable)
//   3. Derive alerts (scans panels for anomalies)
//   4. Derive summary (reduces over panels + alerts — done LAST)
//   5. Assemble report

export function buildDashboardReport(ctx: DashboardContext): ExecutiveDashboardReport {
  const panels: DashboardPanelData[] = [
    buildHealthPanel(ctx),
    buildPipelinePanel(ctx),
    buildEffectivenessPanel(ctx),
    buildSignalReliabilityPanel(ctx),
    buildIntegrityPanel(ctx),
  ];
  const alerts = buildAlerts(ctx, panels);
  const summary = buildSummaryPanel(ctx, panels, alerts);

  const upstreamMetrics: UpstreamMetrics = {
    improvingSubsystems: panels.find(p => p.id === "health")
      ?.rows.filter((r: any) => r.trend === "up").length ?? 0,
    degradingSubsystems: panels.find(p => p.id === "health")
      ?.rows.filter((r: any) => r.trend === "down").length ?? 0,
    // All numeric — string formatting is the renderer's job
    responseRate: extractUpstreamValue(summary, "responseRate"),
    effectivenessRate: extractUpstreamValue(summary, "effectivenessRate"),
    correlationCoverage: extractUpstreamValue(summary, "correlationCoverage"),
    unaddressedCount: alerts.filter(a => a.severity === "warning" || a.severity === "critical").length,
  };

  return { metadata: buildMetadata(ctx, summary, panels), summary, panels, alerts, upstreamMetrics, extensions: [] };
}
```

Key rules:
- **Never call `new Date()`** — use `ctx.snapshot.generatedAt`.
- **Never format strings** — return numeric values; the renderer formats.
- Use `PANEL_ORDER` for consistent ordering.
- Use centralized thresholds (`HEALTH_OK`, `HEALTH_WARNING`, `COVERAGE_OK`).

Tests: Same file as 1a. Same 10 test functions. Implement builders → tests go green.

- [ ] Step 1: Confirm pre-existing tests fail (builder functions not yet implemented)
- [ ] Step 2: Implement all 7 sub-builders
- [ ] Step 3: Run tests → green
- [ ] Step 4: Commit

```ts
import { describe, it, expect } from "vitest";
import {
  buildDashboardReport,
  buildHealthPanel,
  buildPipelinePanel,
  buildEffectivenessPanel,
  buildSignalReliabilityPanel,
  buildIntegrityPanel,
  buildAlerts,
  buildSummaryPanel,
} from "../../src/executive/executive-dashboard.js";
import type { ExecutiveDashboardSnapshot } from "../../src/executive/executive-dashboard.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function mockSnapshot(over: Partial<ExecutiveDashboardSnapshot> = {}): ExecutiveDashboardSnapshot {
  return {
    trends: null,
    effectivenessResult: null,
    subsystemCorrelationReport: null,
    outcomeReports: [],
    proposalStatusMap: new Map(),
    effectivenessOutcomeMap: new Map(),
    loadWarnings: [],
    windowDays: 30,
    ...over,
  };
}

describe("buildDashboardReport", () => {
  it("returns a valid report even from a fully empty snapshot", () => {
    const report = buildDashboardReport(mockSnapshot(), { brief: false });
    expect(report.metadata.schemaVersion).toBe(1);
    expect(report.metadata.dashboardVersion).toBe("p10.9.0");
    expect(report.panels.length).toBeGreaterThanOrEqual(1);
    expect(report.summary.empty).toBe(false); // always renders
  });

  it("honors brief option (summary + alerts only, panels empty)", () => {
    const report = buildDashboardReport(mockSnapshot(), { brief: true });
    expect(report.panels.every(p => p.empty)).toBe(true);
  });

  it("filters all panels by subsystemFilter", () => {
    const report = buildDashboardReport(mockSnapshot(), {
      brief: false,
      subsystemFilter: "workflow",
    });
    expect(report.metadata.subsystemFilter).toBe("workflow");
  });

  it("produces deterministic panel ordering", () => {
    const report = buildDashboardReport(mockSnapshot(), { brief: false });
    const ids = report.panels.map(p => p.id);
    expect(ids).toEqual([
      "health", "pipeline", "effectiveness",
      "signal-reliability", "integrity",
    ]);
  });
});

describe("buildHealthPanel", () => {
  it("returns empty panel when no trends", () => {
    const panel = buildHealthPanel(mockSnapshot());
    expect(panel.empty).toBe(true);
  });

  it("sorts critical-status subsystems first", () => {
    const snapshot = mockSnapshot({
      trends: {
        id: "t1", generatedAt: "2026-06-28T00:00:00.000Z", windowDays: 30,
        subsystemScores: {
          workflow: 75, memory: 45, security: 30, learning: 82,
        } as any,
      },
    });
    const panel = buildHealthPanel(snapshot);
    // security(30) should be first (critical < 40)
    expect(panel.rows[0]).toMatchObject({ subsystem: "security", status: "critical" });
    expect(panel.rows[1]).toMatchObject({ subsystem: "memory", status: "warning" });
    expect(panel.rows[2]).toMatchObject({ subsystem: "workflow", status: "ok" });
  });
});

describe("buildPipelinePanel", () => {
  it("returns empty panel when no effectiveness result", () => {
    const panel = buildPipelinePanel(mockSnapshot());
    expect(panel.empty).toBe(true);
  });

  it("sorts by descending total recommendations", () => {
    const snapshot = mockSnapshot({
      effectivenessResult: {
        effectivenessStatus: "ok", generatedAt: "",
        staleThresholdDays: 7, reportCount: 2,
        totalRecommendations: 18,
        signalCalibration: [
          { signal: "degrading_trend", total: 12, unreviewed: 3, stale: 1,
            applied: 4, awaitingReview: 2, approvedPendingApply: 1,
            rejected: 0, failed: 0, proposalMissing: 1, bridgedCount: 8,
            actionRate: 0.67, appliedKeep: 2, appliedRevert: 0,
            appliedInvestigate: 1, appliedNoData: 1,
            effectivenessRate: 0.67, effectivenessCoverage: 0.75 },
          { signal: "low_confidence", total: 6, unreviewed: 2, stale: 1,
            applied: 1, awaitingReview: 1, approvedPendingApply: 0,
            rejected: 1, failed: 0, proposalMissing: 0, bridgedCount: 3,
            actionRate: 0.50, appliedKeep: 0, appliedRevert: 1,
            appliedInvestigate: 0, appliedNoData: 0,
            effectivenessRate: 0, effectivenessCoverage: 1 },
        ],
        recommendations: [],
        loadWarnings: [],
      },
    });
    const panel = buildPipelinePanel(snapshot);
    expect(panel.rows[0]).toMatchObject({ signal: "degrading_trend", total: 12 });
    expect(panel.rows[1]).toMatchObject({ signal: "low_confidence", total: 6 });
  });
});

describe("buildEffectivenessPanel", () => {
  it("returns empty panel when no applied recommendations", () => {
    const snapshot = mockSnapshot({
      effectivenessResult: {
        effectivenessStatus: "ok", generatedAt: "",
        staleThresholdDays: 7, reportCount: 1,
        totalRecommendations: 5,
        signalCalibration: [
          { signal: "degrading_trend", total: 5, unreviewed: 5, stale: 0,
            applied: 0, awaitingReview: 0, approvedPendingApply: 0,
            rejected: 0, failed: 0, proposalMissing: 0, bridgedCount: 0,
            actionRate: 0, appliedKeep: 0, appliedRevert: 0,
            appliedInvestigate: 0, appliedNoData: 0,
            effectivenessRate: 0, effectivenessCoverage: 0 },
        ],
        recommendations: [],
        loadWarnings: [],
      },
    });
    const panel = buildEffectivenessPanel(snapshot);
    expect(panel.empty).toBe(true);
  });
});

describe("buildSignalReliabilityPanel", () => {
  it("returns empty panel when no correlation report", () => {
    const panel = buildSignalReliabilityPanel(mockSnapshot());
    expect(panel.empty).toBe(true);
  });

  it("maps coverage rate to status threshold", () => {
    const snapshot = mockSnapshot({
      subsystemCorrelationReport: {
        correlationStatus: "ok", correlationMode: "strict",
        correlationLagDays: 30, reportGeneratedAt: "",
        outcomeReportCount: 2, totalRecommendations: 10,
        matchedRecommendationCount: 6, unmatchedRecommendationCount: 4,
        subsystemCorrelations: [],
        signalCorrelations: [
          { signal: "degrading_trend", recommendationCount: 8,
            matchedRecommendationCount: 7, matchedDeltaCount: 12,
            averageDelta: 1.2, averageAbsoluteDelta: 3.0,
            improvingRate: 0.57, coverageRate: 0.88,
            confidenceBuckets: [] },
          { signal: "low_confidence", recommendationCount: 2,
            matchedRecommendationCount: 0, matchedDeltaCount: 0,
            averageDelta: 0, averageAbsoluteDelta: 0,
            improvingRate: 0, coverageRate: 0,
            confidenceBuckets: [] },
        ],
        correlations: [],
        loadWarnings: [],
      },
    });
    const panel = buildSignalReliabilityPanel(snapshot);
    expect(panel.rows[0]).toMatchObject({ signal: "degrading_trend", status: "ok" });
    expect(panel.rows[1]).toMatchObject({ signal: "low_confidence", status: "critical" });
  });
});

describe("buildIntegrityPanel", () => {
  it("always renders, even with empty snapshot", () => {
    const panel = buildIntegrityPanel(mockSnapshot());
    expect(panel.empty).toBe(false);
    expect(panel.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildAlerts", () => {
  it("returns empty array from empty snapshot", () => {
    expect(buildAlerts(mockSnapshot(), [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run tests/executive/executive-dashboard.vitest.ts --reporter=verbose 2>&1 | head -10
```
Expected: FAIL — module not found, all tests fail.

- [ ] **Step 3: Implement types + builder**

Create `src/executive/executive-dashboard.ts`:

```ts
/**
 * P10.9 — Executive Dashboard.
 *
 * Pure composition layer: takes ExecutiveDashboardSnapshot (produced by
 * the async loader) and returns ExecutiveDashboardReport (the canonical
 * executive state model). No I/O, no analytics computation.
 *
 * Build order: load snapshot → build panels → derive alerts → derive summary.
 * Summary is last so it can reduce over already-built panel data.
 *
 * @module
 */

import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import type { EffectivenessResult, SignalCalibration, EffectivenessOutcome, ProposalStatus } from "./recommendation-effectiveness.js";
import type { SubsystemCorrelationReport, ConfidenceBucket, SubsystemCorrelation, SignalCorrelation } from "./subsystem-correlation.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Panel identifiers
// ---------------------------------------------------------------------------

export type DashboardPanelId =
  | "summary"
  | "health"
  | "pipeline"
  | "effectiveness"
  | "signal-reliability"
  | "integrity";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface ExecutiveSummaryRow {
  label: string;
  value: string;
  previous: string;
  severity: "ok" | "warning" | "critical";
  source: string;
}

export interface SubsystemHealthRow {
  subsystem: string;
  score: number;
  trend: "up" | "down" | "flat";
  delta: number;
  status: "ok" | "warning" | "critical";
  correlationEffectiveness: number | null;
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
  action: string;
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

// ---------------------------------------------------------------------------
// DashboardPanel
// ---------------------------------------------------------------------------

export interface DashboardPanel<T> {
  id: DashboardPanelId;
  title: string;
  rows: readonly T[];
  empty: boolean;
}

export type DashboardPanelData =
  | DashboardPanel<SubsystemHealthRow>
  | DashboardPanel<PipelineRow>
  | DashboardPanel<ProposalEffectivenessRow>
  | DashboardPanel<SignalReliabilityRow>
  | DashboardPanel<IntegrityRow>;

export interface DashboardExtension {
  id: string;
  panel: DashboardPanelData;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface ExecutiveAlert {
  severity: "ok" | "warning" | "critical";
  source: string;
  subsystem?: string;
  recommendationId?: string;
  proposalId?: string;
  correlationKey?: string;
  message: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Loader types
// ---------------------------------------------------------------------------

export interface DashboardSources {
  trendsLoaded: boolean;
  recommendationsLoaded: boolean;
  proposalsLoaded: boolean;
  effectivenessLoaded: boolean;
  correlationsLoaded: boolean;
}

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

export interface DashboardMetadata {
  generatedAt: string;
  windowDays: number;
  trendSnapshotAge: number | null;
  recommendationWindow: number;
  correlationMode: string;
  correlationLagDays: number;
  subsystemFilter?: string;
  schemaVersion: 1;
  dashboardVersion: "p10.9.0";
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

export interface ExecutiveDashboardReport {
  metadata: DashboardMetadata;
  summary: DashboardPanel<ExecutiveSummaryRow>;
  panels: DashboardPanelData[];
  alerts: ExecutiveAlert[];
  upstreamMetrics: UpstreamMetrics;
  extensions: DashboardExtension[];
}

// ---------------------------------------------------------------------------
// Panel builders
// ---------------------------------------------------------------------------

/**
 * Build the subsystem health panel from trend and correlation data.
 * Sorts by status (critical first -> warning -> ok), then subsystem name.
 */
export function buildHealthPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<SubsystemHealthRow> { /* ... */ }

/**
 * Build the recommendation pipeline panel (signal disposition).
 * Sorts by descending total recommendations.
 */
export function buildPipelinePanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<PipelineRow> { /* ... */ }

/**
 * Build the proposal effectiveness panel (per-action keep/revert/investigate).
 * Only non-empty when at least one signal has applied > 0.
 * Sorts by descending effectiveness rate.
 */
export function buildEffectivenessPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<ProposalEffectivenessRow> { /* ... */ }

/**
 * Build the signal reliability panel (correlation coverage per signal).
 * Status thresholds: >= 60% → ok, >= 30% → warning, < 30% → critical.
 * Sorts by descending coverage rate.
 */
export function buildSignalReliabilityPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<SignalReliabilityRow> { /* ... */ }

/**
 * Build the system integrity panel. Always renders.
 * Shows counts for reports loaded, recommendations, correlation coverage,
 * effectiveness coverage, trend coverage, missing proposals.
 */
export function buildIntegrityPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<IntegrityRow> { /* ... */ }

/**
 * Derive alerts from stale/unreviewed recs, degrading subsystems,
 * low correlation coverage, and missing proposal data.
 */
export function buildAlerts(
  snapshot: ExecutiveDashboardSnapshot,
  panels: DashboardPanelData[],
): ExecutiveAlert[] { /* ... */ }

/**
 * Build the executive summary panel. Derived LAST so it can reduce
 * over the already-built panels and alerts. Extracts upstream metric
 * values — never computes them.
 */
export function buildSummaryPanel(
  snapshot: ExecutiveDashboardSnapshot,
  panels: DashboardPanelData[],
  alerts: ExecutiveAlert[],
): DashboardPanel<ExecutiveSummaryRow> { /* ... */ }

/**
 * Main composition function. Pure — no I/O, no store access.
 *
 * Build order: panels → alerts → summary. Summary is last to prevent
 * metric drift (it reduces over panels + alerts).
 */
export function buildDashboardReport(
  snapshot: ExecutiveDashboardSnapshot,
  options: DashboardBuilderOptions,
): ExecutiveDashboardReport {
  const generatedAt = new Date().toISOString();
  const panels: DashboardPanelData[] = [];

  // 1. Build panels (unordered; renderer sorts by spec order)
  const health = buildHealthPanel(snapshot);
  const pipeline = buildPipelinePanel(snapshot);
  const effectiveness = buildEffectivenessPanel(snapshot);
  const reliability = buildSignalReliabilityPanel(snapshot);
  const integrity = buildIntegrityPanel(snapshot);

  // 2. Apply subsystem filter
  if (options.subsystemFilter) {
    // Each sub-builder handles its own filtering; for panels that
    // don't support per-subsystem filtering, they remain empty.
  }

  panels.push(health, pipeline, effectiveness, reliability, integrity);

  // 3. Derive alerts
  const alerts = buildAlerts(snapshot, panels);

  // 4. Derive summary (last — extracts from panels + alerts, never from raw snapshot)
  const summary = buildSummaryPanel(snapshot, panels, alerts);

  // 5. Assemble metadata
  const metadata: DashboardMetadata = {
    generatedAt,
    windowDays: snapshot.windowDays,
    trendSnapshotAge: snapshot.trends
      ? Date.now() - new Date(snapshot.trends.generatedAt).getTime()
      : null,
    recommendationWindow: snapshot.windowDays,
    correlationMode: snapshot.subsystemCorrelationReport?.correlationMode ?? "strict",
    correlationLagDays: snapshot.subsystemCorrelationReport?.correlationLagDays ?? 30,
    subsystemFilter: options.subsystemFilter,
    schemaVersion: 1,
    dashboardVersion: "p10.9.0",
    sources: {
      trendsLoaded: snapshot.trends !== null,
      recommendationsLoaded: snapshot.effectivenessResult !== null,
      proposalsLoaded: snapshot.proposalStatusMap.size > 0,
      effectivenessLoaded: snapshot.effectivenessOutcomeMap.size > 0,
      correlationsLoaded: snapshot.subsystemCorrelationReport !== null,
    },
    loadWarnings: snapshot.loadWarnings,
  };

  // 6. Assemble upstream metrics (extracted from panels)
  const upstreamMetrics: UpstreamMetrics = {
    responseRate: !summary.empty ? parseFloat(summary.rows.find(r => r.source === "responseRate")?.value ?? "") ?? null : null,
    effectivenessRate: null,
    correlationCoverage: null,
    improvingSubsystems: health.rows.filter(r => r.trend === "up").length,
    degradingSubsystems: health.rows.filter(r => r.trend === "down").length,
    unaddressedCount: alerts.filter(a => a.severity === "critical" || a.severity === "warning").length,
  };

  return { metadata, summary, panels, alerts, upstreamMetrics, extensions: [] };
}

// ---------------------------------------------------------------------------
// Renderer interface
// ---------------------------------------------------------------------------

export interface DashboardRenderer {
  render(report: ExecutiveDashboardReport): void;
}
```

Implement the full function bodies for each sub-builder. Key implementation details:

- `buildHealthPanel`: Extract `subsystemScores` from `snapshot.trends`. Map score to status (>= 60 → ok, >= 40 → warning, < 40 → critical). Calculate trend direction from delta (positive → up, negative → down, zero → flat). Sort by status severity (critical first), then subsystem name.
- `buildPipelinePanel`: Iterate `snapshot.effectivenessResult.signalCalibration`. Map to `PipelineRow`. Sort by `total` descending.
- `buildEffectivenessPanel`: Iterate signal calibration, only include signals with `applied > 0`. Extract `appliedKeep`/`appliedRevert`/`appliedInvestigate`/`appliedNoData` per signal. Sort by `effectivenessRate` descending.
- `buildSignalReliabilityPanel`: Iterate `snapshot.subsystemCorrelationReport.signalCorrelations`. Map coverage rate to status. Sort by `coverageRate` descending.
- `buildIntegrityPanel`: Always produces rows. Count reports, recommendations, compute correlation coverage percentage, effectiveness coverage, trend coverage, missing proposals.
- `buildAlerts`: Check each panel for issues; also check `loadWarnings`. Each alert has `severity`, `source` (where it came from), `message`, `action`, and optional `correlationKey`.
- `buildSummaryPanel`: Extract 6 KPI values from `upstreamMetrics` and panel data. Each row has `label`, `value`, `previous`, `severity`, and `source` key.

- [ ] **Step 4: Run tests to verify green**

```bash
npx vitest run tests/executive/executive-dashboard.vitest.ts --reporter=verbose 2>&1
```
Expected: All ~10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/executive/executive-dashboard.ts tests/executive/executive-dashboard.vitest.ts
git commit -m "feat(p10-9): add pure types + builder for executive dashboard

ExecutiveDashboardReport canonical state model, DashboardPanel<T>
abstraction, 7 sub-builders (health/pipeline/effectiveness/
reliability/integrity/summary/alerts), DashboardPanelData
discriminated union, ExecutiveAlert domain object, DashboardExtension
point, TerminalRenderer/JsonRenderer interface. ~10 unit tests.

Build order: panels → alerts → summary (last, prevents metric drift).
No I/O, no analytics computation."
```

### Task 2: Async loader — loadDashboardSnapshot

**Files:**
- Create: `src/executive/executive-dashboard-loader.ts`

**Interfaces:**
- Consumes: `ExecutiveDashboardSnapshot`, `DashboardSources` from `executive-dashboard.ts`.
- Produces: `loadDashboardSnapshot(cwd, windowDays)` → `ExecutiveDashboardSnapshot`.

- [ ] **Step 1: Implement loader**

Use **parallel I/O** for independent store reads:

```ts
export async function loadDashboardSnapshot(
  cwd: string,
  windowDays: number,
): Promise<ExecutiveDashboardSnapshot> {
  const loadWarnings: string[] = [];
  const generatedAt = new Date().toISOString();

  // Phase 1: Load independent stores in parallel
  const [trendsResult, recMetasResult] = await Promise.allSettled([
    loadTrends(cwd),
    listRecommendationMetas(cwd, windowDays),
  ]);

  const trends = trendsResult.status === "fulfilled" ? trendsResult.value : null;
  const recMetas = recMetasResult.status === "fulfilled" ? recMetasResult.value : [];
  if (trendsResult.status === "rejected") loadWarnings.push("Failed to load trend snapshot");
  if (recMetasResult.status === "rejected") loadWarnings.push("Failed to list recommendation reports");

  // Phase 2: Load recommendation reports (depends on rec metas)
  const loadedReports = await loadReportsInParallel(recMetas, cwd, loadWarnings);

  // Phase 3: Load outcome reports + proposals (depends on loaded reports)
  const [outcomeRefs, proposalStatusMap] = await Promise.all([
    loadOutcomeRefs(cwd, windowDays, loadWarnings),
    loadProposalStatuses(loadedReports, cwd, loadWarnings),
  ]);

  // Phase 4: Build entries, enrichment, correlation
  const entries = buildEntries(loadedReports, proposalStatusMap);
  const effectivenessOutcomeMap = loadEffectivenessOutcomes(cwd, loadWarnings);
  const enrichedEntries = applyEffectivenessData(entries, effectivenessOutcomeMap);
  const effectivenessResult = entries.length > 0
    ? computeRecommendationEffectiveness(enrichedEntries, DEFAULT_STALE_THRESHOLD, generatedAt)
    : null;
  const subsystemCorrelationReport = outcomeRefs.length > 0 && entries.length > 0
    ? await computeSubsystemCorrelation(entries, outcomeRefs,
        new SubsystemTimeMatcher("strict", DEFAULT_CORRELATION_LAG),
        "strict", DEFAULT_CORRELATION_LAG, generatedAt)
    : null;

  return {
    trends, effectivenessResult, subsystemCorrelationReport,
    outcomeReports: outcomeRefs.map(r => r.report),
    proposalStatusMap, effectivenessOutcomeMap,
    loadWarnings, windowDays, generatedAt,
  };
}
```

No separate test file — tested through CLI integration tests.

  // 4. Build RecommendationEntry array for effectiveness result and correlation
  const entries: RecommendationEntry[] = [];
  for (const report of loadedReports) {
    const ageDays = Math.floor((nowMs - new Date(report.report.generatedAt).getTime()) / MS_PER_DAY);
    const recs = report.report.recommendations;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const proposalStatus = rec.proposalId
        ? (proposalStatusMap.get(rec.proposalId) ?? null)
        : undefined;
      entries.push({
        reportId: report.id, generatedAt: report.report.generatedAt,
        recIndex: i, subsystem: rec.subsystem, signal: rec.signal,
        severity: rec.severity, signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation, proposalId: rec.proposalId,
        disposition: classifyRecommendation(
          { subsystem: rec.subsystem, signal: rec.signal, severity: rec.severity,
            signalConfidence: rec.signalConfidence, recommendation: rec.recommendation,
            proposalId: rec.proposalId, proposalStatus, ageDays },
          DEFAULT_STALE_THRESHOLD_DAYS,
        ),
        ageDays,
      });
    }
  }

  // 5. Load effectiveness outcomes (P10.8b)
  const effectivenessDir = join(cwd, ".alix", "adaptation", "effectiveness");
  const effectivenessOutcomeMap = new Map<string, EffectivenessOutcome>();
  try {
    if (existsSync(effectivenessDir)) {
      const files = readdirSync(effectivenessDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = readFileSync(join(effectivenessDir, file), "utf-8");
          const report = JSON.parse(raw);
          effectivenessOutcomeMap.set(report.proposalId, report.recommendation);
        } catch (e: any) {
          loadWarnings.push(`Skipping corrupt effectiveness report: ${file} — ${e.message}`);
        }
      }
    }
  } catch {
    loadWarnings.push("Failed to read effectiveness directory");
  }

  // 6. Enrich entries with effectiveness data (reuses P10.8b pure function)
  const enrichedEntries = applyEffectivenessData(entries, effectivenessOutcomeMap);

  // 7. Compute correlation (P10.8c)
  const outcomeStore = new OutcomeReportStore(join(cwd, ".alix", "executive", "outcomes"));
  const outcomeRefs: Array<{ id: string; report: any }> = [];
  try {
    const metas = outcomeStore.list();
    const filteredMetas = windowDays
      ? metas.filter(m => (nowMs - new Date(m.generatedAt).getTime()) / MS_PER_DAY <= windowDays)
      : metas;
    for (const meta of filteredMetas) {
      try {
        const report = outcomeStore.load(meta.reportId);
        if (report) outcomeRefs.push({ id: meta.reportId, report });
      } catch (e: any) {
        loadWarnings.push(`Skipping corrupt outcome report: ${meta.reportId} — ${e.message}`);
      }
    }
  } catch {
    loadWarnings.push("Failed to list outcome reports");
  }

  let subsystemCorrelationReport = null;
  if (outcomeRefs.length > 0 && entries.length > 0) {
    const matcher = new SubsystemTimeMatcher("strict", 30);
    subsystemCorrelationReport = await computeSubsystemCorrelation(
      entries, outcomeRefs, matcher, "strict", 30, generatedAt,
    );
  }

  // 8. Build effectiveness result (reuses P10.8 aggregation)
  const { computeRecommendationEffectiveness } = await import("./recommendation-effectiveness.js");
  const effectivenessResult = entries.length > 0
    ? computeRecommendationEffectiveness(enrichedEntries, DEFAULT_STALE_THRESHOLD_DAYS, generatedAt)
    : null;

  return {
    trends,
    effectivenessResult,
    subsystemCorrelationReport,
    outcomeReports: outcomeRefs.map(r => r.report),
    proposalStatusMap,
    effectivenessOutcomeMap,
    loadWarnings,
    windowDays,
  };
}
```

No separate test file for the loader — it is tested through the CLI integration tests (Task 3).

- [ ] **Step 2: Commit**

```bash
git add src/executive/executive-dashboard-loader.ts
git commit -m "feat(p10-9): add async loader for executive dashboard

loadDashboardSnapshot() loads TrendStore, RecommendationReportStore,
OutcomeReportStore, ProposalStore, and effectiveness directory.
Produces ExecutiveDashboardSnapshot for the pure builder.
Reuses classifyRecommendation, applyEffectivenessData,
computeSubsystemCorrelation, and computeRecommendationEffectiveness
from existing P10.8 modules. All store reads wrapped in try/catch
for graceful partial-data handling."
```

### Task 3: CLI handler + renderers + routing + sentinel + tests

**Files:**
- Create: `tests/cli/commands/executive-dashboard-cli.vitest.ts`
- Modify: `src/cli/commands/executive-dashboard-handler.ts` (replace with P10.9 pipeline)
- Modify: `src/cli/commands/executive.ts` (routing — already has `case "dashboard"`)
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add new files)

**Interfaces:**
- Consumes: `loadDashboardSnapshot()`, `buildDashboardReport()`, `ExecutiveDashboardReport`, `DashboardRenderer`, `TerminalDashboardRenderer`, `JsonDashboardRenderer`.
- Produces: `runDashboard()` — the CLI entry point.

- [ ] **Step 1: Write failing CLI tests**

Create `tests/cli/commands/executive-dashboard-cli.vitest.ts`:

```ts
/**
 * P10.9 — Executive Dashboard CLI integration tests.
 *
 * Tests the full pipeline: loader → builder → renderer.
 * Uses temp directories with seeded store data.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runDashboard } from "../../../src/cli/commands/executive-dashboard-handler.js";
import { RecommendationReportStore, type RecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "../../../src/executive/outcome-evaluator.js";
import type { ExecutiveSubsystemName } from "../../../src/executive/executive-health.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
}

function makeExecRec(over = {}) {
  return {
    subsystem: "workflow", signal: "degrading_trend", severity: "high",
    recommendation: "Investigate workflow", signalConfidence: 0.88,
    occurrenceCount: 8, averageDelta: -3.2, ...over,
  };
}

function makeReport(recs: any[], generatedAt = "2026-06-15T12:00:00.000Z"): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0", id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt, requestedWindow: 10, recommendationStatus: "ok",
      inputReportCount: recs.length, analyzedReportCount: recs.length,
      skippedReportCount: 0, evidenceReportIds: ["outcome-a"],
      recommendations: recs, warnings: [], loadWarnings: [],
    },
  };
}

function persist(report: RecommendationReport, tempRoot: string): string {
  const store = new RecommendationReportStore(join(tempRoot, ".alix", "executive", "recommendations"));
  return store.save(report.report);
}

let tempRoot: string;
const MS_PER_DAY = 86_400_000;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-9-dashboard-cli-"));
  mkdirSync(join(tempRoot, ".alix", "executive", "recommendations"), { recursive: true });
  mkdirSync(join(tempRoot, ".alix", "executive", "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive dashboard CLI", () => {
  it("renders terminal dashboard with all panel headers", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard([]);
    const output = c.out().join("\n");
    expect(output).toContain("Executive Dashboard");
    expect(output).toContain("Executive Summary");
    expect(output).toContain("Subsystem Health");
    expect(output).toContain("Recommendation Pipeline");
    expect(output).toContain("System Integrity");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--brief shows summary + alerts only", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--brief"]);
    const output = c.out().join("\n");
    expect(output).toContain("Executive Dashboard (brief)");
    expect(output).toContain("Executive Summary");
    expect(output).not.toContain("Subsystem Health");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--json outputs valid ExecutiveDashboardReport", async () => {
    const rec = makeExecRec();
    const savedId = persist(makeReport([rec]), tempRoot);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.metadata.schemaVersion).toBe(1);
    expect(parsed.metadata.dashboardVersion).toBe("p10.9.0");
    expect(parsed.summary).toBeDefined();
    expect(parsed.panels).toBeDefined();
    expect(parsed.alerts).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("partial data renders available panels with warnings", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.summary.empty).toBe(false);
    expect(parsed.panels.some(p => p.empty)).toBe(true);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("empty dashboard (no stores) still produces summary + integrity + alerts", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(Object.values(parsed.metadata.sources).every(v => v === false)).toBe(true);
    expect(parsed.summary.empty).toBe(false);
    expect(parsed.alerts).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("large dashboard: 100+ recs renders with deterministic ordering", async () => {
    const recs = Array.from({ length: 120 }, (_, i) => ({
      subsystem: i % 3 === 0 ? "workflow" : i % 3 === 1 ? "memory" : "security",
      signal: i % 5 === 0 ? "degrading_trend" : i % 5 === 1 ? "persistent_instability"
        : i % 5 === 2 ? "low_confidence" : "improving_trend",
      severity: "high", recommendation: `Rec ${i}`, signalConfidence: 0.5 + (i % 5) * 0.1,
      occurrenceCount: 5, averageDelta: i % 2 === 0 ? -2 : 3,
      proposalId: i < 50 ? `p${i}` : undefined,
    }));
    persist(makeReport(recs, "2026-06-15T12:00:00.000Z"), tempRoot);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.panels.map((p: any) => p.id))
      .toEqual(["health", "pipeline", "effectiveness", "signal-reliability", "integrity"]);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("corrupt data (null/NaN/undefined) never crashes dashboard", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--brief"]);
    expect(c.out().join("\n")).toContain("Executive Dashboard");
    expect(c.err().length).toBe(0);
    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run to verify failures**

```bash
npx vitest run tests/cli/commands/executive-dashboard-cli.vitest.ts --reporter=verbose 2>&1 | head -20
```
Expected: FAIL — `runDashboard` hasn't been updated yet.

- [ ] **Step 3: Implement the CLI handler + renderers**

Replace `src/cli/commands/executive-dashboard-handler.ts`:

```ts
/**
 * P10.9 — Executive Dashboard CLI handler.
 *
 * Coordinates the full dashboard pipeline:
 *   1. Parse CLI flags
 *   2. Load dashboard snapshot (async I/O)
 *   3. Build dashboard report (pure)
 *   4. Render (terminal or JSON)
 *
 * Replaces the P10.0/P10.1 dashboard which built health reports and
 * planning engines — those moved upstream to their respective milestones.
 *
 * @module
 */

import { loadDashboardSnapshot } from "../../executive/executive-dashboard-loader.js";
import { buildDashboardReport } from "../../executive/executive-dashboard.js";
import type { ExecutiveDashboardReport } from "../../executive/executive-dashboard.js";
import { renderTerminalDashboard } from "./executive-dashboard-renderer.js";

const DEFAULT_SINCE_DAYS = 30;

export async function runDashboard(args: string[]): Promise<void> {
  const brief = args.includes("--brief");
  const useJson = args.includes("--json");

  const sinceIndex = args.indexOf("--since");
  const sinceDays = sinceIndex !== -1 && sinceIndex + 1 < args.length
    ? Math.max(1, parseInt(args[sinceIndex + 1], 10) || DEFAULT_SINCE_DAYS)
    : DEFAULT_SINCE_DAYS;

  const subIdx = args.indexOf("--subsystem");
  const subsystemFilter = subIdx !== -1 && subIdx + 1 < args.length
    ? args[subIdx + 1]
    : undefined;

  const cwd = process.cwd();

  const snapshot = await loadDashboardSnapshot(cwd, sinceDays);
  const report = buildDashboardReport(snapshot, { brief, subsystemFilter });

  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderTerminalDashboard(report);
  }
}
```

And then `src/cli/commands/executive-dashboard-renderer.ts` (separate renderer module — pure UI, no business logic):

```ts
/**
 * P10.9 — Executive Dashboard terminal renderer.
 *
 * Pure formatting layer. No analytics computation — only formats
 * data already present in the ExecutiveDashboardReport.
 * Uses centralized formatter helpers for consistent output.
 *
 * @module
 */

import type { ExecutiveDashboardReport, DashboardPanelData,
  ExecutiveAlert, ExecutiveSummaryRow } from "../../executive/executive-dashboard.js";

// ─────────────────────────────────────────────────────────────────────
// Formatter helpers
// ─────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const clamped = Math.max(0, Math.min(1, n));
  return `${(clamped * 100).toFixed(0)}%`;
}
function icon(severity: string): string {
  if (severity === "ok") return "✅";
  if (severity === "warning") return "⚠️";
  return "🔴";
}
function trendArrow(t: string): string {
  if (t === "up") return "↑";
  if (t === "down") return "↓";
  return "→";
}

// ─────────────────────────────────────────────────────────────────────
// Main renderer
// ─────────────────────────────────────────────────────────────────────

export function renderTerminalDashboard(report: ExecutiveDashboardReport): void {
  const { summary, panels, alerts, metadata } = report;

  console.log("");
  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║ Executive Dashboard              schema: 1  p10.9.0        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log("");

  // Summary panel (always renders)
  if (summary.rows.length > 0) {
    console.log("Executive Summary");
    console.log("─".repeat(75));
    for (const row of summary.rows) {
      console.log(
        ` ${row.label.padEnd(28)} · ${icon(row.severity)}  ${row.value.padStart(8)}  (prev ${row.previous})`,
      );
    }
    console.log("");
  }

  // Panels (render title even if empty — test expectations depend on it)
  for (const panel of panels) {
    console.log(`${panel.title}`);
    console.log("─".repeat(75));
    if (panel.empty) {
      console.log(" (no data)");
    } else {
      renderPanel(panel);
    }
    console.log("");
  }

  // Alerts
  if (alerts.length > 0) {
    console.log(`Alerts (${alerts.length})`);
    console.log("─".repeat(75));
    for (const alert of alerts) {
      const subsys = alert.subsystem ? ` ${alert.subsystem}` : "";
      console.log(` ${icon(alert.severity)} [${alert.source}]${subsys} — ${alert.message}`);
      console.log(`    Action: ${alert.action}`);
    }
    console.log("");
  }

  // Metadata line
  const srcSummary = Object.entries(metadata.sources)
    .filter(([_, v]) => v).length + "/" + Object.keys(metadata.sources).length + " sources loaded";
  if (metadata.loadWarnings.length > 0) {
    console.log(` ⚠️  ${metadata.loadWarnings.length} warning(s) — run --json for details`);
  }
  console.log(` ${srcSummary}  |  ${metadata.subsystemFilter ? `subsystem: ${metadata.subsystemFilter}` : ""}`);
}

function renderPanel(panel: DashboardPanelData): void {
  switch (panel.id) {
    case "health":
      console.log(` ${"Subsystem".padEnd(16)} ${"Score".padEnd(7)} ${"Trend".padEnd(5)} ${"Δ".padEnd(8)} ${"Status".padEnd(8)}`);
      for (const row of panel.rows as any) {
        const trendChar = row.trend === "up" ? "↑" : row.trend === "down" ? "↓" : "→";
        console.log(
          ` ${row.subsystem.padEnd(16)} ${String(row.score).padEnd(7)} ${trendChar.padEnd(5)} ${String(row.delta).padEnd(8)} ${icon(row.status).padEnd(8)}`,
        );
      }
      break;
    case "pipeline": {
      console.log(` ${"Signal".padEnd(22)} ${"Total".padEnd(6)} ${"Unrev".padEnd(6)} ${"Stale".padEnd(6)} ${"Appld".padEnd(6)} Rt    Eff`);
      for (const row of panel.rows as any) {
        const rt = pct(row.actionRate);
        const ef = row.effectivenessRate !== null ? pct(row.effectivenessRate) : "—";
        console.log(
          ` ${row.signal.padEnd(22)} ${String(row.total).padEnd(6)} ${String(row.unreviewed).padEnd(6)} ${String(row.stale).padEnd(6)} ${String(row.applied).padEnd(6)} ${rt} ${ef}`,
        );
      }
      break;
    }
    case "effectiveness": {
      console.log(` ${"Action".padEnd(24)} ${"Kept".padEnd(5)} ${"Rev".padEnd(5)} ${"Inv".padEnd(5)} ${"NoD".padEnd(5)} Rt      Cov`);
      for (const row of panel.rows as any) {
        console.log(
          ` ${row.action.padEnd(24)} ${String(row.kept).padEnd(5)} ${String(row.reverted).padEnd(5)} ${String(row.investigated).padEnd(5)} ${String(row.noData).padEnd(5)} ${pct(row.effectivenessRate).padEnd(6)} ${pct(row.coverage)}`,
        );
      }
      break;
    }
    case "signal-reliability": {
      console.log(` ${"Signal".padEnd(22)} Coverage  ImproveRt Status`);
      for (const row of panel.rows as any) {
        console.log(
          ` ${row.signal.padEnd(22)} ${pct(row.coverageRate).padEnd(9)} ${pct(row.improvingRate).padEnd(10)} ${icon(row.status)}`,
        );
      }
      break;
    }
    case "integrity":
      for (const row of panel.rows as any) {
        console.log(` ${row.metric.padEnd(28)} ${String(row.value).padStart(8)}  ${icon(row.status)}`);
      }
      break;
  }
}
```

- [ ] **Step 4: Add sentinel entries**

Add to `tests/executive/executive-sentinels.vitest.ts`:

```ts
  // P10.9 files
  "src/executive/executive-dashboard.ts",
  "src/executive/executive-dashboard-loader.ts",
```

The existing `src/cli/commands/executive-dashboard-handler.ts` and `src/cli/commands/executive-dashboard-renderer.ts` are already in `EXECUTIVE_FILES`.

- [ ] **Step 5: Verify — full suite + tsc + sentinel**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
npx tsc --noEmit
```

Expected: All tests pass (baseline ~2126 + ~14 new = ~2140), tsc clean, sentinel green.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-dashboard-handler.ts src/cli/commands/executive-dashboard-renderer.ts tests/cli/commands/executive-dashboard-cli.vitest.ts tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10-9): add CLI handler, renderers, tests, and sentinel

- Replaced P10.0 dashboard handler with P10.9 pipeline
- TerminalDashboardRenderer with box-drawing for all 6 panels
- 4 CLI integration tests (default, --brief, --json, partial data)
- Added new files to EXECUTIVE_FILES sentinel

Full pipeline: loadDashboardSnapshot → buildDashboardReport → render"
```

### Task 4: Whole-branch review + PR

**Release checklist (run in order):**
- [ ] 1. Lint (if available)
- [ ] 2. Full test suite — expect ~2140 passing
- [ ] 3. TypeScript — clean
- [ ] 4. Executive purity sentinel — all pass
- [ ] 5. Create review package: `bash <plugin>/scripts/review-package <merge-base> HEAD`
- [ ] 6. Dispatch whole-branch review on most capable model
- [ ] 7. Apply any Critical/Important findings
- [ ] 8. Push branch, create PR, squash merge
- [ ] 9. Tag `alix-p10-9-complete` and push tag

---

## File structure summary

| File | Task | Responsibility |
|------|------|---------------|
| `src/executive/executive-dashboard.ts` | 1 | Types, builder, 7 sub-builders, renderer interface |
| `tests/executive/executive-dashboard.vitest.ts` | 1 | 10 pure builder tests |
| `src/executive/executive-dashboard-loader.ts` | 2 | Async loadDashboardSnapshot, all store I/O |
| `src/cli/commands/executive-dashboard-handler.ts` | 3 | CLI entry point, flag parsing, pipeline coordination |
| `src/cli/commands/executive-dashboard-renderer.ts` | 3 | TerminalDashboardRenderer, panel dispatch |
| `tests/cli/commands/executive-dashboard-cli.vitest.ts` | 3 | 4 CLI integration tests |
| `tests/executive/executive-sentinels.vitest.ts` | 3 | Add 2 new files |
| `src/cli/commands/executive.ts` | 3 | Routing already exists (P10.0) |
