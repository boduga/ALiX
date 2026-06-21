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
import { StrategicBriefBuilder } from "../../adaptation/strategic-brief.js";
import type { StrategicBrief } from "../../adaptation/strategic-brief-types.js";
import type { IntelligenceReport } from "../../adaptation/intelligence-types.js";
import type { ProposalEffectivenessReport } from "../../adaptation/effectiveness-types.js";
import type { EvidenceRecord } from "../../security/evidence/evidence-types.js";
import { PipelineHealthCollector } from "../../adaptation/pipeline-health-collector.js";
import { PipelineHealthBuilder } from "../../adaptation/pipeline-health-builder.js";
import type { PipelineHealthReport } from "../../adaptation/pipeline-health-types.js";

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
    case "brief":
      await runBrief(rest);
      return;
    case "status":
      await runStatus(rest);
      return;
    case "review":
      console.log("review: unavailable (P6.5a foundation — real lens agents deferred to P6.5b)");
      return;
    default:
      console.error(`Unknown decision subcommand: "${subcommand}"`);
      console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | status [--window N] [--json] | review <proposal-id>");
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
    try {
      const ctx = await infra.contextBuilder.build(proposal.id);
      const riskScore = riskBuilder.build(ctx);
      const recommendation = recEngine.recommend(ctx, riskScore);
      inputs.push({ ctx, riskScore, recommendation });
    } catch {
      console.error(`  ⚠️ Skipped ${proposal.id}: failed to build context`);
      continue;
    }
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

// ---------------------------------------------------------------------------
// runBrief — Strategic Brief
// ---------------------------------------------------------------------------

/**
 * Build and render a strategic brief from persisted stores.
 * Computed fresh each run — no persistence.
 */
async function runBrief(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowSize: 30 | 90 | 180 = 30;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (![30, 90, 180].includes(parsed)) {
      console.error("Error: --window requires 30, 90, or 180");
      process.exit(1);
    }
    windowSize = parsed as 30 | 90 | 180;
  }

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const briefBuilder = new StrategicBriefBuilder();

  // Query stores — this is the CLI's responsibility, not the builder's
  let intelligenceReports: IntelligenceReport[];
  let effectivenessReports: ProposalEffectivenessReport[];
  let evidenceRecords: EvidenceRecord[];
  const LIFECYCLE_TYPES = new Set(["adaptation_proposed", "adaptation_approved", "adaptation_applied", "adaptation_failed", "adaptation_rejected"]);
  try {
    effectivenessReports = await infra.effectivenessStore.list();

    // Load all intelligence reports for trend detection across history
    const intelFilenames = await infra.intelligenceStore.list();
    intelligenceReports = (
      await Promise.all(intelFilenames.map((f) => infra.intelligenceStore.load(f)))
    ).filter(Boolean) as IntelligenceReport[];

    // Query evidence store — EvidenceStore.query takes type (singular),
    // so query broadly then filter for lifecycle event types in-memory
    const allEvidence = await infra.evidenceStore.query({ limit: 10000 });
    evidenceRecords = allEvidence.records.filter((r) => LIFECYCLE_TYPES.has(r.type));
  } catch (err) {
    console.error(`Error querying stores: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const input = {
    intelligenceReports,
    effectivenessReports,
    evidenceRecords,
  };

  const brief = briefBuilder.build(input, { window: windowSize });

  if (jsonMode) {
    console.log(JSON.stringify(brief, null, 2));
    return;
  }

  // Terminal renderer
  const periodStart = new Date(brief.period.start).toLocaleDateString();
  const periodEnd = new Date(brief.period.end).toLocaleDateString();

  console.log(`Strategic Brief: Last ${windowSize} days (${periodStart} → ${periodEnd})`);
  console.log(`═════════════════════════════════════════════════════════`);
  console.log(``);

  if (brief.findings.length > 0) {
    console.log(`Findings (${brief.findings.length}):`);
    for (const f of brief.findings) {
      const icon =
        f.category === "trend" ? "📈" :
        f.category === "hotspot" ? "🔥" :
        f.category === "system_warning" ? "⚠️" :
        "💡";
      console.log(` ${icon} ${f.summary}`);
    }
    console.log(``);
  }

  if (brief.trends.length > 0) {
    console.log(`Trends (${brief.trends.length}):`);
    for (const t of brief.trends) {
      const dirIcon = t.direction === "increasing" ? "↑" : t.direction === "decreasing" ? "↓" : "→";
      console.log(` ${dirIcon} ${t.metric}: ${t.direction} (magnitude: ${(t.magnitude * 100).toFixed(0)}%, n=${t.sampleSize})`);
    }
    console.log(``);
  }

  if (brief.hotspots.length > 0) {
    console.log(`Hotspots (${brief.hotspots.length}):`);
    for (const h of brief.hotspots) {
      const sevIcon = h.severity === "high" ? "🔴" : h.severity === "medium" ? "🟠" : "🟡";
      console.log(` ${sevIcon} ${h.area} (${h.severity}): ${h.evidence}`);
    }
    console.log(``);
  }

  if (brief.strategicActions.length > 0) {
    console.log(`Strategic actions:`);
    for (const action of brief.strategicActions) {
      console.log(` · ${action}`);
    }
    console.log(``);
  }

  console.log(`Data: ${intelligenceReports.length} intelligence reports, ${effectivenessReports.length} effectiveness reports, ${evidenceRecords.length} evidence records`);
  console.log(`Confidence: ${(brief.confidence * 100).toFixed(0)}% (data sufficiency)`);

  if (brief.reasons.length > 0) {
    console.log(``);
    console.log(`Data sources:`);
    for (const r of brief.reasons) {
      console.log(` · ${r}`);
    }
  }
}

// ---------------------------------------------------------------------------
// runStatus — Pipeline Health Report
// ---------------------------------------------------------------------------

async function runStatus(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  const windowDays = windowIdx !== -1 && windowIdx + 1 < args.length ? parseInt(args[windowIdx + 1], 10) : 30;

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskScoreBuilder = new RiskScoreBuilder();
  const recommendationEngine = new RecommendationEngine();
  const collector = new PipelineHealthCollector({ ...infra, riskScoreBuilder, recommendationEngine });
  const builder = new PipelineHealthBuilder();

  const input = await collector.collect(windowDays);
  const report = builder.build(input, { windowDays: windowDays as any, generatedAt: new Date().toISOString() });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Terminal renderer
  const healthIcon = report.health === "healthy" ? "✅" : report.health === "degraded" ? "⚠️" : "🔴";
  console.log(`Pipeline Health — Last ${report.windowDays} days: ${healthIcon} ${report.health}`);
  console.log(`═══════════════════════════════════════`);
  console.log(``);

  const p = report.proposalCounts;
  console.log(`Proposals: ${p.total} total (${p.pending} pending, ${p.applied} applied, ${p.approved} approved, ${p.rejected} rejected, ${p.failed} failed)`);

  if (report.scopedProposals.total > 0) {
    const s = report.scopedProposals;
    const stale = s.staleProposals > 0 ? `  ⚠ Stale: ${s.staleProposals} (>30 days)` : "";
    const broken = s.brokenLineage > 0 ? `  Broken lineage: ${s.brokenLineage}` : "";
    const suffix = [stale, broken].filter(Boolean).join(" | ");
    console.log(` ${suffix}`);
    console.log(``);
    console.log(`Confidence:`);
    console.log(`  Context: ${(s.confidence.contextAvg * 100).toFixed(0)}% avg (n=${s.confidence.sampleSize})`);
    if (s.confidence.riskAvg !== undefined) console.log(`  Risk: ${(s.confidence.riskAvg * 100).toFixed(0)}% avg`);
    if (s.confidence.recommendationAvg !== undefined) console.log(`  Recommendation: ${(s.confidence.recommendationAvg * 100).toFixed(0)}% avg`);
  } else {
    console.log(`  No proposals in window`);
  }
  console.log(``);

  if (report.strategicBrief.available) {
    console.log(`Strategic brief: ${report.strategicBrief.confidence !== null ? (report.strategicBrief.confidence * 100).toFixed(0) + "%" : "N/A"} (${report.strategicBrief.findings} findings)`);
  } else {
    console.log(`Strategic brief: unavailable`);
  }
  console.log(``);

  console.log(`Activity:`);
  console.log(`  Effectiveness reports: ${report.effectivenessReports}  |  Intelligence reports: ${report.intelligenceReports}`);
  console.log(`  Lifecycle events: ${report.lifecycleEvents.total} total (${report.lifecycleEvents.inWindow} in window)`);
  console.log(``);

  if (report.governanceReview.frameworkAvailable) {
    console.log(`Governance review: Framework ready (P6.5a). Lenses deferred (P6.5b).`);
  }
  console.log(``);

  if (report.healthSignals.length > 0) {
    console.log(`Signals:`);
    for (const signal of report.healthSignals) {
      const icon = signal.severity === "critical" ? "🔴" : signal.severity === "warning" ? "⚠️" : "ℹ️";
      console.log(`  ${icon} ${signal.message}`);
    }
  }
}
