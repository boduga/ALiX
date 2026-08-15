import { createHash } from "node:crypto";
import type { LearningProposal } from "./contracts/learning-contract.js";
import type { GovernanceRecommendation } from "../../evolution/verification/contracts/recommendation-contract.js";

/**
 * A2.5 bridge for A8 proposals.
 *
 * CRITICAL: always constructs `kind: "MONITOR"`. A8 proposals are diagnostic
 * only; they cannot directly authorize mutations. If a future program wants
 * A8 to recommend strategy changes, that is a NEW architectural increment
 * with its own bridge.
 *
 * ---------------------------------------------------------------------------
 * Field-shape adaptation (T6 reconnaissance deviation)
 * ---------------------------------------------------------------------------
 *
 * The T6 brief imported `GovernanceRecommendation` from
 * `../../governance/governance-types.ts`, but that file exports a DIFFERENT
 * `GovernanceRecommendation` interface (governance.report record carrying
 * `recommendations: Recommendation[]` — P9.1 domain), not the A2.5
 * verification-framework recommendation type that this bridge is supposed to
 * produce.
 *
 * The A2.5 verification-framework `GovernanceRecommendation` lives in
 * `../../evolution/verification/contracts/recommendation-contract.ts` and
 * has the shape `{ recommendationId, evidenceId, proposalId, kind, confidence,
 * reasoning, supportingEvidence, risks, createdAt }`. That is the type this
 * bridge emits, per the A8 architectural binding
 * (adapters → pure detectors → LearningFinding[] → LearningProposal → A2.5
 * bridge → GovernanceRecommendation(kind: "MONITOR") → A3 generateDecision).
 *
 * Field-name adaptations from the brief's literal:
 * - brief `evidence`             → actual `supportingEvidence: string[]`
 *                                   (per `validateGovernanceRecommendation`
 *                                   contract; the brief's "evidence" name
 *                                   matches the source `LearningFinding.
 *                                   evidenceRefs`, but the destination
 *                                   `GovernanceRecommendation` field is
 *                                   `supportingEvidence`)
 * - brief `decidedBy`            → DROPPED — no such field on the type. The
 *                                   producing actor is recorded in `reasoning`.
 * - brief `generatedAt`          → actual `createdAt` (per
 *                                   `validateGovernanceRecommendation`).
 * - missing `recommendationId`   → REQUIRED non-empty field; derived as
 *                                   `a8-rec:${proposalId}` so it is unique,
 *                                   traceable to the source proposal, and
 *                                   conforms to validator.
 * - missing `evidenceId`         → REQUIRED non-empty field; derived as a
 *                                   sha-256-hex digest of the sorted finding
 *                                   ids (deterministic for a given proposal).
 * - missing `risks`              → REQUIRED field; emitted as `[]` because
 *                                   A8 surfaces organizational PATTERNS, not
 *                                   per-proposal risk judgments.
 *
 * Consumers (decision-engine `computeRecommendationTracking`,
 * recommendation-engine `RecommendationEngine.generate`, etc.) already handle
 * `kind: "MONITOR"` correctly — `MONITOR` is one of the four `kind` values
 * the existing A2.5 engine can emit, and the decision engine maps it 1:1 to
 * `MONITOR` via `RECOMMENDATION_KIND_MAP`.
 */
export function buildGovernanceRecommendation(
  proposal: LearningProposal,
): GovernanceRecommendation {
  const recommendationId = `a8-rec:${proposal.proposalId}`;
  const evidenceId = hashFindingIds(proposal);
  const supportingEvidence = proposal.findings.flatMap((f) => [...f.evidenceRefs]);

  return {
    recommendationId,
    evidenceId,
    proposalId: proposal.proposalId,
    kind: "MONITOR",
    confidence: 1.0,
    reasoning: `A8 detected ${proposal.findings.length} organizational pattern(s); see LearningProposal ${proposal.proposalId} (producer: a8_organizational_learning)`,
    supportingEvidence,
    risks: [],
    createdAt: proposal.generatedAt,
  };
}

/**
 * Derive a stable `evidenceId` from the sorted finding ids of a proposal.
 *
 * The validator requires `evidenceId` to be a non-empty string; it does not
 * prescribe shape. We use a sha-256 hex digest of the joined, sorted finding
 * ids so that two proposals with identical findings yield identical
 * `evidenceId` values (helpful for downstream deduplication / clustering),
 * while proposals differing in even one finding id diverge.
 */
function hashFindingIds(proposal: LearningProposal): string {
  const ids = proposal.findings.map((f) => f.findingId).sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(ids.join("|")).digest("hex");
}