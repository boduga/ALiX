/**
 * Shared `SOURCE_ARTIFACT_TYPE_MAP` — extracted to a single module so
 * all worktree copies of `forward-ref-extractors.ts` import the same
 * definition and stay in sync.
 *
 * Maps from the `SourceArtifactType` vocabulary (used by RiskScore and
 * GovernanceReview sourceArtifacts[]) into the canonical `ArtifactType`
 * namespace.
 *
 * @module
 */

import type { ArtifactType } from "./evidence-chain-types.js";
import type { SourceArtifactType } from "../adaptation/decision-types.js";

export const SOURCE_ARTIFACT_TYPE_MAP: Partial<
  Record<SourceArtifactType, ArtifactType>
> = {
  proposal: "adaptation_proposal",
  context: "decision_context",
  risk: "risk_score",
  recommendation: "recommendation",
  review: "governance_review",
  lineage: "decision_context",
  effectiveness: "outcome_record",
  intelligence: "outcome_record",
  priority: "decision_context",
};
