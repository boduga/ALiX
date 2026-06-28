/**
 * P10.9 — Executive Dashboard Async Loader.
 *
 * Async I/O function that loads all executive stores in parallel and returns
 * an ExecutiveDashboardSnapshot for the pure builder (buildDashboardReport).
 * All store reads wrapped in try/catch so partial data never crashes the
 * dashboard.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutiveTrendStore } from "./trend-store.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import {
  RecommendationReportStore,
  type RecommendationReport,
  type RecommendationReportMeta,
} from "./recommendation-report-store.js";
import { OutcomeReportStore, type OutcomeReportMeta } from "./outcome-store.js";
import { ProposalStore } from "../adaptation/proposal-store.js";
import {
  classifyRecommendation,
  applyEffectivenessData,
  computeRecommendationEffectiveness,
} from "./recommendation-effectiveness.js";
import type { EffectivenessOutcome, RecommendationEntry, ProposalStatus } from "./recommendation-effectiveness.js";
import { SubsystemTimeMatcher, computeSubsystemCorrelation } from "./subsystem-correlation.js";
import type { OutcomeReportRef } from "./subsystem-correlation.js";
import type { ExecutiveDashboardSnapshot } from "./executive-dashboard.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const DEFAULT_STALE_THRESHOLD = 7;
const DEFAULT_CORRELATION_LAG = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadDashboardSnapshot(
  cwd: string,
  windowDays: number,
): Promise<ExecutiveDashboardSnapshot> {
  const generatedAt = new Date().toISOString();
  const loadWarnings: string[] = [];

  // Phase 1: Parallel I/O for independent stores (trends + recommendation metas)
  const [trendsResult, recMetasResult] = await Promise.allSettled([
    loadTrends(cwd),
    listRecommendationMetas(cwd, windowDays),
  ]);

  const trends = trendsResult.status === "fulfilled" ? trendsResult.value : null;
  if (trendsResult.status === "rejected") {
    loadWarnings.push(`Failed to load trends: ${trendsResult.reason}`);
  }

  const recMetas = recMetasResult.status === "fulfilled" ? recMetasResult.value : [];
  if (recMetasResult.status === "rejected") {
    loadWarnings.push(`Failed to list recommendation reports: ${recMetasResult.reason}`);
  }

  // Phase 2: Load recommendation reports (depends on metas)
  const loadedReports = await loadReportsInParallel(recMetas, cwd, loadWarnings);

  // Phase 3: Parallel outcome reports + proposal statuses
  const nowMs = Date.now();

  const [outcomeRefsResult, proposalStatusMapResult] = await Promise.allSettled([
    loadOutcomeRefs(cwd, windowDays, loadWarnings),
    loadProposalStatuses(loadedReports, cwd, loadWarnings),
  ]);

  const outcomeRefs = outcomeRefsResult.status === "fulfilled" ? outcomeRefsResult.value : [];
  if (outcomeRefsResult.status === "rejected") {
    loadWarnings.push(`Failed to load outcome reports: ${outcomeRefsResult.reason}`);
  }

  const proposalStatusMap = proposalStatusMapResult.status === "fulfilled"
    ? proposalStatusMapResult.value
    : new Map<string, ProposalStatus | null>();
  if (proposalStatusMapResult.status === "rejected") {
    loadWarnings.push(`Failed to load proposal statuses: ${proposalStatusMapResult.reason}`);
  }

  // Phase 4: Build RecommendationEntry array, load effectiveness, compute everything
  const entries = buildEntries(loadedReports, proposalStatusMap, nowMs, loadWarnings);
  const effectivenessOutcomeMap = loadEffectivenessOutcomes(cwd, loadWarnings);
  const enrichedEntries = applyEffectivenessData(entries, effectivenessOutcomeMap);

  const effectivenessResult = entries.length > 0
    ? computeRecommendationEffectiveness(enrichedEntries, DEFAULT_STALE_THRESHOLD, generatedAt)
    : null;

  const subsystemCorrelationReport = outcomeRefs.length > 0 && entries.length > 0
    ? await computeSubsystemCorrelation(
        enrichedEntries,
        outcomeRefs,
        new SubsystemTimeMatcher("strict", DEFAULT_CORRELATION_LAG),
        "strict",
        DEFAULT_CORRELATION_LAG,
        generatedAt,
      )
    : null;

  return {
    trends,
    effectivenessResult,
    subsystemCorrelationReport,
    outcomeReports: outcomeRefs.map((ref) => ref.report),
    proposalStatusMap,
    effectivenessOutcomeMap,
    loadWarnings,
    windowDays,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function loadTrends(cwd: string): Promise<ExecutiveTrendSnapshot | null> {
  const store = new ExecutiveTrendStore(join(cwd, ".alix", "executive"));
  return store.loadLatest();
}

async function listRecommendationMetas(
  cwd: string,
  windowDays: number,
): Promise<RecommendationReportMeta[]> {
  const store = new RecommendationReportStore(join(cwd, ".alix", "executive", "recommendations"));
  const metas = store.list();
  const nowMs = Date.now();
  return windowDays > 0
    ? metas.filter((m) => (nowMs - new Date(m.generatedAt).getTime()) / MS_PER_DAY <= windowDays)
    : metas;
}

async function loadReportsInParallel(
  metas: RecommendationReportMeta[],
  cwd: string,
  loadWarnings: string[],
): Promise<RecommendationReport[]> {
  if (metas.length === 0) return [];

  const store = new RecommendationReportStore(join(cwd, ".alix", "executive", "recommendations"));
  const reports: RecommendationReport[] = [];

  for (const meta of metas) {
    try {
      const report = store.load(meta.reportId);
      if (report) reports.push(report);
    } catch (e: any) {
      loadWarnings.push(`Skipping corrupt recommendation report: ${meta.reportId} — ${e.message}`);
    }
  }

  return reports;
}

async function loadOutcomeRefs(
  cwd: string,
  windowDays: number,
  loadWarnings: string[],
): Promise<OutcomeReportRef[]> {
  const store = new OutcomeReportStore(join(cwd, ".alix", "executive", "outcomes"));
  const refs: OutcomeReportRef[] = [];

  let metas: OutcomeReportMeta[];
  try {
    metas = store.list();
  } catch (e: any) {
    loadWarnings.push(`Failed to list outcome reports: ${e.message}`);
    return [];
  }

  const nowMs = Date.now();
  const filtered = windowDays > 0
    ? metas.filter((m) => (nowMs - new Date(m.generatedAt).getTime()) / MS_PER_DAY <= windowDays)
    : metas;

  for (const meta of filtered) {
    try {
      const report = store.load(meta.reportId);
      if (report) refs.push({ id: meta.reportId, report });
    } catch (e: any) {
      loadWarnings.push(`Skipping corrupt outcome report: ${meta.reportId} — ${e.message}`);
    }
  }

  return refs;
}

async function loadProposalStatuses(
  loadedReports: RecommendationReport[],
  cwd: string,
  loadWarnings: string[],
): Promise<Map<string, ProposalStatus | null>> {
  const allProposalIds = new Set<string>();
  for (const report of loadedReports) {
    for (const rec of report.report.recommendations) {
      if (rec.proposalId) allProposalIds.add(rec.proposalId);
    }
  }

  if (allProposalIds.size === 0) return new Map();

  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const statusMap = new Map<string, ProposalStatus | null>();

  await Promise.all(
    [...allProposalIds].map(async (pid) => {
      try {
        const proposal = await proposalStore.load(pid);
        statusMap.set(pid, proposal ? (proposal.status as ProposalStatus) : null);
      } catch {
        statusMap.set(pid, null);
      }
    }),
  );

  return statusMap;
}

function buildEntries(
  loadedReports: RecommendationReport[],
  proposalStatusMap: Map<string, ProposalStatus | null>,
  nowMs: number,
  loadWarnings: string[],
): RecommendationEntry[] {
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
          proposalStatus: proposalStatus as ProposalStatus | null | undefined,
          ageDays,
        },
        DEFAULT_STALE_THRESHOLD,
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

  return entries;
}

function loadEffectivenessOutcomes(
  cwd: string,
  loadWarnings: string[],
): Map<string, EffectivenessOutcome> {
  const outcomeMap = new Map<string, EffectivenessOutcome>();
  const effectivenessDir = join(cwd, ".alix", "adaptation", "effectiveness");

  try {
    if (!existsSync(effectivenessDir)) return outcomeMap;

    const files = readdirSync(effectivenessDir).filter((f) => f.endsWith(".json"));
    const VALID_OUTCOMES = new Set<EffectivenessOutcome>(["keep", "revert", "investigate", "no_data"]);

    for (const file of files) {
      try {
        const raw = readFileSync(join(effectivenessDir, file), "utf-8");
        const report = JSON.parse(raw);

        if (!VALID_OUTCOMES.has(report.recommendation)) {
          loadWarnings.push(
            `Skipping effectiveness report with unrecognized recommendation "${report.recommendation}": ${file}`,
          );
          continue;
        }

        outcomeMap.set(report.proposalId, report.recommendation as EffectivenessOutcome);
      } catch (e: any) {
        loadWarnings.push(`Skipping corrupt effectiveness report: ${file} — ${e.message}`);
      }
    }
  } catch (e: any) {
    loadWarnings.push(`Failed to read effectiveness directory: ${e.message}`);
  }

  return outcomeMap;
}
