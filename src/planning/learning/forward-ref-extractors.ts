/**
 * P8.5a.0 — Forward-reference extractors.
 *
 * One extractor per artifact type. Each extractor takes an artifact
 * and returns `ProvenanceLink[]` that record the artifact's forward
 * dependencies. The Evidence Chain is built by walking the graph
 * via these extractors.
 *
 * Adding a new artifact type = adding one extractor in `EXTRACTORS`.
 * Existing types are not modified.
 *
 * @module
 */

import type {
  ArtifactType,
  ProvenanceLink,
  ProvenanceRelationship,
} from "./evidence-chain-types.js";
import type { OutcomeRecord } from "../adaptation/outcome-types.js";
import type { GovernanceReview } from "../adaptation/governance-review-types.js";
import type { RiskScore } from "../adaptation/risk-score-types.js";
import type {
  LearningSignal,
  CalibrationProfile,
  LearningProposal,
} from "./learning-types.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type { SourceArtifactType } from "../adaptation/decision-types.js";

// ---------------------------------------------------------------------------
// Extractor signature
// ---------------------------------------------------------------------------

/**
 * Extracts forward-provenance references from an artifact and
 * returns the directed links those references imply.
 */
export type ForwardRefExtractor = (artifact: unknown) => ProvenanceLink[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ProvenanceLink. Caller-provided ids/types win; falls back
 * to "?" placeholders if the artifact itself does not carry an id
 * (defensive — extractors normally see well-formed objects).
 */
function link(
  sourceArtifactId: string,
  sourceArtifactType: ArtifactType,
  targetArtifactId: string,
  targetArtifactType: ArtifactType,
  relationship: ProvenanceRelationship,
  recordedAt: string,
): ProvenanceLink {
  return {
    sourceArtifactId,
    sourceArtifactType,
    targetArtifactId,
    targetArtifactType,
    relationship,
    recordedAt,
  };
}

// Mapping from the SourceArtifactType vocabulary (used by RiskScore and
// GovernanceReview sourceArtifacts[]) into the canonical ArtifactType
// namespace. We honor the caller's hint when it maps cleanly; otherwise
// we fall back to a generic "decision_context" target so the link is
// still preserved for traversal (the explain command displays ids).
const SOURCE_ARTIFACT_TYPE_MAP: Partial<Record<SourceArtifactType, ArtifactType>> = {
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

function targetTypeForSource(t: SourceArtifactType): ArtifactType {
  return SOURCE_ARTIFACT_TYPE_MAP[t] ?? "decision_context";
}

// ---------------------------------------------------------------------------
// Per-type extractors
// ---------------------------------------------------------------------------

const outcomeRecord: ForwardRefExtractor = (a) => {
  const o = a as Partial<OutcomeRecord>;
  const links: ProvenanceLink[] = [];
  const recordedAt = o.generatedAt ?? new Date().toISOString();
  if (o.decisionId) {
    links.push(
      link(o.id ?? "?", "outcome_record", o.decisionId, "decision_context", "derived_from", recordedAt),
    );
  }
  if (o.recommendationId) {
    links.push(
      link(o.id ?? "?", "outcome_record", o.recommendationId, "recommendation", "derived_from", recordedAt),
    );
  }
  if (o.governanceReviewId) {
    links.push(
      link(o.id ?? "?", "outcome_record", o.governanceReviewId, "governance_review", "derived_from", recordedAt),
    );
  }
  return links;
};

const governanceReview: ForwardRefExtractor = (a) => {
  const r = a as Partial<GovernanceReview>;
  const links: ProvenanceLink[] = [];
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  if (r.recommendationId) {
    links.push(
      link(r.id ?? "?", "governance_review", r.recommendationId, "recommendation", "reviewed_from", recordedAt),
    );
  }
  if (r.proposalId) {
    links.push(
      link(r.id ?? "?", "governance_review", r.proposalId, "adaptation_proposal", "reviewed_from", recordedAt),
    );
  }
  return links;
};

const riskScore: ForwardRefExtractor = (a) => {
  const r = a as Partial<RiskScore>;
  const links: ProvenanceLink[] = [];
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  for (const src of r.sourceArtifacts ?? []) {
    // Source artifacts carry their own artifactType. We honor it for
    // the chain's correctness, but fall back to "decision_context" when
    // the type is not in our mapping (defensive).
    links.push(
      link(
        r.id ?? "?",
        "risk_score",
        src.id,
        targetTypeForSource(src.type),
        "supports",
        recordedAt,
      ),
    );
  }
  return links;
};

const lensCalibrationReport: ForwardRefExtractor = (a) => {
  // LensCalibrationReport inherits evidenceRefs from DecisionArtifact.
  // Each entry points to an outcome_record that fed the calibration.
  const r = a as Partial<{ id: string; generatedAt: string; evidenceRefs: string[] }>;
  const links: ProvenanceLink[] = [];
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  for (const id of r.evidenceRefs ?? []) {
    links.push(
      link(r.id ?? "?", "lens_calibration_report", id, "outcome_record", "supports", recordedAt),
    );
  }
  return links;
};

const recommendationAccuracyReport: ForwardRefExtractor = (_a) => {
  // RecommendationAccuracyReport is a computed aggregate. No direct
  // forward-ref field; the report's source is implicit (all
  // outcome_records in the window). We return an empty link list.
  // The chain can still record the report node if needed.
  return [];
};

const learningSignal: ForwardRefExtractor = (a) => {
  const s = a as Partial<LearningSignal>;
  const links: ProvenanceLink[] = [];
  const recordedAt = s.generatedAt ?? new Date().toISOString();
  if (s.sourceReportId) {
    links.push(
      link(
        s.id ?? "?",
        "learning_signal",
        s.sourceReportId,
        "recommendation_accuracy_report",
        "derived_from",
        recordedAt,
      ),
    );
  }
  for (const id of s.evidenceRefs ?? []) {
    links.push(
      link(s.id ?? "?", "learning_signal", id, "outcome_record", "supports", recordedAt),
    );
  }
  return links;
};

const calibrationProfile: ForwardRefExtractor = (a) => {
  const p = a as Partial<CalibrationProfile>;
  const links: ProvenanceLink[] = [];
  const recordedAt = p.generatedAt ?? new Date().toISOString();
  for (const id of p.evidenceRefs ?? []) {
    links.push(
      link(p.id ?? "?", "calibration_profile", id, "outcome_record", "supports", recordedAt),
    );
  }
  for (const id of p.sourceSignalIds ?? []) {
    links.push(
      link(p.id ?? "?", "calibration_profile", id, "learning_signal", "derived_from", recordedAt),
    );
  }
  return links;
};

const adaptationProposal: ForwardRefExtractor = (a) => {
  const ap = a as Partial<AdaptationProposal> & {
    sourceSignalIds?: string[];
    approvedBy?: string;
    generatedAt?: string;
  };
  const links: ProvenanceLink[] = [];
  const recordedAt = ap.generatedAt ?? ap.createdAt ?? new Date().toISOString();
  for (const id of ap.sourceSignalIds ?? []) {
    links.push(
      link(ap.id ?? "?", "adaptation_proposal", id, "learning_signal", "derived_from", recordedAt),
    );
  }
  if (ap.approvedBy) {
    // The approver is recorded as an "approved_from" link to the human
    // identity. We deliberately use a permissive targetArtifactType
    // ("decision_context") since human operators are not part of the
    // artifact-type enum. The link's identity carries the meaning.
    links.push(
      link(ap.id ?? "?", "adaptation_proposal", ap.approvedBy, "decision_context", "approved_from", recordedAt),
    );
  }
  return links;
};

const learningProposal: ForwardRefExtractor = (a) => {
  const lp = a as Partial<LearningProposal>;
  const links: ProvenanceLink[] = [];
  const recordedAt = lp.generatedAt ?? new Date().toISOString();
  for (const id of lp.sourceSignalIds ?? []) {
    links.push(
      link(lp.id ?? "?", "learning_proposal", id, "learning_signal", "derived_from", recordedAt),
    );
  }
  return links;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Per-type forward-ref extractor registry. Adding a new artifact type
 * means adding one entry here. The registry MUST cover every ArtifactType
 * except `learning_evidence_chain` (chains don't currently link chains).
 */
export const EXTRACTORS: Record<
  Exclude<ArtifactType, "learning_evidence_chain">,
  ForwardRefExtractor
> = {
  decision_context: () => [],
  risk_score: riskScore,
  recommendation: () => [],
  governance_review: governanceReview,
  outcome_record: outcomeRecord,
  lens_calibration_report: lensCalibrationReport,
  recommendation_accuracy_report: recommendationAccuracyReport,
  adaptation_proposal: adaptationProposal,
  learning_signal: learningSignal,
  calibration_profile: calibrationProfile,
  learning_proposal: learningProposal,
};

/**
 * Public entry point. Looks up the extractor for an artifact type and
 * returns its links. Falls back to `[]` for unknown types
 * (defensive — the registry should cover everything).
 *
 * The extractor's sourceArtifactId (derived from the artifact itself)
 * is overridden with the caller-supplied artifactId so the chain
 * reflects the caller's view of artifact identity.
 */
export function extractForwardRefs(
  artifact: unknown,
  artifactType: ArtifactType,
  artifactId: string,
  recordedAt: string,
): ProvenanceLink[] {
  if (artifactType === "learning_evidence_chain") return [];
  const extractor = (EXTRACTORS as Record<string, ForwardRefExtractor>)[artifactType];
  if (!extractor) return [];
  const links = extractor(artifact);
  // Normalize the source id/type to the caller's view.
  return links.map((l) => ({
    ...l,
    sourceArtifactId: artifactId,
    sourceArtifactType: artifactType as ArtifactType,
    recordedAt: l.recordedAt ?? recordedAt,
  }));
}
