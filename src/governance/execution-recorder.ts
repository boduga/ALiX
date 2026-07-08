/**
 * P17.4 — Audited Execution Recorder.
 *
 * Pure module: records execution attempts and outcomes only after an approved
 * execution plan exists. Validates approval, action ID mapping, and status
 * transitions. No execution, no mutation, no store writes, no audit imports.
 *
 * Core invariant:
 *   approved plan → record → no execution
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type { GovernanceExecutionPlan, GovernanceExecutionAction } from "./execution-plans.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionAttemptStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "partial"
  | "reverted";

export type ExecutionActionResultStatus =
  | "succeeded"
  | "failed"
  | "skipped"
  | "manual_required";

export interface GovernanceExecutionActionResult {
  actionId: string;
  status: ExecutionActionResultStatus;
  summary: string;
  evidenceRefs: string[];
}

export interface GovernanceExecutionAttempt {
  attemptId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  status: ExecutionAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  executedBy: string;
  actionResults: GovernanceExecutionActionResult[];
  failureReason: string | null;
  revertAttemptId: string | null;
  auditRefs: string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AttemptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttemptValidationError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function buildAttemptId(
  planId: string,
  status: string,
  executedBy: string,
  startedAt: string,
): string {
  const hash = createHash("sha256")
    .update(["p17.4", planId, status, executedBy, startedAt].join("|"))
    .digest("hex");
  return hash.slice(0, 16);
}

function validateActionResult(
  actionResult: unknown,
  actionIndex: number,
): GovernanceExecutionActionResult {
  if (typeof actionResult !== "object" || actionResult === null) {
    throw new AttemptValidationError(
      `actionResults[${actionIndex}] must be an object`,
    );
  }
  const ar = actionResult as Record<string, unknown>;
  if (!isNonEmpty(ar.actionId)) {
    throw new AttemptValidationError(
      `actionResults[${actionIndex}].actionId is required`,
    );
  }
  const validStatuses: ExecutionActionResultStatus[] = [
    "succeeded", "failed", "skipped", "manual_required",
  ];
  if (!validStatuses.includes(ar.status as ExecutionActionResultStatus)) {
    throw new AttemptValidationError(
      `actionResults[${actionIndex}].status must be one of: ${validStatuses.join(", ")}`,
    );
  }
  if (!isNonEmpty(ar.summary)) {
    throw new AttemptValidationError(
      `actionResults[${actionIndex}].summary is required`,
    );
  }
  const evidenceRefs = Array.isArray(ar.evidenceRefs) ? ar.evidenceRefs : [];
  return {
    actionId: ar.actionId as string,
    status: ar.status as ExecutionActionResultStatus,
    summary: ar.summary as string,
    evidenceRefs: evidenceRefs as string[],
  };
}

// ---------------------------------------------------------------------------
// Factory: recordExecutionAttempt
// ---------------------------------------------------------------------------

export interface RecordExecutionAttemptInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  status: ExecutionAttemptStatus;
  executedBy: string;
  actionResults: GovernanceExecutionActionResult[];
  failureReason?: string | null;
  revertAttemptId?: string | null;
  /** Injectable timestamp for deterministic test IDs. Defaults to new Date().toISOString(). */
  now?: string;
}

/**
 * Create a validated execution attempt record.
 *
 * Validates:
 *   - Approval must have decision === "approved"
 *   - All action IDs in the attempt must map to approvedActionIds
 *   - Status is a valid ExecutionAttemptStatus
 *   - failureReason required when status is "failed" or "partial"
 *   - executedBy is non-empty
 *   - No recording against rejected plans
 *
 * Returns a GovernanceExecutionAttempt **without** persisting it.
 * The caller is responsible for storing through an audited store.
 */
export function recordExecutionAttempt(
  input: RecordExecutionAttemptInput,
): GovernanceExecutionAttempt {
  const {
    plan,
    approval,
    status,
    executedBy,
    actionResults,
    failureReason = null,
    revertAttemptId = null,
    now,
  } = input;

  // --- Validation ---

  // 1. Approval must be approved
  if (approval.decision !== "approved") {
    throw new AttemptValidationError(
      `Cannot record attempt: approval decision is "${approval.decision}", expected "approved"`,
    );
  }

  // 2. Plan must be from the same plan as approval
  if (approval.planId !== plan.planId) {
    throw new AttemptValidationError(
      `Approval planId "${approval.planId}" does not match plan planId "${plan.planId}"`,
    );
  }

  // 3. executedBy must be non-empty
  if (!isNonEmpty(executedBy)) {
    throw new AttemptValidationError("executedBy is required");
  }

  // 4. Validate status
  const validStatuses: ExecutionAttemptStatus[] = [
    "started", "succeeded", "failed", "partial", "reverted",
  ];
  if (!validStatuses.includes(status)) {
    throw new AttemptValidationError(
      `Invalid attempt status "${status}". Must be one of: ${validStatuses.join(", ")}`,
    );
  }

  // 5. failureReason required for failed, partial, or reverted
  if ((status === "failed" || status === "partial" || status === "reverted") && !isNonEmpty(failureReason)) {
    throw new AttemptValidationError(
      `failureReason is required when status is "${status}"`,
    );
  }

  // 6. Every action result actionId must be in the plan's proposedActions
  const planActionIds = new Set(plan.proposedActions.map((a) => a.actionId));
  for (let i = 0; i < actionResults.length; i++) {
    const ar = actionResults[i]!;
    if (!planActionIds.has(ar.actionId)) {
      throw new AttemptValidationError(
        `actionId "${ar.actionId}" at index ${i} is not in plan's proposedActions`,
      );
    }
  }

  // 7. Every action result actionId must be in the approval's approvedActionIds
  const approvedSet = new Set(approval.approvedActionIds);
  for (let i = 0; i < actionResults.length; i++) {
    const ar = actionResults[i]!;
    if (!approvedSet.has(ar.actionId)) {
      throw new AttemptValidationError(
        `actionId "${ar.actionId}" at index ${i} was not approved by the approval gate`,
      );
    }
  }

  // 8. Validate each action result shape
  const validatedResults = actionResults.map((ar, i) => validateActionResult(ar, i));

  // 9. completedAt logic
  const startedAt = now ?? new Date().toISOString();
  const isTerminal = status === "succeeded" || status === "failed" || status === "partial" || status === "reverted";
  const completedAt = isTerminal ? startedAt : null;

  // --- Build ---

  const attemptId = buildAttemptId(plan.planId, status, executedBy, startedAt);

  // Validate revertAttemptId only if provided and non-null
  if (revertAttemptId !== null && typeof revertAttemptId === "string" && revertAttemptId.trim().length === 0) {
    throw new AttemptValidationError("revertAttemptId must not be an empty string");
  }

  return {
    attemptId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    status,
    startedAt,
    completedAt,
    executedBy,
    actionResults: validatedResults,
    failureReason: failureReason ?? null,
    revertAttemptId: revertAttemptId ?? null,
    auditRefs: [],
  };
}
