/**
 * P4.4a — Evidence Memory: record types.
 *
 * Defines the evidence record schema used by the append-only evidence store.
 * Every record carries a deterministic fingerprint so the chain is verifiable.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Evidence record schema version
// ---------------------------------------------------------------------------

/** Current schema version for evidence records. */
export const EVIDENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

/**
 * Evidence record types.
 *
 * - `config_signed`: a config signature was produced (recorded after sign())
 * - `trust_evaluation`: a trust check ran (recorded after evaluateTrust())
 * - `audit_checkpoint`: an audit checkpoint was created
 * - `evidence_compaction`: older evidence was compacted into a summary
 */
export type EvidenceType =
  | "config_signed"
  | "trust_evaluation"
  | "audit_checkpoint"
  | "evidence_compaction";

/** All valid evidence type strings. */
export const EVIDENCE_TYPES: ReadonlySet<string> = new Set<EvidenceType>([
  "config_signed",
  "trust_evaluation",
  "audit_checkpoint",
  "evidence_compaction",
]);

// ---------------------------------------------------------------------------
// Evidence record
// ---------------------------------------------------------------------------

/**
 * A single evidence record in the append-only store.
 *
 * Properties:
 * - `version` — schema version for forward compatibility
 * - `id` — UUID v4, unique per record
 * - `type` — evidence classification
 * - `timestamp` — ISO 8601 when the evidence was recorded
 * - `fingerprint` — SHA-256 hex digest of canonical(type + timestamp + payload).
 *   Included in the record so readers can verify without recomputing.
 * - `payload` — type-specific evidence data (never contains secrets)
 */
export interface EvidenceRecord {
  version: typeof EVIDENCE_SCHEMA_VERSION;
  id: string;
  type: EvidenceType;
  timestamp: string;
  fingerprint: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Type-specific payload shapes (for documentation and type narrowing)
// ---------------------------------------------------------------------------

/** Payload for `config_signed` records. */
export interface ConfigSignedPayload {
  configVersion: number;
  keyId: string;
  configHash: string;
  prevConfigHash: string | null;
  signatureFingerprint: string; // first 16 hex of signature
}

/** Payload for `trust_evaluation` records. */
export interface TrustEvaluationPayload {
  configVersion: number;
  trusted: boolean;
  signed: boolean;
  signatureValid: boolean;
  versionOk: boolean;
  keyId?: string;
  issueCount: number;
}

/** Payload for `audit_checkpoint` records. */
export interface AuditCheckpointPayload {
  sequence: number;
  recordHash: string;
  signerKeyId: string;
}

/** Payload for `evidence_compaction` records. */
export interface EvidenceCompactionPayload {
  compactedType: string;
  recordCount: number;
  oldestTimestamp: string;
  newestTimestamp: string;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface EvidenceQuery {
  type?: EvidenceType;
  after?: string; // ISO 8601
  before?: string; // ISO 8601
  fingerprint?: string;
  limit?: number;
}

export interface EvidenceQueryResult {
  records: EvidenceRecord[];
  total: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Store config
// ---------------------------------------------------------------------------

export interface EvidenceStoreConfig {
  /** Directory where the evidence JSONL file lives. */
  storeDir: string;
  /** Lock file path (defaults to <storeDir>/evidence.lock). */
  lockPath?: string;
  /** Max records returned per query. Default 100. */
  defaultQueryLimit?: number;
  /** Max lines to scan during stream read. Default 100000. */
  maxScanLines?: number;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

export interface CompactionResult {
  recordsBefore: number;
  recordsAfter: number;
  summaryRecord: EvidenceRecord | null;
}
