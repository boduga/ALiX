/**
 * P23.4 — Replay Report Builder.
 *
 * Pure function: turns a CounterfactualReplayOutcome into a structured report
 * with text and JSON output. No stores, no CLI execution, no audit emitters.
 */

import type { CounterfactualReplayOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPLAY_START = "P23-REPLAY-START";
const REPLAY_END   = "P23-REPLAY-END";

const FOOTER =
  "P23 replay report is read-only. No policy, approval, readiness, handoff,\n" +
  "closure, audit, or execution state was mutated. Counterfactual outputs are\n" +
  "advisory and require governed human review before any future adoption.";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface ReplayReport {
  replayId: string;
  sourceLifecycleId: string;
  scenarioName: string;
  sourceRecords: {
    approvals: number;
    lifecycleTraces: number;
    readinessProjections: number;
    handoffs: number;
    closureReviews: number;
    closureIntelligence: number;
  };
  originalOutcome: {
    readinessLevel: string | null;
    evidenceCompleteness: string;
    handoffReadiness: string;
    closureDecision: string | null;
    closureRiskLevel: string | null;
    qualitySignalCount: number;
    requiresAttention: boolean;
  };
  counterfactualOutcome: {
    readinessLevel: string | null;
    evidenceCompleteness: string;
    handoffReadiness: string;
    closureDecision: string | null;
    closureRiskLevel: string | null;
    qualitySignalCount: number;
    requiresAttention: boolean;
    blocked: boolean;
    blockedReasons: readonly string[];
  };
  diff: {
    category: string;
    detailsCount: number;
    details: ReadonlyArray<{
      category: string;
      field: string;
      originalValue: unknown;
      counterfactualValue: unknown;
    }>;
  };
  riskDelta: {
    originalRisk: string;
    counterfactualRisk: string;
    direction: "increased" | "decreased" | "unchanged";
  };
  candidateLessons: ReadonlyArray<{
    lessonId: string;
    summary: string;
    basis: readonly string[];
    confidence: string;
    appliesTo: string;
    requiresHumanReview: boolean;
  }>;
  footer: string;
}

// ---------------------------------------------------------------------------
// Text rendering helpers
// ---------------------------------------------------------------------------

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function line(label: string, value: unknown, indent: number = 2): string {
  return " ".repeat(indent) + label + ": " + renderValue(value) + "\n";
}

function section(title: string, body: string): string {
  return `\n  ${title}\n${body}`;
}

// ---------------------------------------------------------------------------
// Text format
// ---------------------------------------------------------------------------

function renderText(report: ReplayReport): string {
  let out = "";

  out += `${REPLAY_START}\n`;
  out += `Replay Report — ${report.scenarioName}\n`;
  out += "=".repeat(50) + "\n";

  out += `\n  Replay ID: ${report.replayId}`;
  out += `\n  Source lifecycle ID: ${report.sourceLifecycleId}`;

  out += section(
    "Source Records Used",
    line("Approvals", report.sourceRecords.approvals) +
    line("Lifecycle traces", report.sourceRecords.lifecycleTraces) +
    line("Readiness projections", report.sourceRecords.readinessProjections) +
    line("Handoffs", report.sourceRecords.handoffs) +
    line("Closure reviews", report.sourceRecords.closureReviews) +
    line("Closure intelligence", report.sourceRecords.closureIntelligence),
  );

  // Original outcome
  out += section(
    "Original Outcome Summary",
    line("Readiness level", report.originalOutcome.readinessLevel) +
    line("Evidence completeness", report.originalOutcome.evidenceCompleteness) +
    line("Handoff readiness", report.originalOutcome.handoffReadiness) +
    line("Closure decision", report.originalOutcome.closureDecision) +
    line("Risk level", report.originalOutcome.closureRiskLevel) +
    line("Quality signals", report.originalOutcome.qualitySignalCount) +
    line("Requires attention", report.originalOutcome.requiresAttention),
  );

  // Counterfactual outcome
  out += section(
    "Counterfactual Outcome Summary",
    line("Readiness level", report.counterfactualOutcome.readinessLevel) +
    line("Evidence completeness", report.counterfactualOutcome.evidenceCompleteness) +
    line("Handoff readiness", report.counterfactualOutcome.handoffReadiness) +
    line("Closure decision", report.counterfactualOutcome.closureDecision) +
    line("Risk level", report.counterfactualOutcome.closureRiskLevel) +
    line("Quality signals", report.counterfactualOutcome.qualitySignalCount) +
    line("Requires attention", report.counterfactualOutcome.requiresAttention) +
    line("Blocked", report.counterfactualOutcome.blocked),
  );

  // Diff
  out += section(
    `Diff — ${report.diff.category} (${report.diff.detailsCount} change(s))`,
    report.diff.details.length === 0
      ? "    No changes detected.\n"
      : report.diff.details.map(
          (d) => `    [${d.category}] ${d.field}: ${renderValue(d.originalValue)} → ${renderValue(d.counterfactualValue)}\n`,
        ).join(""),
  );

  // Risk delta
  out += section(
    "Risk Delta",
    line("Original risk", report.riskDelta.originalRisk) +
    line("Counterfactual risk", report.riskDelta.counterfactualRisk) +
    line("Direction", report.riskDelta.direction),
  );

  // Changed signals
  const readinessChanged = report.diff.details.filter(
    (d) => d.category === "readiness_changed" || d.category === "evidence_gap_changed",
  );
  const handoffChanged = report.diff.details.filter((d) => d.category === "handoff_quality_changed");
  const riskChanged = report.diff.details.filter((d) => d.category === "closure_risk_changed");

  if (readinessChanged.length > 0) {
    out += section(
      "Changed Readiness Signals",
      readinessChanged.map(
        (d) => `    ${d.field}: ${renderValue(d.originalValue)} → ${renderValue(d.counterfactualValue)}\n`,
      ).join(""),
    );
  }
  if (handoffChanged.length > 0) {
    out += section(
      "Changed Handoff Quality Signals",
      handoffChanged.map(
        (d) => `    ${d.field}: ${renderValue(d.originalValue)} → ${renderValue(d.counterfactualValue)}\n`,
      ).join(""),
    );
  }
  if (riskChanged.length > 0) {
    out += section(
      "Changed Closure Risk Signals",
      riskChanged.map(
        (d) => `    ${d.field}: ${renderValue(d.originalValue)} → ${renderValue(d.counterfactualValue)}\n`,
      ).join(""),
    );
  }

  // Candidate lessons
  if (report.candidateLessons.length > 0) {
    out += section(
      "Candidate Lessons",
      report.candidateLessons.map(
        (l) =>
          `  - [${l.appliesTo}] (${l.confidence}) ${l.summary}\n` +
          `    Lesson ID: ${l.lessonId}\n` +
          `    Requires human review: ${l.requiresHumanReview ? "yes" : "no"}\n`,
      ).join(""),
    );
  } else {
    out += section("Candidate Lessons", "    No candidate lessons generated.\n");
  }

  // Footer
  out += `\n${REPLAY_END}\n`;
  out += `---\n${FOOTER}\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Build a structured replay report from a counterfactual replay outcome.
 *
 * @param outcome - The counterfactual replay outcome (never mutated).
 * @returns A structured report with text and JSON output support.
 */
export function buildReplayReport(
  outcome: CounterfactualReplayOutcome,
): ReplayReport {
  const report: ReplayReport = {
    replayId: outcome.replayId,
    sourceLifecycleId: outcome.sourceLifecycleId,
    scenarioName: outcome.scenarioId,
    sourceRecords: {
      approvals: 0,
      lifecycleTraces: 0,
      readinessProjections: outcome.originalOutcome.readinessLevel !== null ? 1 : 0,
      handoffs: 0,
      closureReviews: outcome.originalOutcome.closureDecision !== null ? 1 : 0,
      closureIntelligence: outcome.originalOutcome.qualitySignalCount,
    },
    originalOutcome: {
      readinessLevel: outcome.originalOutcome.readinessLevel,
      evidenceCompleteness: outcome.originalOutcome.evidenceCompleteness,
      handoffReadiness: outcome.originalOutcome.handoffReadiness,
      closureDecision: outcome.originalOutcome.closureDecision,
      closureRiskLevel: outcome.originalOutcome.closureRiskLevel,
      qualitySignalCount: outcome.originalOutcome.qualitySignalCount,
      requiresAttention: outcome.originalOutcome.requiresAttention,
    },
    counterfactualOutcome: {
      readinessLevel: outcome.counterfactualOutcome.readinessLevel,
      evidenceCompleteness: outcome.counterfactualOutcome.evidenceCompleteness,
      handoffReadiness: outcome.counterfactualOutcome.handoffReadiness,
      closureDecision: outcome.counterfactualOutcome.closureDecision,
      closureRiskLevel: outcome.counterfactualOutcome.closureRiskLevel,
      qualitySignalCount: outcome.counterfactualOutcome.qualitySignalCount,
      requiresAttention: outcome.counterfactualOutcome.requiresAttention,
      blocked: outcome.counterfactualOutcome.blocked,
      blockedReasons: outcome.counterfactualOutcome.blockedReasons,
    },
    diff: {
      category: outcome.diff.category,
      detailsCount: outcome.diff.details.length,
      details: outcome.diff.details.map((d) => ({
        category: d.category,
        field: d.field,
        originalValue: d.originalValue,
        counterfactualValue: d.counterfactualValue,
      })),
    },
    riskDelta: {
      originalRisk: outcome.riskDelta.originalRisk,
      counterfactualRisk: outcome.riskDelta.counterfactualRisk,
      direction: outcome.riskDelta.direction,
    },
    candidateLessons: outcome.candidateLessons.map((l) => ({
      lessonId: l.lessonId,
      summary: l.summary,
      basis: l.basis,
      confidence: l.confidence,
      appliesTo: l.appliesTo,
      requiresHumanReview: l.requiresHumanReview,
    })),
    footer: FOOTER,
  };

  return report;
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

/**
 * Render a report as formatted text with P23 delimiters and boundary footer.
 */
export function renderReportText(report: ReplayReport): string {
  return renderText(report);
}

/**
 * Render a report as a JSON-compatible object (same shape as ReplayReport).
 * The caller can JSON.stringify() the result.
 */
export function renderReportJson(report: ReplayReport): ReplayReport {
  return report;
}

/**
 * Build and render a report in one call.
 *
 * @param outcome - Counterfactual replay outcome.
 * @param format  - Output format: "text" (default) or "json".
 * @returns Formatted report string.
 */
export function formatReplayReport(
  outcome: CounterfactualReplayOutcome,
  format: "text" | "json" = "text",
): string {
  const report = buildReplayReport(outcome);

  if (format === "json") {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderReportText(report);
}
