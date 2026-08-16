/**
 * A9 — enriched proposals adapter (Slice 1, Phase 4/5).
 *
 * Read-only adapter over raw `EnrichedProposal[]` (the P10.8a pipeline output).
 * A9 reads `enrichedFields` directly and NEVER imports A8's normalized
 * aggregation layer (`src/evolution/learning/`) — A9 is its own module.
 *
 * Schema reconciliation (mirrors the A8 wayfinder map #517 findings):
 * - `EnrichedProposal` has nested `proposal: AdaptationProposal`, not flat fields.
 * - `proposalId` ← `proposal.id`; `recordedAt` ← `proposal.createdAt`
 *   (epoch ISO when nullish).
 * - `capabilityId` ← `proposal.target.capability` for the `kind: "capability"`
 *   target variant; "" for all other ProposalTarget variants.
 * - `enrichedFields` ← the top-level key list of the EnrichedProposal wrapper.
 * - `assessment` flags ← which enriched wrapper fields are populated (non-null);
 *   `sourceConfidence` / `evidenceFingerprints` ← the nested proposal's, for
 *   the evidence-completeness detector's population/recency/diversity signal.
 *
 * @module evolution/a9/adapters/enriched-proposals-adapter
 */

import type { EnrichedProposal } from "../../../adaptation/intelligence-types.js";
import type { A9Adapter, EnrichedProposalRecord } from "../contracts/a9-contract.js";

/** Source of EnrichedProposal[]: a pre-loaded array, or a lazy async supplier
 *  (the composition root uses a supplier so no I/O happens at construction —
 *  the P10.8a analyzer only runs when `.list()` is first called). */
export type EnrichedProposalsSource =
  | ReadonlyArray<EnrichedProposal>
  | (() => Promise<ReadonlyArray<EnrichedProposal>>);

export class EnrichedProposalsAdapter implements A9Adapter<EnrichedProposalRecord> {
  readonly name = "a9-enriched-proposals";
  constructor(private readonly source: EnrichedProposalsSource) {}

  async list(): Promise<ReadonlyArray<EnrichedProposalRecord>> {
    const resolved =
      typeof this.source === "function" ? await this.source() : this.source;
    return resolved.map((p) => this.toRecord(p));
  }

  private toRecord(p: EnrichedProposal): EnrichedProposalRecord {
    const proposal = p.proposal;
    const target = proposal.target;
    // ProposalTarget's capability variant carries the identifier at
    // `target.capability` (not `target.id` — documented minor field drift).
    const capabilityId =
      target.kind === "capability" && typeof target.capability === "string"
        ? target.capability
        : "";
    const sourceConfidence =
      typeof proposal.sourceConfidence === "number" && Number.isFinite(proposal.sourceConfidence)
        ? proposal.sourceConfidence
        : 0;
    const evidenceFingerprints = Array.isArray(proposal.evidenceFingerprints)
      ? proposal.evidenceFingerprints.filter((f): f is string => typeof f === "string")
      : [];
    return {
      proposalId: proposal.id,
      capabilityId,
      enrichedFields: Object.keys(p),
      recordedAt: proposal.createdAt ?? new Date(0).toISOString(),
      sourceConfidence,
      evidenceFingerprints,
      assessment: {
        hasEffectivenessReport: p.effectivenessReport !== null && p.effectivenessReport !== undefined,
        hasRevertDecision: p.revertProposalId !== null && p.revertProposalId !== undefined,
        hasTimeToApproval: p.timeToApprovalHours !== null && p.timeToApprovalHours !== undefined,
        hasTimeToApply: p.timeToApplyHours !== null && p.timeToApplyHours !== undefined,
      },
    };
  }
}
