import type { LearningAdapter, EnrichedProposalRecord } from "../contracts/learning-contract.js";
import type { EnrichedProposal } from "../../../adaptation/intelligence-types.js";

/**
 * Read-only adapter over P10.8a EnrichedProposal[] pipeline.
 * Returns normalized EnrichedProposalRecord[].
 *
 * EnrichedProposal has nested `proposal: AdaptationProposal`, not flat fields.
 * proposalId, capabilityId, recordedAt all derived from the nested proposal.
 *
 * Schema reconciliation (A8 wayfinder map #517):
 * - `proposalId` from `proposal.id`.
 * - `capabilityId` from `proposal.target` (ProposalTarget union). Only the
 *   `kind: "capability"` variant carries a capability identifier, and that
 *   identifier lives at `target.capability` (not `target.id` — minor field
 *   drift from the original brief; documented in commit message). All other
 *   ProposalTarget variants resolve to `capabilityId === ""`.
 * - `enrichedFields` is the top-level key list of the EnrichedProposal
 *   wrapper (the analytics-side metadata, not the nested proposal's keys).
 * - `recordedAt` from `proposal.createdAt` (closest analogue; EnrichedProposal
 *   itself has no timestamp).
 */
export class EnrichedProposalsAdapter implements LearningAdapter<EnrichedProposalRecord> {
  readonly name = "enriched-proposals";
  constructor(private readonly source: ReadonlyArray<EnrichedProposal>) {}

  async list(): Promise<ReadonlyArray<EnrichedProposalRecord>> {
    return this.source.map((p) => this.normalize(p));
  }

  private normalize(p: EnrichedProposal): EnrichedProposalRecord {
    const proposal = p.proposal;
    const target = proposal.target;
    // Minor field-name drift: ProposalTarget's capability variant uses
    // `capability` (not `id`) as the identifier field. See module-level
    // comment for context.
    const capabilityId =
      target.kind === "capability" && typeof target.capability === "string"
        ? target.capability
        : "";
    return {
      proposalId: proposal.id,
      capabilityId,
      enrichedFields: Object.keys(p),
      recordedAt: proposal.createdAt ?? new Date(0).toISOString(),
    };
  }
}
