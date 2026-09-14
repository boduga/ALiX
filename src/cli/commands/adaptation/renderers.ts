/**
 * P5.1g — adaptation CLI command.
 *
 * Closes the reflection → propose → approve → apply loop:
 *
 *   ReflectionReport
 *     → `propose` converts recommendations into pending proposals
 *     → `approve`/`reject` route through ApprovalGate (records evidence)
 *     → `apply` routes through ApprovalGate, which dispatches to the
 *       AgentCardApplier or SkillApplier selected by `proposal.target.kind`
 *
 * Governance invariant (owned by ApprovalGate, not this module): **no approval,
 * no mutation**. The CLI never calls an applier directly — it selects the
 * applier by target kind and hands it to the gate, which is the sole owner of
 * status transitions and evidence recording for approve/reject/apply. Only the
 * `propose` step records evidence itself (`adaptation_proposed`), because that
 * happens before any gate involvement.
 *
 * Subcommands:
 *   list [--status <status>]       List proposals (optionally filtered by status)
 *   show <id>                      Show full proposal details
 *   propose <report.json>          Convert a ReflectionReport into proposals
 *   approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals
 *   reject <id> [--reason <text>]  Reject a pending proposal
 *   apply <id>                     Apply an approved proposal
 *   revert <id> [--reason <text>]  Create a revert proposal for an applied proposal
 *
 *   intelligence [--since] [--until] [--min-bucket-size <n>] [--min-confidence <n>] [--json]
 * @module
 */

import "node:path";
import "../../../adaptation/adaptation-proposal-store.js";
import "../../../adaptation/recommendation-to-proposal.js";
import "../../../adaptation/approval-gate.js";
import "../../../adaptation/appliers/agent-card-applier.js";
import "../../../adaptation/appliers/skill-applier.js";
import "../../../adaptation/revert-applier.js";
import "../../../adaptation/appliers/governance-change-applier.js";
import "../../../adaptation/snapshot-store.js";
import "../../../adaptation/recommendation-to-proposal.js";
import "../../../adaptation/effectiveness-reporter.js";
import "../../../adaptation/effectiveness-store.js";
import type { ProposalEffectivenessReport } from "../../../adaptation/effectiveness-types.js";
import "../../../adaptation/auto-proposal-generator.js";
import "../../../security/evidence/evidence-store.js";
import "../../../workflow/evidence-writer.js";
import type { AdaptationProposal } from "../../../adaptation/adaptation-types.js";
import "../../../adaptation/intelligence-reporter.js";
import "../../../adaptation/intelligence-store.js";
import "../../../adaptation/proposal-lifecycle-analyzer.js";
import "../../../adaptation/proposal-scorer.js";
import "../../../adaptation/priority-store.js";
import "../../../adaptation/effectiveness-trend-analyzer.js";
import "../../../adaptation/bucket-aggregator.js";
import "../../../adaptation/revert-signal-analyzer.js";
import "../../../adaptation/confidence-calibration-analyzer.js";
import "../../../adaptation/capability-evolution-store.js";
import "../../../adaptation/capability-evolution-proposal-generator.js";
import "../../../adaptation/capability-evolution-reporter.js";
import type { CapabilityEvolutionReport } from "../../../adaptation/capability-evolution-types.js";
import "../../../adaptation/lineage-builder.js";
import "../../../adaptation/proposal-readiness.js";
import "../../../executive/executive-orchestrator.js";
import "../../../executive/execution-state-store.js";
import "../../../executive/execution-engine.js";
import "../../../executive/plan-store.js";
import "../../../executive/step-runner.js";

// ---------------------------------------------------------------------------
// Formatting / helpers
// ---------------------------------------------------------------------------

/**
 * Target kinds that have no automated applier — the human must perform the
 * action out-of-band (file an issue, edit a routing weight, declare a
 * capability). runApply intercepts these before the gate and surfaces
 * actionable guidance instead of mutating.
 */
/** Whether a proposal target kind requires manual (out-of-band) action. */

/**
 * Print actionable manual-action guidance for a proposal that cannot be
 * auto-applied. Writes to stdout (this is a guided success, not an error),
 * does not mutate anything, does not touch the gate or evidence.
 *
 * The proposal status stays "approved" — the human performs the action
 * out-of-band; tracking manual completion is a future concern.
 */
export function printManualAction(p: AdaptationProposal): void {
  console.log("Manual action required — this proposal cannot be auto-applied.");
  console.log(`  Proposal: ${p.id}`);
  console.log(`  Action:   ${p.action}`);
  console.log(`  Reason:   ${p.reason}`);

  // The P5.0 recommendation's free-text action — the most concrete steer the
  // system has. Surface it verbatim so the operator gets the specific change.
  const recommendedAction = p.payload.recommendedAction;
  if (typeof recommendedAction === "string" && recommendedAction.length > 0) {
    console.log(`  Suggested change: ${recommendedAction}`);
  }

  console.log("  What to do by hand:");

  switch (p.target.kind) {
    case "issue":
      console.log(`    - Open a GitHub issue titled: "${p.target.title}"`);
      console.log(`      Use the reason above as the issue body / starting point.`);
      break;
    case "routing_weight": {
      const agent = p.payload.agentId;
      const weight = p.payload.weight;
      console.log(
        `    - Adjust the routing weight for the "${p.target.capability}" capability` +
          (typeof agent === "string" ? ` on agent "${agent}"` : "") +
          (typeof weight === "number" || typeof weight === "string" ? ` to ${weight}` : "") +
          ".",
      );
      break;
    }
    case "capability": {
      const agent = p.target.agentId ?? p.payload.agentId;
      console.log(
        `    - Add the "${p.target.capability}" capability` +
          (typeof agent === "string" ? ` to agent "${agent}"` : "") +
          " (declare it on the relevant agent card).",
      );
      break;
    }
  }

  console.log("  No files were changed. Proposal remains \"approved\".");
}


/** Human-readable one-liner for a proposal's target. */
export function describeTarget(p: AdaptationProposal): string {
  switch (p.target.kind) {
    case "agent_card":
      return `agent_card:${p.target.id}`;
    case "skill":
      return `skill:${p.target.id}`;
    case "capability":
      return `capability:${p.target.capability}`;
    case "issue":
      return `issue:"${p.target.title}"`;
    case "routing_weight":
      return `routing_weight:${p.target.capability}`;
    case "revert":
      return `revert proposal ${p.target.sourceProposalId}`;
    case "learning":
      return `learning:${p.target.area}`;
    case "governance":
      return `governance:${p.target.recommendationId}`;
    case "executive_remediation":
      // P10.4b: executive → proposal bridge; render step + subsystem for human inspection.
      return `executive_remediation:${p.target.stepId}@${p.target.subsystem}`;
  }
}


/** Print full proposal details. */
export function printProposal(p: AdaptationProposal): void {
  console.log(`ID:              ${p.id}`);
  console.log(`Status:          ${p.status}`);
  console.log(`Action:          ${p.action}`);
  console.log(`Target:          ${describeTarget(p)}`);
  console.log(`Created:         ${p.createdAt}`);
  console.log(`Source:          ${p.sourceRecommendationType} (confidence ${p.sourceConfidence})`);
  console.log(`Reason:          ${p.reason}`);
  if (p.evidenceFingerprints.length > 0) {
    console.log(`Evidence:        ${p.evidenceFingerprints.join(", ")}`);
  }
  if (p.approvedBy) console.log(`Approved by:    ${p.approvedBy}${p.approvedAt ? ` at ${p.approvedAt}` : ""}`);
  if (p.appliedAt) console.log(`Applied at:      ${p.appliedAt}`);
  if (p.error) console.log(`Error:           ${p.error}`);
  console.log(`Payload:`);
  console.log(JSON.stringify(p.payload, null, 2));
}


export function printUsage(toStderr: boolean): void {
  const lines = [
    "Usage: alix adaptation <subcommand> [options]",
    "  list [--status <status>]       List proposals (optionally filtered by status)",
    "  show <id>                      Show full proposal details",
    "  propose <report.json>          Convert a ReflectionReport into proposals",
    "  approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals",
    "  reject <id> [--reason <text>]  Reject a pending proposal",
    "  apply <id>                     Apply an approved proposal",
    "  revert <id> [--reason <text>]  Create a revert proposal for an applied proposal (approve then apply to execute)",
    "  effectiveness <id> [--all]     Assess an applied proposal (keep/revert/investigate)",
    "  generate [--reflection <path> | --effectiveness <id> | --all-effectiveness | --capability-evolution [--report <path>]] [--min-confidence <n>] [options]",
    "  intelligence [--since] [--until] [--min-bucket-size <n>] [--min-confidence <n>] [--json]  Analyze cross-proposal effectiveness trends (read-only)",
    "  prioritize [--top <n>] [--min-score <n>] [--json]  Rank pending proposals by expected value (read-only)",
    "  capability-evolution [--json] [--reflection-dir <dir>]  Report on capability health, gaps, overlap, and drift (read-only)",
    "  lineage <id> [--depth <n>] [--json] [--export <file>]  Show proposal lifecycle lineage tree",
  ];
  for (const line of lines) {
    if (toStderr) console.error(line);
    else console.log(line);
  }
}


export function printEffectiveness(r: ProposalEffectivenessReport): void {
  console.log(`Proposal:       ${r.proposalId}`);
  console.log(`Applied at:    ${r.appliedAt}  (window ±${r.windowDays}d)`);
  console.log(`Recommendation: ${r.recommendation.toUpperCase()}  — ${r.reason}`);
  if (r.primary) {
    console.log(`Primary:       ${r.primary.metric} ${r.primary.before} → ${r.primary.after}`);
  } else {
    console.log(`Primary:       (none — manual-action proposal)`);
  }
  console.log(`Data sufficient: ${r.dataSufficient}`);
  console.log("");
}


/**
 * Print the standard "Generated: N proposal(s)" summary line. The skip
 * count is reported as a raw integer — per-source breakdown (e.g.
 * low-confidence vs routing_adjustment) lives at the per-method level
 * in the AutomaticProposalGenerator. The CLI keeps the summary simple
 * to avoid duplicating the generator's internal classification here.
 */
export function printGenerateSummary(result: {
  generated: number;
  skipped: number;
  proposals: AdaptationProposal[];
}): void {
  const ids = result.proposals.map((p) => p.id).join(", ");
  console.log(`Generated: ${result.generated} proposal(s) [${ids}]`);
  console.log(`Skipped:   ${result.skipped}`);
}


/** Print the IntelligenceReport as formatted terminal output. */
export function printIntelligenceReport(report: {
  generatedAt: string;
  totalProposalsAnalyzed: number;
  dataWindow: { oldestProposalCreatedAt: string; newestProposalCreatedAt: string; oldestEffectivenessAssessedAt: string | null };
  executiveSummary: string;
  buckets: Record<string, { dimension: string; buckets: Array<{ value: string; totalProposals: number; insufficientData: boolean; keepRate?: number; keepCount?: number; advisoryRevertRate?: number; applyFailureRate?: number; actualRevertRate?: number; approvalRate?: number }> }>;
  revertSignalAnalysis: { totalAdvisoryReverts: number; totalActualReverts: number; totalUnactedReverts: number; revertPrecision: number | null };
  confidenceCalibration: { totalAssessed: number; confidenceOutcomeCorrelation: number | null; buckets: Array<{ range: string; totalProposals: number; insufficientData: boolean; keepRate?: number; advisoryRevertRate?: number }> };
  topPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
  lowestPerforming: Array<{ dimension: string; value: string; keepRate: number; total: number }>;
}): void {
  // Header
  console.log("\n=== Adaptation Intelligence Report ===");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Proposals analyzed: ${report.totalProposalsAnalyzed}`);
  console.log(`Data window: ${report.dataWindow.oldestProposalCreatedAt || "N/A"} — ${report.dataWindow.newestProposalCreatedAt || "N/A"}`);
  console.log("");

  // Executive summary
  console.log("Executive Summary:");
  console.log(report.executiveSummary);
  console.log("");

  // Per-dimension bucket tables
  for (const [dimension, bucketSet] of Object.entries(report.buckets)) {
    if (!bucketSet || !bucketSet.buckets || bucketSet.buckets.length === 0) continue;
    console.log(`--- ${dimension} ---`);
    const header = pad("Bucket", 35) + pad("Total", 6) + pad("Keep", 7) + pad("Rvrt(A)", 8) + pad("Rvrt(!)", 8) + pad("Failed", 7) + pad("Apprv", 6);
    console.log(header);
    for (const b of bucketSet.buckets) {
      if (b.insufficientData) {
        console.log(`  ${pad(b.value, 33)} ${pad(`${b.totalProposals}`, 6)} ⚠️  — insufficient data`);
      } else {
        const keepStr = b.keepRate !== undefined ? `${(b.keepRate * 100).toFixed(0)}%` : "—";
        const revertAStr = b.advisoryRevertRate !== undefined ? `${(b.advisoryRevertRate * 100).toFixed(0)}%` : "—";
        const revertIStr = b.actualRevertRate !== undefined ? `${(b.actualRevertRate * 100).toFixed(0)}%` : "—";
        const failStr = b.applyFailureRate !== undefined ? `${(b.applyFailureRate * 100).toFixed(0)}%` : "—";
        const approveStr = b.approvalRate !== undefined ? `${(b.approvalRate * 100).toFixed(0)}%` : "—";
        console.log(
          `  ${pad(b.value, 33)} ${pad(`${b.totalProposals}`, 6)}` +
          `${pad(keepStr, 7)}${pad(revertAStr, 8)}${pad(revertIStr, 8)}${pad(failStr, 7)}${pad(approveStr, 6)}`,
        );
      }
    }
    console.log("");
  }

  // Revert signal
  console.log("--- Revert Signal ---");
  console.log(`  Advisory reverts:      ${report.revertSignalAnalysis.totalAdvisoryReverts}`);
  console.log(`  Actual reverts:        ${report.revertSignalAnalysis.totalActualReverts}`);
  console.log(`  Unacted reverts:       ${report.revertSignalAnalysis.totalUnactedReverts}`);
  console.log(`  Revert precision:      ${report.revertSignalAnalysis.revertPrecision !== null ? (report.revertSignalAnalysis.revertPrecision * 100).toFixed(1) + "%" : "N/A"}`);
  console.log("");

  // Confidence calibration
  console.log("--- Confidence Calibration ---");
  console.log(`  Total assessed: ${report.confidenceCalibration.totalAssessed}`);
  console.log(`  Confidence-outcome correlation: ${
    report.confidenceCalibration.confidenceOutcomeCorrelation !== null
      ? report.confidenceCalibration.confidenceOutcomeCorrelation.toFixed(3)
      : "N/A (insufficient data)"
  }`);
  if (report.confidenceCalibration.buckets.length > 0) {
    console.log(`  ${pad("Range", 12)} ${pad("Total", 6)} ${pad("Keep", 7)} ${pad("Rvrt(A)", 8)}`);
    for (const cb of report.confidenceCalibration.buckets) {
      if (cb.totalProposals === 0) continue;
      const rangeStr = `${cb.range}`;
      const keepStr = !cb.insufficientData && cb.keepRate !== undefined ? `${(cb.keepRate * 100).toFixed(0)}%` : "—";
      const rvrtStr = !cb.insufficientData && cb.advisoryRevertRate !== undefined ? `${(cb.advisoryRevertRate * 100).toFixed(0)}%` : "—";
      console.log(`  ${pad(rangeStr, 12)} ${pad(`${cb.totalProposals}`, 6)} ${pad(keepStr, 7)} ${pad(rvrtStr, 8)}${cb.insufficientData ? " ⚠️" : ""}`);
    }
  }
  console.log("");

  // Top / lowest
  if (report.topPerforming.length > 0) {
    console.log("--- Top Performing ---");
    for (const t of report.topPerforming) {
      console.log(`  ${t.dimension}/${t.value}: ${(t.keepRate * 100).toFixed(0)}% keep (${t.total} proposals)`);
    }
    console.log("");
  }

  if (report.lowestPerforming.length > 0) {
    console.log("--- Lowest Performing ---");
    for (const t of report.lowestPerforming) {
      console.log(`  ${t.dimension}/${t.value}: ${(t.keepRate * 100).toFixed(0)}% keep (${t.total} proposals)`);
    }
    console.log("");
  }
}


/** Right-pad a string to a minimum width. */
export function pad(s: string, width: number): string {
  return s.padEnd(width);
}


/** Print the ProposalPriorityReport as formatted terminal output. */
export function printPriorityReport(report: {
  generatedAt: string;
  scoringVersion: string;
  totalPending: number;
  totalScored: number;
  totalLowConfidence: number;
  executiveSummary: string;
  ranked: Array<{
    proposalId: string;
    priorityScore: number;
    confidence: string;
    rationale: string;
    proposal: { action: string; target: { kind: string }; createdAt: string };
  }>;
}): void {
  console.log(`\n=== Proposal Priority Report ${report.scoringVersion} ===`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Pending: ${report.totalPending} | Scored: ${report.totalScored} | Low confidence: ${report.totalLowConfidence}`);
  console.log("");

  console.log("Executive Summary:");
  console.log(report.executiveSummary);
  console.log("");

  if (report.ranked.length === 0) {
    console.log("No pending proposals to prioritize.");
    return;
  }

  // Table header
  const header =
    pad("Rank", 5) +
    pad("Score", 7) +
    pad("Conf", 7) +
    pad("ID", 22) +
    pad("Action", 28) +
    pad("Target", 16) +
    pad("Rationale", 50);
  console.log(header);
  console.log("-".repeat(header.length));

  for (let i = 0; i < report.ranked.length; i++) {
    const p = report.ranked[i];
    const rank = (i + 1).toString();
    const scoreStr = p.priorityScore.toFixed(2);
    const confStr = p.confidence.padEnd(6);
    const idStr = p.proposalId.slice(0, 20);
    const actionStr = p.proposal.action.slice(0, 26);
    const targetStr = p.proposal.target.kind.slice(0, 14);
    const rationaleStr = p.rationale.slice(0, 48);
    console.log(
      `${pad(rank, 5)}${pad(scoreStr, 7)}${pad(confStr, 7)}${pad(idStr, 22)}${pad(actionStr, 28)}${pad(targetStr, 16)}${pad(rationaleStr, 50)}`,
    );
  }
  console.log("");
}


/** Print CapabilityEvolutionReport as formatted terminal output. */
export function printCapabilityEvolutionReport(report: CapabilityEvolutionReport): void {
  const pad = (s: string, len: number) => s.padEnd(len);

  // Header
  console.log("Capability Evolution Report");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Total capabilities: ${report.totalCapabilities}`);
  console.log("");

  // Executive summary
  console.log("--- Executive Summary ---");
  console.log(report.executiveSummary);
  console.log("");

  // Lifecycle distribution
  console.log("--- Lifecycle Distribution ---");
  for (const [state, count] of Object.entries(report.lifecycleDistribution)) {
    if (count > 0) {
      console.log(`  ${pad(state, 12)} ${count}`);
    }
  }
  console.log("");

  // Health analysis
  console.log("--- Capability Health ---");
  if (report.healthAnalysis.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      `${pad("Capability", 28)} ${pad("State", 12)} ${pad("Agents", 7)} ${pad("Resolutions", 12)} ${pad("Proposals", 10)} ${pad("Demand", 7)} ${pad("Keep", 7)} ${pad("Revert", 7)}`,
    );
    console.log("-".repeat(90));
    for (const h of report.healthAnalysis) {
      const keepStr = h.keepRate !== null ? (h.keepRate * 100).toFixed(0) + "%" : "—";
      const revertStr = h.revertRate !== null ? (h.revertRate * 100).toFixed(0) + "%" : "—";
      console.log(
        `${pad(h.capability.slice(0, 26), 28)} ${pad(h.lifecycleState, 12)} ${pad(String(h.agentCount), 7)} ${pad(String(h.resolutionCount), 12)} ${pad(String(h.proposalCount), 10)} ${pad(h.demandScore.toFixed(2), 7)} ${pad(keepStr, 7)} ${pad(revertStr, 7)}`,
      );
    }
  }
  console.log("");

  // Gap analysis
  console.log("--- Capability Gaps ---");
  if (report.gapAnalysis.length === 0) {
    console.log("  (none)");
  } else {
    for (const g of report.gapAnalysis) {
      console.log(`  ${g.suggestedCapability} (strength: ${g.signalStrength}, confidence: ${g.confidence})`);
      for (const e of g.evidence) {
        console.log(`    - ${e}`);
      }
    }
  }
  console.log("");

  // Overlap analysis
  console.log("--- Capability Overlap ---");
  if (report.overlapAnalysis.length === 0) {
    console.log("  (none)");
  } else {
    console.log(`${pad("A", 26)} ${pad("B", 26)} ${pad("Score", 7)} ${pad("Asym", 7)} ${pad("Cover A→B", 10)} ${pad("Cover B→A", 10)} ${pad("Consolidate?", 13)}`);
    console.log("-".repeat(100));
    for (const o of report.overlapAnalysis) {
      console.log(
        `${pad(o.capabilityA.slice(0, 24), 26)} ${pad(o.capabilityB.slice(0, 24), 26)} ${pad(o.overlapScore.toFixed(3), 7)} ${pad(o.asymmetry.toFixed(3), 7)} ${pad(o.coverageAtoB.toFixed(3), 10)} ${pad(o.coverageBtoA.toFixed(3), 10)} ${pad(o.consolidationCandidate ? "YES" : "no", 13)}`,
      );
    }
  }
  console.log("");

  // Drift analysis
  console.log("--- Capability Drift ---");
  if (report.driftAnalysis.length === 0) {
    console.log("  (none)");
  } else {
    console.log(`${pad("Capability", 28)} ${pad("Drift", 7)} ${pad("Split?", 8)}`);
    console.log("-".repeat(43));
    for (const d of report.driftAnalysis) {
      console.log(
        `${pad(d.capability.slice(0, 26), 28)} ${pad(d.driftMagnitude.toFixed(3), 7)} ${pad(d.splitCandidate ? "YES" : "no", 8)}`,
      );
    }
  }
  console.log("");
}
