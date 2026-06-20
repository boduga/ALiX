/**
 * P5.3.3 — ProposalLifecycleAnalyzer.
 *
 * Loads all proposals, enriches each with its effectiveness report, revert
 * status, lifecycle metrics, and applies time/confidence filters.
 *
 * Pure read + compute — no mutations, no evidence writes, no proposals created.
 *
 * @module
 */

import type { EnrichedProposal, IntelligenceOptions } from "./intelligence-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";
import { ProposalStore } from "./proposal-store.js";
import { EffectivenessStore } from "./effectiveness-store.js";
import { EvidenceStore } from "../security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Outcome mapping
// ---------------------------------------------------------------------------

/**
 * Map a proposal status to the outcome string used in EnrichedProposal.
 * "reverted" is handled separately — it overrides the stored status.
 */
function statusToOutcome(
  status: AdaptationProposal["status"],
): EnrichedProposal["outcome"] {
  switch (status) {
    case "applied":
      return "applied";
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

// ---------------------------------------------------------------------------
// ProposalLifecycleAnalyzer
// ---------------------------------------------------------------------------

export class ProposalLifecycleAnalyzer {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly evidenceStore: EvidenceStore,
  ) {}

  /**
   * Load all proposals, enrich each with effectiveness data and revert status,
   * compute lifecycle metrics, and apply optional filters.
   *
   * The revert scan is done once (O(n)) by building a Map of
   * sourceProposalId → applied revert proposal.  This avoids N+1 scanning.
   */
  async analyze(opts?: IntelligenceOptions): Promise<EnrichedProposal[]> {
    // 1. Load all proposals once
    const allProposals = await this.proposalStore.list();

    // 2. Build revert map: sourceProposalId → applied revert proposal
    const revertMap = new Map<string, AdaptationProposal>();
    for (const p of allProposals) {
      if (
        p.action === "revert_proposal" &&
        p.target.kind === "revert" &&
        p.status === "applied"
      ) {
        revertMap.set(p.target.sourceProposalId, p);
      }
    }

    // 3. Enrich each proposal
    const enriched: EnrichedProposal[] = [];

    for (const proposal of allProposals) {
      // a. Load effectiveness report (may be null)
      const effectivenessReport: ProposalEffectivenessReport | null =
        await this.effectivenessStore.load(proposal.id);

      // b. Determine revert status
      const revertProposal = revertMap.get(proposal.id) ?? null;
      const wasReverted = revertProposal !== null;

      // c. Compute outcome
      const outcome: EnrichedProposal["outcome"] = wasReverted
        ? "reverted"
        : statusToOutcome(proposal.status);

      // d. Compute time metrics
      const timeToApprovalHours: number | null =
        proposal.approvedAt && proposal.createdAt
          ? hoursBetween(proposal.createdAt, proposal.approvedAt)
          : null;

      const timeToApplyHours: number | null =
        proposal.appliedAt && proposal.approvedAt
          ? hoursBetween(proposal.approvedAt, proposal.appliedAt)
          : null;

      enriched.push({
        proposal,
        effectivenessReport,
        wasReverted,
        revertProposalId: revertProposal?.id ?? null,
        outcome,
        timeToApprovalHours,
        timeToApplyHours,
      });
    }

    // 4. Apply filters
    const { since, until, minConfidence } = opts ?? {};
    let filtered = enriched;

    if (since !== undefined) {
      filtered = filtered.filter((e) => e.proposal.createdAt >= since);
    }
    if (until !== undefined) {
      filtered = filtered.filter((e) => e.proposal.createdAt <= until);
    }
    if (minConfidence !== undefined) {
      filtered = filtered.filter(
        (e) => e.proposal.sourceConfidence >= minConfidence,
      );
    }

    return filtered;
  }
}
