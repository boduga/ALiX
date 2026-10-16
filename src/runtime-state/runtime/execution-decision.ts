/**
 * execution-decision.ts — Canonical decision contract for all execution paths.
 *
 * Every tool call, graph node, daemon route, and agent request produces
 * exactly one ExecutionDecision through ExecutionAuthorization.evaluate().
 *
 * This is NOT a merge of PolicyGate and ApprovalStore — it is the shared
 * return type that those components compose behind a single boundary.
 */

import type { SessionMode } from "../../operations/config/schema.js";
import type { WorkerOwnershipClaim } from "../../coordination/kernel/coordination-types.js";

// ─── Decision contract ──────────────────────────────────────────────

export type ExecutionDecision =
  | { status: "allowed"; policyRuleId?: string; approvalId?: string; policyRevision?: string }
  | { status: "denied"; reason: string; policyRuleId?: string; approvalId?: string; policyRevision?: string }
  | {
      status: "approval_required";
      approvalId: string;
      bindingKey?: string;
      requestFingerprint?: string;
      reason: string;
      policyRuleId?: string;
      policyRevision?: string;
    };

/**
 * Trusted coordination execution identity (SRAP approval-binding continuity).
 *
 * Minted by the coordination runtime (`authorizeWorker`), never by the model.
 * Carried as a TYPED request field — not inside the generic `metadata` bag —
 * so the authorization boundary can validate it and `PolicyGate` can create a
 * coordination-bound approval instead of silently falling back to the legacy
 * approval path.
 */
export type CoordinationExecutionContext = {
  coordinationRunId: string;
  workerId: string;
  workerAttempt: number;
  /** Worker ownership claims, part of the canonical approval binding. */
  ownershipClaims?: WorkerOwnershipClaim[];
  /** Deterministic request fingerprint; defaults to the capability name. */
  requestFingerprint?: string;
};

// ─── Request ────────────────────────────────────────────────────────

export interface ExecutionDecisionRequest {
  requestId: string;
  capability: string;
  toolName?: string;
  args?: Record<string, unknown>;
  cwd: string;
  sessionMode: SessionMode;
  sessionId: string;
  agentId?: string;
  source: "tool" | "graph" | "daemon" | "tui" | "replay" | "agent";
  nodeId?: string;
  graphId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Trusted coordination execution identity. When present, the boundary
   * validates it and routes the request through the coordination-aware
   * approval path; a malformed identity is denied (fail closed), never
   * degraded to legacy authorization.
   */
  coordination?: CoordinationExecutionContext;
  /** Paths this subagent is scoped to write (owned-path auto-approval). */
  ownedPaths?: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────

export function decisionAllowed(overrides?: { policyRuleId?: string; approvalId?: string; policyRevision?: string }): ExecutionDecision {
  return { status: "allowed", ...overrides };
}

export function decisionDenied(reason: string, overrides?: { policyRuleId?: string; approvalId?: string; policyRevision?: string }): ExecutionDecision {
  return { status: "denied", reason, ...overrides };
}

export function decisionApprovalRequired(approvalId: string, reason: string, overrides?: { policyRuleId?: string; policyRevision?: string; bindingKey?: string; requestFingerprint?: string }): ExecutionDecision {
  return { status: "approval_required", approvalId, reason, ...overrides };
}
