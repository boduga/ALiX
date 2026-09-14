/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import type {
  LedgerAnalytics,
  PeriodRollup,
} from "../../../governance/ledger-analytics.js";
import { type FailureAnalysis, failureSeverityForType } from "../../../governance/failure-clustering.js";
import type { PolicySuggestion } from "../../../governance/policy-suggestions.js";
import type { FrictionReport } from "../../../governance/approval-friction.js";
import { BOLD, DIM, GREEN, RED, RESET, YELLOW, colorForSeverity, parseFlags, parseSectionFlag } from "./shared.js";

// ---------------------------------------------------------------------------
// runAnalytics — `alix governance analytics [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runAnalytics(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../../governance/run-ledger.js");
  const { computeAnalytics, computePeriodRollups } = await import(
    "../../../governance/ledger-analytics.js",
  );

  const cwd = process.cwd();
  const store = new FileLedgerStore(cwd);
  const entries = await store.list();

  // Apply window filter — FileLedgerStore.list() returns newest-first
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = entries.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoffMs,
  );

  const analytics = computeAnalytics(filtered, windowDays);
  const rollups = computePeriodRollups(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ analytics, rollups }, null, 2));
    return;
  }

  renderAnalytics(analytics, rollups);
}


// ---------------------------------------------------------------------------
// runFailureAnalysis — `alix governance failure-analysis [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runFailureAnalysis(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileFailureMemoryStore } = await import("../../../governance/failure-memory.js");
  const { computeFailureAnalysis } = await import(
    "../../../governance/failure-clustering.js",
  );

  const cwd = process.cwd();
  const store = new FileFailureMemoryStore(cwd);
  const records = await store.list();

  // Apply window filter
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = records.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoffMs,
  );

  const failureAnalysis = computeFailureAnalysis(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ failureAnalysis }, null, 2));
    return;
  }

  renderFailureAnalysis(failureAnalysis, windowDays);
}


// ---------------------------------------------------------------------------
// runPolicySuggestions — `alix governance policy-suggestions [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runPolicySuggestions(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../../governance/failure-memory.js");
  const { computePolicySuggestions } = await import(
    "../../../governance/policy-suggestions.js",
  );

  const cwd = process.cwd();
  const ledger = new FileLedgerStore(cwd);
  const failures = new FileFailureMemoryStore(cwd);

  // Window filter applied independently to each store.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  const ledgerEntries = (await ledger.list()).filter(
    (e) => new Date(e.timestamp).getTime() >= cutoffMs,
  );
  const failureRecords = (await failures.list()).filter(
    (r) => new Date(r.timestamp).getTime() >= cutoffMs,
  );

  const policySuggestions = computePolicySuggestions(ledgerEntries, failureRecords);

  if (jsonMode) {
    console.log(JSON.stringify({ policySuggestions }, null, 2));
    return;
  }

  renderPolicySuggestions(policySuggestions, windowDays);
}


// ---------------------------------------------------------------------------
// runFrictionAnalysis — `alix governance friction-analysis [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runFrictionAnalysis(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../../governance/run-ledger.js");
  const { computeFrictionReport } = await import("../../../governance/approval-friction.js");

  const cwd = process.cwd();
  const store = new FileLedgerStore(cwd);
  const entries = await store.list();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  const frictionReport = computeFrictionReport(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ frictionReport }, null, 2));
    return;
  }

  renderFrictionAnalysis(frictionReport, windowDays);
}


// ---------------------------------------------------------------------------
// runReport — `alix governance report [--section <s>] [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runReport(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const section = parseSectionFlag(args);

  // Dynamic imports for stores and pure functions
  const { FileLedgerStore } = await import("../../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../../governance/failure-memory.js");
  const { computeAnalytics, computePeriodRollups } = await import(
    "../../../governance/ledger-analytics.js",
  );
  const { computeFailureAnalysis } = await import("../../../governance/failure-clustering.js");
  const { computePolicySuggestions } = await import(
    "../../../governance/policy-suggestions.js",
  );
  const { computeFrictionReport } = await import("../../../governance/approval-friction.js");

  const cwd = process.cwd();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  // Helper: fetch + filter a store
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowed = async <T extends { timestamp: string }>(
    store: { list: (limit?: number) => Promise<T[]> },
  ): Promise<T[]> =>
    (await store.list()).filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  // Check if a section should be computed
  const want = (s: string): boolean => section === null || section === s;

  const result: Record<string, unknown> = {};

  if (want("analytics")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    result.analytics = computeAnalytics(entries, windowDays);
    result.rollups = computePeriodRollups(entries);
  }

  if (want("failures")) {
    const records = await windowed(new FileFailureMemoryStore(cwd));
    result.failureAnalysis = computeFailureAnalysis(records);
  }

  if (want("policies")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    const records = await windowed(new FileFailureMemoryStore(cwd));
    result.policySuggestions = computePolicySuggestions(entries, records);
  }

  if (want("friction")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    result.frictionReport = computeFrictionReport(entries);
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  renderReport(result, windowDays, section);
}


// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

export const BAR = "═══════════════════════════════════════════════════════════════";


// -- Report (aggregated P13.1-P13.4) -----------------------------------------

export function renderReport(result: Record<string, unknown>, windowDays: number, section: string | null): void {
  console.log(BOLD + "Governance Report" + RESET);
  console.log(`Window: ${windowDays} days`);
  console.log(DIM + "  Advisory only — no policies or gates modified." + RESET);
  console.log(BAR);

  const show = (name: string) => section === null || section === name;

  if (show("analytics") && result.analytics) {
    console.log("");
    console.log(BOLD + "◆ Ledger Analytics" + RESET);
    renderAnalytics(result.analytics as LedgerAnalytics, result.rollups as PeriodRollup[]);
  } else if (show("analytics")) {
    console.log("");
    console.log(BOLD + "◆ Ledger Analytics" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("failures") && result.failureAnalysis) {
    console.log("");
    console.log(BOLD + "◆ Failure Clustering" + RESET);
    renderFailureAnalysis(result.failureAnalysis as FailureAnalysis, windowDays);
  } else if (show("failures")) {
    console.log("");
    console.log(BOLD + "◆ Failure Clustering" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("policies") && result.policySuggestions) {
    console.log("");
    console.log(BOLD + "◆ Policy Suggestions" + RESET);
    renderPolicySuggestions(result.policySuggestions as PolicySuggestion[], windowDays);
  } else if (show("policies")) {
    console.log("");
    console.log(BOLD + "◆ Policy Suggestions" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("friction") && result.frictionReport) {
    console.log("");
    console.log(BOLD + "◆ Approval Friction" + RESET);
    renderFrictionAnalysis(result.frictionReport as FrictionReport, windowDays);
  } else if (show("friction")) {
    console.log("");
    console.log(BOLD + "◆ Approval Friction" + RESET);
    console.log(DIM + "  No data" + RESET);
  }
}


// -- Analytics ----------------------------------------------------------------

export function colorForTrend(trend: string): string {
  switch (trend) {
    case "improving":
      return GREEN;
    case "degrading":
      return RED;
    default:
      return YELLOW;
  }
}


export function colorForRateValue(rate: number): string {
  if (rate >= 0.8) return GREEN;
  if (rate >= 0.5) return YELLOW;
  return RED;
}


export function renderAnalytics(
  analytics: LedgerAnalytics,
  rollups: PeriodRollup[],
): void {
  console.log(BOLD + "Governance Analytics" + RESET);
  console.log(BAR);

  // Summary line
  console.log(
    `  ${analytics.totalRuns} runs, ${analytics.timeframeDays}d window`,
  );

  // Trend
  const trendColor = colorForTrend(analytics.trendDirection);
  console.log(
    `  Trend: ${trendColor}${analytics.trendDirection.toUpperCase()}${RESET}`,
  );

  // Approval rate
  const rateColor = colorForRateValue(analytics.approvalRate);
  console.log(
    `  Approval Rate: ${rateColor}${(analytics.approvalRate * 100).toFixed(1)}%${RESET}`,
  );

  // Average risk
  console.log(
    `  Avg Risk Score: ${analytics.averageRiskScore.toFixed(1)}`,
  );

  // Outcomes
  console.log("");
  console.log(BOLD + "By Outcome" + RESET);
  for (const [outcome, count] of Object.entries(analytics.byOutcome)) {
    if (count > 0) {
      const icon =
        outcome === "failed"
          ? "❌"
          : outcome === "denied"
            ? "🚫"
            : "⏹️";
      console.log(` ${icon} ${outcome}: ${count}`);
    }
  }
  console.log("");

  // Risk levels
  console.log(BOLD + "By Risk Level" + RESET);
  for (const [level, count] of Object.entries(analytics.byRiskLevel)) {
    if (count > 0) {
      const color = colorForSeverity(level);
      console.log(` ${color}[${level.toUpperCase()}]${RESET} ${count}`);
    }
  }
  console.log("");

  // Period rollups (last 7 days max)
  if (rollups.length > 0) {
    const recent = rollups.slice(-7);
    console.log(
      BOLD + `Daily Rollups (last ${recent.length} day(s))` + RESET,
    );
    for (const r of recent) {
      const badCount = r.failures + r.denied;
      const failStr =
        badCount > 0
          ? ` ${RED}${badCount} bad${RESET}`
          : " 0 bad";
      console.log(
        ` ${r.date} | ${r.runs} runs${failStr} | avg risk ${r.avgRiskScore.toFixed(1)}`,
      );
    }
  }
}


// -- Failure Analysis --------------------------------------------------------

export function severityColor(severity: "high" | "medium" | "low"): string {
  switch (severity) {
    case "high": return RED;
    case "medium": return YELLOW;
    default: return GREEN;
  }
}


export function renderFailureAnalysis(analysis: FailureAnalysis, windowDays: number): void {
  console.log(BOLD + "Governance Failure Analysis" + RESET);
  console.log(BAR);
  console.log(`Total Records:  ${analysis.total}`);
  console.log(`Window:         ${windowDays} days (requested)`);
  console.log(`Data Span:      ${analysis.timeframeDays} days (actual)`);
  console.log(`Dominant Type:  ${analysis.dominantType ?? "none"}`);
  console.log("");

  // Clusters
  if (analysis.clusters.length > 0) {
    console.log(BOLD + "By Cluster" + RESET);
    for (const c of analysis.clusters) {
      const sev = failureSeverityForType(c.failureType);
      const color = severityColor(sev);
      console.log(
        ` ${color}[${sev.toUpperCase()}]${RESET} ${c.failureType} (${c.count})`,
      );
      if (c.commonDetailKeywords.length > 0) {
        console.log(`    Keywords: ${c.commonDetailKeywords.join(", ")}`);
      }
      if (c.commonFilePaths.length > 0) {
        console.log(`    File paths: ${c.commonFilePaths.join(", ")}`);
      }
    }
    console.log("");
  }

  // Recurring file paths
  if (analysis.recurringFilePaths.length > 0) {
    console.log(BOLD + "Recurring File Paths (2+ records)" + RESET);
    const maxLen = Math.max(...analysis.recurringFilePaths.map((p) => p.length)) + 4;
    for (const fp of analysis.recurringFilePaths) {
      const count = analysis.recurringFilePathCounts[fp] ?? 0;
      console.log(` ${fp.padEnd(maxLen)}(${count})`);
    }
  }
}


// -- Policy Suggestions ------------------------------------------------------

export function confidenceColor(confidence: number): string {
  // High-confidence suggestions carry the strongest evidence and warrant urgent human attention → RED.
  if (confidence >= 0.75) return RED;
  if (confidence >= 0.6) return YELLOW;
  return GREEN;
}


export function renderPolicySuggestions(
  suggestions: PolicySuggestion[],
  windowDays: number,
): void {
  console.log(BOLD + "Governance Policy Suggestions" + RESET);
  console.log(BAR);
  console.log(`Window: ${windowDays} days`);
  console.log(
    DIM + `${suggestions.length} suggestion(s) — advisory only, no policy files modified` + RESET,
  );
  console.log("");

  if (suggestions.length === 0) {
    console.log(
      DIM + "  No suggestions. Either insufficient evidence or policies look healthy." + RESET,
    );
    return;
  }

  for (const s of suggestions) {
    const color = confidenceColor(s.confidence);
    const pid = s.policyId ? ` ${s.policyId}` : " (no policyId)";
    console.log(
      `${color}[${s.confidence.toFixed(2)}]${RESET} ${s.type}${pid} ${DIM}${s.sourceHeuristic}${RESET}`,
    );
    console.log(`    Reason: ${s.reason}`);
    console.log(`    Recommendation: ${s.recommendation}`);
    console.log(
      `    Evidence: matched=${s.evidence.matchedCount}, denied=${s.evidence.deniedCount}, bypassed=${s.evidence.bypassedCount}, related=${s.evidence.relatedFailureCount}`,
    );
    console.log("");
  }
}


// -- Approval Friction Analysis ---------------------------------------------

export function frictionColor(score: number): string {
  if (score >= 0.6) return RED;
  if (score >= 0.3) return YELLOW;
  return GREEN;
}


export function renderFrictionAnalysis(report: FrictionReport, windowDays: number): void {
  console.log(BOLD + "Governance Approval Friction Analysis" + RESET);
  console.log(BAR);
  console.log(`Window:                    ${windowDays} days`);
  console.log(`Total Approvals Requested: ${report.totalApprovalsRequested}`);
  console.log(`Overall Friction Score:    ${frictionColor(report.overallFrictionScore)}${report.overallFrictionScore.toFixed(2)}${RESET}`);
  console.log(`Highest Friction Gate:     ${report.highestFrictionGate ?? "none"}`);
  console.log(`Average time to approve:   not available (no request timestamps)`);
  console.log(DIM + "  Advisory only — no approval gates modified." + RESET);
  console.log("");

  if (report.gates.length > 0) {
    console.log(BOLD + "By Gate" + RESET);
    for (const g of report.gates) {
      const color = frictionColor(g.frictionScore);
      console.log(
        `  ${color}${g.frictionScore.toFixed(2)}${RESET}  ${g.gate}` +
        ` (${g.totalOccurrences} occurrences: ${g.deniedCount} denied, ${g.pendingCount} pending, ${g.approvedCount} approved)`,
      );
    }
  }
}
