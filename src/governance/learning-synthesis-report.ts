/**
 * P27.3 — Review Learning Synthesis Report.
 *
 * Pure function: composes DriftOutcomeTrace[] + DriftCorrelationAnalytics
 * into a structured read-only LearningSynthesisReport with text and JSON
 * output. Descriptive only — never prescriptive.
 *
 * No stores, no CLI, no audit emitters. No policy recommendations.
 * No threshold changes. No reviewer ranking. No predictive scores.
 */

import { createHash } from "node:crypto";
import type { DriftOutcomeTrace, LearningSynthesisReport } from "./learning-synthesis-types.js";
import type { DriftCorrelationAnalytics } from "./learning-synthesis-types.js";

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

const REQUIRED_FOOTNOTES = [
  "This report contains descriptive governance intelligence only.",
  "P27 produces correlations, not causation.",
  "No governance policy was changed by generating this report.",
  "No thresholds were adjusted.",
  "No reviewers were ranked.",
  "No candidates were prioritized.",
  "No outcomes were auto-adopted.",
  "Governance decisions remain under explicit human control.",
];

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildSynthesisReport(
  traces: DriftOutcomeTrace[],
  analytics: DriftCorrelationAnalytics,
  opts?: {
    generatedAt?: string;
    windowStart?: string;
    windowEnd?: string;
    /** Total terminal-state candidates (dismissed, closed, accepted_for_policy_review). Used for completeness & missing-outcome metrics. */
    totalTerminalCandidates?: number;
    /** Total terminal candidates that have at least one outcome record. */
    terminalCandidatesWithOutcomes?: number;
  },
): LearningSynthesisReport {
  const windowStart = opts?.windowStart ?? (traces.length > 0 ? traces[0]!.windowStart : "");
  const windowEnd = opts?.windowEnd ?? (traces.length > 0 ? traces[0]!.windowEnd : "");
  const signals = new Set(traces.map(t => t.signalId));
  const candidates = new Set(traces.map(t => t.candidateId));

  // Compute trace completeness: ratio of terminal candidates with outcomes to total terminal candidates
  const totalTC = opts?.totalTerminalCandidates ?? 0;
  const withOutcomes = opts?.terminalCandidatesWithOutcomes ?? traces.length;
  const traceCompleteness = totalTC > 0
    ? Math.round((withOutcomes / totalTC) * 100) / 100
    : (traces.length > 0 ? 1 : 0);

  const missingOutcomes = totalTC > 0 ? totalTC - withOutcomes : 0;

  // Signal kind frequency
  const signalKindFrequency: Record<string, number> = {};
  for (const trace of traces) {
    signalKindFrequency[trace.signalKind] = (signalKindFrequency[trace.signalKind] ?? 0) + 1;
  }

  return {
    reportId: createHash("sha256")
      .update(["p27", windowStart, windowEnd, String(traces.length)].join("|"))
      .digest("hex")
      .slice(0, 16),
    windowStart,
    windowEnd,
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    totalSignals: signals.size,
    totalCandidates: candidates.size,
    totalOutcomes: traces.length,
    outcomeBySignalKind: analytics.outcomeBySignalKind,
    outcomeBySeverity: analytics.outcomeBySeverity,
    timeStats: analytics.timeStats,
    traceCompleteness,
    missingOutcomes,
    repeatedPatterns: analytics.repeatedPatterns,
    confidenceByOutcome: {},
    signalKindFrequency,
    footnotes: [...REQUIRED_FOOTNOTES],
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderSynthesisReportText(report: LearningSynthesisReport): string {
  let out = "";

  out += "P27-SYNTHESIS-START\n";
  out += "Policy Review Learning Synthesis Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}\n`;
  out += `  Window: ${report.windowStart} → ${report.windowEnd}\n`;
  out += `  Generated: ${report.generatedAt}\n`;

  out += `\n  Summary\n`;
  out += `    Signals: ${report.totalSignals}\n`;
  out += `    Candidates: ${report.totalCandidates}\n`;
  out += `    Outcomes: ${report.totalOutcomes}\n`;

  out += `\n  Correlations\n`;
  for (const [kind, outcomes] of Object.entries(report.outcomeBySignalKind)) {
    out += `    ${kind}:\n`;
    for (const [outcome, count] of Object.entries(outcomes)) {
      out += `      ${outcome}: ${count}\n`;
    }
  }

  out += `\n  Time Statistics\n`;
  out += `    Avg time to review: ${report.timeStats.avgTimeToReviewDays} days\n`;
  out += `    Avg time to outcome: ${report.timeStats.avgTimeToOutcomeDays} days\n`;

  out += `\n  Trace Completeness: ${report.traceCompleteness}\n`;
  out += `  Missing outcomes: ${report.missingOutcomes}\n`;

  if (report.repeatedPatterns.length > 0) {
    out += `\n  Repeated Drift Patterns\n`;
    for (const pattern of report.repeatedPatterns) {
      out += `    ${pattern} (appears in 2+ windows)\n`;
    }
  }

  out += "\n---\n";
  for (const note of report.footnotes) {
    out += note + "\n";
  }
  out += "P27-SYNTHESIS-END\n";

  return out;
}

// ---------------------------------------------------------------------------
// JSON rendering
// ---------------------------------------------------------------------------

export function renderSynthesisReportJson(report: LearningSynthesisReport): string {
  return JSON.stringify(report, null, 2);
}
