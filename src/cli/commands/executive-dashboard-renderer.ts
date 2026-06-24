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
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=".repeat(72));
  console.log("EXECUTIVE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(72));

  renderHealthSummary(report);
  console.log("");
  renderPriorities(report);
  console.log("=".repeat(72));
}

function renderHealthSummary(report: ExecutiveHealthReport): void {
  console.log("\n[0] EXECUTIVE HEALTH SUMMARY");
  console.log(`Overall Score: ${report.overallScore}\n`);
  console.log("  Subsystem      Score   Status");
  console.log("  -------------  -----   --------------");
  for (const s of report.rankedSubsystems) {
    const emoji = STATUS_EMOJI[s.status];
    const label = STATUS_LABEL[s.status];
    const line = `  ${pad(s.subsystem, 13)}  ${pad(String(s.score), 5)}   ${emoji} ${label}`;
    console.log(line);
  }
}

function renderPriorities(report: ExecutiveHealthReport): void {
  const top3 = report.rankedSubsystems.slice(0, 3);
  console.log(`\n[1] EXECUTIVE PRIORITIES (top ${top3.length})`);
  if (top3.length === 0) {
    console.log("  (none)");
    return;
  }
  top3.forEach((s, i) => {
    console.log(`\n  ${i + 1}. ${capitalize(s.subsystem)}`);
    console.log(`     ${s.summary}.`);
  });
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
