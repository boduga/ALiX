/**
 * P6.0a — decision CLI command.
 *
 * Provides:
 * - `alix decision context <proposal-id>` — render DecisionContext as formatted terminal output
 * - `alix decision context <proposal-id> --json` — output DecisionContext as JSON
 *
 * Subcommands beyond `context` (risk, recommend, queue, brief) are added
 * in later P6 slices.
 *
 * @module
 */

import { join } from "node:path";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { EvidenceStore } from "../../security/evidence/evidence-store.js";
import { LineageBuilder } from "../../adaptation/lineage-builder.js";
import { EffectivenessStore } from "../../adaptation/effectiveness-store.js";
import { IntelligenceStore } from "../../adaptation/intelligence-store.js";
import { DecisionContextBuilder } from "../../adaptation/decision-context-builder.js";
import { RiskScoreBuilder } from "../../adaptation/risk-score-builder.js";
import { RecommendationEngine } from "../../adaptation/recommendation-engine.js";
import { OperatorQueue } from "../../adaptation/operator-queue.js";
import type { QueueItem, QueueInput, RecommendationPriority } from "../../adaptation/operator-queue-types.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
const EVIDENCE_DIR = join(".alix", "security");
const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
const INTELLIGENCE_DIR = join(".alix", "adaptation", "intelligence");

// ---------------------------------------------------------------------------
// Shared infrastructure factory
// ---------------------------------------------------------------------------

interface DecisionInfrastructure {
  proposalStore: ProposalStore;
  evidenceStore: EvidenceStore;
  effectivenessStore: EffectivenessStore;
  intelligenceStore: IntelligenceStore;
  lineageBuilder: LineageBuilder;
  contextBuilder: DecisionContextBuilder;
}

function buildDecisionInfrastructure(cwd: string): DecisionInfrastructure {
  const proposalStore = new ProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const effectivenessStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const intelligenceStore = new IntelligenceStore(join(cwd, INTELLIGENCE_DIR));
  const lineageBuilder = new LineageBuilder(proposalStore, evidenceStore, effectivenessStore, intelligenceStore);
  const contextBuilder = new DecisionContextBuilder(
    proposalStore, evidenceStore, lineageBuilder, effectivenessStore, intelligenceStore,
  );
  return { proposalStore, evidenceStore, effectivenessStore, intelligenceStore, lineageBuilder, contextBuilder };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function handleDecisionCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  switch (subcommand) {
    case "context":
      await runContext(rest);
      return;
    case "risk":
      await runRisk(rest);
      return;
    case "recommend":
      await runRecommend(rest);
      return;
    case "queue":
      await runQueue(rest);
      return;
    default:
      console.error(`Unknown decision subcommand: "${subcommand}"`);
      console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N]");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runContext
// ---------------------------------------------------------------------------

async function runContext(args: string[]): Promise<void> {
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

async function runRisk(args: string[]): Promise<void> {
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

async function runRecommend(args: string[]): Promise<void> {
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
  const recommendation = recEngine.recommend(ctx, risk);

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
async function runQueue(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const limitIdx = args.indexOf("--limit");
  let limit: number | undefined;
  if (limitIdx !== -1 && limitIdx + 1 < args.length) {
    limit = parseInt(args[limitIdx + 1], 10);
    if (isNaN(limit) || limit < 0) {
      console.error("Error: --limit requires a non-negative integer");
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();
  const operatorQueue = new OperatorQueue();

  // List all pending proposals
  const proposals = await infra.proposalStore.list("pending");
  if (proposals.length === 0) {
    console.log("No pending proposals.");
    return;
  }

  // Build QueueInput for each pending proposal
  const inputs: QueueInput[] = [];
  for (const proposal of proposals) {
    const ctx = await infra.contextBuilder.build(proposal.id);
    const riskScore = riskBuilder.build(ctx);
    const recommendation = recEngine.recommend(ctx, riskScore);
    inputs.push({ ctx, riskScore, recommendation });
  }

  // Sort and optionally limit
  const items = operatorQueue.build(inputs, { limit });

  if (jsonMode) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  // Terminal renderer
  const recIcon = (rec: RecommendationPriority | undefined): string => {
    switch (rec) {
      case "investigate": return "🔴";
      case "reject":      return "🟠";
      case "defer":       return "🟡";
      default:            return "⚪";
    }
  };

  console.log(`Operator Queue: ${proposals.length} pending proposal(s)`);
  console.log(`═══════════════════════════════════════`);
  console.log(``);

  for (const item of items) {
    const icon = recIcon(item.recommendation);
    const recLabel = item.recommendation ?? "no recommendation";
    console.log(` ${item.position}. ${icon} ${item.proposalId}  ${recLabel}  risk: ${item.ordering.risk.toFixed(2)}`);
    if (item.reasons.length > 0) {
      console.log(`    ${item.reasons.join(" | ")}`);
    }
    console.log(``);
  }
}
