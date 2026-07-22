/**
 * approval-types.ts — Core types for the approval lifecycle system.
 *
 * Builds on the existing ApprovalRecord from approval-store.ts with
 * lifecycle statuses, use policies, and audit fields.
 */

import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";

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
