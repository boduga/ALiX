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

import { GovernanceStore } from "../../governance/governance-store.js";
import { generateRecommendations } from "../../governance/governance-recommendation-generator.js";
import type {
  GovernanceHealthReport,
  GovernanceAssessment,
  GovernanceDriftReport,
  LensLifecycleReview,
  GovernanceIntegrityReport,
  Recommendation,
} from "../../governance/governance-types.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function colorForSeverity(severity: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return RED;
    case "medium":
      return YELLOW;
    case "low":
      return GREEN;
    default:
      return RESET;
  }
}

function colorForRecommendation(rec: string): string {
  switch (rec) {
    case "retire":
      return RED;
    case "demote":
      return YELLOW;
    case "promote":
      return GREEN;
    case "keep":
      return CYAN;
    default:
      return RESET;
  }
}

function colorForRate(rate: number): string {
  if (rate >= 80) return GREEN;
  if (rate >= 50) return YELLOW;
  return RED;
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

interface ParsedOpts {
  windowDays: number;
  jsonMode: boolean;
}

function parseFlags(args: string[]): ParsedOpts {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 90;

  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  return { windowDays, jsonMode };
}

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_SOURCES = ["health", "drift", "lens-review", "integrity"] as const;

interface ParsedRecommendOpts {
  windowDays: number;
  jsonMode: boolean;
  priority: (typeof VALID_PRIORITIES)[number] | null;
  source: (typeof VALID_SOURCES)[number] | null;
}

function parseRecommendFlags(args: string[]): ParsedRecommendOpts {
  const jsonMode = args.includes("--json");

  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  let priority: ParsedRecommendOpts["priority"] = null;
  const priorityIdx = args.indexOf("--priority");
  if (priorityIdx !== -1) {
    if (priorityIdx + 1 >= args.length) {
      console.error("Error: --priority requires a value (low|medium|high|critical)");
      process.exit(1);
    }
    const v = args[priorityIdx + 1];
    if (!(VALID_PRIORITIES as readonly string[]).includes(v)) {
      console.error(
        `Error: --priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      );
      process.exit(1);
    }
    priority = v as ParsedRecommendOpts["priority"];
  }

  let source: ParsedRecommendOpts["source"] = null;
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx !== -1) {
    if (sourceIdx + 1 >= args.length) {
      console.error("Error: --source requires a value (health|drift|lens-review|integrity)");
      process.exit(1);
    }
    const v = args[sourceIdx + 1];
    if (!(VALID_SOURCES as readonly string[]).includes(v)) {
      console.error(
        `Error: --source must be one of: ${VALID_SOURCES.join(", ")}`,
      );
      process.exit(1);
    }
    source = v as ParsedRecommendOpts["source"];
  }

  return { windowDays, jsonMode, priority, source };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleGovernanceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "health":
      return runHealth(rest);
    case "drift":
      return runDrift(rest);
    case "lens-review":
      return runLensReview(rest);
    case "integrity":
      return runIntegrity(rest);
    case "recommend":
      return runRecommend(rest);
    case "propose": {
      const recommendationId = rest[0];
      if (!recommendationId) {
        console.error("Usage: alix governance propose <recommendation-id>");
        process.exit(2);
      }
      const json = rest.includes("--json");
      const { createGovernanceProposal } = await import("../../governance/governance-proposal-generator.js");
      const result = await createGovernanceProposal({ recommendationId });
      if (!result.ok) {
        if (json) {
          console.log(JSON.stringify({ ok: false, reason: result.reason }));
        } else {
          console.error(result.reason);
        }
        process.exit(1);
      }
      if (json) {
        console.log(JSON.stringify({ ok: true, proposalId: result.proposalId }));
      } else {
        console.log(`Governance proposal created.`);
        console.log(`  Proposal:        ${result.proposalId}`);
        console.log(`  Recommendation:  ${recommendationId}`);
        console.log(``);
        console.log(`Review and approve:`);
        console.log(`  alix governance explain ${result.proposalId}`);
        console.log(`  alix adaptation approve ${result.proposalId}`);
      }
      return;
    }
    default:
      console.error(
        `Unknown governance subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix governance {health|drift|lens-review|integrity|recommend|propose} [--window <days>] [--json]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runHealth — `alix governance health [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runHealth(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  // Dynamic import the builders (as specified by the plan)
  const { buildGovernanceHealth } = await import(
    "../../governance/governance-health-builder.js"
  );
  const { buildGovernanceAssessment } = await import(
    "../../governance/governance-assessment.js"
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

async function runDrift(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { detectGovernanceDrift } = await import(
    "../../governance/governance-drift-detector.js"
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

async function runLensReview(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { reviewLenses } = await import(
    "../../governance/governance-lens-review.js"
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

async function runIntegrity(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { buildGovernanceIntegrity } = await import(
    "../../governance/governance-integrity.js"
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

async function runRecommend(args: string[]): Promise<void> {
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

// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

const BAR = "═══════════════════════════════════════════════════════════════";

// -- Health ------------------------------------------------------------------

function renderHealth(report: GovernanceHealthReport): void {
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

function renderAssessment(assessment: GovernanceAssessment): void {
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

function renderDrift(report: GovernanceDriftReport): void {
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

function renderLensReview(review: LensLifecycleReview): void {
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

function renderIntegrity(report: GovernanceIntegrityReport): void {
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

function colorForPriority(priority: string): string {
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

function renderRecommendations(
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
