/**
 * P8.5a.0 — Evidence Chain / Provenance Graph types.
 *
 * The chain is a separate, append-only graph artifact that records
 * relationships between existing P6/P7/P8 artifacts. It does NOT
 * modify any existing type — the chain derives forward refs that
 * already exist on each artifact (decisionId, recommendationId,
 * sourceSignalIds, evidenceRefs, etc.).
 *
 * Core invariants:
 * - Append-only: chains are records, not state.
 * - Source artifacts remain facts: the chain observes
 *   relationships but never rewrites them.
 * - Exactly five provenance relationships; exhaustive and additive —
 *   adding a new value requires a plan update.
 *
 * @module
 */

import type { DecisionArtifact } from "../adaptation/decision-types.js";

// ---------------------------------------------------------------------------
// Provenance relationships
// ---------------------------------------------------------------------------

/**
 * Exactly five relationships the chain records between artifacts.
 * Each describes a directed edge from a dependent artifact to a source.
 */
export type ProvenanceRelationship =
  | "derived_from" // A derived from B (e.g., signal from outcome)
  | "supports" // A provides evidence for B (e.g., outcome supports decision)
  | "generated" // A generated B (e.g., profile generated proposal)
  | "approved_from" // A approved from B (e.g., proposal approved from review)
  | "reviewed_from"; // A was reviewed from B (e.g., review was on recommendation)

export const PROVENANCE_RELATIONSHIPS: readonly ProvenanceRelationship[] =
  Object.freeze([
    "derived_from",
    "supports",
    "generated",
    "approved_from",
    "reviewed_from",
  ] as const);

export function isProvenanceRelationship(v: unknown): v is ProvenanceRelationship {
  return (
    typeof v === "string" &&
    (PROVENANCE_RELATIONSHIPS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Artifact types
// ---------------------------------------------------------------------------

/**
 * Every artifact type that can participate in the Evidence Chain.
 * `learning_evidence_chain` is included so chains can link other chains
 * (a future audit may compose multiple chains into a higher-level view).
 */
export type ArtifactType =
  | "decision_context"
  | "risk_score"
  | "recommendation"
  | "governance_review"
  | "outcome_record"
  | "lens_calibration_report"
  | "recommendation_accuracy_report"
  | "adaptation_proposal"
  | "learning_signal"
  | "calibration_profile"
  | "learning_proposal"
  | "learning_evidence_chain";

export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.freeze([
  "decision_context",
  "risk_score",
  "recommendation",
  "governance_review",
  "outcome_record",
  "lens_calibration_report",
  "recommendation_accuracy_report",
  "adaptation_proposal",
  "learning_signal",
  "calibration_profile",
  "learning_proposal",
  "learning_evidence_chain",
] as const);

export function isArtifactType(v: unknown): v is ArtifactType {
  return typeof v === "string" && (ARTIFACT_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Explain depth constants (shared by extractors and the future `alix explain` CLI)
// ---------------------------------------------------------------------------

/** Default traversal depth for `alix explain <id>`. */
export const EXPLAIN_DEFAULT_DEPTH = 5;

/** Hard upper bound on traversal depth. Prevents runaway graph walks. */
export const EXPLAIN_MAX_DEPTH = 12;

// ---------------------------------------------------------------------------
// ProvenanceLink
// ---------------------------------------------------------------------------

/**
 * A single directed edge in the Evidence Chain.
 *
 * Direction: from `sourceArtifactId` (the dependent / derived artifact)
 * to `targetArtifactId` (the artifact it depends on / derived from).
 */
export interface ProvenanceLink {
  /** The artifact that depends on / was derived from something. */
  sourceArtifactId: string;
  /** Type of the source artifact. */
  sourceArtifactType: ArtifactType;

  /** The artifact it depends on / was derived from. */
  targetArtifactId: string;
  /** Type of the target artifact. */
  targetArtifactType: ArtifactType;

  /** The relationship between source and target. */
  relationship: ProvenanceRelationship;

  /** When this link was recorded. */
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// LearningEvidenceChain
// ---------------------------------------------------------------------------

/**
 * A persisted, derived artifact capturing the provenance graph rooted
 * at a single artifact. Persisted to enable replay and audit — `alix
 * explain prop-x` should not require re-running every builder.
 *
 * Extends DecisionArtifact so the chain participates in the existing
 * governance pipeline (provenance, lineage, evidence refs).
 */
export interface LearningEvidenceChain extends DecisionArtifact {
  /** The artifact this chain is rooted at. */
  rootArtifactId: string;
  /** Type of the root artifact. */
  rootArtifactType: ArtifactType;

  /** Ordered provenance links, traversing outward from the root. */
  links: ProvenanceLink[];

  /** Maximum depth traversed (1 = direct links, N = transitive). */
  depth: number;

  /** Optional: which lookup triggered this chain assembly. */
  generatedBy?: "alix explain" | "alix learning refresh" | "alix audit";
}
