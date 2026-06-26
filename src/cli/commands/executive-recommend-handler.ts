/**
 * P10.7a — Executive recommend CLI handler.
 * P10.7b — Adds --save (persists RecommendationReport via RecommendationReportStore).
 *
 * Composes the P10.6 learning pipeline (OutcomeReportStore →
 * computeLearningTrends) with the P10.7a recommendation engine
 * (computeRecommendations) and renders a terminal table or JSON.
 *
 * Read-only unless --save is passed: --save is the only path that writes.
 * The store writes; the handler owns no filesystem operations itself.
 *
 * @module
 */

import { join } from "node:path";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { computeLearningTrends } from "../../executive/learning-engine.js";
import { computeRecommendations } from "../../executive/recommendation-engine.js";
import type { RecommendationResult } from "../../executive/recommendation-engine.js";
import {
  RecommendationReportStore,
} from "../../executive/recommendation-report-store.js";
import type { NewRecommendationReport } from "../../executive/recommendation-report-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW = 10;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleRecommendCommand(args: string[]): Promise<void> {
  const windowIndex = args.indexOf("--window");
  const windowN = windowIndex !== -1 && windowIndex + 1 < args.length
    ? Math.max(1, parseInt(args[windowIndex + 1], 10) || DEFAULT_WINDOW)
    : DEFAULT_WINDOW;
  const useJson = args.includes("--json");
  const saveMode = args.includes("--save");

  const execDir = join(process.cwd(), ".alix", "executive");
  const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));

  const metas = outcomeStore.list();
  const windowed = metas.slice(0, windowN);
  const reports: ExecutiveOutcomeEvaluationReport[] = [];
  const evidenceReportIds: string[] = [];

  for (const meta of windowed) {
    try {
      const report = outcomeStore.load(meta.reportId);
      if (report) {
        reports.push(report);
        evidenceReportIds.push(meta.reportId);
      }
    } catch (e: any) {
      console.warn(`Skipping report ${meta.reportId}: ${e.message}`);
    }
  }

  const trends = computeLearningTrends(reports, windowN);
  const result = computeRecommendations(trends);

  let persistedReportId: string | null = null;

  if (saveMode) {
    const recStore = new RecommendationReportStore(
      join(execDir, "recommendations"),
    );
    const payload: NewRecommendationReport = {
      generatedAt: result.generatedAt,
      requestedWindow: result.requestedWindow,
      recommendationStatus: result.recommendationStatus,
      inputReportCount: result.inputReportCount,
      analyzedReportCount: result.analyzedReportCount,
      skippedReportCount: result.skippedReportCount,
      evidenceReportIds,
      recommendations: result.subsystemRecommendations,
      warnings: result.warnings,
      loadWarnings: result.loadWarnings,
    };
    persistedReportId = recStore.save(payload);
    // stderr keeps the id line out of any --json stdout stream.
    console.warn(`Recommendation report saved: ${persistedReportId}`);
  }

  if (useJson) {
    if (persistedReportId !== null) {
      // Re-load the persisted wrapper to emit id + contentHash with the JSON.
      const recStore = new RecommendationReportStore(
        join(execDir, "recommendations"),
      );
      const persisted = recStore.load(persistedReportId);
      console.log(JSON.stringify(persisted, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: RecommendationResult): void {
  if (result.subsystemRecommendations.length === 0) {
    console.log("No recommendations generated.");
    console.log(`Recommendation status: ${result.recommendationStatus}`);
    console.log(`Analyzed reports: ${result.analyzedReportCount}`);
    return;
  }

  console.log(`\nExecutive Recommendations (last ${result.requestedWindow} plans)`);
  console.log(`Generated: ${result.generatedAt}\n`);

  console.log(
    `${"Subsystem".padEnd(18)} ${"Signal".padEnd(24)} ${"Severity".padEnd(9)} ` +
    `${"Conf".padEnd(6)} ${"Occurrences".padEnd(12)} ${"Avg Δ".padEnd(7)} Recommendation`,
  );
  console.log("-".repeat(96));
  for (const r of result.subsystemRecommendations) {
    console.log(
      `${r.subsystem.padEnd(18)} ${r.signal.padEnd(24)} ${r.severity.padEnd(9)} ` +
      `${r.signalConfidence.toFixed(2).padEnd(6)} ${String(r.occurrenceCount).padEnd(12)} ` +
      `${fmtDelta(r.averageDelta).padEnd(7)} ${r.recommendation}`,
    );
  }

  console.log(
    `\nInput: ${result.inputReportCount} reports | Skipped: ${result.skippedReportCount}`,
  );
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const w of result.loadWarnings) console.error(`Load warning: ${w}`);
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}
