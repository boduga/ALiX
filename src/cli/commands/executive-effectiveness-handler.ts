/**
 * P10.8 — Recommendation Effectiveness CLI handler.
 *
 * Read-only handler that loads recommendation reports from
 * RecommendationReportStore, loads associated proposals from ProposalStore,
 * classifies each recommendation's disposition, aggregates per-signal
 * calibration, and renders terminal tables or JSON.
 *
 * Classification uses classifyRecommendation() from the pure function module
 * (Task 1 of P10.8). Aggregation uses computeRecommendationEffectiveness().
 * Sort is delegated to the aggregation function (sortRecommendations).
 *
 * --since  <days>     Filter reports by age (time-based, not count-based).
 * --threshold <days>  Stale threshold (default 7).
 * --report  <id>      Analyze a single report by ID.
 * --json              Emit structured JSON instead of terminal table.
 *
 * @module
 */

import { join } from "node:path";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import type { RecommendationReport } from "../../executive/recommendation-report-store.js";
import {
  classifyRecommendation,
  computeRecommendationEffectiveness,
  EFFECTIVENESS_NO_DATA,
} from "../../executive/recommendation-effectiveness.js";
import type { EffectivenessResult, RecommendationEntry } from "../../executive/recommendation-effectiveness.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const DEFAULT_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleEffectivenessCommand(args: string[]): Promise<void> {
  // Parse flags
  const reportIndex = args.indexOf("--report");
  const reportIdArg =
    reportIndex !== -1 && reportIndex + 1 < args.length ? args[reportIndex + 1] : undefined;
  const sinceIndex = args.indexOf("--since");
  const sinceDays =
    sinceIndex !== -1 && sinceIndex + 1 < args.length
      ? Math.max(1, parseInt(args[sinceIndex + 1], 10))
      : undefined;
  const thresholdIndex = args.indexOf("--threshold");
  const thresholdDays =
    thresholdIndex !== -1 && thresholdIndex + 1 < args.length
      ? Math.max(1, parseInt(args[thresholdIndex + 1], 10))
      : DEFAULT_THRESHOLD_DAYS;
  const useJson = args.includes("--json");

  const cwd = process.cwd();
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );

  const generatedAt = new Date().toISOString();
  const nowMs = Date.now();

  // Resolve which reports to analyze
  const loadedReports: RecommendationReport[] = [];

  if (reportIdArg) {
    // Explicit --report: load exactly one report
    try {
      const report = recommendationStore.load(reportIdArg);
      if (!report) {
        emitError("Report not found", useJson, `Report not found: ${reportIdArg}`);
        return;
      }
      loadedReports.push(report);
    } catch (e: any) {
      emitError(
        "integrity failure",
        useJson,
        `Report integrity failure for ${reportIdArg}: ${e.message}`,
      );
      return;
    }
  } else {
    // No --report: list all reports and optionally filter by --since
    const metas = recommendationStore.list();
    const filtered =
      sinceDays !== undefined
        ? metas.filter((m) => {
            const ageMs = nowMs - new Date(m.generatedAt).getTime();
            return ageMs / MS_PER_DAY <= sinceDays;
          })
        : metas;

    for (const meta of filtered) {
      try {
        const report = recommendationStore.load(meta.reportId);
        if (report) loadedReports.push(report);
      } catch (e: any) {
        console.warn(`Skipping corrupt report: ${meta.reportId} — ${e.message}`);
      }
    }
  }

  if (loadedReports.length === 0) {
    const noData: EffectivenessResult = {
      effectivenessStatus: EFFECTIVENESS_NO_DATA,
      generatedAt,
      staleThresholdDays: thresholdDays,
      reportCount: 0,
      totalRecommendations: 0,
      signalCalibration: [],
      recommendations: [],
      loadWarnings: [
        reportIdArg
          ? `Report not found: ${reportIdArg}`
          : "No recommendation reports found.",
      ],
    };
    if (useJson) {
      console.log(JSON.stringify(noData, null, 2));
    } else {
      console.log("No recommendation effectiveness data available.");
    }
    return;
  }

  // Collect all unique proposal IDs across all loaded reports
  const allProposalIds = new Set<string>();
  for (const report of loadedReports) {
    for (const rec of report.report.recommendations) {
      if (rec.proposalId) allProposalIds.add(rec.proposalId);
    }
  }

  // Load all proposals in parallel for efficiency
  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const proposalStatusMap = new Map<string, string | null>();
  await Promise.all(
    [...allProposalIds].map(async (pid) => {
      try {
        const proposal = await proposalStore.load(pid);
        proposalStatusMap.set(pid, proposal ? proposal.status : null);
      } catch {
        // Corrupt file or invalid id — treat as missing
        proposalStatusMap.set(pid, null);
      }
    }),
  );

  // Build RecommendationEntry array (sort is handled by aggregation)
  const entries: RecommendationEntry[] = [];
  for (const report of loadedReports) {
    const ageDays = Math.floor(
      (nowMs - new Date(report.report.generatedAt).getTime()) / MS_PER_DAY,
    );
    const recs = report.report.recommendations;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const proposalStatus = rec.proposalId
        ? (proposalStatusMap.get(rec.proposalId) ?? null)
        : undefined;

      const disposition = classifyRecommendation(
        {
          subsystem: rec.subsystem,
          signal: rec.signal,
          severity: rec.severity,
          signalConfidence: rec.signalConfidence,
          recommendation: rec.recommendation,
          proposalId: rec.proposalId,
          proposalStatus: proposalStatus as any,
          ageDays,
        },
        thresholdDays,
      );

      entries.push({
        reportId: report.id,
        generatedAt: report.report.generatedAt,
        recIndex: i,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation,
        proposalId: rec.proposalId,
        disposition,
        ageDays,
      });
    }
  }

  // Aggregate (includes internal sorting via sortRecommendations)
  const result = computeRecommendationEffectiveness(entries, thresholdDays, generatedAt);

  // Render output
  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Error emission helper
// ---------------------------------------------------------------------------

function emitError(reason: string, useJson: boolean, message: string): void {
  if (useJson) {
    console.log(JSON.stringify({ ok: false, reason: message }));
  } else {
    console.error(message);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: EffectivenessResult): void {
  if (result.effectivenessStatus === EFFECTIVENESS_NO_DATA) {
    console.log("No recommendation effectiveness data available.");
    return;
  }

  console.log(`\nRecommendation Effectiveness Intelligence`);
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Stale threshold: ${result.staleThresholdDays} days`);
  console.log(
    `Reports: ${result.reportCount} | Total recommendations: ${result.totalRecommendations}\n`,
  );

  if (result.signalCalibration.length > 0) {
    console.log(
      `${"Signal".padEnd(24)} ${"Total".padEnd(6)} ${"Unrev".padEnd(6)} ` +
        `${"Stale".padEnd(6)} ${"Await".padEnd(6)} ${"Appr".padEnd(6)} ` +
        `${"Applied".padEnd(8)} ${"Rej".padEnd(5)} ${"Fail".padEnd(5)} ` +
        `${"Miss".padEnd(5)} ${"Bridged".padEnd(8)} ${"Action Rate"}`,
    );
    console.log("-".repeat(100));
    for (const cal of result.signalCalibration) {
      console.log(
        `${cal.signal.padEnd(24)} ${String(cal.total).padEnd(6)} ` +
          `${String(cal.unreviewed).padEnd(6)} ${String(cal.stale).padEnd(6)} ` +
          `${String(cal.awaitingReview).padEnd(6)} ${String(cal.approvedPendingApply).padEnd(6)} ` +
          `${String(cal.applied).padEnd(8)} ${String(cal.rejected).padEnd(5)} ` +
          `${String(cal.failed).padEnd(5)} ${String(cal.proposalMissing).padEnd(5)} ` +
          `${String(cal.bridgedCount).padEnd(8)} ` +
          `${(cal.actionRate * 100).toFixed(0)}%`,
      );
    }
  }

  if (result.loadWarnings.length > 0) {
    for (const w of result.loadWarnings) {
      console.error(`Warning: ${w}`);
    }
  }
}
