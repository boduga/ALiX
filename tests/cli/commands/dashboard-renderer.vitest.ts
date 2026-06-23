/**
 * P8.5b.2 — Terminal dashboard renderer tests.
 */

import { describe, it, expect, vi } from "vitest";
import { renderDashboard } from "../../../src/cli/commands/dashboard-renderer.js";
import type { DashboardReport } from "../../../src/learning/learning-dashboard.js";

function healthyReport(): DashboardReport {
  return {
    schemaVersion: "p8.5b.0",
    generatedAt: "2026-06-23T00:00:00.000Z",
    windowDays: 90,
    proposalsScanned: 20,
    dashboardIntegrityScore: 95,
    explanationIntegrity: {
      totalExplanations: 20,
      averageCompleteness: 92,
      bestLayer: "outcome",
      worstLayer: "governance",
      layerAvailability: {
        outcome: 100,
        recommendation: 95,
        risk: 90,
        governance: 80,
        learning: 85,
        calibration: 82,
      },
      layerAvailabilityCounts: {
        outcome: { present: 20, missing: 0 },
        recommendation: { present: 19, missing: 1 },
        risk: { present: 18, missing: 2 },
        governance: { present: 16, missing: 4 },
        learning: { present: 17, missing: 3 },
        calibration: { present: 16, missing: 4 },
      },
      evidenceChainUsage: 85,
      fallbackJoinRate: 15,
      incompleteChainCount: 3,
    },
    calibrationHealth: {
      adapters: [
        {
          name: "recommendation",
          signalCount: 12,
          signalTypes: { overconfidence: 7, underconfidence: 5 },
          profileCount: 3,
          lastRefresh: "2026-06-22T12:00:00.000Z",
        },
        {
          name: "risk",
          signalCount: 8,
          signalTypes: { delta_spike: 6, calibration_drift: 2 },
          profileCount: 2,
          lastRefresh: "2026-06-22T10:00:00.000Z",
        },
        {
          name: "governance",
          signalCount: 5,
          signalTypes: { concerns_raised: 5 },
          profileCount: 1,
          lastRefresh: "2026-06-21T08:00:00.000Z",
          note: "Low fidelity (concernsRaised inferred)",
        },
      ],
    },
    signals: {
      totalSignals: 25,
      signals: [
        { id: "sig-1", adapter: "recommendation", type: "overconfidence", strength: 0.8 },
        { id: "sig-2", adapter: "risk", type: "delta_spike", strength: 0.6 },
        { id: "sig-3", adapter: "governance", type: "concerns_raised", strength: 0.4 },
      ],
    },
    joinPathAnalysis: {
      distribution: {
        evidence_chain: 70,
        direct_id: 20,
        proposal_fallback: 10,
      },
      joinPathByLayer: {
        outcome: { evidence_chain: 80, direct_id: 20 },
        recommendation: { evidence_chain: 94, direct_id: 6 },
        risk: { evidence_chain: 65, string_heuristic: 20, direct_id: 15 },
        governance: { evidence_chain: 22, proposal_fallback: 78 },
        learning: { evidence_chain: 50, string_heuristic: 50 },
        calibration: { evidence_chain: 40, string_heuristic: 60 },
      },
      bestLayer: { name: "recommendation", rate: 94 },
      worstLayer: { name: "governance", rate: 22 },
      heuristicLayers: [{ layer: "learning", count: 1 }],
    },
    chainAlerts: {
      critical: [
        {
          proposalId: "prop-42",
          severity: "critical",
          message: "Outcome exists, Recommendation MISSING",
        },
      ],
      warnings: [
        {
          proposalId: "prop-18",
          severity: "warning",
          message: "Risk missing while Governance present",
        },
      ],
      infos: [],
      totalAlerts: 2,
    },
  };
}

function degradedReport(): DashboardReport {
  const r = healthyReport();
  r.dashboardIntegrityScore = 70;
  r.explanationIntegrity.averageCompleteness = 72;
  r.explanationIntegrity.evidenceChainUsage = 50;
  r.explanationIntegrity.layerAvailability.governance = 40;
  r.joinPathAnalysis.worstLayer = { name: "governance", rate: 5 };
  return r;
}

describe("renderDashboard", () => {
  it("renders healthy score with green ANSI color", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("\x1b[32m"); // green ANSI for score >= 90
    expect(output).toContain("95");
    expect(output).toContain("\x1b[0m"); // reset
    log.mockRestore();
  });

  it("renders alerts section with CRITICAL and WARNING messages", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("CRITICAL");
    expect(output).toContain("Recommendation MISSING");
    expect(output).toContain("WARNING");
    expect(output).toContain("Risk missing while Governance present");
    log.mockRestore();
  });

  it("renders join path analysis with by-layer breakdown and heuristic warnings", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    // Global distribution
    expect(output).toContain("evidence_chain");
    expect(output).toContain("70");
    // By-layer breakdown
    expect(output).toContain("outcome");
    expect(output).toContain("recommendation");
    expect(output).toContain("Best layer");
    expect(output).toContain("Worst layer");
    // Heuristic warning
    expect(output).toContain("Heuristic join paths detected");
    expect(output).toContain("learning");
    log.mockRestore();
  });

  it("color-codes based on score thresholds: healthy => green, degraded => yellow", () => {
    const log = vi.spyOn(console, "log");

    // Healthy (score >= 90) => green
    log.mockImplementation(() => {});
    renderDashboard(healthyReport());
    let output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("\x1b[32m"); // green

    log.mockClear();

    // Degraded (score 70, >= 75) => yellow
    const degraded = degradedReport();
    degraded.dashboardIntegrityScore = 76;
    renderDashboard(degraded);
    output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("\x1b[33m"); // yellow

    log.mockClear();

    // Critical (score < 75) => red
    degraded.dashboardIntegrityScore = 60;
    renderDashboard(degraded);
    output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("\x1b[31m"); // red

    log.mockRestore();
  });
});
