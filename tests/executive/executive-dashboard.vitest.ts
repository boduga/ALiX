/**
 * P10.9 — Executive Dashboard: compile-check test.
 *
 * Verifies that all types and constants are correctly exported and
 * structurally sound. No runtime logic — purely a type-check gate.
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
} from "../../src/executive/executive-dashboard.js";

// ---------------------------------------------------------------------------
// Type-level assertions: these verify the imported values exist at runtime
// and have the correct types.  The type annotations are unused but force a
// tsc error if the export structure changes.
// ---------------------------------------------------------------------------

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
        generatedAt: "2026-06-27T00:00:00.000Z",
      };
      expect(snapshot.windowDays).toBe(30);
      expect(snapshot.loadWarnings).toEqual([]);
    });
  });

  // ── ExecutiveDashboardReport ────────────────────────────────────────

  describe("ExecutiveDashboardReport", () => {

    it("should compose all top-level types", () => {
      const metadata: DashboardMetadata = {
        generatedAt: "2026-06-27T00:00:00.000Z",
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
          generatedAt: "2026-06-27T00:00:00.000Z",
        },
        options: {
          brief: false,
        },
      };
      expect(ctx.options.brief).toBe(false);
    });
  });
});
