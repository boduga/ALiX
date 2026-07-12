// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.4 — Verification Evidence Construction.
 *
 * Constructs VerificationEvidence artifacts — the immutable governance
 * objects distilled from VerificationReports. Includes integrity hashing
 * (Section 5.4) and expiration enforcement (Section 13).
 *
 * @module verification-evidence
 */

import type {
  VerificationEvidence,
  LineageRecord,
  EvidenceClass,
  ReproducibilityLevel,
} from "../contracts/verification-contract.js";
import type { ConfidenceProfile } from "../contracts/confidence-contract.js";
import { canonicalStringify } from "../../../security/audit/canonical-json.js";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_INTEGRITY_PREFIX = "alix-evolution-v2:";
const DEFAULT_EVIDENCE_TTL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// VerificationEvidenceInput
// ---------------------------------------------------------------------------

export interface VerificationEvidenceInput {
  /** The verification run that produced this evidence. */
  verificationId: string;
  /** The evolution proposal this evidence evaluates. */
  proposalId: string;
  /** The replay dataset used during verification. */
  replayDatasetId: string;
  /** Snapshot hash of the proposal at verification time. */
  proposalSnapshotHash: string;
  /** Snapshot hash of the environment at verification time. */
  environmentHash: string;
  /** Baseline metrics from historical replay. */
  baselineMetrics: Record<string, number>;
  /** Candidate metrics from projected replay. */
  candidateMetrics: Record<string, number>;
  /** Per-metric deltas. */
  metricDeltas: Record<string, number>;
  /** Descriptions of behavioural changes. */
  behavioralChanges: string[];
  /** Confidence profile. */
  confidenceProfile: ConfidenceProfile;
  /** Achieved reproducibility level. */
  reproducibilityLevel: ReproducibilityLevel;
  /** Lineage records. */
  lineage: LineageRecord[];
  /** When this evidence was produced (ISO 8601). */
  verifiedAt: string;
  /** When this evidence expires (ISO 8601). Optional — defaults to verifiedAt + 90 days. */
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// createVerificationEvidence
// ---------------------------------------------------------------------------

/**
 * Construct a VerificationEvidence artifact with computed integrity hash.
 *
 * @param input - Evidence construction input.
 * @returns Fully populated VerificationEvidence with integrityHash.
 */
export function createVerificationEvidence(input: VerificationEvidenceInput): VerificationEvidence {
  const expiresAt = input.expiresAt ?? computeExpiry(input.verifiedAt, DEFAULT_EVIDENCE_TTL_DAYS);

  const evidenceWithoutHash: Omit<VerificationEvidence, "integrityHash"> = {
    evidenceId: `ev-ver-${randomUUID()}`,
    verificationId: input.verificationId,
    proposalId: input.proposalId,
    replayDatasetId: input.replayDatasetId,
    evidenceClass: "projected" as EvidenceClass,
    proposalSnapshotHash: input.proposalSnapshotHash,
    environmentHash: input.environmentHash,
    baselineMetrics: { ...input.baselineMetrics },
    candidateMetrics: { ...input.candidateMetrics },
    metricDeltas: { ...input.metricDeltas },
    behavioralChanges: [...input.behavioralChanges],
    confidenceProfile: input.confidenceProfile,
    reproducibilityLevel: input.reproducibilityLevel,
    lineage: [...input.lineage],
    verifiedAt: input.verifiedAt,
    expiresAt,
    reverificationRequired: false,
  };

  const integrityHash = computeEvidenceIntegrityHash(evidenceWithoutHash);

  return {
    ...evidenceWithoutHash,
    integrityHash,
  };
}

// ---------------------------------------------------------------------------
// computeEvidenceIntegrityHash
// ---------------------------------------------------------------------------

/**
 * Compute the integrity hash for verification evidence per Section 5.4.
 *
 * Uses canonicalStringify + SHA-256 with the A2-specific domain prefix
 * ("alix-evolution-v2:"), matching the X-series evidence integrity contract.
 *
 * Excludes:
 * - the integrityHash field itself
 * - any transient runtime metadata
 *
 * Pure — no side effects.
 *
 * @param evidence - Evidence object without the integrityHash field.
 * @returns Hex-encoded SHA-256 digest.
 */
export function computeEvidenceIntegrityHash(
  evidence: Omit<VerificationEvidence, "integrityHash">,
): string {
  // Defensive strip of integrityHash if somehow present
  const { integrityHash: _omitted, ...rest } = evidence as VerificationEvidence;
  void _omitted;

  const canonical = canonicalStringify(rest);
  const hash = createHash("sha256");
  hash.update(`${EVIDENCE_INTEGRITY_PREFIX}${canonical}`);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// isEvidenceExpired
// ---------------------------------------------------------------------------

/**
 * Check whether verification evidence has expired per Section 13.
 *
 * @param evidence - The evidence to check.
 * @param currentTimeMs - Current wall-clock time in ms. Defaults to Date.now().
 * @returns true if current time >= expiresAt; the bridge MUST reject such evidence.
 */
export function isEvidenceExpired(
  evidence: Pick<VerificationEvidence, "expiresAt">,
  currentTimeMs?: number,
): boolean {
  const now = currentTimeMs ?? Date.now();
  const expiryMs = new Date(evidence.expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return true; // unparseable expiry → treat as expired (fail-closed)
  return now >= expiryMs;
}

/**
 * Mark evidence as requiring reverification (used when expiry is reached).
 */
export function markReverificationRequired(
  evidence: VerificationEvidence,
): VerificationEvidence {
  return { ...evidence, reverificationRequired: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeExpiry(verifiedAt: string, ttlDays: number): string {
  const verifiedMs = new Date(verifiedAt).getTime();
  if (!Number.isFinite(verifiedMs)) {
    throw new Error(`verifiedAt must be a valid ISO timestamp, got: ${verifiedAt}`);
  }
  return new Date(verifiedMs + ttlDays * MS_PER_DAY).toISOString();
}
