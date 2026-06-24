/**
 * P10.0 — Executive Dashboard renderer.
 *
 * Pure formatter. Consumes ExecutiveHealthReport. No data access.
 * Mirrors P9.5's renderGovernanceDashboard pattern with 2 panels.
 *
 * @module
 */

import type {
  ExecutiveHealthReport,
  ExecutiveSubsystemHealth,
  ExecutiveStatus,
} from "../../executive/executive-health.js";
import type { ExecutivePriorityReport } from "../../executive/priority-engine.js";

export interface RenderOptions {
  jsonMode?: boolean;
}

const STATUS_EMOJI: Record<ExecutiveStatus, string> = {
  healthy: "🟢",
  warning: "🟡",
  critical: "🔴",
};

const STATUS_LABEL: Record<ExecutiveStatus, string> = {
  healthy: "healthy",
  warning: "warning",
  critical: "critical",
};

export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify({ health: report, priority: priorityReport }, null, 2));
    return;
  }

  console.log("=".repeat(78));
  console.log("EXECUTIVE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(78));

  renderHealthSummary(report, priorityReport);
  console.log("");
  renderPriorities(priorityReport);
  console.log("=".repeat(78));
}

function renderHealthSummary(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
): void {
  console.log("\n[0] EXECUTIVE HEALTH SUMMARY");
  console.log(`Overall Score: ${healthReport.overallScore}\n`);
  console.log("  Subsystem      Score   Trend   Blast   Pri      Status");
  console.log("  -------------  -----   -----   -----   ------   --------------");
  for (const entry of priorityReport.priorities) {
    const status = healthReport.rankedSubsystems.find(
      (s) => s.subsystem === entry.subsystem,
    )?.status ?? "unknown";
    const emoji = STATUS_EMOJI[status as ExecutiveStatus] ?? "-";
    console.log(
      `  ${pad(entry.subsystem, 13)}  ${pad(String(entry.healthScore), 5)}  ${pad(String(entry.trendScore), 5)}  ${pad(String(entry.blastRadius), 5)}  ${pad(entry.priorityScore.toFixed(1), 6)}   ${emoji} ${status}`,
    );
  }
}

function renderPriorities(priorityReport: ExecutivePriorityReport): void {
  const top3 = priorityReport.priorities.slice(0, 3);
  console.log(`\n[1] EXECUTIVE PRIORITIES (top ${top3.length})`);
  if (top3.length === 0) {
    console.log("  (none)");
    return;
  }
  top3.forEach((entry, i) => {
    console.log(`\n  ${i + 1}. ${capitalize(entry.subsystem)}`);
    console.log(`     Score: ${entry.healthScore} | Trend: ${entry.trendScore} | Blast: ${entry.blastRadius} | Pri: ${entry.priorityScore.toFixed(1)}`);
  });
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
