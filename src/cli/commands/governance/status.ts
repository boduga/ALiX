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

import { join } from "node:path";
import "node:crypto";
import { GovernanceStore } from "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import { generateRecommendations } from "../../../governance/governance-recommendation-generator.js";
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
  GovernanceHealthReport,
  GovernanceAssessment,
  GovernanceDriftReport,
  LensLifecycleReview,
  GovernanceIntegrityReport,
  Recommendation,
} from "../../../governance/governance-types.js";
import { BAR } from "./analytics.js";
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW, colorForRate, colorForRecommendation, colorForSeverity, parseFlags, parseRecommendFlags } from "./shared.js";

// ---------------------------------------------------------------------------
// runStatus — `alix governance status [--json]`
// ---------------------------------------------------------------------------

export async function runStatus(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const govDir = join(cwd, ".alix", "governance");

  // Import stores
  const { FileLedgerStore } = await import(
    "../../../governance/run-ledger.js"
  );
  const { FileFailureMemoryStore } = await import(
    "../../../governance/failure-memory.js"
  );

  const ledgerStore = new FileLedgerStore(govDir);
  const failureStore = new FileFailureMemoryStore(govDir);

  const allRuns = await ledgerStore.list();
  const allFailures = await failureStore.list();

  const pendingApprovals = allRuns.filter((r) =>
    r.outcome === "completed" && r.approvals.some((g) => g.status === "pending"),
  ).length;
  const deniedRuns = allRuns.filter((r) => r.outcome === "denied").length;
  const failedRuns = allRuns.filter((r) => r.outcome === "failed").length;

  if (jsonMode) {
    console.log(JSON.stringify({
      components: {
        policyAdapter: true,
        riskScoring: true,
        approvalWorkflow: true,
        runLedger: true,
        failureMemory: true,
      },
      counts: {
        recentRuns: allRuns.length,
        recentFailures: allFailures.length,
        pendingApprovals,
        deniedRuns,
        failedRuns,
      },
    }, null, 2));
    return;
  }

  const available = GREEN + "available" + RESET;

  console.log(BOLD + "Governance Status" + RESET);
  console.log(BAR);
  console.log(`  ${GREEN}●${RESET} policy adapter     ${available}`);
  console.log(`  ${GREEN}●${RESET} risk scoring        ${available}`);
  console.log(`  ${GREEN}●${RESET} approval workflow   ${available}`);
  console.log(`  ${GREEN}●${RESET} run ledger          ${available}`);
  console.log(`  ${GREEN}●${RESET} failure memory      ${available}`);
  console.log("");
  console.log(BOLD + "Recent Activity" + RESET);
  console.log(`  runs:     ${allRuns.length}`);
  console.log(`  failures: ${allFailures.length}`);
  console.log(`  pending approvals: ${pendingApprovals > 0 ? YELLOW + pendingApprovals + RESET : pendingApprovals}`);
  console.log(`  denied:   ${deniedRuns > 0 ? RED + deniedRuns + RESET : deniedRuns}`);
  console.log(`  failed:   ${failedRuns > 0 ? RED + failedRuns + RESET : failedRuns}`);
}


// ---------------------------------------------------------------------------
// runHealth — `alix governance health [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runHealth(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  // Dynamic import the builders (as specified by the plan)
  const { buildGovernanceHealth } = await import(
    "../../../governance/governance-health-builder.js"
  );
  const { buildGovernanceAssessment } = await import(
    "../../../governance/governance-assessment.js"
  );

  const report = await buildGovernanceHealth({ cwd, windowDays });
  await store.append("health", report);

  const assessment = buildGovernanceAssessment(report);
  await store.append("assessment", assessment);

  if (jsonMode) {
    console.log(
      JSON.stringify({ health: report, assessment }, null, 2),
    );
    return;
  }

  renderHealth(report);
  console.log("");
  renderAssessment(assessment);
}


// ---------------------------------------------------------------------------
// runDrift — `alix governance drift [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runDrift(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { detectGovernanceDrift } = await import(
    "../../../governance/governance-drift-detector.js"
  );

  const report = await detectGovernanceDrift({ cwd, windowDays });
  await store.append("drift", report);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderDrift(report);
}


// ---------------------------------------------------------------------------
// runLensReview — `alix governance lens-review [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runLensReview(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { reviewLenses } = await import(
    "../../../governance/governance-lens-review.js"
  );

  const review = await reviewLenses({ cwd, windowDays });
  await store.append("lensReviews", review);

  if (jsonMode) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  renderLensReview(review);
}


// ---------------------------------------------------------------------------
// runIntegrity — `alix governance integrity [--window <days>] [--json]`
// ---------------------------------------------------------------------------

export async function runIntegrity(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { buildGovernanceIntegrity } = await import(
    "../../../governance/governance-integrity.js"
  );

  const report = await buildGovernanceIntegrity({ cwd, windowDays });
  await store.append("integrity", report);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderIntegrity(report);
}


// ---------------------------------------------------------------------------
// runRecommend — `alix governance recommend [--window <days>] [--json]
//                            [--priority <level>] [--source <source>]`
// ---------------------------------------------------------------------------

export async function runRecommend(args: string[]): Promise<void> {
  const { windowDays, jsonMode, priority, source } = parseRecommendFlags(args);
  const cwd = process.cwd();
  const generatedAt = new Date().toISOString();

  const artifact = await generateRecommendations({ cwd, windowDays, generatedAt });

  let recs: Recommendation[] = artifact.recommendations;
  if (priority) {
    recs = recs.filter((r) => r.priority === priority);
  }
  if (source) {
    recs = recs.filter((r) => r.source === source);
  }

  if (jsonMode) {
    console.log(JSON.stringify(recs, null, 2));
    return;
  }

  renderRecommendations(artifact.id, recs, generatedAt);
}


// -- Health ------------------------------------------------------------------

export function renderHealth(report: GovernanceHealthReport): void {
  console.log(BOLD + "Governance Health" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(BAR);
  console.log(`Total Reviews:    ${report.totalReviews}`);
  console.log(`Total Proposals:  ${report.totalProposals}`);
  console.log(`Policy Coverage:  ${report.policyCoverage}%`);
  console.log("");

  console.log(BOLD + "Source Metrics" + RESET);
  console.log(
    `  Dashboard Integrity:    ${report.sourceMetrics.dashboardIntegrityScore ?? "n/a"}`,
  );
  console.log(
    `  Explanation Completeness: ${report.sourceMetrics.explanationCompleteness ?? "n/a"}%`,
  );
  console.log(
    `  Evidence Chain Usage:   ${report.sourceMetrics.evidenceChainUsage ?? "n/a"}%`,
  );
  console.log(
    `  Incomplete Chain Layers: ${report.sourceMetrics.incompleteChainLayers}`,
  );

  const lenses = Object.entries(report.lensEffectiveness);
  if (lenses.length > 0) {
    console.log("");
    console.log(BOLD + "Lens Effectiveness" + RESET);
    for (const [lens, value] of lenses) {
      console.log(`  ${lens}: ${value}%`);
    }
  }
}


// -- Assessment ---------------------------------------------------------------

export function renderAssessment(assessment: GovernanceAssessment): void {
  console.log(BOLD + "Governance Assessment" + RESET);
  console.log(`Generated: ${assessment.generatedAt}`);
  console.log(BAR);
  console.log(
    `Governance Confidence: ${(assessment.governanceConfidence * 100).toFixed(1)}%`,
  );
  console.log(
    `Unresolved Issues:    ${assessment.unresolvedGovernanceIssues}`,
  );
  console.log("");
  console.log(BOLD + "Notes" + RESET);
  for (const note of assessment.assessmentNotes) {
    console.log(`  ${note}`);
  }
}


// -- Drift -------------------------------------------------------------------

export function renderDrift(report: GovernanceDriftReport): void {
  console.log(BOLD + "Governance Drift" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Findings:  ${report.findings.length}`);
  console.log(BAR);

  if (report.findings.length === 0) {
    console.log(GREEN + "  No drift detected." + RESET);
    return;
  }

  for (const finding of report.findings) {
    const color = colorForSeverity(finding.severity);
    console.log("");
    console.log(
      color + BOLD + `  [${finding.severity.toUpperCase()}]` + RESET +
        ` ${finding.driftType}`,
    );
    console.log(`  ${finding.description}`);
    console.log(DIM + `  Confidence: ${finding.confidence}` + RESET);
    console.log(`  Recommendation: ${finding.recommendation}`);
  }
}


// -- Lens Review -------------------------------------------------------------

export function renderLensReview(review: LensLifecycleReview): void {
  console.log(BOLD + "Lens Lifecycle Review" + RESET);
  console.log(`Generated: ${review.generatedAt}`);
  console.log(`Lenses Reviewed: ${review.lensReviews.length}`);
  console.log(BAR);

  if (review.lensReviews.length === 0) {
    console.log(DIM + "  No calibration data available for any lens." + RESET);
    return;
  }

  for (const lr of review.lensReviews) {
    const recColor = colorForRecommendation(lr.recommendation);
    console.log("");
    console.log(BOLD + `  ${lr.lens}` + RESET);
    console.log(`    Predictive Value:  ${lr.predictiveValue}`);
    console.log(`    Reviews Analyzed:  ${lr.reviewsAnalyzed}`);
    console.log(`    False Alarms:      ${lr.falseAlarms}`);
    console.log(`    Missed Failures:   ${lr.missedFailures}`);
    console.log(
      `    Recommendation:    ` +
        recColor + lr.recommendation.toUpperCase() + RESET,
    );
    console.log(`    Reason: ${lr.reason}`);
  }
}


// -- Integrity ---------------------------------------------------------------

export function renderIntegrity(report: GovernanceIntegrityReport): void {
  const m = report.metrics;
  console.log(BOLD + "Governance Integrity" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(BAR);

  console.log(`Total Reviews:              ${m.totalReviews}`);
  console.log("");
  console.log(`Reviews with Provenance:    ${m.reviewsWithProvenance}`);
  console.log(`Reviews with Explanations:  ${m.reviewsWithExplanations}`);
  console.log(`Reviews Linked to Outcomes: ${m.reviewsLinkedToOutcomes}`);
  console.log(`Untraceable Findings:       ${m.untraceableFindings}`);
  console.log("");
  console.log(BOLD + "Rates" + RESET);
  console.log(
    `  Provenance Rate:     ` +
      colorForRate(m.provenanceRate) + `${m.provenanceRate}%` + RESET,
  );
  console.log(
    `  Explanation Rate:    ` +
      colorForRate(m.explanationRate) + `${m.explanationRate}%` + RESET,
  );
  console.log(
    `  Outcome Link Rate:   ` +
      colorForRate(m.outcomeLinkRate) + `${m.outcomeLinkRate}%` + RESET,
  );
}


// -- Recommendations --------------------------------------------------------

export function colorForPriority(priority: string): string {
  switch (priority) {
    case "critical":
    case "high":
      return RED;
    case "medium":
      return YELLOW;
    case "low":
      return GREEN;
    default:
      return DIM;
  }
}


export function renderRecommendations(
  artifactId: string,
  recs: Recommendation[],
  generatedAt: string,
): void {
  console.log(BOLD + "Governance Recommendations" + RESET);
  console.log(`Artifact ID: ${artifactId}`);
  console.log(`Generated:   ${generatedAt}`);
  console.log(`Total:       ${recs.length}`);
  console.log(BAR);

  if (recs.length === 0) {
    console.log(
      DIM +
        "No recommendations in this window (or all filtered out)." +
        RESET,
    );
    return;
  }

  for (const r of recs) {
    console.log(
      colorForPriority(r.priority) +
        `[${r.priority.toUpperCase()}]` +
        RESET +
        ` (${r.source}/${r.category}) ${r.title}`,
    );
    console.log(`  ${DIM}${r.description}${RESET}`);
    console.log(`  ${CYAN}→ ${r.operatorGuidance}${RESET}`);
    if (r.expectedBenefit) {
      console.log(`  ${GREEN}Expected benefit:${RESET} ${r.expectedBenefit}`);
    }
    console.log("");
  }
}
