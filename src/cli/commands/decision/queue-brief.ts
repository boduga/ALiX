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
import { OperatorQueue } from "../../../adaptation/operator-queue.js";
import type { QueueInput, RecommendationPriority } from "../../../adaptation/operator-queue-types.js";
import { StrategicBriefBuilder } from "../../../adaptation/strategic-brief.js";
import "../../../adaptation/strategic-brief-types.js";
import type { IntelligenceReport } from "../../../adaptation/intelligence-types.js";
import type { ProposalEffectivenessReport } from "../../../adaptation/effectiveness-types.js";
import type { EvidenceRecord } from "../../../security/evidence/evidence-types.js";
import { PipelineHealthCollector } from "../../../adaptation/pipeline-health-collector.js";
import { PipelineHealthBuilder } from "../../../adaptation/pipeline-health-builder.js";
import "../../../adaptation/execution-intent-types.js";
import { buildDecisionInfrastructure } from "./shared.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

export async function runQueue(args: string[]): Promise<void> {
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
export async function runBrief(args: string[]): Promise<void> {
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

export async function runStatus(args: string[]): Promise<void> {
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
