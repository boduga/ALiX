/**
 * P8.5b.2 — Learning Dashboard terminal renderer.
 *
 * Pure renderer: reads a DashboardReport, emits ANSI-colored text via console.log.
 * No business logic, no aggregation, no store access.
 */

import type { DashboardReport, CoverageThresholds } from "../../learning/learning-dashboard.js";

const DEFAULT_THRESHOLDS: CoverageThresholds = { healthy: 90, degraded: 75, critical: 75 };

function colorize(score: number, thresholds: CoverageThresholds): string {
  if (score >= thresholds.healthy) return "\x1b[32m"; // green
  if (score >= thresholds.degraded) return "\x1b[33m"; // yellow
  return "\x1b[31m"; // red
}

function reset(): string {
  return "\x1b[0m";
}

function bar(value: number, width = 20): string {
  const filled = Math.round((value / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Panel 1: Header
// ---------------------------------------------------------------------------

function renderHeader(report: DashboardReport): void {
  const c = colorize(report.dashboardIntegrityScore, DEFAULT_THRESHOLDS);
  console.log(`${c}╔══════════════════════════════════════════════════╗${reset()}`);
  console.log(`${c}║  LEARNING DASHBOARD          v${report.schemaVersion}          ║${reset()}`);
  console.log(`${c}║  Generated: ${report.generatedAt}                      ║${reset()}`);
  console.log(`${c}║  Window: ${report.windowDays} days  |  Scanned: ${String(report.proposalsScanned).padStart(3)} proposals  ║${reset()}`);
  console.log(`${c}║                                                ║${reset()}`);
  console.log(`${c}║  Dashboard Integrity Score: ${String(report.dashboardIntegrityScore).padStart(6)}             ║${reset()}`);
  console.log(`${c}╚══════════════════════════════════════════════════╝${reset()}`);
}

// ---------------------------------------------------------------------------
// Panel 2: Explanation Integrity
// ---------------------------------------------------------------------------

function renderIntegrityPanel(report: DashboardReport): void {
  const ei = report.explanationIntegrity;
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  EXPLANATION INTEGRITY                           ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Proposals scanned:  ${String(ei.totalExplanations).padStart(4)}                         ║`);
  console.log(`║  Avg completeness:   ${String(ei.averageCompleteness.toFixed(1)).padStart(6)}%                        ║`);
  console.log(`║  Evidence chain use: ${String(ei.evidenceChainUsage.toFixed(1)).padStart(6)}%                        ║`);
  console.log(`║  Fallback join rate: ${String(ei.fallbackJoinRate.toFixed(1)).padStart(6)}%                        ║`);
  console.log(`║  Incomplete layers:  ${String(ei.incompleteChainCount).padStart(4)}                          ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Best layer:  ${ei.bestLayer.padEnd(14)} (${String(ei.layerAvailability[ei.bestLayer]).padStart(5)}%)                    ║`);
  console.log(`║  Worst layer: ${ei.worstLayer.padEnd(14)} (${String(ei.layerAvailability[ei.worstLayer]).padStart(5)}%)                    ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Layer availability:                              ║`);

  // draw per-layer availability bars
  const layerOrder = ["outcome", "recommendation", "risk", "governance", "learning", "calibration"];

  for (const layer of layerOrder) {
    const avail = ei.layerAvailability[layer] ?? 0;
    const counts = ei.layerAvailabilityCounts[layer] ?? { present: 0, missing: 0 };
    console.log(`║    ${layer.padEnd(14)} ${bar(avail)} ${String(avail.toFixed(1)).padStart(6)}%  (${counts.present}/${counts.present + counts.missing})`);
  }

  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Panel 3: Calibration Health
// ---------------------------------------------------------------------------

function renderCalibrationHealth(report: DashboardReport): void {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  CALIBRATION HEALTH                              ║`);
  console.log(`║                                                  ║`);

  for (const a of report.calibrationHealth.adapters) {
    const types = Object.entries(a.signalTypes)
      .map(([t, c]) => `${c} ${t}`)
      .join(", ");
    console.log(`║  ── ${a.name} ──`);
    console.log(`║  Signals:  ${a.signalCount}  (${types || "none"})`);
    console.log(`║  Profiles: ${a.profileCount} active`);
    console.log(`║  Last refresh: ${a.lastRefresh ?? "never"}${a.note ? "  " + "\x1b[33mⓘ\x1b[0m" + " " + a.note : ""}`);
    console.log(`║`);
  }

  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Panel 4: Learning Signal Explorer
// ---------------------------------------------------------------------------

function renderSignalExplorer(report: DashboardReport): void {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  LEARNING SIGNALS                                ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Sig     | Adapter        | Type            | Str  ║`);
  console.log(`║  ${"─".repeat(52)}`);

  for (const sig of report.signals.signals.slice(0, 15)) {
    console.log(
      `║  ${sig.id.slice(0, 7).padEnd(7)} | ${sig.adapter.padEnd(14)} | ${sig.type.padEnd(15)} | ${sig.strength.toFixed(1).padStart(4)}`
    );
  }

  if (report.signals.totalSignals > 15) {
    console.log(`║  ... (${report.signals.totalSignals - 15} more)`);
  }

  console.log(`║                                                  ║`);
  console.log(`║  Total: ${report.signals.totalSignals} signals                                ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Panel 5: Join Path Analysis
// ---------------------------------------------------------------------------

function renderJoinPathAnalysis(report: DashboardReport): void {
  const jp = report.joinPathAnalysis;
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  JOIN PATH ANALYSIS                              ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Global distribution:                            ║`);

  for (const [path, pct] of Object.entries(jp.distribution)) {
    console.log(`║    ${path.padEnd(28)} ${String(pct.toFixed(1)).padStart(6)}%`);
  }

  console.log(`║                                                  ║`);
  console.log(`║  By layer (evidence_chain %):                    ║`);

  const layerOrder = ["outcome", "recommendation", "risk", "governance", "learning", "calibration"];

  for (const layer of layerOrder) {
    const ecRate = jp.joinPathByLayer[layer]?.["evidence_chain"] ?? 0;
    const barFill = bar(ecRate, 16);
    console.log(`║    ${layer.padEnd(14)} ${barFill} ${String(ecRate.toFixed(1)).padStart(6)}%`);
  }

  console.log(`║                                                  ║`);
  console.log(`║  Best layer:  ${jp.bestLayer.name} (${jp.bestLayer.rate.toFixed(1)}%)`);
  console.log(`║  Worst layer: ${jp.worstLayer.name} (${jp.worstLayer.rate.toFixed(1)}%)`);

  if (jp.heuristicLayers.length > 0) {
    console.log(`║                                                  ║`);
    console.log(`║  ${"\x1b[33m"}⚠ Heuristic join paths detected:${reset()}`);
    for (const hl of jp.heuristicLayers) {
      console.log(`║    ${hl.layer}: ${hl.count} string_heuristic joins`);
    }
  }

  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Panel 6: Chain Integrity Alerts
// ---------------------------------------------------------------------------

function renderChainAlerts(report: DashboardReport): void {
  const { chainAlerts } = report;
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  CHAIN INTEGRITY ALERTS                          ║`);
  console.log(`║                                                  ║`);

  if (chainAlerts.totalAlerts === 0) {
    console.log(`║  ${"\x1b[32m"}✓ No alerts${reset()}`);
  } else {
    for (const alert of chainAlerts.critical) {
      console.log(`║  ${"\x1b[31m"}CRITICAL${reset()}`);
      console.log(`║    ${alert.proposalId}: ${alert.message}`);
    }
    for (const alert of chainAlerts.warnings) {
      console.log(`║  ${"\x1b[33m"}WARNING${reset()}`);
      console.log(`║    ${alert.proposalId}: ${alert.message}`);
    }
    for (const alert of chainAlerts.infos) {
      console.log(`║  ${"\x1b[34m"}INFO${reset()}`);
      console.log(`║    ${alert.proposalId}: ${alert.message}`);
    }
  }

  console.log(`║                                                  ║`);
  console.log(`║  ${chainAlerts.totalAlerts} alert(s) found                                ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

export function renderDashboard(report: DashboardReport): void {
  renderHeader(report);
  renderIntegrityPanel(report);
  renderCalibrationHealth(report);
  renderSignalExplorer(report);
  renderJoinPathAnalysis(report);
  renderChainAlerts(report);
}
