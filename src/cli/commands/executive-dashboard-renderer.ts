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

export function renderTerminalDashboard(report: ExecutiveDashboardReport, brief = false): void {
  const { summary, panels, alerts, metadata } = report;

  console.log("");
  const title = brief ? "Executive Dashboard (brief)" : "Executive Dashboard";
  console.log(`╔════════════════════════════════════════════════════════════════╗`);
  const titleLine = `║ ${title.padEnd(36)} schema: 1  p10.9.0        ║`;
  console.log(titleLine);
  console.log(`╚════════════════════════════════════════════════════════════════╝`);
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
  if (brief) {
    // In brief mode, skip all panel sections
  } else {
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
        const trendChar = trendArrow(row.trend);
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
