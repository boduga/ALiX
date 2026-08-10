// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Curation Contract Types.
 *
 * Core artifact types for the A6 Knowledge Evolution curation engine.
 * Defines the normalized in-memory KnowledgeArtifact read model (projected
 * from ALiX's knowledge stores by read-only adapters), the CurationFinding
 * emitted by pure detectors, the internal CurationProposal wrapped for A3
 * governance (deliberately NOT a DecisionArtifact), the explicit
 * CurationConfig thresholds, and the engine output shape (findings + store
 * status).
 *
 * @module curation-contract
 */

// ---------------------------------------------------------------------------
// KnowledgeStore
// ---------------------------------------------------------------------------

/**
 * ALiX knowledge stores A6 projects artifacts from.
 *
 * Includes "evidence" for the A5 VerificationEvidenceLedger projection
 * (evidence-adapter), in addition to the four native knowledge stores.
 */
export type KnowledgeStore =
  | "learning"
  | "chronicle"
  | "failure_memory"
  | "pattern_registry"
  | "evidence";

// ---------------------------------------------------------------------------
// KnowledgeArtifact (normalized read model)
// ---------------------------------------------------------------------------

/**
 * Normalized in-memory read model projected from a knowledge store by a
 * read-only adapter. Not a serializable DTO and never persisted.
 */
export interface KnowledgeArtifact {
  /** Which store this artifact was projected from. */
  readonly store: KnowledgeStore;
  /** Unique artifact id within its store. */
  readonly artifactId: string;
  /** Store-native artifact kind (e.g. "LearningSignal", "FailureRecord"). */
  readonly artifactKind: string;
  /** Optional cluster key — subsystem / policy / task-type. */
  readonly subject?: string;
  /** Normalized text used for similarity + dedup. */
  readonly content: string;
  /** ISO 8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO 8601 last-updated timestamp (absent if the store has none). */
  readonly updatedAt?: string;
  /** Evidence IDs (e.g. A5 observed evidence) supporting this artifact. */
  readonly evidenceRefs: readonly string[];
  /** IDs of artifacts that reference this one downstream. */
  readonly downstreamRefs: readonly string[];
  /**
   * Structured claim, exposed only where the underlying store already has one.
   * Contradiction detection operates only on this.
   */
  readonly claim?: {
    readonly subject: string;
    readonly predicate: string;
    readonly value: string;
  };
}

// ---------------------------------------------------------------------------
// CurationFinding
// ---------------------------------------------------------------------------

export type CurationFindingKind =
  | "stale"
  | "duplicate"
  | "contradiction"
  | "compressible";

export const VALID_CURATION_FINDING_KINDS: readonly CurationFindingKind[] = [
  "stale",
  "duplicate",
  "contradiction",
  "compressible",
];

/** Finding severity, independent of detector confidence. */
export type CurationFindingSeverity = "low" | "medium" | "high";

/**
 * A single curation finding emitted by a pure detector.
 *
 * @invariant findingId is deterministic — a hash of (store, kind, artifactId,
 *   targetId?) — NOT the detection circumstances (see design spec §4.4).
 */
export interface CurationFinding {
  /** Deterministic identity of the artifact relationship being curated. */
  readonly findingId: string;
  readonly kind: CurationFindingKind;
  /** Deterministic subtype, not parsed from rationale. */
  readonly reasonCode: string;
  readonly store: KnowledgeStore;
  /** The artifact flagged. */
  readonly artifactId: string;
  readonly artifactKind: string;
  /** For duplicate/contradiction: the related artifact. */
  readonly targetId?: string;
  readonly severity: CurationFindingSeverity;
  /** Human-readable why. */
  readonly rationale: string;
  /** Evidence IDs supporting this finding (e.g. A5 observed evidence). */
  readonly evidenceRefs: readonly string[];
  /** Detector confidence in [0, 1]. */
  readonly confidence: number;
  /** Observation timestamp — NOT part of deterministic identity. */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// CurationProposal
// ---------------------------------------------------------------------------

/**
 * A6's internal proposal artifact.
 *
 * Deliberately does NOT extend DecisionArtifact — DecisionArtifact requires
 * A3-facing fields (id, subject, outcome, confidence, reasons, generatedAt)
 * that belong to the governance artifact the builder constructs, not the
 * curation phase.
 */
export interface CurationProposal {
  readonly proposalId: string;
  readonly findings: CurationFinding[];
  /** One-line summary: "N stale, M duplicate..." */
  readonly summary: string;
  /** Dimensions covered by this proposal. */
  readonly dimension: CurationFindingKind[];
  /** Observation timestamp — not part of deterministic identity. */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// CurationConfig
// ---------------------------------------------------------------------------

/**
 * Explicit detector thresholds — passed into each detector
 * (detect(artifacts, config)); never hard-coded in detectors.
 */
export interface CurationConfig {
  /** Artifacts older than this many days are stale candidates (default 90). */
  readonly staleAfterDays: number;
  /** Similarity at/above which two artifacts are duplicates (default 0.9). */
  readonly duplicateSimilarityThreshold: number;
  /** Artifacts older than this and low-value are compression candidates. */
  readonly compressionAfterDays: number;
}

export const DEFAULT_CURATION_CONFIG: CurationConfig = {
  staleAfterDays: 90,
  duplicateSimilarityThreshold: 0.9,
  compressionAfterDays: 180,
};

// ---------------------------------------------------------------------------
// CurationResult
// ---------------------------------------------------------------------------

/**
 * Per-store availability — NOT a curation finding and must never become a
 * governance proposal.
 */
export type StoreStatus =
  | { status: "available"; store: KnowledgeStore }
  | { status: "unavailable"; store: KnowledgeStore; reason?: string };

/** Engine output: findings + store availability diagnostics. */
export interface CurationResult {
  readonly findings: CurationFinding[];
  readonly storeStatus: StoreStatus[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Runtime guard for the normalized KnowledgeArtifact read model. */
export function isKnowledgeArtifact(v: unknown): v is KnowledgeArtifact {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as KnowledgeArtifact).store === "string" &&
    typeof (v as KnowledgeArtifact).artifactId === "string" &&
    typeof (v as KnowledgeArtifact).content === "string" &&
    typeof (v as KnowledgeArtifact).createdAt === "string"
  );
}

/** Runtime guard for CurationFinding. */
export function isCurationFinding(v: unknown): v is CurationFinding {
  if (typeof v !== "object" || v === null) return false;
  const c = v as CurationFinding;
  return (
    typeof c.findingId === "string" &&
    typeof c.kind === "string" &&
    (VALID_CURATION_FINDING_KINDS as readonly string[]).includes(c.kind) &&
    typeof c.store === "string" &&
    typeof c.artifactId === "string" &&
    typeof c.createdAt === "string"
  );
}
