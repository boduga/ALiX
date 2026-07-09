/**
 * P26.4 — Outcome Report Builder.
 *
 * Pure function: turns PolicyReviewOutcome[] + OutcomeAnalytics into a
 * structured read-only report with text and JSON output.
 * No stores, no CLI, no audit emitters. No policy mutation, threshold
 * changes, ranking, auto-adoption, or auto-close.
 */

import type { PolicyReviewOutcome } from "./policy-review-outcome-types.js";
import type { OutcomeAnalytics } from "./policy-review-outcome-analytics.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface OutcomeReport {
  reportId: string;
  generatedAt: string;
  totalOutcomeCount: number;
  totalCandidatesCount: number;
  candidatesWithoutOutcomes: number;
  outcomeDistribution: Record<string, number>;
  documentationGaps: {
    missingRationale: number;
    missingEvidence: number;
  };
  candidatesWithMultipleOutcomes: number;
  footer: string;
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildOutcomeReport(
  outcomes: PolicyReviewOutcome[],
  analytics: OutcomeAnalytics,
  opts?: { generatedAt?: string; totalCandidatesCount?: number; candidatesWithoutOutcomes?: number },
): OutcomeReport {
  return {
    reportId: `p26-report`,
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    totalOutcomeCount: outcomes.length,
    totalCandidatesCount: opts?.totalCandidatesCount ?? 0,
    candidatesWithoutOutcomes: opts?.candidatesWithoutOutcomes ?? 0,
    outcomeDistribution: { ...analytics.outcomeDistribution },
    documentationGaps: {
      missingRationale: analytics.outcomesMissingRationale.length,
      missingEvidence: analytics.outcomesMissingEvidence.length,
    },
    candidatesWithMultipleOutcomes: analytics.candidatesWithMultipleOutcomes.length,
    footer:
      "P26 records and analyzes human review outcomes for governed policy review candidates.\n" +
      "This report is read-only intelligence.\n" +
      "It does not apply policy changes.\n" +
      "It does not generate patches.\n" +
      "It does not change thresholds.\n" +
      "It does not rank reviewers.\n" +
      "It does not auto-adopt outcomes.\n" +
      "It does not auto-close candidates.",
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderOutcomeReportText(report: OutcomeReport): string {
  let out = "";

  out += "P26-OUTCOME-REPORT-START\n";
  out += "Policy Review Outcome Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}\n`;
  out += `  Generated: ${report.generatedAt}\n`;
  out += `  Total outcomes: ${report.totalOutcomeCount}\n`;
  out += `  Total candidates: ${report.totalCandidatesCount}\n`;
  out += `  Candidates without outcomes: ${report.candidatesWithoutOutcomes}\n`;

  out += "\n  Outcome Distribution:\n";
  for (const [type, count] of Object.entries(report.outcomeDistribution)) {
    if (count > 0) {
      out += `    ${type}: ${count}\n`;
    }
  }

  out += "\n  Documentation Gaps:\n";
  out += `    Missing rationale: ${report.documentationGaps.missingRationale}\n`;
  out += `    Missing evidence: ${report.documentationGaps.missingEvidence}\n`;

  out += `\n  Candidates with multiple outcomes: ${report.candidatesWithMultipleOutcomes}\n`;

  out += "\n---\n";
  out += report.footer + "\n";
  out += "P26-OUTCOME-REPORT-END\n";

  return out;
}
