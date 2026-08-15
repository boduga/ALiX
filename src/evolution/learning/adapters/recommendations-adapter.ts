import type { LearningAdapter, RecommendationRecord } from "../contracts/learning-contract.js";
import type { GovernanceStore } from "../../../governance/governance-store.js";

/**
 * Read-only adapter over `governance-store` JSONL file
 * `recommendations.jsonl` (A2.5 recommendations).
 *
 * Returns normalized `RecommendationRecord[]`.
 *
 * Architectural decision (A8 wayfinder map #517 ruling, locked):
 * - Recommendations live in a SEPARATE JSONL store (P9.0a governance-store),
 *   NOT in EventLog, NOT on governance event payloads.
 * - T1-reconciliation correctly REMOVED `recommendation` from
 *   `ProposalGovernanceRecord`; this adapter is the dedicated read-side path.
 * - This adapter does NOT join proposals ↔ recommendations. Correlation by
 *   `proposalId` happens in the DETECTOR layer (e.g.
 *   outcome-contradiction-detector).
 *
 * Field-mapping (T4 reconnaissance):
 * - `recordId`   ← source `recommendationId`
 * - `proposalId` ← source `proposalId`
 * - `kind`       ← source `kind`
 * - `confidence` ← source `confidence`
 * - `reasoning`  ← source `reasoning`
 * - `evidenceRefs` ← source `supportingEvidence` (string[]; NOT `evidenceId`)
 * - `recordedAt` ← source `createdAt`
 *
 * NEVER writes. NEVER joins. Pure projection over governance-store output.
 */
export class RecommendationsAdapter implements LearningAdapter<RecommendationRecord> {
  readonly name = "recommendations";

  constructor(private readonly source: GovernanceStore) {}

  async list(): Promise<ReadonlyArray<RecommendationRecord>> {
    const all = await this.source.list("recommendations");
    return all.map((r) => this.normalize(r));
  }

  private normalize(r: {
    recommendationId: string;
    evidenceId: string;
    proposalId: string;
    kind: RecommendationRecord["kind"];
    confidence: number;
    reasoning: string;
    supportingEvidence: ReadonlyArray<string>;
    risks: ReadonlyArray<string>;
    createdAt: string;
  }): RecommendationRecord {
    // `proposalId` invariantly non-empty per
    // `validateGovernanceRecommendation` (recommendation-contract.ts line
    // 112). No silent default substitution.
    return {
      recordId: r.recommendationId,
      proposalId: r.proposalId,
      kind: r.kind,
      confidence: r.confidence,
      reasoning: r.reasoning,
      evidenceRefs: r.supportingEvidence,
      recordedAt: r.createdAt,
    };
  }
}
