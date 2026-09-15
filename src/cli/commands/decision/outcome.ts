/**
 * P6.0a — decision CLI command.
 *
 * Provides:
 * - `alix decision context <proposal-id>` — render DecisionContext as formatted terminal output
 * - `alix decision context <proposal-id> --json` — output DecisionContext as JSON
 * - `alix decision risk <proposal-id>` — render RiskScore (P6.0b)
 * - `alix decision recommend <proposal-id>` — render ApprovalRecommendation (P6.1)
 * - `alix decision queue` — render prioritized operator queue (P6.2)
 * - `alix decision brief` — render strategic brief (P6.3)
 * - `alix decision status` — render pipeline health report (P6.6a)
 * - `alix decision review <proposal-id>` — live governance lens review (P6.5b)
 * - `alix decision outcome record <subject-id>` — record a decision outcome (P7a)
 * - `alix decision outcome show <subject-id>` — show recorded outcomes (P7a)
 * - `alix decision outcome report [--window N] [--json]` — accuracy report (P7b)
 *
 * @module
 */
import { join } from "node:path";
import "../../../adaptation/strategic-brief-types.js";
import { OutcomeStore } from "../../../adaptation/outcome-store.js";
import type { OutcomeRecord, OutcomeValue } from "../../../adaptation/outcome-types.js";
import { ApprovalRecommendationStore } from "../../../adaptation/approval-recommendation-store.js";
import type { ApprovalRecommendation } from "../../../adaptation/recommendation-types.js";
import { GovernanceReviewStore } from "../../../adaptation/governance-review-store.js";
import { RecommendationAccuracyBuilder } from "../../../adaptation/recommendation-accuracy-builder.js";
import { LensCalibrationBuilder } from "../../../adaptation/lens-calibration-builder.js";
import { buildLensObservations } from "../../../learning/governance-lens-observation-builder.js";
import "../../../adaptation/execution-intent-types.js";
import { OUTCOMES_DIR } from "./shared.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

export const VALID_OUTCOMES: OutcomeValue[] = [
  "success",
  "partial_success",
  "neutral",
  "failure",
  "unknown",
];

export async function runOutcome(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  switch (subcommand) {
    case "record":
      await runOutcomeRecord(rest);
      return;
    case "show":
      await runOutcomeShow(rest);
      return;
    case "report":
      await runOutcomeReport(rest);
      return;
    case "lens-calibration":
      await runOutcomeLensCalibration(rest);
      return;
    default:
      console.error(`Unknown outcome subcommand: "${subcommand}"`);
      console.error(
        "Usage: alix decision outcome record <subject-id> --outcome <value> [--recommendation <id>] [--action <taken>] [--json] | show <subject-id> [--json] | report [--window N] [--json] | lens-calibration [--window N] [--json]",
      );
      console.error(
        `Outcome values: ${VALID_OUTCOMES.join(" | ")}`,
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runOutcomeRecord
// ---------------------------------------------------------------------------

export async function runOutcomeRecord(args: string[]): Promise<void> {
  const subjectId = args[0];
  if (!subjectId) {
    console.error(
      "Usage: alix decision outcome record <subject-id> --outcome <value> [--recommendation <id>] [--action <taken>] [--json]",
    );
    console.error(
      `Outcome values: ${VALID_OUTCOMES.join(" | ")}`,
    );
    process.exit(1);
  }

  const outcomeIdx = args.indexOf("--outcome");
  if (outcomeIdx === -1 || outcomeIdx + 1 >= args.length) {
    console.error("Error: --outcome is required");
    console.error(
      `Valid values: ${VALID_OUTCOMES.join(" | ")}`,
    );
    process.exit(1);
  }
  const outcomeValue = args[outcomeIdx + 1] as OutcomeValue;
  if (!VALID_OUTCOMES.includes(outcomeValue)) {
    console.error(
      `Error: invalid outcome "${outcomeValue}". Valid: ${VALID_OUTCOMES.join(" | ")}`,
    );
    process.exit(1);
  }

  const jsonMode = args.includes("--json");

  const recIdx = args.indexOf("--recommendation");
  const recommendationId: string | undefined =
    recIdx !== -1 && recIdx + 1 < args.length
      ? args[recIdx + 1]
      : undefined;

  const actionIdx = args.indexOf("--action");
  const actionTaken: string =
    actionIdx !== -1 && actionIdx + 1 < args.length
      ? args[actionIdx + 1]
      : "unknown";

  // P7.5p.1c — capture actual recommendation confidence, or undefined.
  // Never fake confidence: 1. Look up the recommendation in the store;
  // if not found or no recommendation given, leave confidence undefined
  // unless an explicit --recommendation-confidence override is supplied.
  let confidence: number | undefined;
  let resolvedRecommendation: ApprovalRecommendation | undefined;

  if (recommendationId) {
    try {
      const recStore = new ApprovalRecommendationStore();
      const stored = await recStore.get(recommendationId);
      if (stored) {
        confidence = stored.confidence;
        resolvedRecommendation = stored;
      }
    } catch (err) {
      console.error(
        `Warning: failed to look up recommendation ${recommendationId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // P7.5p.2c — resolve riskScoreId from --risk-score-id override OR rec.riskScoreId.
  // Never fake: missing stays undefined and serializes as absent in JSON.
  let resolvedRiskScoreId: string | undefined;
  const rsIdx = args.indexOf("--risk-score-id");
  if (rsIdx !== -1 && rsIdx + 1 < args.length) {
    resolvedRiskScoreId = args[rsIdx + 1];
  } else if (resolvedRecommendation) {
    resolvedRiskScoreId = resolvedRecommendation.riskScoreId;
  }

  // P7.5p.3c — resolve governanceReviewId from --governance-review-id override OR
  // the most recent stored GovernanceReview for THIS proposal.
  // Never fake: missing stays undefined and serializes as absent in JSON.
  // Auto-lookup MUST be queryByProposal(subjectId), never list().at(-1) — the
  // governance-boundary invariant forbids a review for a different proposal from
  // leaking into this outcome's link. Cross-proposal isolation is locked by test #7.
  let resolvedGovernanceReviewId: string | undefined;
  const grIdx = args.indexOf("--governance-review-id");
  if (grIdx !== -1 && grIdx + 1 < args.length) {
    resolvedGovernanceReviewId = args[grIdx + 1];
  } else {
    try {
      const reviewStore = new GovernanceReviewStore();
      const reviews = await reviewStore.queryByProposal(subjectId);
      if (reviews.length > 0) {
        // Most recent = last-appended for THIS proposal (append order preserved).
        resolvedGovernanceReviewId = reviews[reviews.length - 1].id;
      }
    } catch (err) {
      console.error(
        `Warning: failed to look up governance review for ${subjectId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Parse --recommendation-confidence <0-1> if given. The override wins.
  const confIdx = args.indexOf("--recommendation-confidence");
  if (confIdx !== -1 && confIdx + 1 < args.length) {
    const parsed = parseFloat(args[confIdx + 1]);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      confidence = parsed;
    } else {
      console.error(
        `Error: --recommendation-confidence must be a number between 0 and 1 (got "${args[confIdx + 1]}")`,
      );
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  const store = new OutcomeStore(join(cwd, OUTCOMES_DIR));

  const record: OutcomeRecord = {
    id: `outcome:${subjectId}:${Date.now()}`,
    subjectId,
    subjectType: "proposal",
    outcome: outcomeValue,
    generatedAt: new Date().toISOString(),
    recommendationId,
    actionTaken,
    observationWindowDays: 30,
    confidence,
    riskScoreId: resolvedRiskScoreId,
    governanceReviewId: resolvedGovernanceReviewId,
    reasons: [],
    evidenceRefs: [],
    subject: `Outcome: ${subjectId}`,
  };

  await store.append(record);

  if (jsonMode) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  const outcomeIcon =
    record.outcome === "success" ? "✅" :
    record.outcome === "partial_success" ? "⚠️" :
    record.outcome === "neutral" ? "➖" :
    record.outcome === "failure" ? "❌" :
    "❓";

  console.log(`Outcome recorded: ${record.id}`);
  console.log(`──────────────────────────────`);
  console.log(`${outcomeIcon} ${record.outcome} — ${record.subject}`);
  console.log(`   Subject:      ${record.subjectId} (${record.subjectType})`);
  if (record.recommendationId) {
    console.log(`   Recommendation: ${record.recommendationId}`);
    const confDisplay =
      record.confidence !== undefined
        ? (record.confidence * 100).toFixed(0) + "%"
        : "n/a";
    console.log(`   Recommendation confidence: ${confDisplay}`);
  }
  console.log(`   Action taken:  ${record.actionTaken}`);
  console.log(`   Observation window: ${record.observationWindowDays} days`);
}

// ---------------------------------------------------------------------------
// runOutcomeShow
// ---------------------------------------------------------------------------

export async function runOutcomeShow(args: string[]): Promise<void> {
  const subjectId = args[0];
  if (!subjectId) {
    console.error("Usage: alix decision outcome show <subject-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const store = new OutcomeStore(join(cwd, OUTCOMES_DIR));

  const records = await store.queryBySubject(subjectId);

  if (jsonMode) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log(`No outcomes recorded for ${subjectId}`);
    return;
  }

  console.log(`Outcomes for ${subjectId}: ${records.length} record(s)`);
  console.log(`═══════════════════════════════════════`);
  console.log(``);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const outcomeIcon =
      r.outcome === "success" ? "✅" :
      r.outcome === "partial_success" ? "⚠️" :
      r.outcome === "neutral" ? "➖" :
      r.outcome === "failure" ? "❌" :
      "❓";

    console.log(` ${i + 1}. ${outcomeIcon} ${r.outcome}  ${r.id}`);
    console.log(`    Date:     ${new Date(r.generatedAt).toLocaleDateString()}`);
    console.log(`    Action:   ${r.actionTaken}`);
    if (r.recommendationId) {
      console.log(`    Rec:      ${r.recommendationId}`);
    }
    console.log(`    Window:   ${r.observationWindowDays} days`);
    if (i < records.length - 1) {
      console.log(``);
    }
  }
}

// ---------------------------------------------------------------------------
// runOutcomeReport — Accuracy report (P7b)
// ---------------------------------------------------------------------------

export async function runOutcomeReport(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const cwd = process.cwd();
  const store = new OutcomeStore(join(cwd, OUTCOMES_DIR));

  // Load and window-filter records
  const records = await store.queryByWindow(windowDays);

  // Build accuracy report
  const builder = new RecommendationAccuracyBuilder();
  const report = builder.build(records, { windowDays });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Terminal renderer ──

  const dist = report.outcomeDistribution;

  console.log(`Outcome Report — Last ${report.windowDays} days`);
  console.log(`═══════════════════════════════════════`);
  console.log(`Total outcomes: ${report.totalOutcomes}`);

  // Distribution table with percentages of total
  const pct = (count: number): string => {
    if (report.totalOutcomes === 0) return "0%";
    return `${((count / report.totalOutcomes) * 100).toFixed(0)}%`;
  };

  console.log(`  success:          ${String(dist.success).padStart(2)}  (${pct(dist.success)})`);
  console.log(`  partial_success:  ${String(dist.partial_success).padStart(2)}  (${pct(dist.partial_success)})`);
  console.log(`  neutral:          ${String(dist.neutral).padStart(2)}  (${pct(dist.neutral)})`);
  console.log(`  failure:          ${String(dist.failure).padStart(2)}  (${pct(dist.failure)})`);
  console.log(`  unknown:          ${String(dist.unknown).padStart(2)}  (${pct(dist.unknown)})`);

  console.log(``);

  const acc = report.accuracy;
  if (acc.knownOutcomes === 0) {
    console.log(`Accuracy: no known outcomes to measure (all ${report.totalOutcomes} are unknown)`);
  } else {
    console.log(`Accuracy (known outcomes only, n=${acc.knownOutcomes}):`);
    console.log(`  Success rate:       ${(acc.successRate * 100).toFixed(0)}%  (${dist.success}/${acc.knownOutcomes})`);
    console.log(`  Partial success:    ${(acc.partialSuccessRate * 100).toFixed(0)}%  (${dist.partial_success}/${acc.knownOutcomes})`);
    console.log(`  Failure rate:       ${(acc.failureRate * 100).toFixed(0)}%  (${dist.failure}/${acc.knownOutcomes})`);
  }
}

// ---------------------------------------------------------------------------
// runOutcomeLensCalibration — Lens calibration report (P7c)
//
// P8.5a.2c: lens scores ARE now persisted (P7.5p.3 GovernanceReviewStore).
// This command reads live GovernanceReview × OutcomeStore data, joins by
// proposalId, derives LensObservation[] on demand, and returns a real
// LensCalibrationReport. The P8.5a.2c governance adapter writes signals to
// LearningStore via the orchestrator — this CLI path stays read-only and
// returns the calibration report itself (not signals).
// ---------------------------------------------------------------------------

export async function runOutcomeLensCalibration(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const cwd = process.cwd();
  const generatedAt = new Date().toISOString();

  // Live read: lens scores ARE persisted (P7.5p.3).
  const reviewStore = new GovernanceReviewStore();
  const outcomeStore = new OutcomeStore(join(cwd, OUTCOMES_DIR));

  // Thread `generatedAt` through so the window reads agree with the same
  // "now" the rest of this report uses. Without this, fixed-fixture test
  // data silently falls past the wall-clock 30-day cutoff as the real
  // clock advances.
  const reviews = await reviewStore.queryByWindow(windowDays, generatedAt);
  const outcomes = await outcomeStore.queryByWindow(windowDays, generatedAt);

  // Single source of truth for join + concernsRaised derivation (fix #5).
  // Shared with `GovernanceCalibrationAdapter` so the CLI's report and the
  // adapter's signals are guaranteed to agree on the same observations.
  const { observations, excludedNoOutcome } = buildLensObservations(
    reviews,
    outcomes,
  );

  const report = new LensCalibrationBuilder().build(observations, {
    windowDays,
    generatedAt,
  });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Terminal renderer — live lens calibration report.
  console.log(`Lens Calibration — Last ${windowDays} days`);
  console.log(`═══════════════════════════════════════`);
  console.log(`Reviews analyzed: ${reviews.length}`);
  console.log(`Observations (lens scores × outcomes): ${observations.length}`);
  if (excludedNoOutcome > 0) {
    console.log(`Excluded (no matching outcome): ${excludedNoOutcome}`);
  }
  console.log(``);
  console.log(`Per-lens:`);
  for (const [lens, entry] of Object.entries(report.lenses)) {
    const pv = (entry.predictiveValue * 100).toFixed(0);
    console.log(
      `  ${lens.padEnd(20)} reviews=${String(entry.reviewsAnalyzed).padStart(3)}  PV=${pv.padStart(3)}%  (${entry.calibration})`,
    );
  }
  console.log(``);
  console.log(
    `concernsRaised is inferred (1 for warning verdict, 0 otherwise) — fidelity is "low".`,
  );
  console.log(
    `P8.5a.2c orchestrator writes governance signals to LearningStore.`,
  );
}

// ---------------------------------------------------------------------------
// Intent subcommand — ExecutionIntent capture (P7.5b)
// ---------------------------------------------------------------------------
