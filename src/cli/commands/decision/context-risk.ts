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
import { RiskScoreBuilder } from "../../../adaptation/risk-score-builder.js";
import { RecommendationEngine } from "../../../adaptation/recommendation-engine.js";
import "../../../adaptation/strategic-brief-types.js";
import { ApprovalRecommendationStore } from "../../../adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../../../adaptation/risk-score-store.js";
import "../../../adaptation/execution-intent-types.js";
import { buildDecisionInfrastructure } from "./shared.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

export async function runContext(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision context <proposal-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);

  const ctx = await infra.contextBuilder.build(id);

  if (jsonMode) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  // Terminal renderer
  const statusIcon =
    ctx.contextStatus === "complete_context" ? "✅" :
    ctx.contextStatus === "partial_context" ? "⚠️" :
    ctx.contextStatus === "stale_context" ? "🕰️" :
    "❌";

  console.log(`Decision Context: ${ctx.proposalId}`);
  console.log(`──────────────────────────────────────`);
  console.log(`${statusIcon} Status: ${ctx.contextStatus}`);
  console.log(`   Confidence: ${(ctx.confidence * 100).toFixed(0)}% (evidence completeness)`);
  console.log(``);
  console.log(`Proposal: ${ctx.proposalAction} (${ctx.proposalStatus})`);
  console.log(`Created: ${new Date(ctx.createdAt).toLocaleDateString()} (${ctx.ageDays} day(s) ago)`);
  console.log(``);
  console.log(`Lineage: ${ctx.lineageCompleteness}${ctx.lineage ? ` — ${ctx.lineage.nodes.length} lifecycle stages traced` : ""}`);
  console.log(``);
  console.log(`Effectiveness trend (${ctx.effectivenessTrend.actionType || "n/a"}):`);
  console.log(`   Keep rate: ${(ctx.effectivenessTrend.keepRate * 100).toFixed(0)}%  (n=${ctx.effectivenessTrend.sampleSize})`);
  console.log(`   Revert rate: ${(ctx.effectivenessTrend.revertRate * 100).toFixed(0)}%`);
  if (ctx.similarProposals.length > 0) {
    console.log(``);
    console.log(`Similar proposals: ${ctx.similarProposals.length}`);
    for (const sp of ctx.similarProposals) {
      console.log(`   · ${sp.proposalId} — ${sp.outcome} (${(sp.confidence * 100).toFixed(0)}%)`);
    }
  }
  console.log(``);
  console.log(`Sources:`);
  for (const src of ctx.sourceArtifacts) {
    const icon =
      src.type === "proposal" ? "📄" :
      src.type === "lineage" ? "🔗" :
      src.type === "effectiveness" ? "📊" :
      src.type === "intelligence" ? "🧠" :
      "📌";
    console.log(`   ${icon} ${src.type}: ${src.id}`);
  }
  console.log(``);
  console.log(`Data freshness: ${ctx.dataFreshness.newestArtifactAgeDays} day(s) (newest) / ${ctx.dataFreshness.oldestArtifactAgeDays} day(s) (oldest)`);

  if (ctx.warnings && ctx.warnings.length > 0) {
    console.log(``);
    console.log(`⚠️ Warnings (${ctx.warnings.length}):`);
    for (const w of ctx.warnings) {
      console.log(`   · ${w.message} (${w.severity})`);
    }
  }

  if (ctx.reasons.length > 0) {
    console.log(``);
    console.log(`Why this confidence:`);
    for (const r of ctx.reasons) {
      console.log(`   · ${r}`);
    }
  }
}

// ---------------------------------------------------------------------------
// runRisk
// ---------------------------------------------------------------------------

export async function runRisk(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision risk <proposal-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();

  const ctx = await infra.contextBuilder.build(id);
  const risk = riskBuilder.build(ctx);

  if (jsonMode) {
    console.log(JSON.stringify(risk, null, 2));
    return;
  }

  // Terminal renderer
  const riskIcon =
    risk.outcome === "low" ? "🟢" :
    risk.outcome === "medium" ? "🟡" :
    risk.outcome === "high" ? "🟠" :
    "🔴";

  console.log(`Risk Score: ${risk.id}`);
  console.log(`────────────────────────────────`);
  console.log(`${riskIcon} Overall risk: ${risk.outcome} (${(risk.overallRisk * 100).toFixed(0)}%)`);
  console.log(`   Confidence: ${(risk.confidence * 100).toFixed(0)}%`);
  console.log(``);
  console.log(`Dimensions:`);
  for (const r of risk.risks) {
    const dimIcon =
      r.score < 0.3 ? "🟢" :
      r.score < 0.6 ? "🟡" :
      r.score < 0.85 ? "🟠" :
      "🔴";
    console.log(`   ${dimIcon} ${r.dimension}: ${(r.score * 100).toFixed(0)}%`);
    for (const reason of r.reasons) {
      console.log(`       · ${reason}`);
    }
  }
  console.log(``);
  console.log(`Sources: ${risk.sourceArtifacts.length} artifact(s) used`);
}

// ---------------------------------------------------------------------------
// runRecommend
// ---------------------------------------------------------------------------

export async function runRecommend(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision recommend <proposal-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();

  const ctx = await infra.contextBuilder.build(id);
  const risk = riskBuilder.build(ctx);

  // P7.5p.2b — persist the RiskScore so P8.2 risk calibration can join RiskScore × OutcomeRecord.
  // Best-effort: log-and-continue on failure; never block the recommendation output.
  await new RiskScoreStore().append(risk).catch((err) =>
    console.warn(
      `[alix] warning: failed to persist risk score ${risk.id}:`,
      err instanceof Error ? err.message : String(err),
    ),
  );

  const recommendation = recEngine.recommend(ctx, risk);

  // P7.5p.1b — persist the recommendation so the outcome CLI can read its confidence back
  try {
    const recStore = new ApprovalRecommendationStore();
    await recStore.append(recommendation);
  } catch (err) {
    console.error(
      `Warning: failed to persist recommendation ${recommendation.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (jsonMode) {
    console.log(JSON.stringify(recommendation, null, 2));
    return;
  }

  const recIcon =
    recommendation.recommendation === "approve" ? "✅" :
    recommendation.recommendation === "reject" ? "❌" :
    recommendation.recommendation === "defer" ? "⏸️" :
    "🔍";

  console.log(`Recommendation: ${recommendation.proposalId}`);
  console.log(`────────────────────────────────────`);
  console.log(`${recIcon} ${recommendation.recommendation.charAt(0).toUpperCase() + recommendation.recommendation.slice(1)} (confidence: ${(recommendation.confidence * 100).toFixed(0)}%)`);
  console.log(``);
  console.log(`Context confidence: ${(ctx.confidence * 100).toFixed(0)}% (evidence completeness)`);
  console.log(`Risk score:        ${risk.overallRisk.toFixed(2)}  (${risk.outcome})`);
  console.log(``);
  console.log(`Reasons:`);
  for (const reason of recommendation.reasons) {
    console.log(` · ${reason}`);
  }
  if (recommendation.warnings && recommendation.warnings.length > 0) {
    console.log(``);
    console.log(`Warnings:`);
    for (const w of recommendation.warnings) {
      const icon = w.severity === "critical" ? "🔴" : w.severity === "warning" ? "🟡" : "🔵";
      console.log(` ${icon} ${w.message}`);
    }
  }
  console.log(``);
  console.log(`Sources: ${recommendation.sourceArtifacts.length} artifact(s)`);
}

// ---------------------------------------------------------------------------
// runQueue — Operator Queue
// ---------------------------------------------------------------------------

/**
 * Build and render the prioritized operator queue.
 * Computed fresh each run — no persistence.
 */
