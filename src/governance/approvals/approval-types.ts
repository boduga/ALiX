/**
 * approval-types.ts — Core types for the approval lifecycle system.
 *
 * Builds on the existing ApprovalRecord from approval-store.ts with
 * lifecycle statuses, use policies, and audit fields.
 */

import type { WorkerOwnershipClaim } from "../../coordination/kernel/coordination-types.js";

export type ApprovalStatus =
  | "pending" | "approved" | "denied"
  | "consumed" | "expired" | "revoked" | "invalidated";

export type ApprovalUsePolicy =
  | "single_use" | "worker_attempt" | "coordination_run" | "session";

export interface ApprovalRecord {
  id: string;
  schemaVersion: "2.0";
  status: ApprovalStatus;
  usePolicy: ApprovalUsePolicy;

  bindingKey: string;
  requestFingerprint: string;
  policyRevision: string;

  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  /** Canonical runtime agent identity responsible for this approval. */
  agentId?: string;
  /** Stable request id (typically the toolCallId) — used to detect re-executions
   * of the same tool call and prevent duplicate approvals. */
  requestId?: string;

  capabilities: string[];
  toolId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";

  ownershipClaims: WorkerOwnershipClaim[];
  ownershipClaimsHash?: string;

  groupId?: string;

  reason: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decisionReason?: string;
  decidedBy?: string;
  consumedAt?: string;
  consumedByWorkerId?: string;
  consumedAttempt?: number;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  /**
   * SRAP-1 authenticated remote-decision evidence, when this record was decided
   * through the remote endpoint. Persisted inside the authoritative
   * `approval.updated` ledger payload (ADR-0015). Absent for CLI/local decisions.
   */
  remoteDecisionEvidence?: RemoteDecisionEvidence;
  metadata?: Record<string, unknown>;
}

export type ApprovalGroup = {
  id: string;
  schemaVersion: "1.0";
  approvalIds: string[];
  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  ownershipClaimsHash?: string;
  policyRevision: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "denied" | "partial" | "expired" | "revoked" | "consumed";
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
};

export type ConsumeResult =
  | { consumed: true; record: ApprovalRecord }
  | { consumed: false; reason: string };

/**
 * SRAP-1 authenticated remote-decision evidence.
 *
 * Bounded, minimal, and safe to persist in the authoritative `approval.updated`
 * ledger payload (see ADR-0015). Never carries a raw bearer token, cookie, or
 * raw credential id — `credentialRef` is a versioned HMAC over the credential
 * record id (`src/governance/security/credentials/srap-evidence.ts`).
 */
export interface RemoteDecisionEvidence {
  /** Stable decision identity; the idempotency key for audit projection. */
  decisionId: string;
  /** Persistent operator principal that decided. */
  principalId: string;
  /** `hmac-sha256:v<N>:<base64url>` over the credential record id. */
  credentialRef: string;
  /** The decision taken. */
  decision: "approved" | "denied";
  /** Bounded client nonce, used with principalId+decision for exact retry. */
  nonce: string;
  /** When the decision was made (ISO-8601). */
  decidedAt: string;
  /** Connection security the decision arrived over. */
  transport: "direct-tls" | "proxy-tls";
}

/**
 * The bounded identity an exact retry is compared against. Per the operator
 * decision, retry identity is `{ principalId, nonce, decision }` — not request
 * body bytes.
 */
export function remoteDecisionRetryKey(e: Pick<RemoteDecisionEvidence, "principalId" | "nonce" | "decision">): string {
  return `${e.principalId}\u0000${e.nonce}\u0000${e.decision}`;
}

/** Ledger event vocabulary for the approvals domain (R2.4). */
export const APPROVAL_LEDGER_EVENT_TYPES = [
  "approval.created",
  "approval.updated",
  "approval.removed",
] as const;
