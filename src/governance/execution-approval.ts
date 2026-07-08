/**
 * P17.3 — Execution Approval Gate.
 *
 * Pure module: explicit operator approval before execution recording.
 * No execution, no mutation, no store writes, no audit imports.
 */

import { createHash } from "node:crypto";
import type { GovernanceExecutionPlan } from "./execution-plans.js";

export interface GovernanceExecutionApproval {
  approvalId: string;
  planId: string;
  remediationId: string;
  decision: "approved" | "rejected";
  rationale: string;
  operatorId: string;
  createdAt: string;
  approvedActionIds: string[];
  auditRefs: string[];
}

export class ApprovalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalValidationError";
  }
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function buildApprovalId(
  planId: string,
  decision: string,
  operatorId: string,
  createdAt: string,
  approvedActionIds: string[],
): string {
  const sortedCopy = [...approvedActionIds].sort();
  return createHash("sha256")
    .update(["p17.3", planId, decision, operatorId, createdAt, ...sortedCopy].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function assertDraft(plan: GovernanceExecutionPlan): void {
  if (plan.status !== "draft") {
    throw new ApprovalValidationError(`Plan ${plan.planId} status is "${plan.status}", must be "draft" to approve/reject`);
  }
}

export function approveExecutionPlan(
  plan: GovernanceExecutionPlan,
  operatorId: string,
  rationale: string,
  approvedActionIds: string[],
  options?: { now?: string },
): GovernanceExecutionApproval {
  assertDraft(plan);

  if (!isNonEmpty(operatorId)) {
    throw new ApprovalValidationError("operatorId is required");
  }
  if (!isNonEmpty(rationale)) {
    throw new ApprovalValidationError("rationale is required");
  }
  if (!Array.isArray(approvedActionIds) || approvedActionIds.length === 0) {
    throw new ApprovalValidationError("approvedActionIds must be a non-empty array");
  }

  const validActionIds = new Set(plan.proposedActions.map((a) => a.actionId));
  for (const id of approvedActionIds) {
    if (!validActionIds.has(id)) {
      throw new ApprovalValidationError(`approvedActionId "${id}" not found in plan proposedActions`);
    }
  }

  const createdAt = options?.now ?? new Date().toISOString();
  const approvalId = buildApprovalId(plan.planId, "approved", operatorId, createdAt, approvedActionIds);

  return {
    approvalId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    decision: "approved",
    rationale,
    operatorId,
    createdAt,
    approvedActionIds: [...approvedActionIds].sort(),
    auditRefs: [],
  };
}

export function rejectExecutionPlan(
  plan: GovernanceExecutionPlan,
  operatorId: string,
  rationale: string,
  options?: { now?: string },
): GovernanceExecutionApproval {
  assertDraft(plan);

  if (!isNonEmpty(operatorId)) {
    throw new ApprovalValidationError("operatorId is required");
  }
  if (!isNonEmpty(rationale)) {
    throw new ApprovalValidationError("rationale is required");
  }

  const createdAt = options?.now ?? new Date().toISOString();
  const approvalId = buildApprovalId(plan.planId, "rejected", operatorId, createdAt, []);

  return {
    approvalId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    decision: "rejected",
    rationale,
    operatorId,
    createdAt,
    approvedActionIds: [],
    auditRefs: [],
  };
}
