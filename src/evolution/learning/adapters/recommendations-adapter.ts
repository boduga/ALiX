import type { LearningAdapter, RecommendationRecord } from "../contracts/learning-contract.js";
import type { RecommendationStore } from "../../../evolution/verification/recommendation/recommendation-store.js";

/**
 * Read-only adapter over the A2.5-owned `RecommendationStore` JSONL file
 * `recommendations.jsonl` (`.alix/verification/`), returning normalized
 * `RecommendationRecord[]`.
 *
 * Q-A8-REC ruling (LOCKED): the adapter reads EXCLUSIVELY from the A2.5
 * surface (A2.5 → recommendations.jsonl → A8). It does NOT read the P9.x
 * `GovernanceStore` `recommendations.jsonl` — that file holds P9.1
 * governance REPORT records (`{ reportType, recommendations: [] }`), a
 * different artifact type. The former adapter typed its source as
 * `GovernanceStore` and mis-read that report wrapper (TS2740 + runtime
 * `evidenceRefs: undefined` → `[...undefined]` throw, which permanently
 * marked the decisions stage `unavailable`). The source is now the
 * A2.5-owned store, whose records ARE the flat A2.5 shape this normalize
 * step consumes.
 *
 * Architectural decisions (A8 wayfinder map #517 + Q-A8-REC, locked):
 * - Recommendations live in a SEPARATE A2.5-owned JSONL store, NOT in
 *   EventLog, NOT on governance event payloads.
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
 * NEVER writes. NEVER joins. Pure projection over A2.5 store output.
 */
export class RecommendationsAdapter implements LearningAdapter<RecommendationRecord> {
  readonly name = "recommendations";

  constructor(private readonly source: RecommendationStore) {}

  async list(): Promise<ReadonlyArray<RecommendationRecord>> {
    const all = await this.source.list();
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
