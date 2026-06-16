/**
 * collaboration-conflict-types.ts — Core types for finding conflict detection,
 * evidence comparison, and resolution.
 */

export type ConflictStatus = "detected" | "under_review" | "resolved" | "accepted_divergence" | "dismissed" | "superseded";
export type ConflictType = "contradiction" | "competing_decision" | "stale_evidence" | "artifact_mismatch" | "confidence_disagreement" | "scope_overlap" | "worker_reported";
export type DetectionMethod = "deterministic" | "worker_report" | "model_assisted";
export type ClaimValueType = "string" | "number" | "boolean" | "enum" | "version" | "digest" | "path" | "unknown";
export type ClaimCompatibility = "compatible" | "incompatible" | "different_scope" | "insufficient_structure" | "uncertain";

export type FindingClaim = {
  subject: string; predicate: string; value: string; valueType: ClaimValueType;
  unit?: string; scope?: string;
  normalizedSubject: string; normalizedPredicate: string; normalizedValue: string;
  extractionMethod: "structured" | "deterministic" | "model_assisted";
  extractionVersion: string;
};

export type ClaimComparison = {
  leftFindingId: string; rightFindingId: string;
  compatibility: ClaimCompatibility;
  type?: ConflictType;
  reasons: string[];
  comparatorVersion: string;
};

export type EvidenceComparisonRanking = {
  findingId: string; score: number;
  components: { freshness: number; evidenceQuality: number; confidence: number; sourceAttempt: number; resultProvenance: number; artifactIntegrity: number; };
  reasons: string[];
};

export type EvidenceComparison = {
  ranking: EvidenceComparisonRanking[];
  confidence: "high" | "medium" | "low";
  scoreMargin: number;
  recommendation: "prefer_stronger_evidence" | "request_more_evidence" | "accept_divergence" | "human_review";
  unresolvedReasons: string[];
};

export type ConflictResolution = {
  decision: string;
  acceptedFindingIds: string[];
  rejectedFindingIds: string[];
  resolver: { kind: "worker" | "operator" | "planner"; id: string; };
  evidenceRefs: any[];
  resolvedAt: string;
};

export type ConflictHistoryEntry = {
  action: "created" | "updated" | "under_review" | "resolved" | "accepted_divergence" | "dismissed" | "superseded";
  actor?: { kind: string; id: string; };
  at: string;
  reason?: string;
};

export type ConflictResolverAuthority =
  | { kind: "worker"; workerId: string; allowedConflictIds?: string[] }
  | { kind: "operator"; actorId: string; }
  | { kind: "planner"; plannerId: string; };

export interface FindingConflict {
  id: string; schemaVersion: "1.0";
  runId: string; conflictFingerprint: string; topicKey: string;
  type: ConflictType; status: ConflictStatus;
  findingIds: string[];
  claimComparisons: ClaimComparison[];
  evidenceComparison: EvidenceComparison;
  detectedBy: DetectionMethod[];
  criticality: "info" | "warning" | "critical";
  blocksDownstreamByPolicy: boolean;
  resolution?: ConflictResolution;
  history: ConflictHistoryEntry[];
  createdAt: string; updatedAt: string;
}
