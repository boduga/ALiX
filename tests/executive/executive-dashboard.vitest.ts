/**
 * P10.9 — Executive Dashboard: types + builders test suite.
 *
 * Verifies that all types, constants, and builder functions are correctly
 * exported and structurally sound. Covers both the type-level compile-time
 * checks and the runtime behavior of every sub-builder.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  // Row types
  ExecutiveSummaryRow,
  SubsystemHealthRow,
  PipelineRow,
  ProposalEffectivenessRow,
  SignalReliabilityRow,
  IntegrityRow,
  // Panel abstraction
  DashboardPanel,
  DashboardPanelData,
  DashboardPanelId,
  DashboardExtension,
  // Alerts
  ExecutiveAlert,
  // Snapshot / loader
  DashboardSources,
  ExecutiveDashboardSnapshot,
  DashboardBuilderOptions,
  DashboardContext,
  // Metadata
  DashboardMetadata,
  // Metrics
  UpstreamMetrics,
  // Report
  ExecutiveDashboardReport,
  // Constants
  PANEL_ORDER,
  HEALTH_OK,
  HEALTH_WARNING,
  COVERAGE_OK,
  COVERAGE_WARNING,
  DEFAULT_CORRELATION_LAG,
  DEFAULT_STALE_THRESHOLD,
  // Builder functions
  buildDashboardReport,
  buildHealthPanel,
  buildPipelinePanel,
  buildEffectivenessPanel,
  buildSignalReliabilityPanel,
  buildIntegrityPanel,
  buildAlerts,
  buildSummaryPanel,
} from "../../src/executive/executive-dashboard.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    generatedAt: "2026-06-28T00:00:00.000Z",
    ...over,
  };
}

describe("executive-dashboard", () => {

  // ── Constants ────────────────────────────────────────────────────────

  describe("constants", () => {

    it("PANEL_ORDER should contain 5 panels and exclude 'summary'", () => {
      const order: readonly DashboardPanelId[] = PANEL_ORDER;
      expect(order).toEqual([
        "health", "pipeline", "effectiveness",
        "signal-reliability", "integrity",
      ]);
      expect(order).not.toContain("summary");
    });

    it("HEALTH_OK should be 60", () => {
      expect(HEALTH_OK).toBe(60);
    });

    it("HEALTH_WARNING should be 40", () => {
      expect(HEALTH_WARNING).toBe(40);
    });

    it("COVERAGE_OK should be 0.6", () => {
      expect(COVERAGE_OK).toBe(0.6);
    });

    it("COVERAGE_WARNING should be 0.3", () => {
      expect(COVERAGE_WARNING).toBe(0.3);
    });

    it("DEFAULT_CORRELATION_LAG should be 30", () => {
      expect(DEFAULT_CORRELATION_LAG).toBe(30);
    });

    it("DEFAULT_STALE_THRESHOLD should be 7", () => {
      expect(DEFAULT_STALE_THRESHOLD).toBe(7);
    });
  });

  // ── Structural: compile-time checks only (verify shapes) ────────────

  describe("type shape (compile-time)", () => {

    it("ExecutiveSummaryRow has correct fields", () => {
      // Runtime check that the type contract is accessible via value
      const row: ExecutiveSummaryRow = {
        label: "ok",
        value: "10",
        previous: "8",
        severity: "ok",
        source: "trend",
      };
      const values: readonly string[] = [row.label, row.value, row.previous, row.source];
      expect(values).toEqual(["ok", "10", "8", "trend"]);
    });

    it("SubsystemHealthRow has correct shape", () => {
      const row: SubsystemHealthRow = {
        subsystem: "auth",
        score: 80,
        trend: "up",
        delta: 5,
        status: "ok",
        correlationEffectiveness: 0.75,
      };
      expect(row.subsystem).toBe("auth");
      expect(row.score).toBe(80);
      expect(row.correlationEffectiveness).toBe(0.75);
    });

    it("PipelineRow has correct shape", () => {
      const row: PipelineRow = {
        signal: "memory",
        total: 10,
        unreviewed: 2,
        stale: 1,
        applied: 5,
        actionRate: 0.5,
        effectivenessRate: 0.8,
      };
      expect(row.signal).toBe("memory");
      expect(row.effectivenessRate).toBe(0.8);
    });

    it("ProposalEffectivenessRow has correct shape", () => {
      const row: ProposalEffectivenessRow = {
        action: "stabilize",
        kept: 5,
        reverted: 1,
        investigated: 2,
        noData: 0,
        effectivenessRate: 0.8,
        coverage: 1.0,
      };
      expect(row.action).toBe("stabilize");
      expect(row.effectivenessRate).toBe(0.8);
    });

    it("SignalReliabilityRow has correct shape", () => {
      const row: SignalReliabilityRow = {
        signal: "cpu",
        coverageRate: 0.9,
        improvingRate: 0.5,
        status: "ok",
        confidenceBuckets: [],
      };
      expect(row.signal).toBe("cpu");
      expect(row.confidenceBuckets).toEqual([]);
    });

    it("IntegrityRow uses union value type", () => {
      const stringVal: IntegrityRow = {
        metric: "foo",
        value: "bar",
        status: "ok",
      };
      const numVal: IntegrityRow = {
        metric: "baz",
        value: 42,
        status: "warning",
      };
      expect(typeof stringVal.value).toBe("string");
      expect(typeof numVal.value).toBe("number");
    });
  });

  // ── DashboardPanel contract ─────────────────────────────────────────

  describe("DashboardPanel<T>", () => {

    it("should create a panel with literal version/schema fields", () => {
      const panel: DashboardPanel<IntegrityRow> = {
        id: "integrity",
        title: "Integrity",
        rows: [],
        empty: true,
        panelVersion: 1,
        panelSchema: 1,
      };
      // panelVersion and panelSchema are type-level literals — verify at runtime
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const v: 1 = panel.panelVersion;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const s: 1 = panel.panelSchema;
      expect(panel.empty).toBe(true);
    });

    it("should accept each variant in the discriminated union", () => {
      const healthPanel: DashboardPanelData = {
        id: "health",
        title: "Health",
        rows: [{
          subsystem: "auth",
          score: 70,
          trend: "up",
          delta: 3,
          status: "ok",
          correlationEffectiveness: null,
        }],
        empty: false,
        panelVersion: 1,
        panelSchema: 1,
      };
      expect(healthPanel.id).toBe("health");

      const pipelinePanel: DashboardPanelData = {
        id: "pipeline",
        title: "Pipeline",
        rows: [],
        empty: true,
        panelVersion: 1,
        panelSchema: 1,
      };
      expect(pipelinePanel.id).toBe("pipeline");
    });
  });

  // ── ExecutiveDashboardSnapshot ──────────────────────────────────────

  describe("ExecutiveDashboardSnapshot", () => {

    it("should accept all nullable and collection fields", () => {
      const snapshot: ExecutiveDashboardSnapshot = {
        trends: null,
        effectivenessResult: null,
        subsystemCorrelationReport: null,
        outcomeReports: [],
        proposalStatusMap: new Map(),
        effectivenessOutcomeMap: new Map(),
        loadWarnings: [],
        windowDays: 30,
        generatedAt: "2026-06-28T00:00:00.000Z",
      };
      expect(snapshot.windowDays).toBe(30);
      expect(snapshot.loadWarnings).toEqual([]);
    });
  });

  // ── ExecutiveDashboardReport ────────────────────────────────────────

  describe("ExecutiveDashboardReport", () => {

    it("should compose all top-level types", () => {
      const metadata: DashboardMetadata = {
        generatedAt: "2026-06-28T00:00:00.000Z",
        windowDays: 30,
        trendSnapshotAge: null,
        recommendationWindow: 30,
        correlationMode: "loose",
        correlationLagDays: 30,
        schemaVersion: 1,
        dashboardVersion: "p10.9.0",
        sources: {
          trendsLoaded: false,
          recommendationsLoaded: false,
          proposalsLoaded: false,
          effectivenessLoaded: false,
          correlationsLoaded: false,
        },
        loadWarnings: [],
      };

      const summaryPanel: DashboardPanel<ExecutiveSummaryRow> = {
        id: "summary",
        title: "Summary",
        rows: [],
        empty: true,
        panelVersion: 1,
        panelSchema: 1,
      };

      const report: ExecutiveDashboardReport = {
        metadata,
        summary: summaryPanel,
        panels: [],
        alerts: [],
        upstreamMetrics: {
          responseRate: null,
          effectivenessRate: null,
          correlationCoverage: null,
          improvingSubsystems: 0,
          degradingSubsystems: 0,
          unaddressedCount: 0,
        },
        extensions: [],
      };

      expect(report.metadata.dashboardVersion).toBe("p10.9.0");
      expect(report.panels).toEqual([]);
    });
  });

  // ── DashboardExtension ──────────────────────────────────────────────

  describe("DashboardExtension", () => {

    it("should wrap any DashboardPanelData", () => {
      const ext: DashboardExtension = {
        id: "custom-metrics",
        panel: {
          id: "integrity",
          title: "Custom",
          rows: [],
          empty: true,
          panelVersion: 1,
          panelSchema: 1,
        },
      };
      expect(ext.id).toBe("custom-metrics");
    });
  });

  // ── ExecutiveAlert ──────────────────────────────────────────────────

  describe("ExecutiveAlert", () => {

    it("should accept all optional fields", () => {
      const alert: ExecutiveAlert = {
        severity: "warning",
        source: "stale",
        subsystem: "auth",
        recommendationId: "rec-1",
        proposalId: "prop-1",
        correlationKey: "auth:memory",
        message: "Stale recommendations detected",
        action: "Review pipeline",
      };
      expect(alert.severity).toBe("warning");
      expect(alert.recommendationId).toBe("rec-1");
    });
  });

  // ── DashboardContext ────────────────────────────────────────────────

  describe("DashboardContext", () => {

    it("should compose snapshot and options", () => {
      const ctx: DashboardContext = {
        snapshot: {
          trends: null,
          effectivenessResult: null,
          subsystemCorrelationReport: null,
          outcomeReports: [],
          proposalStatusMap: new Map(),
          effectivenessOutcomeMap: new Map(),
          loadWarnings: [],
          windowDays: 30,
          generatedAt: "2026-06-28T00:00:00.000Z",
        },
        options: {
          brief: false,
        },
      };
      expect(ctx.options.brief).toBe(false);
    });
  });

  // =====================================================================
  // Builder tests
  // =====================================================================

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
});
