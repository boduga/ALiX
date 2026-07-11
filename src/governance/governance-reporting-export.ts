/**
 * P29.3 — Compliance Package Export (renderComplianceJson / renderComplianceText).
 *
 * Pure-render functions — no I/O, no side effects, no store access.
 *
 * @module
 */

import type { CompliancePackage } from "./governance-reporting-types.js";

// ---------------------------------------------------------------------------
// ANSI helpers (terminal-safe, no store interaction)
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BAR = "═".repeat(63);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a CompliancePackage as formatted JSON.
 *
 * Uses JSON.stringify with 2-space indent and trailing newline.
 * Pure function — no I/O, no side effects.
 */
export function renderComplianceJson(pkg: CompliancePackage): string {
  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Render a CompliancePackage as structured human-readable text.
 *
 * Includes inventory counts, per-section summaries, correlation analytics,
 * key explanations, phase metadata, and boundary flags.
 * Pure function — no I/O, no side effects.
 */
export function renderComplianceText(pkg: CompliancePackage): string {
  const lines: string[] = [];

  // -----------------------------------------------------------------------
  // Header
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Compliance Package${RESET}`);
  lines.push(`Package ID: ${pkg.packageId}`);
  lines.push(`Generated:  ${pkg.generatedAt}`);
  lines.push(`Window:     ${pkg.windowStart} → ${pkg.windowEnd}`);
  lines.push(BAR);

  // -----------------------------------------------------------------------
  // Inventory
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Inventory${RESET}`);
  lines.push(`  Signals:     ${pkg.totalSignals}`);
  lines.push(`  Candidates:  ${pkg.totalCandidates}`);
  lines.push(`  Outcomes:    ${pkg.totalOutcomes}`);
  lines.push(`  Traces:      ${pkg.totalTraces}`);
  lines.push("");

  // -----------------------------------------------------------------------
  // Phases Included
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Phases Included${RESET}`);
  if (pkg.phasesIncluded.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const phase of pkg.phasesIncluded) {
      lines.push(`  ${phase}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Signal Summary
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Signal Summary (${pkg.signalSummary.length})${RESET}`);
  if (pkg.signalSummary.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const s of pkg.signalSummary) {
      lines.push(`  [${s.severity.toUpperCase()}] ${s.kind} (${s.signalId})`);
      lines.push(`    Direction: ${s.direction} | Window: ${s.windowStart} → ${s.windowEnd}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Candidate Summary
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Candidate Summary (${pkg.candidateSummary.length})${RESET}`);
  if (pkg.candidateSummary.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const c of pkg.candidateSummary) {
      lines.push(`  ${c.status} — ${c.title} (${c.candidateId})`);
      lines.push(`    Signal: ${c.signalKind} [${c.signalSeverity}] | Has outcome: ${c.hasOutcome}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Outcome Summary
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Outcome Summary (${pkg.outcomeSummary.length})${RESET}`);
  if (pkg.outcomeSummary.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const o of pkg.outcomeSummary) {
      lines.push(`  ${o.outcomeType} (${o.outcomeId})`);
      lines.push(`    Candidate: ${o.candidateId} | By: ${o.recordedBy}`);
      lines.push(`    Rationale: ${o.rationale}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Trace Summary
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Trace Summary (${pkg.traceSummary.length})${RESET}`);
  if (pkg.traceSummary.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const t of pkg.traceSummary) {
      lines.push(`  ${t.signalKind} → ${t.outcomeType} (${t.timeToOutcomeDays.toFixed(1)} days)`);
      lines.push(`    Outcome: ${t.outcomeId} | Candidate: ${t.candidateId}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Execution Evidence
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Execution Evidence${RESET}`);
  lines.push(`  Records:    ${pkg.executionEvidenceCount}`);
  lines.push(`  Outcomes:   ${pkg.executionOutcomes.success} success, ${pkg.executionOutcomes.failed} failed, ${pkg.executionOutcomes.partial} partial`);
  lines.push("");

  // -----------------------------------------------------------------------
  // Correlation Analytics
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Correlation Analytics${RESET}`);
  const ca = pkg.correlationAnalytics;
  lines.push(
    `  Coverage: ${ca.evidenceCoverage.withOutcome}/${ca.evidenceCoverage.totalSignals}` +
    ` (${(ca.evidenceCoverage.coverageRate * 100).toFixed(1)}%)`,
  );
  if (ca.signalToOutcomeCorrelations.length === 0) {
    lines.push(`  ${DIM}(no correlations)${RESET}`);
  } else {
    for (const corr of ca.signalToOutcomeCorrelations) {
      lines.push(
        `  ${corr.signalKind} → ${corr.outcomeType}:` +
        ` strength=${corr.correlationStrength.toFixed(2)} (n=${corr.sampleSize})`,
      );
    }
  }
  if (ca.commonPatterns.length > 0) {
    lines.push(`  Patterns:`);
    for (const pat of ca.commonPatterns) {
      lines.push(`    • ${pat}`);
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Key Explanations
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Key Explanations (${pkg.keyExplanations.length})${RESET}`);
  if (pkg.keyExplanations.length === 0) {
    lines.push(`  ${DIM}(none)${RESET}`);
  } else {
    for (const e of pkg.keyExplanations) {
      lines.push(
        `  [${e.type}] ${e.description} (conf: ${e.confidence.toFixed(2)})`,
      );
      if (e.relatedIds.length > 0) {
        lines.push(`    Related: ${e.relatedIds.join(", ")}`);
      }
    }
  }
  lines.push("");

  // -----------------------------------------------------------------------
  // Boundary Flags
  // -----------------------------------------------------------------------
  lines.push(`${BOLD}Boundary Flags${RESET}`);
  lines.push(`  Read-only:        ${pkg.readOnly}`);
  lines.push(`  No policy mut:    ${pkg.noPolicyMutation}`);
  lines.push(`  No threshold chg: ${pkg.noThresholdChange}`);
  lines.push(`  No auto-adopt:    ${pkg.noAutoAdoption}`);
  lines.push(`  No ranking:       ${pkg.noRanking}`);

  return lines.join("\n") + "\n";
}
