/**
 * audit-types.ts — Audit event types for policy and approval tracking.
 *
 * v1: original flat records with id, action, timestamp, actor, details.
 * v2: tamper-evident hash-chained records with version, seq, prevHash, recordHash.
 */

// ---------------------------------------------------------------------------
// v1 types (preserved for backward compatibility)
// ---------------------------------------------------------------------------

export type AuditAction =
  | "policy.evaluated"
  | "policy.allowed"
  | "policy.denied"
  | "policy.asked"
  | "approval.created"
  | "approval.approved"
  | "approval.denied"
  | "runtime.blocked"
  | "runtime.allowed"
  | "runtime.requires_approval"
  | "graph.continued"
  | "graph.completed"
  | "authorization.allowed"
  | "authorization.denied"
  | "authorization.approval_required"
  | "conflict.detected"
  | "conflict.reported"
  | "conflict.under_review"
  | "conflict.resolved"
  | "conflict.accepted_divergence"
  | "conflict.dismissed"
  | "conflict.candidate_generation"
  | "replan.failed"
  | "replan.error";

/** v1+ action type — any action string allowed (v1 or v2). */
export type AnyAuditAction = AuditAction | SecurityAction;

export interface AuditDetails {
  graphId?: string;
  nodeId?: string;
  capability?: string;
  approvalId?: string;
  policyRuleId?: string;
  policyDecision?: string;
  reason?: string;
  sessionId?: string;
  durationMs?: number;
  requestId?: string;
  toolName?: string;
  agentId?: string;
  source?: string;
  decision?: string;
  riskLevel?: string;
  runId?: string;
  workerId?: string;
  errors?: string[];
  error?: string;
}

export interface AuditRecord {
  id: string;
  action: AuditAction;
  timestamp: string;
  actor?: string;
  details: AuditDetails;
}

// ---------------------------------------------------------------------------
// v2 — Security actions (new actions for the integrity-enabled audit system)
// ---------------------------------------------------------------------------

export type SecurityAction =
  | "auth.success"
  | "auth.failure"
  | "token.create"
  | "token.revoke"
  | "session.create"
  | "session.destroy"
  | "audit.integrity_enabled"
  | "audit.recovery"
  | "audit.stale_lock_recovered"
  | "audit.stale_sidecar_recovered"
  | "audit.genesis"
  | "security.config_changed"
  | "security.rate_limit_hit"
  | "security.connection_blocked";

// ---------------------------------------------------------------------------
// v2 — Hash-chained audit record
// ---------------------------------------------------------------------------

/**
 * A v2 tamper-evident audit record.
 *
 * Every v2 record carries:
 * - `seq` — monotonically increasing sequence number (starts at 1).
 * - `prevHash` — SHA-256 hex digest of the preceding record (null for genesis).
 * - `recordHash` — SHA-256 hex digest of this record's canonical body.
 *
 * The hash chain binds: domain prefix + canonical(body) + seq + prevHash.
 */
export interface AuditRecordV2 {
  /** Always 2 for v2 records. */
  version: 2;
  /** Monotonically increasing sequence number (1-based). */
  seq: number;
  /** Hex SHA-256 digest of the previous record, or null for the genesis record. */
  prevHash: string | null;
  /** Hex SHA-256 digest of this record's canonical data. */
  recordHash: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** The action that triggered this audit record. */
  action: AnyAuditAction;
  /** Optional actor identifier. */
  actor?: string;
  /** Optional redacted details payload. */
  details?: unknown;
}

/**
 * The input shape for appending a v2 record.
 * `seq`, `prevHash`, and `recordHash` are assigned by the chain writer.
 */
export type AuditRecordV2Input = Omit<
  AuditRecordV2,
  "version" | "seq" | "prevHash" | "recordHash"
>;

// ---------------------------------------------------------------------------
// Legacy record (pre-v2 activation)
// ---------------------------------------------------------------------------

/**
 * A record from the legacy (v1) audit log.
 *
 * These records exist before `activateLegacy()` is called. They have no
 * hash chain and are treated as an opaque byte segment by the v2 system.
 */
export interface LegacyAuditRecord {
  id: string;
  action: string;
  timestamp: string;
  actor?: string;
  details: unknown;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the record looks like a v2 audit record.
 */
export function isAuditRecordV2(record: unknown): record is AuditRecordV2 {
  if (record === null || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return r.version === 2 && typeof r.seq === "number" && typeof r.recordHash === "string";
}

/**
 * Returns `true` if the record looks like a legacy (pre-v2) audit record.
 */
export function isLegacyAuditRecord(record: unknown): record is LegacyAuditRecord {
  if (record === null || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  // legacy records have an `id` and a `timestamp` string, but no `version`
  return typeof r.id === "string" && typeof r.timestamp === "string" && r.version === undefined;
}

// ---------------------------------------------------------------------------
// Head sidecar
// ---------------------------------------------------------------------------

/**
 * The head sidecar file tracks the tip of the v2 hash chain.
 * Written atomically after every successful append.
 */
export interface AuditHead {
  /** Sequence number of the most recent v2 record. */
  seq: number;
  /** Hex SHA-256 `recordHash` of the most recent v2 record. */
  recordHash: string;
  /** Hex SHA-256 `prevHash` that the most recent v2 record carried. */
  prevHash: string | null;
  /** Unix timestamp (ms) of the most recent v2 record. */
  timestamp: number;
  /** ISO-8601 timestamp of when this head sidecar was written. */
  updatedAt: string;

  /**
   * Legacy activation metadata — present only after `activateLegacy()`
   * has been called (at least once).
   */
  legacy?: {
    /** SHA-256 hex digest of the legacy bytes segment. */
    digest: string;
    /** Number of legacy records counted. */
    count: number;
    /** Exact byte length of the legacy segment. */
    bytes: number;
    /** Whether the legacy segment has been verified. Always false after activation. */
    verified: false;
  };
}

// ---------------------------------------------------------------------------
// Activation result
// ---------------------------------------------------------------------------

/**
 * Returned by `activateLegacy()`. Describes what happened.
 */
export type ActivationResult =
  | { activated: true; legacyCount: number; legacyBytes: number; legacyDigest: string; activationRecord: AuditRecordV2 }
  | { activated: false; reason: string };
