/**
 * audit-types.ts — Audit event types for policy and approval tracking.
 */

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
  | "graph.completed";

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
}

export interface AuditRecord {
  id: string;
  action: AuditAction;
  timestamp: string;
  actor?: string;
  details: AuditDetails;
}
