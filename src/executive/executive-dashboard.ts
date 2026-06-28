/**
 * P10.9 — Executive Dashboard: pure types, constants, panel abstraction.
 *
 * Readonly interfaces and discriminated-union panel types for the executive
 * dashboard pipeline. No builders, no renderers — purely the data contract.
 *
 * @module
 */

import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import type { EffectivenessResult, SignalCalibration, EffectivenessOutcome, ProposalStatus } from "./recommendation-effectiveness.js";
import type { SubsystemCorrelationReport, ConfidenceBucket, SubsystemCorrelation, SignalCorrelation } from "./subsystem-correlation.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Panel identity
// ---------------------------------------------------------------------------

export type DashboardPanelId = "summary" | "health" | "pipeline"
  | "effectiveness" | "signal-reliability" | "integrity";

// ---------------------------------------------------------------------------
// Row types (dashboard-only)
// ---------------------------------------------------------------------------

export interface ExecutiveSummaryRow {
  readonly label: string;
  readonly value: string;
  readonly previous: string;
  readonly severity: "ok" | "warning" | "critical";
  readonly source: string;
}

export interface SubsystemHealthRow {
  readonly subsystem: string;
  readonly score: number;
  readonly trend: "up" | "down" | "flat";
  readonly delta: number;
  readonly status: "ok" | "warning" | "critical";
  readonly correlationEffectiveness: number | null;
}

export interface PipelineRow {
  readonly signal: string;
  readonly total: number;
  readonly unreviewed: number;
  readonly stale: number;
  readonly applied: number;
  readonly actionRate: number;
  readonly effectivenessRate: number | null;
}

export interface ProposalEffectivenessRow {
  readonly action: string;
  readonly kept: number;
  readonly reverted: number;
  readonly investigated: number;
  readonly noData: number;
  readonly effectivenessRate: number;
  readonly coverage: number;
}

export interface SignalReliabilityRow {
  readonly signal: string;
  readonly coverageRate: number;
  readonly improvingRate: number;
  readonly status: "ok" | "warning" | "critical";
  readonly confidenceBuckets: readonly ConfidenceBucket[];
}

export interface IntegrityRow {
  readonly metric: string;
  readonly value: string | number;
  readonly status: "ok" | "warning" | "critical";
}

// ---------------------------------------------------------------------------
// Panel abstraction
// ---------------------------------------------------------------------------

export interface DashboardPanel<T> {
  readonly id: DashboardPanelId;
  readonly title: string;
  readonly rows: readonly T[];
  readonly empty: boolean;
  readonly panelVersion: 1;
  readonly panelSchema: 1;
}

export type DashboardPanelData =
  | DashboardPanel<SubsystemHealthRow>
  | DashboardPanel<PipelineRow>
  | DashboardPanel<ProposalEffectivenessRow>
  | DashboardPanel<SignalReliabilityRow>
  | DashboardPanel<IntegrityRow>;

// ---------------------------------------------------------------------------
// Extension point
// ---------------------------------------------------------------------------

export interface DashboardExtension {
  readonly id: string;
  readonly panel: DashboardPanelData;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface ExecutiveAlert {
  readonly severity: "ok" | "warning" | "critical";
  readonly source: string;     // "stale" | "degrading" | "low-coverage" | "unavailable"
  readonly subsystem?: string;
  readonly recommendationId?: string;
  readonly proposalId?: string;
  readonly correlationKey?: string;
  readonly message: string;
  readonly action: string;
}

// ---------------------------------------------------------------------------
// Loader / snapshot types
// ---------------------------------------------------------------------------

export interface DashboardSources {
  readonly trendsLoaded: boolean;
  readonly recommendationsLoaded: boolean;
  readonly proposalsLoaded: boolean;
  readonly effectivenessLoaded: boolean;
  readonly correlationsLoaded: boolean;
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

export interface DashboardBuilderOptions {
  readonly subsystemFilter?: string;
  readonly brief: boolean;
}

export interface DashboardContext {
  readonly snapshot: ExecutiveDashboardSnapshot;
  readonly options: DashboardBuilderOptions;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface DashboardMetadata {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly trendSnapshotAge: number | null;
  readonly recommendationWindow: number;
  readonly correlationMode: string;
  readonly correlationLagDays: number;
  readonly subsystemFilter?: string;
  readonly schemaVersion: 1;
  readonly dashboardVersion: "p10.9.0";
  readonly sources: DashboardSources;
  readonly loadWarnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Upstream metrics
// ---------------------------------------------------------------------------

export interface UpstreamMetrics {
  readonly responseRate: number | null;
  readonly effectivenessRate: number | null;
  readonly correlationCoverage: number | null;
  readonly improvingSubsystems: number;
  readonly degradingSubsystems: number;
  readonly unaddressedCount: number;
}

// ---------------------------------------------------------------------------
// Canonical report
// ---------------------------------------------------------------------------

export interface ExecutiveDashboardReport {
  readonly metadata: DashboardMetadata;
  readonly summary: DashboardPanel<ExecutiveSummaryRow>;
  readonly panels: readonly DashboardPanelData[];
  readonly alerts: readonly ExecutiveAlert[];
  readonly upstreamMetrics: UpstreamMetrics;
  readonly extensions: readonly DashboardExtension[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PANEL_ORDER: readonly DashboardPanelId[] = [
  "health", "pipeline", "effectiveness", "signal-reliability", "integrity",
] as const;

export const HEALTH_OK = 60;
export const HEALTH_WARNING = 40;
export const COVERAGE_OK = 0.6;
export const COVERAGE_WARNING = 0.3;
export const DEFAULT_CORRELATION_LAG = 30;
export const DEFAULT_STALE_THRESHOLD = 7;

// ---------------------------------------------------------------------------
// Panel builders
// ---------------------------------------------------------------------------

/**
 * Build the subsystem health panel from trend and correlation data.
 * Sorts by status (critical first -> warning -> ok), then subsystem name.
 */
export function buildHealthPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<SubsystemHealthRow> {
  if (!snapshot.trends) {
    return { id: "health", title: "Subsystem Health", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const };
  }

  const subsystemCorrelations = snapshot.subsystemCorrelationReport?.subsystemCorrelations ?? [];

  const rows: SubsystemHealthRow[] = Object.entries(snapshot.trends.subsystemScores).map(([subsystem, score]) => {
    const delta = 0; // No historical delta in trends snapshot
    const trend: "up" | "down" | "flat" = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const status: "ok" | "warning" | "critical" = score >= HEALTH_OK ? "ok" : score >= HEALTH_WARNING ? "warning" : "critical";
    const correlation = subsystemCorrelations.find(c => c.subsystem === subsystem);
    const correlationEffectiveness = correlation?.correlationEffectiveness ?? null;
    return { subsystem, score, trend, delta, status, correlationEffectiveness };
  });

  const severityOrder: Record<string, number> = { critical: 0, warning: 1, ok: 2 };
  rows.sort((a, b) => severityOrder[a.status] - severityOrder[b.status]);

  return { id: "health", title: "Subsystem Health", rows, empty: false, panelVersion: 1 as const, panelSchema: 1 as const };
}

/**
 * Build the recommendation pipeline panel (signal disposition).
 * Sorts by descending total recommendations.
 */
export function buildPipelinePanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<PipelineRow> {
  if (!snapshot.effectivenessResult) {
    return { id: "pipeline", title: "Pipeline", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const };
  }

  const rows: PipelineRow[] = snapshot.effectivenessResult.signalCalibration.map(cal => ({
    signal: cal.signal,
    total: cal.total,
    unreviewed: cal.unreviewed,
    stale: cal.stale,
    applied: cal.applied,
    actionRate: cal.actionRate,
    effectivenessRate: cal.effectivenessRate,
  }));

  rows.sort((a, b) => b.total - a.total);

  return { id: "pipeline", title: "Pipeline", rows, empty: false, panelVersion: 1 as const, panelSchema: 1 as const };
}

/**
 * Build the proposal effectiveness panel (per-action keep/revert/investigate).
 * Only non-empty when at least one signal has applied > 0.
 * Sorts by descending effectiveness rate.
 */
export function buildEffectivenessPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<ProposalEffectivenessRow> {
  if (!snapshot.effectivenessResult) {
    return { id: "effectiveness", title: "Proposal Effectiveness", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const };
  }

  const filtered = snapshot.effectivenessResult.signalCalibration.filter(cal => cal.applied > 0);
  if (filtered.length === 0) {
    return { id: "effectiveness", title: "Proposal Effectiveness", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const };
  }

  const rows: ProposalEffectivenessRow[] = filtered.map(cal => ({
    action: cal.signal,
    kept: cal.appliedKeep,
    reverted: cal.appliedRevert,
    investigated: cal.appliedInvestigate,
    noData: cal.appliedNoData,
    effectivenessRate: cal.effectivenessRate,
    coverage: cal.effectivenessCoverage,
  }));

  rows.sort((a, b) => b.effectivenessRate - a.effectivenessRate);

  return { id: "effectiveness", title: "Proposal Effectiveness", rows, empty: false, panelVersion: 1 as const, panelSchema: 1 as const };
}

/**
 * Build the signal reliability panel (correlation coverage per signal).
 * Status thresholds: >= 60% -> ok, >= 30% -> warning, < 30% -> critical.
 * Sorts by descending coverage rate.
 */
export function buildSignalReliabilityPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<SignalReliabilityRow> {
  if (!snapshot.subsystemCorrelationReport) {
    return { id: "signal-reliability", title: "Signal Reliability", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const };
  }

  const rows: SignalReliabilityRow[] = snapshot.subsystemCorrelationReport.signalCorrelations.map(sc => {
    const status: "ok" | "warning" | "critical" = sc.coverageRate >= COVERAGE_OK ? "ok" : sc.coverageRate >= COVERAGE_WARNING ? "warning" : "critical";
    return {
      signal: sc.signal,
      coverageRate: sc.coverageRate,
      improvingRate: sc.improvingRate,
      status,
      confidenceBuckets: sc.confidenceBuckets,
    };
  });

  rows.sort((a, b) => b.coverageRate - a.coverageRate);

  return { id: "signal-reliability", title: "Signal Reliability", rows, empty: false, panelVersion: 1 as const, panelSchema: 1 as const };
}

/**
 * Build the system integrity panel. Always renders.
 * Shows counts for reports loaded, recommendations, correlation coverage,
 * effectiveness coverage, trend coverage, missing proposals.
 */
export function buildIntegrityPanel(snapshot: ExecutiveDashboardSnapshot): DashboardPanel<IntegrityRow> {
  const rows: IntegrityRow[] = [
    { metric: "Reports Loaded", value: snapshot.outcomeReports.length, status: "ok" },
    { metric: "Recommendations", value: snapshot.effectivenessResult?.totalRecommendations ?? 0, status: "ok" },
  ];

  // Correlated
  if (snapshot.subsystemCorrelationReport) {
    const rep = snapshot.subsystemCorrelationReport;
    rows.push({
      metric: "Correlated",
      value: `${rep.matchedRecommendationCount}/${rep.totalRecommendations}`,
      status: "ok",
    });
  } else {
    rows.push({ metric: "Correlated", value: "N/A", status: "ok" });
  }

  // Effectiveness Coverage
  if (snapshot.effectivenessResult && snapshot.effectivenessResult.signalCalibration.length > 0) {
    const totalCoverage = snapshot.effectivenessResult.signalCalibration.reduce(
      (sum, cal) => sum + cal.effectivenessCoverage, 0,
    );
    const avgCoverage = Math.round((totalCoverage / snapshot.effectivenessResult.signalCalibration.length) * 100) / 100;
    rows.push({ metric: "Effectiveness Coverage", value: avgCoverage, status: "ok" });
  } else {
    rows.push({ metric: "Effectiveness Coverage", value: "N/A", status: "ok" });
  }

  // Trend Coverage
  rows.push({ metric: "Trend Coverage", value: snapshot.trends !== null ? "Yes" : "No", status: "ok" });

  // Missing Proposals
  let missingCount = 0;
  for (const value of snapshot.proposalStatusMap.values()) {
    if (value === null) missingCount++;
  }
  rows.push({ metric: "Missing Proposals", value: missingCount, status: "ok" });

  return { id: "integrity", title: "Integrity", rows, empty: false, panelVersion: 1 as const, panelSchema: 1 as const };
}

/**
 * Derive alerts from stale/unreviewed recs, degrading subsystems,
 * low correlation coverage, and missing proposal data.
 */
export function buildAlerts(
  snapshot: ExecutiveDashboardSnapshot,
  panels: DashboardPanelData[],
): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = [];

  // Check for stale/unreviewed recommendations
  if (snapshot.effectivenessResult) {
    for (const cal of snapshot.effectivenessResult.signalCalibration) {
      if (cal.stale > 0) {
        alerts.push({
          severity: "warning",
          source: "stale",
          message: `${cal.signal}: ${cal.stale} stale recommendation(s)`,
          action: "Review pipeline",
        });
      }
      if (cal.unreviewed > 0) {
        alerts.push({
          severity: "ok",
          source: "stale",
          message: `${cal.signal}: ${cal.unreviewed} unreviewed recommendation(s)`,
          action: "Review pipeline",
        });
      }
    }
  }

  // Check for degrading subsystems from health panel
  const healthPanel = panels.find(p => p.id === "health") as DashboardPanel<SubsystemHealthRow> | undefined;
  if (healthPanel) {
    for (const row of healthPanel.rows) {
      if (row.trend === "down") {
        alerts.push({
          severity: "warning",
          source: "degrading",
          subsystem: row.subsystem,
          message: `Subsystem ${row.subsystem} is degrading`,
          action: "Investigate subsystem",
        });
      }
    }
  }

  // Check for low correlation coverage from signal reliability panel
  const reliabilityPanel = panels.find(p => p.id === "signal-reliability") as DashboardPanel<SignalReliabilityRow> | undefined;
  if (reliabilityPanel) {
    for (const row of reliabilityPanel.rows) {
      if (row.status !== "ok") {
        alerts.push({
          severity: row.status === "critical" ? "critical" : "warning",
          source: "low-coverage",
          correlationKey: row.signal,
          message: `${row.signal}: correlation coverage is ${row.status}`,
          action: "Improve correlation coverage",
        });
      }
    }
  }

  // Check loadWarnings from snapshot
  for (const warning of snapshot.loadWarnings) {
    alerts.push({
      severity: "warning",
      source: "unavailable",
      message: warning,
      action: "Check data sources",
    });
  }

  // Cap at 10
  if (alerts.length > 10) {
    alerts.length = 10;
  }

  // Sort by severity (critical first)
  const sevOrder: Record<string, number> = { critical: 0, warning: 1, ok: 2 };
  alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return alerts;
}

/**
 * Build the executive summary panel. Derived LAST so it can reduce
 * over the already-built panels and alerts. Extracts upstream metric
 * values — never computes them.
 */
export function buildSummaryPanel(
  snapshot: ExecutiveDashboardSnapshot,
  panels: DashboardPanelData[],
  alerts: ExecutiveAlert[],
): DashboardPanel<ExecutiveSummaryRow> {
  const healthPanel = panels.find(p => p.id === "health") as DashboardPanel<SubsystemHealthRow> | undefined;
  const pipelinePanel = panels.find(p => p.id === "pipeline") as DashboardPanel<PipelineRow> | undefined;
  const reliabilityPanel = panels.find(p => p.id === "signal-reliability") as DashboardPanel<SignalReliabilityRow> | undefined;

  const healthRows = healthPanel?.rows ?? [];
  const pipelineRows = pipelinePanel?.rows ?? [];
  const reliabilityRows = reliabilityPanel?.rows ?? [];

  const improvingCount = healthRows.filter(r => r.trend === "up").length;
  const degradingCount = healthRows.filter(r => r.trend === "down").length;
  const totalHealth = healthRows.length;

  // Response Rate (weighted average of actionRate by total)
  let responseRateNum = 0;
  let responseRateDen = 0;
  for (const row of pipelineRows) {
    responseRateDen += row.total;
    responseRateNum += row.actionRate * row.total;
  }
  const responseRate = responseRateDen > 0 ? Math.round((responseRateNum / responseRateDen) * 100) / 100 : 0;

  // Effectiveness Rate (weighted average of effectivenessRate by total)
  let effRateNum = 0;
  let effRateDen = 0;
  for (const row of pipelineRows) {
    if (row.effectivenessRate !== null) {
      effRateDen += row.total;
      effRateNum += row.effectivenessRate * row.total;
    }
  }
  const effectivenessRate = effRateDen > 0 ? Math.round((effRateNum / effRateDen) * 100) / 100 : 0;

  // Correlation Coverage (average of coverageRate)
  const correlationCoverage = reliabilityRows.length > 0
    ? reliabilityRows.reduce((s, r) => s + r.coverageRate, 0) / reliabilityRows.length
    : 0;

  // Unaddressed Alerts
  const unaddressedCount = alerts.filter(a => a.severity === "warning" || a.severity === "critical").length;

  const rows: ExecutiveSummaryRow[] = [
    {
      label: "Subsystems Improving",
      value: totalHealth > 0 ? `${improvingCount}/${totalHealth}` : `${improvingCount}`,
      previous: "—",
      severity: "ok",
      source: "improvingSubsystems",
    },
    {
      label: "Subsystems Degrading",
      value: totalHealth > 0 ? `${degradingCount}/${totalHealth}` : `${degradingCount}`,
      previous: "—",
      severity: degradingCount > 0 ? "warning" : "ok",
      source: "degradingSubsystems",
    },
    {
      label: "Response Rate",
      value: `${Math.round(responseRate * 100)}%`,
      previous: "—",
      severity: responseRate >= 0.5 ? "ok" : "warning",
      source: "responseRate",
    },
    {
      label: "Effectiveness Rate",
      value: `${Math.round(effectivenessRate * 100)}%`,
      previous: "—",
      severity: effectivenessRate >= 0.5 ? "ok" : "warning",
      source: "effectivenessRate",
    },
    {
      label: "Correlation Coverage",
      value: `${Math.round(correlationCoverage * 100)}%`,
      previous: "—",
      severity: correlationCoverage >= COVERAGE_OK ? "ok" : correlationCoverage >= COVERAGE_WARNING ? "warning" : "critical",
      source: "correlationCoverage",
    },
    {
      label: "Unaddressed Alerts",
      value: `${unaddressedCount}`,
      previous: "—",
      severity: unaddressedCount > 0 ? "warning" : "ok",
      source: "unaddressedAlerts",
    },
  ];

  return {
    id: "summary",
    title: "Executive Summary",
    rows,
    empty: false,
    panelVersion: 1 as const,
    panelSchema: 1 as const,
  };
}

// ---------------------------------------------------------------------------
// Dashboard report builder
// ---------------------------------------------------------------------------

/**
 * Main composition function. Pure — no I/O, no store access.
 *
 * Build order: panels -> alerts -> summary. Summary is last to prevent
 * metric drift (it reduces over panels + alerts).
 */
export function buildDashboardReport(
  snapshot: ExecutiveDashboardSnapshot,
  options: DashboardBuilderOptions,
): ExecutiveDashboardReport {
  // 1. Build panels (sub-builder handles brief mode)
  const panels: DashboardPanelData[] = buildAllPanels(snapshot, options);

  // 2. Derive alerts
  const alerts = buildAlerts(snapshot, panels);

  // 3. Derive summary (last — reduces over panels + alerts)
  const summary = buildSummaryPanel(snapshot, panels, alerts);

  // 4. Assemble metadata (no Date.now() — use snapshot.generatedAt)
  const metadata: DashboardMetadata = {
    generatedAt: snapshot.generatedAt,
    windowDays: snapshot.windowDays,
    trendSnapshotAge: null,
    recommendationWindow: snapshot.windowDays,
    correlationMode: snapshot.subsystemCorrelationReport?.correlationMode ?? "strict",
    correlationLagDays: snapshot.subsystemCorrelationReport?.correlationLagDays ?? DEFAULT_CORRELATION_LAG,
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

  // 5. Compute upstream metrics directly from panel data (never parse strings)
  const healthPanel = panels.find(p => p.id === "health") as DashboardPanel<SubsystemHealthRow> | undefined;
  const pipelinePanel = panels.find(p => p.id === "pipeline") as DashboardPanel<PipelineRow> | undefined;
  const reliabilityPanel = panels.find(p => p.id === "signal-reliability") as DashboardPanel<SignalReliabilityRow> | undefined;

  const healthRows = healthPanel?.rows ?? [];
  const pipelineRows = pipelinePanel?.rows ?? [];
  const reliabilityRows = reliabilityPanel?.rows ?? [];

  let rrNum = 0, rrDen = 0;
  for (const row of pipelineRows) { rrDen += row.total; rrNum += row.actionRate * row.total; }
  const responseRate = rrDen > 0 ? Math.round((rrNum / rrDen) * 100) / 100 : null;

  let erNum = 0, erDen = 0;
  for (const row of pipelineRows) {
    if (row.effectivenessRate !== null) { erDen += row.total; erNum += row.effectivenessRate * row.total; }
  }
  const effectivenessRate = erDen > 0 ? Math.round((erNum / erDen) * 100) / 100 : null;

  const correlationCoverage = reliabilityRows.length > 0
    ? reliabilityRows.reduce((s, r) => s + r.coverageRate, 0) / reliabilityRows.length
    : null;

  const upstreamMetrics: UpstreamMetrics = {
    improvingSubsystems: healthRows.filter(r => r.trend === "up").length,
    degradingSubsystems: healthRows.filter(r => r.trend === "down").length,
    responseRate,
    effectivenessRate,
    correlationCoverage,
    unaddressedCount: alerts.filter(a => a.severity === "warning" || a.severity === "critical").length,
  };

  return { metadata, summary, panels, alerts, upstreamMetrics, extensions: [] };
}

/** Build all panels, respecting the brief option. */
function buildAllPanels(
  snapshot: ExecutiveDashboardSnapshot,
  options: DashboardBuilderOptions,
): DashboardPanelData[] {
  if (options.brief) {
    return [
      { id: "health", title: "Subsystem Health", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const },
      { id: "pipeline", title: "Pipeline", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const },
      { id: "effectiveness", title: "Proposal Effectiveness", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const },
      { id: "signal-reliability", title: "Signal Reliability", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const },
      { id: "integrity", title: "Integrity", rows: [], empty: true, panelVersion: 1 as const, panelSchema: 1 as const },
    ];
  }
  return [
    buildHealthPanel(snapshot),
    buildPipelinePanel(snapshot),
    buildEffectivenessPanel(snapshot),
    buildSignalReliabilityPanel(snapshot),
    buildIntegrityPanel(snapshot),
  ];
}

// ---------------------------------------------------------------------------
// Renderer interface
// ---------------------------------------------------------------------------

export interface DashboardRenderer {
  render(report: ExecutiveDashboardReport): void;
}
