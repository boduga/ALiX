/**
 * P25.4 — Policy Review Candidate Report Builder.
 *
 * Pure function: turns PolicyReviewCandidate[] into structured read-only
 * report with text and JSON output. No stores, no CLI, no audit emitters.
 */

import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface CandidateReport {
  reportId: string;
  generatedAt: string;
  totalCount: number;
  byStatus: Record<string, number>;
  candidates: Array<{
    candidateId: string;
    title: string;
    status: string;
    sourceKind: string;
    severity: string;
    notesCount: number;
  }>;
  footer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildCandidateReport(
  candidates: PolicyReviewCandidate[],
  opts?: { generatedAt?: string },
): CandidateReport {
  const byStatus: Record<string, number> = {
    proposed: 0,
    under_review: 0,
    needs_info: 0,
    deferred: 0,
    accepted_for_policy_review: 0,
    dismissed: 0,
    closed: 0,
  };

  for (const c of candidates) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }

  return {
    reportId: `p25-report`,
    generatedAt: opts?.generatedAt ?? now(),
    totalCount: candidates.length,
    byStatus,
    candidates: candidates.map(c => ({
      candidateId: c.candidateId,
      title: c.title,
      status: c.status,
      sourceKind: c.source.signalKind,
      severity: c.source.signalSeverity,
      notesCount: c.review.notes.length,
    })),
    footer:
      "No policy was changed. No threshold was changed. No candidate was ranked. No candidate was auto-adopted. No review outcome was applied to governance policy.",
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderCandidateReportText(report: CandidateReport): string {
  let out = "";

  out += "P25-CANDIDATE-REPORT-START\n";
  out += "Policy Review Candidate Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n Report ID: ${report.reportId}\n`;
  out += ` Generated: ${report.generatedAt}\n`;
  out += ` Total candidates: ${report.totalCount}\n`;

  out += "\n By Status:\n";
  for (const [status, count] of Object.entries(report.byStatus)) {
    out += `  ${status}: ${count}\n`;
  }

  if (report.candidates.length === 0) {
    out += "\n No candidates.\n";
  } else {
    out += "\n Candidates:\n";
    for (const c of report.candidates) {
      out += `  [${c.status}] ${c.title}\n`;
      out += `   ID: ${c.candidateId} | Kind: ${c.sourceKind} | Severity: ${c.severity}\n`;
    }
  }

  out += "\n---\n";
  out += report.footer + "\n";
  out += "P25-CANDIDATE-REPORT-END\n";

  return out;
}

// ---------------------------------------------------------------------------
// JSON rendering
// ---------------------------------------------------------------------------

export function renderCandidateReportJson(report: CandidateReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
