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
import { homedir } from "node:os";
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
import { ProviderCatalogAdapter } from "../../adaptation/provider-catalog-adapter.js";
import { LLMLensAgent } from "../../adaptation/llm-lens-agent.js";
import { GovernanceReviewCouncil } from "../../adaptation/governance-review-council.js";
import type { LensName, GovernanceReview } from "../../adaptation/governance-review-types.js";
import type { GovernanceReviewInput } from "../../adaptation/governance-review-types.js";
import { detectProvider, PROVIDERS } from "../../providers/catalog.js";
import { createProvider } from "../../providers/registry.js";
import { OutcomeStore } from "../../adaptation/outcome-store.js";
import type { OutcomeRecord, OutcomeValue } from "../../adaptation/outcome-types.js";
import { ApprovalRecommendationStore } from "../../adaptation/approval-recommendation-store.js";
import type { ApprovalRecommendation } from "../../adaptation/recommendation-types.js";
import { RiskScoreStore } from "../../adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../../adaptation/governance-review-store.js";
import { RecommendationAccuracyBuilder } from "../../adaptation/recommendation-accuracy-builder.js";
import { LensCalibrationBuilder } from "../../adaptation/lens-calibration-builder.js";
import { buildLensObservations } from "../../learning/governance-lens-observation-builder.js";
import { IntentStore } from "../../adaptation/intent-store.js";
import type { ExecutionIntent } from "../../adaptation/execution-intent-types.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
const EVIDENCE_DIR = join(".alix", "security");
const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
const INTELLIGENCE_DIR = join(".alix", "adaptation", "intelligence");
const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const INTENTS_DIR = join(homedir(), ".alix", "execution", "intents");

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
      await runReview(rest);
      return;
    case "outcome":
      await runOutcome(rest);
      return;
    case "intent":
      await runIntent(rest);
      return;
    default:
      console.error(`Unknown decision subcommand: "${subcommand}"`);
      console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | status [--window N] [--json] | review <proposal-id> [--json] [--lens <name>] | outcome <subcommand> ... | intent <subcommand> ...");
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

// ---------------------------------------------------------------------------
// runReview — Live Governance Lens Review (P6.5b)
// ---------------------------------------------------------------------------

/**
 * Execute governance lens review against a live LLM provider.
 *
 * Flow:
 * 1. Parse --json, --lens <name>, <proposal-id> from args
 * 2. Validate --lens against LensName union (exit non-zero on invalid)
 * 3. Detect and create provider (exit non-zero if none configured)
 * 4. Build DecisionContext -> RiskScore -> Recommendation (fail fast)
 * 5. Assemble GovernanceReviewInput
 * 6. Create LLMLensAgent instances (4 lenses or 1 if --lens)
 * 7. Run lenses in parallel: Promise.all(lenses.map(l => l.run(input)))
 * 8. GovernanceReviewCouncil.aggregate() -> GovernanceReview
 * 9. Render terminal output or JSON
 */
async function runReview(args: string[]): Promise<void> {
  // Parse arguments
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision review <proposal-id> [--json] [--lens <name>]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const lensIdx = args.indexOf("--lens");
  let targetLens: LensName | undefined;
  if (lensIdx !== -1) {
    if (lensIdx + 1 >= args.length) {
      console.error("Error: --lens requires a lens name (red_team, historian, policy_auditor, confidence_critic)");
      process.exit(1);
    }
    const lensArg = args[lensIdx + 1];
    if (!["red_team", "historian", "policy_auditor", "confidence_critic"].includes(lensArg)) {
      console.error(`Error: invalid lens name "${lensArg}". Valid: red_team, historian, policy_auditor, confidence_critic`);
      process.exit(1);
    }
    targetLens = lensArg as LensName;
  }

  // ---- Provider setup (before any I/O) ----

  const detected = detectProvider();
  const providerInfo = PROVIDERS.find(p => p.id === detected.provider);
  if (!providerInfo) {
    console.error(`Error: unknown provider "${detected.provider}"`);
    process.exit(1);
  }
  const apiKey = process.env[providerInfo.env] ?? "";
  // Skip API key check for ollama (local, no key needed)
  if (!apiKey && detected.provider !== "ollama") {
    console.error(`Error: no API key found for provider "${detected.provider}". Set ${providerInfo.env}`);
    process.exit(1);
  }

  const modelAdapter = await createProvider(
    { provider: detected.provider, model: detected.model },
    apiKey || undefined,
  );
  const llmAdapter = new ProviderCatalogAdapter(modelAdapter, detected);

  // ---- Decision pipeline (fail fast) ----

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();

  const ctx = await infra.contextBuilder.build(id);
  const risk = riskBuilder.build(ctx);
  const recommendation = recEngine.recommend(ctx, risk);

  // ---- Assemble lens input ----

  const input: GovernanceReviewInput = {
    recommendation,
    decisionContext: ctx,
    riskScore: risk,
  };

  // ---- Create and run lens agents ----

  const ALL_LENSES: LensName[] = ["red_team", "historian", "policy_auditor", "confidence_critic"];
  const lensesToRun = targetLens ? [targetLens] : ALL_LENSES;
  const agents = lensesToRun.map(lens => new LLMLensAgent(llmAdapter, lens));

  // Run in parallel
  const scores = await Promise.all(agents.map(l => l.run(input)));

  // ---- Aggregate ----

  const council = new GovernanceReviewCouncil();
  const reviewId = `review-${id}-${Date.now()}`;
  const review = council.aggregate(reviewId, id, recommendation.id, scores, input);

  // ---- Persist review (best-effort, P7.5p.3b) ----
  // Order invariant: lens-run → aggregate → append → render.
  // Append is best-effort: log-and-continue on failure; never block render.
  await new GovernanceReviewStore().append(review).catch((err) =>
    console.warn(
      `Warning: failed to persist governance review ${reviewId}:`,
      err instanceof Error ? err.message : String(err),
    ),
  );

  // ---- Render ----

  if (jsonMode) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  renderReview(review, targetLens);
}

// ---------------------------------------------------------------------------
// renderReview — Terminal renderer for GovernanceReview
// ---------------------------------------------------------------------------

function renderReview(review: GovernanceReview, singleLens?: LensName): void {
  const verdictIcon =
    review.verdict === "agree" ? "✅" :
    review.verdict === "agree_with_concerns" ? "⚠️" :
    review.verdict === "challenge" ? "🟠" :
    "❓";

  console.log(`Governance Review: ${review.proposalId}`);
  console.log(`────────────────────────────────────────`);
  console.log(`${verdictIcon} Council verdict: ${review.verdict}`);
  console.log(`   Confidence: ${(review.confidence * 100).toFixed(0)}%`);
  console.log(``);

  if (singleLens) {
    console.log(`Lens: ${singleLens} (single-lens mode)`);
  } else {
    console.log(`Lens scores (${review.lensScores.length}):`);
  }

  for (const s of review.lensScores) {
    const lensIcon =
      s.recommendedVerdict === "agree" ? "✅" :
      s.recommendedVerdict === "agree_with_concerns" ? "⚠️" :
      s.recommendedVerdict === "challenge" ? "🟠" :
      "❓";
    const providerInfo = s.provider ? ` [${s.provider}${s.model ? `/${s.model}` : ""}]` : "";
    console.log(` ${lensIcon} ${s.lens}: ${s.recommendedVerdict} (${(s.confidence * 100).toFixed(0)}%)${providerInfo}`);
    console.log(`    ${s.rationale}`);
  }
  console.log(``);

  console.log(`Council vote: agree=${review.councilVote.agree} agree_with_concerns=${review.councilVote.agreeWithConcerns} challenge=${review.councilVote.challenge} insufficient=${review.councilVote.insufficientInformation}`);
  console.log(``);

  if (review.concerns.length > 0) {
    console.log(`Concerns raised (${review.concerns.length}):`);
    for (const c of review.concerns) {
      console.log(` · ${c}`);
    }
    console.log(``);
  }

  if (review.blindSpots.length > 0) {
    console.log(`Blind spots (${review.blindSpots.length}):`);
    for (const b of review.blindSpots) {
      console.log(` · ${b}`);
    }
    console.log(``);
  }

  if (review.historicalAnalogies.length > 0) {
    console.log(`Historical analogies (${review.historicalAnalogies.length}):`);
    for (const h of review.historicalAnalogies) {
      console.log(` · ${h}`);
    }
    console.log(``);
  }

  console.log(`Sources: ${review.sourceArtifacts.length} artifact(s)`);
}

// ---------------------------------------------------------------------------
// runOutcome — Outcome Tracking CLI (P7a)
// ---------------------------------------------------------------------------

const VALID_OUTCOMES: OutcomeValue[] = [
  "success",
  "partial_success",
  "neutral",
  "failure",
  "unknown",
];

async function runOutcome(args: string[]): Promise<void> {
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

async function runOutcomeRecord(args: string[]): Promise<void> {
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

async function runOutcomeShow(args: string[]): Promise<void> {
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

async function runOutcomeReport(args: string[]): Promise<void> {
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

async function runOutcomeLensCalibration(args: string[]): Promise<void> {
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

  const reviews = await reviewStore.queryByWindow(windowDays);
  const outcomes = await outcomeStore.queryByWindow(windowDays);

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

async function runIntent(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "list") {
    await runIntentList();
    return;
  }

  if (subcommand === "show") {
    const id = args[1];
    if (!id) {
      console.error("Usage: alix decision intent show <id>");
      process.exit(1);
    }
    await runIntentShow(id);
    return;
  }

  if (subcommand === "propose") {
    const id = args[1];
    if (!id) {
      console.error("Usage: alix decision intent propose <intent-id>");
      process.exit(1);
    }
    await runIntentPropose(id);
    return;
  }

  console.error(`Unknown intent subcommand: "${subcommand}"`);
  console.error("Usage: alix decision intent list | intent show <id> | intent propose <intent-id>");
  process.exit(1);
}

async function runIntentList(): Promise<void> {
  const store = new IntentStore(INTENTS_DIR);
  const intents = await store.list();

  if (intents.length === 0) {
    console.log("No execution intents captured.");
    return;
  }

  console.log(`Execution intents (${intents.length}):\n`);
  for (const intent of intents) {
    const icon = statusIcon(intent.status);
    const shortId = intent.id.length > 30 ? intent.id.slice(0, 27) + "..." : intent.id;
    console.log(`${icon} ${shortId}`);
    console.log(`   Source:  ${intent.source}${intent.skillId ? ` (${intent.skillId})` : ""}`);
    console.log(`   Status:  ${intent.status}`);
    console.log(`   Summary: ${intent.outputSummary.slice(0, 80)}${intent.outputSummary.length > 80 ? "..." : ""}`);
    console.log();
  }
}

async function runIntentShow(id: string): Promise<void> {
  const store = new IntentStore(INTENTS_DIR);
  const intent = await store.get(id);

  if (!intent) {
    console.error(`Intent not found: ${id}`);
    process.exit(1);
  }

  console.log(JSON.stringify(intent, null, 2));
}

function statusIcon(status: string): string {
  switch (status) {
    case "captured":   return "\u{1F4E5}";  // inbox tray
    case "proposed":   return "\u{1F4DD}";  // memo
    case "discarded":  return "\u{1F5D1}️";  // wastebasket
    default:           return "⚪";  // white circle
  }
}

async function runIntentPropose(id: string): Promise<void> {
  const intentStore = new IntentStore(INTENTS_DIR);
  const intent = await intentStore.get(id);

  if (!intent) {
    console.error(`Intent not found: ${id}`);
    process.exit(1);
  }

  // Validate: only "captured" intents can be proposed
  if (intent.status !== "captured") {
    console.error(
      `Intent ${id} status is "${intent.status}" — only "captured" intents can be proposed`,
    );
    process.exit(1);
  }

  // Validate: must have proposedAction + proposedTarget
  if (!intent.proposedAction || !intent.proposedTarget) {
    console.error(
      `Intent ${id} has no proposedAction or proposedTarget — cannot map to proposal`,
    );
    process.exit(1);
  }

  const { IntentProposalMapper } = await import(
    "../../adaptation/intent-proposal-mapper.js"
  );

  const proposalsDir = join(process.cwd(), ".alix", "adaptation", "proposals");
  const proposalStore = new ProposalStore(proposalsDir);
  const mapper = new IntentProposalMapper(proposalStore);

  const result = await mapper.mapToProposal(intent, intentStore);

  if (!result.success) {
    console.error(`Proposal mapping failed: ${result.errors.join("; ")}`);
    process.exit(1);
  }

  console.log(`✅ Proposal created: ${result.proposal!.id}`);
  console.log(`  Intent:   ${id}`);
  console.log(`  Action:   ${result.proposal!.action}`);
  console.log(`  Target:   ${JSON.stringify(result.proposal!.target)}`);
  console.log(`  Status:   ${result.proposal!.status}`);
  console.log();
  console.log(`═══ NEXT STEPS ═══`);
  console.log(
    `Proposal created. Use \`alix decision approve ${result.proposal!.id}\``,
  );
  console.log(
    `and \`alix decision apply ${result.proposal!.id}\` to execute.`,
  );
  console.log();
}
