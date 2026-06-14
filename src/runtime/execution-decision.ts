/**
 * execution-decision.ts — Canonical decision contract for all execution paths.
 *
 * Every tool call, graph node, daemon route, and agent request produces
 * exactly one ExecutionDecision through ExecutionAuthorization.evaluate().
 *
 * This is NOT a merge of PolicyGate and ApprovalStore — it is the shared
 * return type that those components compose behind a single boundary.
 */

import type { SessionMode } from "../config/schema.js";

// ─── Decision contract ──────────────────────────────────────────────

export type ExecutionDecision =
  | { status: "allowed"; policyRuleId?: string; approvalId?: string }
  | { status: "denied"; reason: string; policyRuleId?: string; approvalId?: string }
  | {
      status: "approval_required";
      approvalId: string;
      reason: string;
      policyRuleId?: string;
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
}

// ─── Helpers ────────────────────────────────────────────────────────

export function decisionAllowed(overrides?: { policyRuleId?: string; approvalId?: string }): ExecutionDecision {
  return { status: "allowed", ...overrides };
}

export function decisionDenied(reason: string, overrides?: { policyRuleId?: string; approvalId?: string }): ExecutionDecision {
  return { status: "denied", reason, ...overrides };
}

export function decisionApprovalRequired(approvalId: string, reason: string, overrides?: { policyRuleId?: string }): ExecutionDecision {
  return { status: "approval_required", approvalId, reason, ...overrides };
}
