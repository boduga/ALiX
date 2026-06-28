/**
 * P10.8c — Predictive Signal Correlation CLI handler.
 *
 * Read-only handler loads recommendation reports from RecommendationReportStore,
 * loads outcome reports from OutcomeReportStore, computes subsystem correlation
 * via pure computeSubsystemCorrelation(), renders terminal tables or JSON.
 *
 * --mode strict|loose  Correlation timing mode (default: strict)
 * --lag <days>         Lag window in strict mode (default: 30)
 * --report <id>        Analyze a single report by ID
 * --json               Emit structured JSON instead of terminal tables
 *
 * @module
 */

import { join } from "node:path";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import type { RecommendationReport } from "../../executive/recommendation-report-store.js";
import {
  classifyRecommendation,
} from "../../executive/recommendation-effectiveness.js";
import type {
  RecommendationEntry,
  ProposalStatus,
} from "../../executive/recommendation-effectiveness.js";
import {
  SubsystemTimeMatcher,
  computeSubsystemCorrelation,
  PSC_NO_DATA,
} from "../../executive/subsystem-correlation.js";
import type {
  SubsystemCorrelationReport,
  SubsystemCorrelation,
  CorrelationMode,
  OutcomeReportRef,
} from "../../executive/subsystem-correlation.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LAG_DAYS = 30;
const DEFAULT_STALE_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleSubsystemCorrelationCommand(args: string[]): Promise<void> {
  // Parse flags
  const reportIndex = args.indexOf("--report");
  const reportIdArg = reportIndex !== -1 && reportIndex + 1 < args.length
    ? args[reportIndex + 1]
    : undefined;

  const modeIndex = args.indexOf("--mode");
  const modeArg = modeIndex !== -1 && modeIndex + 1 < args.length
    ? args[modeIndex + 1]
    : "strict";
  const correlationMode: CorrelationMode = modeArg === "loose" ? "loose" : "strict";

  const lagIndex = args.indexOf("--lag");
  const lagArg = lagIndex !== -1 && lagIndex + 1 < args.length
    ? parseInt(args[lagIndex + 1], 10)
    : DEFAULT_LAG_DAYS;
  const correlationLagDays = lagArg > 0 ? lagArg : DEFAULT_LAG_DAYS;

  const useJson = args.includes("--json");
  const generatedAt = new Date().toISOString();
  const cwd = process.cwd();

  // Load recommendation reports
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );
  const outcomeStore = new OutcomeReportStore(
    join(cwd, ".alix", "executive", "outcomes"),
  );

  const loadedReports: RecommendationReport[] = [];
  if (reportIdArg) {
    try {
      const report = recommendationStore.load(reportIdArg);
      if (!report) {
        emitError("not_found", useJson, `Recommendation report not found: ${reportIdArg}`);
        return;
      }
      loadedReports.push(report);
    } catch (e: any) {
      emitError("integrity_failure", useJson, `Report integrity failure: ${reportIdArg} — ${e.message}`);
      return;
    }
  } else {
    const metas = recommendationStore.list();
    for (const meta of metas) {
      try {
        const report = recommendationStore.load(meta.reportId);
        if (report) loadedReports.push(report);
      } catch (e: any) {
        console.warn(`Skipping corrupt recommendation report: ${meta.reportId} — ${e.message}`);
      }
    }
  }

  if (loadedReports.length === 0) {
    emitNoData(useJson, generatedAt, correlationMode, correlationLagDays);
    return;
  }

  // Collect unique proposal IDs across loaded reports for disposition classification
  const allProposalIds = new Set<string>();
  for (const report of loadedReports) {
    for (const rec of report.report.recommendations) {
      if (rec.proposalId) allProposalIds.add(rec.proposalId);
    }
  }

  // Load proposal statuses (read-only) so recommendations get the real P10.8a
  // disposition (unreviewed/stale/awaiting_review/applied/rejected/failed/...)
  // instead of a two-state stub.
  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const proposalStatusMap = new Map<string, ProposalStatus | null>();
  await Promise.all(
    [...allProposalIds].map(async (pid) => {
      try {
        const proposal = await proposalStore.load(pid);
        proposalStatusMap.set(pid, proposal ? (proposal.status as ProposalStatus) : null);
      } catch {
        proposalStatusMap.set(pid, null); // Corrupt/missing — treated as proposal_missing
      }
    }),
  );

  // Build RecommendationEntry array inline
  const recommendations: RecommendationEntry[] = [];
  const nowMs = Date.now();
  for (const report of loadedReports) {
    const recs = report.report.recommendations;
    const ageDays = Math.floor((nowMs - new Date(report.report.generatedAt).getTime()) / MS_PER_DAY);
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const proposalStatus = rec.proposalId
        ? (proposalStatusMap.get(rec.proposalId) ?? null)
        : undefined;
      recommendations.push({
        reportId: report.id,
        generatedAt: report.report.generatedAt,
        recIndex: i,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation,
        proposalId: rec.proposalId,
        disposition: classifyRecommendation(
          {
            subsystem: rec.subsystem,
            signal: rec.signal,
            severity: rec.severity,
            signalConfidence: rec.signalConfidence,
            recommendation: rec.recommendation,
            proposalId: rec.proposalId,
            proposalStatus,
            ageDays,
          },
          DEFAULT_STALE_THRESHOLD_DAYS,
        ),
        ageDays,
      });
    }
  }

  // Load outcome reports paired with their store ids (OutcomeReportRef keeps
  // SubsystemCorrelationEntry.outcomeReportId honest — the pure report type
  // has no id field of its own).
  const outcomeReports: OutcomeReportRef[] = [];
  try {
    const outcomeMetas = outcomeStore.list();
    for (const meta of outcomeMetas) {
      try {
        const report = outcomeStore.load(meta.reportId);
        if (report) outcomeReports.push({ id: meta.reportId, report });
      } catch (e: any) {
        console.warn(`Skipping corrupt outcome report: ${meta.reportId} — ${e.message}`);
      }
    }
  } catch {
    // Outcomes directory inaccessible — proceed with empty array
  }

  // Compute correlation
  const matcher = new SubsystemTimeMatcher(correlationMode, correlationLagDays);
  const result = await computeSubsystemCorrelation(
    recommendations,
    outcomeReports,
    matcher,
    correlationMode,
    correlationLagDays,
    generatedAt,
  );

  // Render output
  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result, reportIdArg !== undefined);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: SubsystemCorrelationReport, showDetail: boolean): void {
  if (result.correlationStatus === PSC_NO_DATA) {
    console.log("No predictive signal correlation data available.");
    return;
  }

  console.log(`\nPredictive Signal Correlation Report (${result.correlationMode}, ${result.correlationLagDays} day lag)`);
  console.log(`Generated: ${result.reportGeneratedAt}`);
  console.log(
    `Outcome reports: ${result.outcomeReportCount} | Recommendations: ${result.totalRecommendations} | Matched: ${result.matchedRecommendationCount} | Unmatched: ${result.unmatchedRecommendationCount}\n`,
  );

  // Subsystem correlation table
  if (result.subsystemCorrelations.length > 0) {
    console.log(
      `${"Subsystem".padEnd(16)} ${"Recs".padEnd(6)} ${"Outcomes".padEnd(6)} ` +
      `${"MatchedΔ".padEnd(8)} ${"Uncorr".padEnd(6)} ${"AvgΔ".padEnd(7)} ` +
      `${"|Δ|".padEnd(6)} ${"Improv".padEnd(6)} ${"Degrade".padEnd(6)} ` +
      `${"NetΔ".padEnd(7)} ${"CorrEff".padEnd(6)}`,
    );
    console.log("-".repeat(85));
    for (const sub of result.subsystemCorrelations) {
      console.log(
        `${sub.subsystem.padEnd(16)} ${String(sub.recommendationCount).padEnd(6)} ` +
        `${String(sub.outcomeReportCount).padEnd(6)} ${String(sub.matchedDeltaCount).padEnd(8)} ` +
        `${String(sub.uncorrelatedRecommendationCount).padEnd(6)} ${fmtDelta(sub.averageDelta).padEnd(7)} ` +
        `${fmtDelta(sub.averageAbsoluteDelta).padEnd(6)} ${String(sub.improvingCount).padEnd(6)} ` +
        `${String(sub.degradingCount).padEnd(6)} ${fmtDelta(sub.netDelta).padEnd(7)} ` +
        `${fmtPct(sub.correlationEffectiveness).padEnd(6)}`,
      );
    }
  }

  // Signal correlation table
  if (result.signalCorrelations.length > 0) {
    console.log(
      `\n${"Signal".padEnd(24)} ${"Recs".padEnd(6)} ${"Matched".padEnd(8)} ` +
      `${"MatchedΔ".padEnd(8)} ${"AvgΔ".padEnd(7)} ${"|Δ|".padEnd(6)} ` +
      `${"Improv".padEnd(6)} ${"Cov".padEnd(6)}`,
    );
    console.log("-".repeat(71));
    for (const sig of result.signalCorrelations) {
      console.log(
        `${sig.signal.padEnd(24)} ${String(sig.recommendationCount).padEnd(6)} ` +
        `${String(sig.matchedRecommendationCount).padEnd(8)} ${String(sig.matchedDeltaCount).padEnd(8)} ` +
        `${fmtDelta(sig.averageDelta).padEnd(7)} ${fmtDelta(sig.averageAbsoluteDelta).padEnd(6)} ` +
        `${fmtPct(sig.improvingRate).padEnd(6)} ${fmtPct(sig.coverageRate).padEnd(6)}`,
      );
    }
  }

  // Per-recommendation detail table (only when a specific --report was requested)
  if (result.correlations.length > 0 && showDetail) {
    console.log("\nPer-Recommendation Correlation Detail:");
    console.log(
      `${"ReportID".padEnd(14)} ${"Idx".padEnd(4)} ${"Signal".padEnd(18)} ` +
      `${"Sev".padEnd(5)} ${"Conf".padEnd(6)} ${"Disp".padEnd(12)} ` +
      `${"OutcomeID".padEnd(14)} ${"Δ".padEnd(6)} ${"Lag".padEnd(4)}`,
    );
    console.log("-".repeat(95));
    for (const entry of result.correlations) {
      console.log(
        `${entry.reportId.slice(0, 12).padEnd(14)} ${String(entry.recIndex).padEnd(4)} ` +
        `${entry.signal.slice(0, 16).padEnd(18)} ${entry.severity.slice(0, 3).padEnd(5)} ` +
        `${fmtPct(entry.signalConfidence).padEnd(6)} ${(entry.recommendationDisposition ?? "-").slice(0, 10).padEnd(12)} ` +
        `${entry.outcomeReportId.slice(0, 12).padEnd(14)} ${fmtDelta(entry.delta).padEnd(6)} ` +
        `${String(entry.lagDays).padEnd(4)}`,
      );
    }
  }

  // Warnings
  if (result.loadWarnings.length > 0) {
    for (const w of result.loadWarnings) {
      console.error(`Warning: ${w}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDelta(value: number): string {
  // Show sign for non-zero values
  if (value > 0) return `+${value.toFixed(1)}`;
  return value.toFixed(1);
}

function fmtPct(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function emitError(reason: string, useJson: boolean, message: string): void {
  if (useJson) {
    console.log(JSON.stringify({ ok: false, reason: message }));
  } else {
    console.error(message);
  }
}

function emitNoData(useJson: boolean, generatedAt: string, mode: string, lagDays: number): void {
  const noData: SubsystemCorrelationReport = {
    correlationStatus: PSC_NO_DATA,
    correlationMode: mode as CorrelationMode,
    correlationLagDays: lagDays,
    reportGeneratedAt: generatedAt,
    outcomeReportCount: 0,
    totalRecommendations: 0,
    matchedRecommendationCount: 0,
    unmatchedRecommendationCount: 0,
    subsystemCorrelations: [],
    signalCorrelations: [],
    correlations: [],
    loadWarnings: [],
  };
  if (useJson) {
    console.log(JSON.stringify(noData, null, 2));
  } else {
    console.log("No predictive signal correlation data available.");
  }
}
