/**
 * P10.6 — Executive learn CLI handler.
 *
 * Loads outcome reports from OutcomeReportStore and renders trend analytics.
 *
 * @module
 */

import { join } from "node:path";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { computeLearningTrends } from "../../executive/learning-engine.js";
import type { TrendResult, SubsystemTrend, ObjectiveTrend } from "../../executive/learning-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW = 10;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleLearnCommand(args: string[]): Promise<void> {
  const windowIndex = args.indexOf("--window");
  const windowN = windowIndex !== -1 && windowIndex + 1 < args.length
    ? Math.max(1, parseInt(args[windowIndex + 1], 10) || DEFAULT_WINDOW)
    : DEFAULT_WINDOW;
  const useJson = args.includes("--json");

  const execDir = join(process.cwd(), ".alix", "executive");
  const store = new OutcomeReportStore(join(execDir, "outcomes"));

  const warnings: string[] = [];
  const metas = store.list();
  const windowed = metas.slice(0, windowN);
  const reports: ExecutiveOutcomeEvaluationReport[] = [];
  let skippedCount = 0;

  for (const meta of windowed) {
    try {
      const report = store.load(meta.reportId);
      if (report) reports.push(report);
    } catch (e: any) {
      skippedCount++;
      warnings.push(`Skipping report ${meta.reportId}: ${e.message}`);
    }
  }

  const result = computeLearningTrends(reports, windowN);
  // Add load-level warnings (separate from analytical warnings)
  result.loadWarnings = warnings;

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: TrendResult): void {
  if (result.trendStatus === "insufficient_data") {
    console.log(`No trend data available. Analyzed: ${result.analyzedReportCount}, Skipped: ${result.skippedReportCount}`);
    return;
  }

  console.log(`\nExecutive Learning Trends (last ${result.requestedWindow} plans)`);
  console.log(`Generated: ${result.generatedAt}\n`);

  renderSubsystemTable(result.subsystemTrends);
  renderObjectiveTable(result.objectiveTrends);

  console.log(
    `\nInput: ${result.inputReportCount} reports | Skipped: ${result.skippedReportCount} (evaluationStatus ≠ completed)`,
  );
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.error(`Analytical warning: ${w}`);
    }
  }
  if (result.loadWarnings.length > 0) {
    for (const w of result.loadWarnings) {
      console.error(`Load warning: ${w}`);
    }
  }
}

function renderSubsystemTable(trends: SubsystemTrend[]): void {
  if (trends.length === 0) return;
  console.log(`${"Subsystem".padEnd(16)} ${"Occurrences".padEnd(12)} ${"Success".padEnd(9)} ${"Mixed".padEnd(8)} ${"Degraded".padEnd(10)} ${"Avg Δ"}`);
  console.log("-".repeat(65));
  for (const t of trends) {
    console.log(
      `${t.subsystem.padEnd(16)} ${String(t.occurrenceCount).padEnd(12)} ${fmtPct(t.successRate).padEnd(9)} ${fmtPct(t.mixedRate).padEnd(8)} ${fmtPct(t.degradationRate).padEnd(10)} ${fmtDelta(t.averageDelta)}`,
    );
  }
}

function renderObjectiveTable(trends: ObjectiveTrend[]): void {
  if (trends.length === 0) return;
  console.log(`${"Objective Type".padEnd(16)} ${"Occurrences".padEnd(12)} ${"Success".padEnd(9)} ${"Mixed".padEnd(8)} ${"Degraded".padEnd(10)} ${"Avg Δ"}`);
  console.log("-".repeat(65));
  for (const t of trends) {
    console.log(
      `${t.objectiveType.padEnd(16)} ${String(t.occurrenceCount).padEnd(12)} ${fmtPct(t.successRate).padEnd(9)} ${fmtPct(t.mixedRate).padEnd(8)} ${fmtPct(t.degradationRate).padEnd(10)} ${fmtDelta(t.averageDelta)}`,
    );
  }
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}
