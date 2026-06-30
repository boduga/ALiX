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
  | "evidence_compaction"
  // P4.5 workflow events
  | "issue_selected"
  | "plan_generated"
  | "plan_approved"
  | "plan_rejected"
  | "execution_started"
  | "execution_completed"
  | "review_started"
  | "review_completed"
  | "pr_created"
  | "merge_completed"
  | "workflow_blocked"
  | "workflow_unblocked"
  | "workflow_aborted"
  // P4.5g execution events
  | "execution_subtask_started"
  | "execution_subtask_completed"
  | "execution_test_passed"
  | "execution_test_failed"
  | "execution_commit_created"
  // P4.7 capability routing
  | "agent_resolved"
  | "capability_routed"
  // P5.1 adaptation lifecycle
  | "adaptation_proposed"
  | "adaptation_approved"
  | "adaptation_rejected"
  | "adaptation_applied"
  | "adaptation_failed"
  // P5.2e executable revert
  | "adaptation_snapshot_taken"
  | "adaptation_revert_failed"
  // P5.2b effectiveness assessment
  | "adaptation_effectiveness"
  // P5.5 capability evolution intelligence
  | "reflection_report"
  // P9.3 governance proposal lifecycle
  | "governance_approval_denied"
  | "governance_approval_decision"
  | "governance_orphan_cleaned"
  // P9.4a governance mutation applied
  | "governance_mutation_applied"
  // P10.4a executive execution events
  | "executive_plan_saved"
  | "executive_plan_approved"
  | "executive_plan_rejected"
  | "executive_plan_started"
  | "executive_step_executed"
  | "executive_step_intent_recorded"
  | "executive_step_blocked"
  | "executive_plan_completed"
  | "executive_plan_failed"
  // P10.4b executive proposal bridge events
  | "executive_step_bridged_to_proposal"
  | "executive_step_bridge_failed"
  // P10.4c executive apply reconciler event
  | "executive_step_applied_remediation"
  // P10.9.2c lifecycle automation
  | "executive_step_orchestrated";

/** All valid evidence type strings. */
export const EVIDENCE_TYPES: ReadonlySet<string> = new Set<EvidenceType>([
  "config_signed",
  "trust_evaluation",
  "audit_checkpoint",
  "evidence_compaction",
  // P4.5 workflow events
  "issue_selected",
  "plan_generated",
  "plan_approved",
  "plan_rejected",
  "execution_started",
  "execution_completed",
  "review_started",
  "review_completed",
  "pr_created",
  "merge_completed",
  "workflow_blocked",
  "workflow_unblocked",
  "workflow_aborted",
  // P4.5g execution events
  "execution_subtask_started",
  "execution_subtask_completed",
  "execution_test_passed",
  "execution_test_failed",
  "execution_commit_created",
  "agent_resolved",
  "capability_routed",
  // P5.1 adaptation lifecycle
  "adaptation_proposed",
  "adaptation_approved",
  "adaptation_rejected",
  "adaptation_applied",
  "adaptation_failed",
  // P5.2e executable revert
  "adaptation_snapshot_taken",
  "adaptation_revert_failed",
  // P5.2b effectiveness assessment
  "adaptation_effectiveness",
  // P5.5 capability evolution intelligence
  "reflection_report",
  // P9.3 governance proposal lifecycle
  "governance_approval_denied",
  "governance_approval_decision",
  "governance_orphan_cleaned",
  "governance_mutation_applied",
  // P10.4a executive execution events
  "executive_plan_saved",
  "executive_plan_approved",
  "executive_plan_rejected",
  "executive_plan_started",
  "executive_step_executed",
  "executive_step_intent_recorded",
  "executive_step_blocked",
  "executive_plan_completed",
  "executive_plan_failed",
  // P10.4b executive proposal bridge events
  "executive_step_bridged_to_proposal",
  "executive_step_bridge_failed",
  // P10.4c executive apply reconciler event
  "executive_step_applied_remediation",
  // P10.9.2c lifecycle automation
  "executive_step_orchestrated",
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
