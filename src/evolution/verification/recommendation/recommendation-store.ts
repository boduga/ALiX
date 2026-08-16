/**
 * A2.5 — RecommendationStore: append-only JSONL persistence for
 * GovernanceRecommendation artifacts.
 *
 * Storage: .alix/verification/recommendations.jsonl
 *
 * Q-A8-REC ruling (LOCKED): this is the honest A2.5-owned persistent
 * recommendation surface — the dedicated write/read path behind the flow
 *   A2.5 → recommendations.jsonl → A8 RecommendationsAdapter.
 * It is a DEDICATED A2.5 path, deliberately NOT `.alix/governance/
 * recommendations.jsonl`, which the P9.x GovernanceStore owns (a different
 * artifact type). That namespace/path collision is resolved explicitly here
 * per the ruling.
 *
 * Ownership invariants (locked):
 * - A2.5 is the producer and semantic owner. The pure RecommendationEngine
 *   writes nothing; this store is appended at the composition root where the
 *   engine's output is used (governance-decision-cli `runDecide`).
 * - A2.5 vocabulary is unchanged: records are verbatim A2.5
 *   `GovernanceRecommendation` (recommendation-contract.ts).
 * - append-only (shared JsonlStore): a stored record is never modified or
 *   deleted. An identical-content duplicate append is a deterministic no-op;
 *   a different-content-same-id append is a FATAL identity collision —
 *   surfaced, never silently merged.
 * - A8 reads ONLY through the read-only RecommendationsAdapter.
 * - Persistence failure surfaces (the caller fails the operation, mirroring
 *   A9's locked persistence behavior) — never a silent empty surface.
 *
 * Implementation is the shared generic append-only JSONL store
 * (jsonl-store.ts, extracted from ForecastsStore + CorrelationsStore).
 *
 * @module evolution/verification/recommendation/recommendation-store
 */

import { join } from "node:path";
import { canonicalStringify } from "../../../security/audit/canonical-json.js";
import type { GovernanceRecommendation } from "../contracts/recommendation-contract.js";
import { JsonlStore } from "../../../evolution/a9/jsonl-store.js";

const STORE_DIR = join(".alix", "verification");
const STORE_FILE = "recommendations.jsonl";

export class RecommendationStore extends JsonlStore<GovernanceRecommendation, string> {
  /** @param storeDir directory holding recommendations.jsonl (defaults to
   *  `process.cwd()/.alix/verification`, the A2.5 namespace). */
  constructor(storeDir: string = join(process.cwd(), STORE_DIR)) {
    super(storeDir, {
      storeFile: STORE_FILE,
      idOf: (r) => r.recommendationId,
      contentOf: recommendationContentOf,
      label: "RecommendationStore",
      idLabel: "recommendationId",
    });
  }
}

/**
 * Canonical content of a recommendation record (everything except its
 * `recommendationId`), serialized with the SAME canonical stringify the
 * duplicate-identity policy uses. Two records with the SAME id must have the
 * SAME canonical content — if they differ, a fatal identity collision occurred
 * (no overwrite, no merge, no silent continue).
 */
export function recommendationContentOf(rec: GovernanceRecommendation): string {
  const { recommendationId: _id, ...content } = rec;
  return canonicalStringify(content);
}
