// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.1 — Replay Dataset Contract.
 *
 * Defines the ReplayDataset as a first-class immutable object with
 * content-addressed identity. A replay dataset captures exactly what
 * historical reality was reconstructed — the evidence window, source
 * references, policy/governance snapshots, and construction metadata.
 *
 * The dataset is NEVER embedded in verification results. VerificationRun
 * and VerificationEvidence reference it by ID and hash.
 *
 * @module replay-contract
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";
import { canonicalStringify } from "../../../security/audit/canonical-json.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Domain prefix for replay dataset hashing
// ---------------------------------------------------------------------------

const REPLAY_DATASET_HASH_PREFIX = "alix-evolution-v2:";

// ---------------------------------------------------------------------------
// Historical Window
// ---------------------------------------------------------------------------

export interface HistoricalWindow {
  /** ISO 8601 start of the window. */
  startTime: string;
  /** ISO 8601 end of the window. */
  endTime: string;
  /** Duration in milliseconds (must match startTime - endTime). */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Evidence Source
// ---------------------------------------------------------------------------

export interface EvidenceSource {
  /** Identifier of the source store or collection. */
  sourceId: string;
  /** Type of the source. */
  sourceType: "execution_evidence" | "audit_event" | "telemetry" | "pattern_discovery";
  /** Number of evidence records referenced from this source. */
  referenceCount: number;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface PolicySnapshot {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  capturedAt: string;
  rules: number;
}

export interface TopologySnapshot {
  agentCount: number;
  activePolicies: string[];
  runtimeVersion: string;
}

export interface TelemetrySnapshot {
  metricNames: string[];
  sampleCount: number;
  timeRangeMs: number;
}

export interface AgentConfigurationSnapshot {
  agentIds: string[];
  configurationHashes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Construction Metadata
// ---------------------------------------------------------------------------

export type ConstructionStrategy = "time_window" | "evidence_count" | "scenario_match";

export interface ConstructionMetadata {
  /** How this dataset was constructed. */
  constructionStrategy: ConstructionStrategy;
  /** Criteria used to filter evidence (e.g. window, count, tags). */
  evidenceFilterCriteria: Record<string, unknown>;
  /** Hash identifiers for the snapshot versions used. */
  snapshotVersions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Replay Dataset
// ---------------------------------------------------------------------------

/**
 * First-class immutable object representing a replay dataset.
 *
 * Defines exactly what historical reality was reconstructed for a
 * verification run. Referenced by VerificationRun.replayDatasetId,
 * never embedded directly.
 *
 * @invariant datasetHash is deterministic — same content always produces the same hash.
 * @invariant historicalWindow must be consistent (startTime < endTime, durationMs matches).
 */
export interface ReplayDataset {
  /** Unique dataset identifier. */
  datasetId: string;
  /** Deterministic content hash of this dataset. */
  datasetHash: string;
  /** The historical time window this dataset covers. */
  historicalWindow: HistoricalWindow;
  /** Sources from which evidence was collected. */
  evidenceSources: readonly EvidenceSource[];
  /** Total number of evidence records. */
  evidenceCount: number;
  /** Policy state at construction time. */
  policySnapshot: PolicySnapshot;
  /** System topology snapshot. */
  topologySnapshot: TopologySnapshot;
  /** Resource telemetry snapshot. */
  telemetrySnapshot: TelemetrySnapshot;
  /** Agent configuration snapshot. */
  agentConfigurationSnapshot: AgentConfigurationSnapshot;
  /** How this dataset was constructed. */
  constructionMetadata: ConstructionMetadata;
  /** When this dataset was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// computeDatasetHash
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic content hash of a ReplayDataset.
 *
 * Uses the same canonicalStringify + SHA-256 contract as X-series evidence,
 * with an A2-specific domain prefix ("alix-evolution-v2:") to distinguish
 * it from audit hashes.
 *
 * Pure — no side effects.
 *
 * @param dataset - The dataset to hash (without datasetHash populated).
 * @returns Hex-encoded SHA-256 digest.
 */
export function computeDatasetHash(
  dataset: Omit<ReplayDataset, "datasetHash">,
): string {
  // Defensively strip any datasetHash field that may have been passed in,
  // per the integrity contract (Section 5.4 — hash must not include itself).
  const { datasetHash: _omitted, ...rest } = dataset as ReplayDataset;
  void _omitted;

  const canonical = canonicalStringify(rest);
  const hash = createHash("sha256");
  hash.update(`${REPLAY_DATASET_HASH_PREFIX}${canonical}`);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validate a HistoricalWindow structure.
 */
export function validateHistoricalWindow(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["HistoricalWindow must be an object"] };
  }
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.startTime)) errors.push("startTime required and must be non-empty");
  if (!isNonEmptyString(v.endTime)) errors.push("endTime required and must be non-empty");
  if (typeof v.durationMs !== "number" || (v.durationMs as number) < 0) {
    errors.push("durationMs required and must be non-negative");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a ReplayDataset structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateReplayDataset(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ReplayDataset must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.datasetId)) errors.push("datasetId required and must be non-empty");
  if (!isNonEmptyString(v.datasetHash)) errors.push("datasetHash required and must be non-empty");

  if (!v.historicalWindow || typeof v.historicalWindow !== "object") {
    errors.push("historicalWindow required and must be an object");
  }

  if (!Array.isArray(v.evidenceSources)) errors.push("evidenceSources required and must be an array");
  if (typeof v.evidenceCount !== "number" || (v.evidenceCount as number) < 0) {
    errors.push("evidenceCount required and must be non-negative");
  }
  if (!v.policySnapshot || typeof v.policySnapshot !== "object") {
    errors.push("policySnapshot required and must be an object");
  }
  if (!v.constructionMetadata || typeof v.constructionMetadata !== "object") {
    errors.push("constructionMetadata required and must be an object");
  }
  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}
