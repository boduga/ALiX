/**
 * collaboration-types.ts — Shared finding, artifact, and context types for
 * multi-agent collaboration.
 *
 * Workers publish findings and artifacts through a constrained API.
 * The scheduler builds context manifests from dependency results.
 * All records preserve worker, run, timestamp, and evidence provenance.
 */

import type { WorkerOwnershipClaim } from "./coordination-types.js";
import type { CoordinationWorkerResultRecord } from "./coordination-result-store.js";
import type { FindingClaim } from "./collaboration-conflict-types.js";

// ─── Finding and artifact kinds ─────────────────────────────────────

export type FindingKind =
  | "fact" | "decision" | "assumption" | "warning" | "question" | "recommendation";

export type ArtifactKind =
  | "file" | "patch" | "report" | "dataset" | "test_result" | "code_symbol";

export type ContextSelectionReason =
  | "direct_dependency_result" | "dependency_finding" | "referenced_artifact" | "tag_match";

export type CompressionMetadata = {
  originalTokens: number;
  compressedTokens: number;
  algorithm: string;
  compressionRatio: number;
};

export type OmittedByReason = {
  budget: number;
  lowRelevance: number;
  invalidated: number;
  superseded: number;
  staleAttempt: number;
  staleDependency: number;
  staleArtifact: number;
  unauthorized: number;
  duplicate: number;
  semanticRerankLimit: number;
};

export type ScoredManifestFinding = {
  findingId: string;
  sourceWorkerId: string;
  sourceWorkerAttempt: number;
  reason: ContextSelectionReason;
  estimatedTokens: number;
  includedTokens: number;
  digest: string;
  score: number;
  scoreComponents: Record<string, number>;
  selectionReasons: string[];
  compression?: CompressionMetadata;
};

export type CollaborationContextWarningCode =
  | "dependency_result_missing" | "dependency_result_corrupt"
  | "dependency_result_invalid_ref" | "dependency_result_invalid_record"
  | "finding_missing_artifact" | "context_truncated" | "token_estimate_failed";

// ─── Evidence references ────────────────────────────────────────────

export type EvidenceRef =
  | { kind: "worker_result"; ref: string; workerId: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "finding"; findingId: string }
  | { kind: "file"; path: string; digest?: string }
  | { kind: "event"; eventId: string };

// ─── Shared data records ────────────────────────────────────────────

export interface SharedFinding {
  id: string;
  schemaVersion: "1.0";
  runId: string;
  workerId: string;
  workerAttempt: number;
  kind: FindingKind;
  title: string;
  content: string;
  confidence?: number;
  claim?: FindingClaim;
  tags: string[];
  evidenceRefs: EvidenceRef[];
  artifactRefs: string[];
  supersededBy?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedArtifact {
  id: string;
  schemaVersion: "1.0";
  runId: string;
  workerId: string;
  workerAttempt: number;
  kind: ArtifactKind;
  uri: string;
  mediaType?: string;
  digest?: string;
  sizeBytes?: number;
  ownershipClaims: WorkerOwnershipClaim[];
  createdAt: string;
  updatedAt: string;
}

// ─── Context manifest and snapshot ──────────────────────────────────

export type CollaborationContextWarning = {
  code: CollaborationContextWarningCode;
  sourceId?: string;
  message: string;
};

export interface WorkerContextManifest {
  schemaVersion: "1.0" | "1.1";
  runId: string;
  workerId: string;
  workerAttempt: number;
  dependencyWorkerIds: string[];
  findings: ScoredManifestFinding[];
  artifacts: Array<{
    artifactId: string;
    sourceWorkerId: string;
    reason: ContextSelectionReason;
    estimatedTokens: number;
    digest?: string;
  }>;
  results: Array<{
    resultRef: string;
    sourceWorkerId: string;
    reason: "direct_dependency_result";
    estimatedTokens: number;
    outcome: "success" | "failure";
  }>;
  generatedAt: string;
  tokenEstimate: number;
  tokenBudget: number;
  omitted: { findings: number; artifacts: number; results: number };
  omittedByReason: OmittedByReason;
  relevanceConfigFingerprint?: string;
  warnings: CollaborationContextWarning[];
  sourceRevision: number;
  sourceFingerprint: string;
}

export interface WorkerContextSnapshot {
  schemaVersion: "1.0";
  manifestRef: string;
  sourceFingerprint: string;
  dependencyResults: CoordinationWorkerResultRecord[];
  findings: SharedFinding[];
  artifacts: SharedArtifact[];
  renderedText: string;
}

// ─── Store state ────────────────────────────────────────────────────

export interface CollaborationState {
  schemaVersion: "1.0";
  runId: string;
  revision: number;
  findings: SharedFinding[];
  artifacts: SharedArtifact[];
  createdAt: string;
  updatedAt: string;
}

// ─── Filter ─────────────────────────────────────────────────────────

export type FindingFilter = {
  kinds?: FindingKind[];
  tags?: string[];
  workerIds?: string[];
  since?: string;
  limit?: number;
};

// ─── Publish inputs ─────────────────────────────────────────────────

export interface PublishFindingInput {
  kind: FindingKind;
  title: string;
  content: string;
  confidence?: number;
  tags?: string[];
  evidenceRefs?: EvidenceRef[];
  artifactRefs?: string[];
}

export interface PublishArtifactInput {
  kind: ArtifactKind;
  uri: string;
  mediaType?: string;
  digest?: string;
  sizeBytes?: number;
  ownershipClaims?: WorkerOwnershipClaim[];
}

// ─── Actor identity (internal) ──────────────────────────────────────

export type CollaborationActor = {
  runId: string;
  workerId: string;
  workerAttempt: number;
};
