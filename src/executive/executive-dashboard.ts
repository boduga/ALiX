/**
 * P10.9 — Executive Dashboard: pure types, constants, panel abstraction.
 *
 * Readonly interfaces and discriminated-union panel types for the executive
 * dashboard pipeline. No builders, no renderers — purely the data contract.
 *
 * @module
 */

import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import type { EffectivenessResult, EffectivenessOutcome, ProposalStatus } from "./recommendation-effectiveness.js";
import type { SubsystemCorrelationReport, ConfidenceBucket } from "./subsystem-correlation.js";
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
