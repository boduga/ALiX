// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.0 — Verification Contract Types.
 *
 * Core artifact types for the A2 Evolution Verification Framework. Defines
 * the three distinct verification artifacts (Run, Report, Evidence), the
 * evidence class hierarchy, the reproducibility contract, and the typed
 * failure taxonomy.
 *
 * This module is contract-only — no stores, no state machine, no CLI.
 * A2 types are independent of A0 evolution lifecycle types — verification
 * runs have their own lifecycle and are not evolution proposals.
 *
 * @module verification-contract
 */

import type { ConfidenceProfile } from "./confidence-contract.js";
export type { ConfidenceProfile };
import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Evidence Class Hierarchy (Section 3)
// ---------------------------------------------------------------------------

/**
 * Evidence class hierarchy.
 *
 * - `observed`: Records what actually happened — immutable, highest confidence.
 * - `derived`: Computed from observed evidence through analytical transforms.
 * - `projected`: Produced through deterministic verification — counterfactual.
 * - `executed`: Produced by governed execution — real change applied.
 *
 * Downstream consumers MUST respect precedence: `observed > derived > projected > executed`.
 * Projected evidence MUST NOT override observed evidence for the same metric.
 */
export type EvidenceClass = "observed" | "derived" | "projected" | "executed";

/**
 * All valid EvidenceClass values.
 */
export const VALID_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "observed",
  "derived",
  "projected",
  "executed",
];

// ---------------------------------------------------------------------------
// Verification Run Lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a verification run.
 *
 * A2 has its own lifecycle distinct from A0 evolution lifecycle:
 * pending → running → completed | failed | cancelled
 */
export type VerificationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const VERIFICATION_TERMINAL_STATUSES: readonly VerificationStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export const VERIFICATION_ALL_STATUSES: readonly VerificationStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

// ---------------------------------------------------------------------------
// Verification Failure Taxonomy (Section 11)
// ---------------------------------------------------------------------------

/**
 * Typed failure taxonomy for verification runs.
 *
 * Every verification failure carries an explicit kind. Never collapse
 * multiple failure modes into a generic "Verification Failed" string.
 */
export type VerificationFailureKind =
  | "ReplayConstructionFailure"
  | "ReplayIntegrityFailure"
  | "SandboxInitializationFailure"
  | "ProposalExecutionFailure"
  | "DeterminismFailure"
  | "CoverageFailure"
  | "MetricCollectionFailure"
  | "PolicyEvaluationFailure"
  | "ResourceConstraintFailure"
  | "TimeoutFailure";

export const VERIFICATION_FAILURE_KINDS: readonly VerificationFailureKind[] = [
  "ReplayConstructionFailure",
  "ReplayIntegrityFailure",
  "SandboxInitializationFailure",
  "ProposalExecutionFailure",
  "DeterminismFailure",
  "CoverageFailure",
  "MetricCollectionFailure",
  "PolicyEvaluationFailure",
  "ResourceConstraintFailure",
  "TimeoutFailure",
];

// ---------------------------------------------------------------------------
// Reproducibility Levels (Section 7)
// ---------------------------------------------------------------------------

/**
 * Reproducibility level of a verification run.
 *
 * - 0 (metric): Same aggregate measurements.
 * - 1 (report): Equivalent verification reports.
 * - 2 (artifact): Byte-identical verification artifacts.
 * - 3 (cryptographic): Identical hashes across outputs.
 *
 * A2 targets Level 2 for all governance-facing verification runs.
 */
export type ReproducibilityLevel = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Verification Run (Section 5.1)
// ---------------------------------------------------------------------------

/**
 * A Verification Run represents one complete counterfactual evaluation lifecycle.
 *
 * Owns the execution context. Referenced by downstream reports and evidence.
 * Does not contain operational data — that belongs to VerificationReport.
 */
export interface VerificationRun {
  /** Unique run identifier. */
  verificationId: string;
  /** Proposal being evaluated. */
  proposalId: string;
  /** Replay dataset used for this run. */
  replayDatasetId: string;
  /** Environment configuration hash. */
  environmentHash: string;
  /** When the run started. */
  startedAt: string;
  /** When the run completed (null if still running or failed to start). */
  completedAt: string | null;
  /** Current lifecycle status. */
  status: VerificationStatus;
  /** Typed failure reason (null if no failure occurred). */
  failureReason: VerificationFailureKind | null;
}

// ---------------------------------------------------------------------------
// Verification Report (Section 5.2)
// ---------------------------------------------------------------------------

/**
 * A Verification Report is an operational artifact.
 *
 * Purpose: debugging, engineering analysis, investigation.
 * Reports may be large. They are NOT the primary governance object.
 * Governance uses VerificationEvidence, not VerificationReport.
 *
 * @invariant evidenceClass is always "projected" for A2-generated reports.
 */
export interface MetricResult {
  name: string;
  baselineValue: number;
  candidateValue: number;
  delta: number;
}

export interface VerificationReport {
  /** Unique report identifier. */
  reportId: string;
  /** The verification run that produced this report. */
  verificationId: string;
  /** Evidence class — always "projected" for A2-generated reports. */
  evidenceClass: EvidenceClass;
  /** Metadata about the replay execution. */
  replayMetadata: Record<string, unknown>;
  /** Ordered execution log entries. */
  executionLogs: readonly string[];
  /** Per-metric comparison results. */
  metricResults: readonly MetricResult[];
  /** Diagnostic information for investigation. */
  diagnostics: readonly Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

/**
 * A record in the evidence provenance chain.
 */
export interface LineageRecord {
  /** Step name in the verification pipeline. */
  step: string;
  /** Identifier of the source artifact. */
  sourceId: string;
  /** Type of the source artifact. */
  sourceType: "replay_dataset" | "proposal" | "run" | "evaluation";
  /** When this lineage step was recorded. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Verification Evidence (Section 5.3)
// ---------------------------------------------------------------------------

/**
 * Verification Evidence is the immutable governance artifact.
 *
 * Purpose: consumed by A3, stored in evidence ledger, referenced by
 * evolution lifecycle. Produced by distilling a VerificationReport
 * into its essential governance-facing structure.
 *
 * @invariant evidenceClass is always "projected" for A2-generated evidence.
 * @invariant integrityHash follows the same canonical hashing contract
 *            as X-series evidence (canonicalStringify + SHA-256).
 */
export interface VerificationEvidence {
  /** Unique evidence identifier. */
  evidenceId: string;
  /** The verification run that produced this evidence. */
  verificationId: string;
  /** The evolution proposal this evidence evaluates. */
  proposalId: string;
  /** The replay dataset used during verification. */
  replayDatasetId: string;
  /** Evidence class — always "projected" for A2-generated evidence. */
  evidenceClass: EvidenceClass;
  /** Snapshot hash of the proposal at verification time. */
  proposalSnapshotHash: string;
  /** Snapshot hash of the environment at verification time. */
  environmentHash: string;

  // -- Counterfactual comparison (Section 8.1) --
  /** Baseline metrics from historical replay. */
  baselineMetrics: Record<string, number>;
  /** Candidate metrics from projected replay. */
  candidateMetrics: Record<string, number>;
  /** Per-metric deltas (candidate - baseline). */
  metricDeltas: Record<string, number>;
  /** Descriptions of behavioural changes detected. */
  behavioralChanges: string[];

  // -- Confidence (Section 9) --
  /** Confidence profile for this evidence. */
  confidenceProfile: ConfidenceProfile;

  // -- Reproducibility (Section 7) --
  /** Achieved reproducibility level. */
  reproducibilityLevel: ReproducibilityLevel;

  // -- Lineage (Section 10) --
  /** Ordered chain of provenance records. */
  lineage: readonly LineageRecord[];

  // -- Expiry (Section 13) --
  /** When this evidence was produced. */
  verifiedAt: string;
  /** When this evidence expires and requires re-verification. */
  expiresAt: string;
  /** Whether re-verification is needed. */
  reverificationRequired: boolean;

  // -- Integrity (Section 5.4) --
  /** Canonical integrity hash of this evidence object. */
  integrityHash: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a VerificationStatus value.
 */
export function isValidVerificationStatus(v: string): v is VerificationStatus {
  return (VERIFICATION_ALL_STATUSES as readonly string[]).includes(v);
}

/**
 * Validate a VerificationFailureKind value.
 */
export function isValidVerificationFailureKind(v: string): v is VerificationFailureKind {
  return (VERIFICATION_FAILURE_KINDS as readonly string[]).includes(v);
}

/**
 * Validate a ReproducibilityLevel value.
 */
export function isValidReproducibilityLevel(v: unknown): v is ReproducibilityLevel {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a VerificationRun structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateVerificationRun(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["VerificationRun must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.verificationId)) errors.push("verificationId required and must be non-empty");
  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");
  if (!isNonEmptyString(v.replayDatasetId)) errors.push("replayDatasetId required and must be non-empty");
  if (!isNonEmptyString(v.environmentHash)) errors.push("environmentHash required and must be non-empty");
  if (!isNonEmptyString(v.startedAt)) errors.push("startedAt required and must be non-empty");

  if (v.status === undefined || v.status === null) {
    errors.push("status required");
  } else if (typeof v.status !== "string" || !isValidVerificationStatus(v.status as string)) {
    errors.push(`status must be one of: ${VERIFICATION_ALL_STATUSES.join(", ")}`);
  }

  if (v.failureReason !== null && v.failureReason !== undefined) {
    if (typeof v.failureReason !== "string" || !isValidVerificationFailureKind(v.failureReason as string)) {
      errors.push(`failureReason must be a valid VerificationFailureKind or null`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a VerificationReport structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateVerificationReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["VerificationReport must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.reportId)) errors.push("reportId required and must be non-empty");
  if (!isNonEmptyString(v.verificationId)) errors.push("verificationId required and must be non-empty");

  if (v.evidenceClass !== "projected") {
    errors.push("evidenceClass must be 'projected' for A2-generated reports");
  }

  if (!Array.isArray(v.executionLogs)) errors.push("executionLogs required and must be an array");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a VerificationEvidence structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateVerificationEvidence(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["VerificationEvidence must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.evidenceId)) errors.push("evidenceId required and must be non-empty");
  if (!isNonEmptyString(v.verificationId)) errors.push("verificationId required and must be non-empty");
  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");
  if (!isNonEmptyString(v.replayDatasetId)) errors.push("replayDatasetId required and must be non-empty");

  if (v.evidenceClass !== "projected") {
    errors.push("evidenceClass must be 'projected' for A2-generated evidence");
  }

  if (!isNonEmptyString(v.proposalSnapshotHash)) errors.push("proposalSnapshotHash required and must be non-empty");
  if (!isNonEmptyString(v.environmentHash)) errors.push("environmentHash required and must be non-empty");

  if (typeof v.baselineMetrics !== "object" || v.baselineMetrics === null) {
    errors.push("baselineMetrics required and must be an object");
  }
  if (typeof v.candidateMetrics !== "object" || v.candidateMetrics === null) {
    errors.push("candidateMetrics required and must be an object");
  }

  if (!isNonEmptyString(v.verifiedAt)) errors.push("verifiedAt required and must be non-empty");
  if (!isNonEmptyString(v.expiresAt)) errors.push("expiresAt required and must be non-empty");
  if (typeof v.reverificationRequired !== "boolean") errors.push("reverificationRequired must be a boolean");
  if (!isNonEmptyString(v.integrityHash)) errors.push("integrityHash required and must be non-empty");

  if (v.reproducibilityLevel === undefined || v.reproducibilityLevel === null || !isValidReproducibilityLevel(v.reproducibilityLevel)) {
    errors.push("reproducibilityLevel must be 0, 1, 2, or 3");
  }

  return { valid: errors.length === 0, errors };
}
