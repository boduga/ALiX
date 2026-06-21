/**
 * P6.0a — DecisionContextBuilder.
 *
 * Builds a read-only DecisionContext for a given proposal by aggregating:
 * - ProposalStore (proposal state)
 * - LineageBuilder (lifecycle graph)
 * - EvidenceStore (evidence fingerprints)
 * - EffectivenessStore (effectiveness history)
 * - IntelligenceStore (intelligence trends and similar proposals)
 *
 * Read-only rule: this builder reads stores but never writes to them.
 * Enforced by governance sentinel test.
 *
 * @module
 */

import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { LineageBuilder } from "./lineage-builder.js";
import type { EffectivenessStore } from "./effectiveness-store.js";
import type { IntelligenceStore } from "./intelligence-store.js";
import type {
  DecisionContext,
  ContextStatus,
  SourceArtifact,
  EffectivenessTrend,
  DataFreshness,
  EnrichedWarning,
  WarningSeverity,
} from "./decision-types.js";
import {
  computeDecisionConfidence,
  STALE_THRESHOLD_DAYS,
} from "./decision-confidence.js";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class DecisionContextBuilder {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly lineageBuilder: LineageBuilder,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async build(proposalId: string): Promise<DecisionContext> {
    const generatedAt = new Date().toISOString();
    const reasons: string[] = [];
    const warnings: EnrichedWarning[] = [];
    const evidenceRefs: string[] = [];
    const sourceArtifacts: SourceArtifact[] = [];

    // 1. Load the proposal
    const proposal = await this.proposalStore.load(proposalId);
    if (!proposal) {
      return {
        id: `decision-ctx-${proposalId}`,
        subject: `Context for proposal ${proposalId}`,
        outcome: "insufficient_data",
        contextStatus: "insufficient_data",
        confidence: 0,
        reasons: ["Proposal not found"],
        warnings: [{ message: `Proposal ${proposalId} not found in ProposalStore`, severity: "critical" }],
        evidenceRefs: [],
        generatedAt,
        proposalId,
        proposalStatus: "unknown",
        proposalAction: "unknown",
        createdAt: "",
        ageDays: 0,
        lineage: undefined,
        lineageCompleteness: "broken",
        similarProposals: [],
        effectivenessTrend: { actionType: "", keepRate: 0, revertRate: 0, sampleSize: 0 },
        sourceArtifacts: [],
        dataFreshness: { newestArtifactAgeDays: 0, oldestArtifactAgeDays: 0 },
      };
    }

    sourceArtifacts.push({
      type: "proposal",
      id: proposal.id,
      timestamp: proposal.createdAt,
    });
    evidenceRefs.push(...proposal.evidenceFingerprints);

    const createdAt = new Date(proposal.createdAt);
    const ageDays = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // 2. Build lineage graph
    const lineage = await this.lineageBuilder.build(proposalId);
    sourceArtifacts.push({
      type: "lineage",
      id: proposalId,
      timestamp: lineage.generatedAt,
    });

    // Propagate lineage warnings with severity mapping
    if (lineage.warnings.length > 0) {
      for (const w of lineage.warnings) {
        const severity: WarningSeverity =
          w.type === "missing_evidence_fingerprint" || w.type === "integrity_mismatch"
            ? "critical"
            : w.type === "stalled_cycle"
              ? "warning"
              : "info";
        warnings.push({ message: `[lineage] ${w.message}`, severity });
      }
    }

    // 3. Compute context status
    let contextStatus: ContextStatus;
    if (ageDays > STALE_THRESHOLD_DAYS) {
      contextStatus = "stale_context";
      warnings.push({ message: `Proposal has had no activity for ${ageDays} days (threshold: ${STALE_THRESHOLD_DAYS})`, severity: "warning" });
    } else if (lineage.completeness === "complete") {
      contextStatus = "complete_context";
    } else {
      contextStatus = "partial_context";
    }

    // 4. Load effectiveness history
    const effReport = await this.effectivenessStore.load(proposalId);
    let effectivenessTrend: EffectivenessTrend = {
      actionType: proposal.action,
      keepRate: 0,
      revertRate: 0,
      sampleSize: 0,
    };
    if (effReport) {
      sourceArtifacts.push({
        type: "effectiveness",
        id: proposalId,
        timestamp: effReport.assessedAt,
      });
      effectivenessTrend = {
        actionType: proposal.action,
        keepRate: effReport.recommendation === "keep" ? 1 : 0,
        revertRate: effReport.recommendation === "revert" ? 1 : 0,
        sampleSize: 1,
      };
    }

    // 5. Load similar proposals via IntelligenceStore
    const similarResults = await this.intelligenceStore.findSimilarProposals(
      proposal.action,
      proposalId,
      this.proposalStore,
    );

    // 6. Scan intelligence reports for source artifacts
    const intelligenceFiles = await this.intelligenceStore.list();
    for (const filename of intelligenceFiles.slice(0, 5)) {
      const report = await this.intelligenceStore.load(filename);
      if (!report) continue;
      sourceArtifacts.push({
        type: "intelligence",
        id: filename,
        timestamp: report.generatedAt,
      });
    }

    // 7. Compute confidence via shared module
    const confidenceResult = computeDecisionConfidence({
      lineageCompleteness: lineage.completeness,
      hasEvidenceFingerprints: proposal.evidenceFingerprints.length > 0,
      hasEffectiveness: !!effReport,
      similarProposalsCount: similarResults.length,
      warningsCount: warnings.length,
      ageDays,
    });

    // 8. Combine reasons
    reasons.push(...confidenceResult.reasons);
    if (effReport) {
      reasons.push(`Effectiveness: ${effReport.recommendation}`);
    }

    // 9. Build data freshness
    const sourceTimestamps = sourceArtifacts
      .map((s) => s.timestamp)
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime())
      .filter((t) => !isNaN(t));

    const dataFreshness: DataFreshness = {
      newestArtifactAgeDays:
        sourceTimestamps.length > 0
          ? Math.floor((Date.now() - Math.max(...sourceTimestamps)) / (1000 * 60 * 60 * 24))
          : 0,
      oldestArtifactAgeDays:
        sourceTimestamps.length > 0
          ? Math.floor((Date.now() - Math.min(...sourceTimestamps)) / (1000 * 60 * 60 * 24))
          : 0,
    };

    // 9. Build return value
    return {
      // DecisionArtifact fields (outcome is set to contextStatus for artifact
      // compatibility — P6's base artifact shape requires an outcome field,
      // and contextStatus is the most semantically accurate value at this layer)
      id: `decision-ctx-${proposalId}`,
      subject: `Context for ${proposal.action}: ${proposal.reason}`,
      outcome: contextStatus,
      confidence: confidenceResult.confidence,
      reasons,
      warnings: warnings.length > 0 ? warnings : undefined,
      evidenceRefs,
      generatedAt,

      // DecisionContext-specific fields
      contextStatus,
      proposalId: proposal.id,
      proposalStatus: proposal.status,
      proposalAction: proposal.action,
      createdAt: proposal.createdAt,
      ageDays,
      lineage,
      lineageCompleteness: lineage.completeness,
      similarProposals: similarResults.map((r) => ({
        proposalId: r.proposalId,
        action: proposal.action,
        outcome: r.outcome,
        confidence: r.confidence,
      })),
      effectivenessTrend,
      sourceArtifacts,
      dataFreshness,
    };
  }
}
