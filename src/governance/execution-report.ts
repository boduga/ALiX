/**
 * P17.5 — Execution Report.
 *
 * Read-only report of the full execution lifecycle. Cross-references
 * remediations, plans, approvals, and attempts to produce a deterministic,
 * non-mutating summary of execution state.
 *
 * Core invariant:
 *   executionState is derived report-only state — never written back to plan.
 *
 * Totals count the latest attempt per plan within the report window.
 * No execution, no mutation, no audit emitter imports.
 *
 * @module
 */

import type { GovernanceRemediationProposal } from "./remediation-queue.js";
import type { GovernanceExecutionPlan } from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type {
  GovernanceExecutionAttempt,
  ExecutionAttemptStatus,
} from "./execution-recorder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionState =
  | "draft"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "partial"
  | "reverted"
  | "superseded";

export interface ExecutionTotals {
  accepted: number;
  planned: number;
  approved: number;
  rejected: number;
  executed: number;
  failed: number;
  partial: number;
  reverted: number;
  unresolved: number;
  superseded: number;
}

export interface GovernanceExecutionReportItem {
  remediationId: string;
  sourceProposalId: string | null;
  remediationStatus: GovernanceRemediationProposal["status"];
  planId: string | null;
  /** Derived report-only lifecycle state. Never written back to the plan. */
  executionState: ExecutionState | null;
  approvalId: string | null;
  approvalDecision: "approved" | "rejected" | null;
  latestAttemptId: string | null;
  latestAttemptStatus: ExecutionAttemptStatus | null;
  riskLevel: "low" | "medium" | "high" | null;
  unresolved: boolean;
  requiresAttention: boolean;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceExecutionReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totals: ExecutionTotals;
  items: GovernanceExecutionReportItem[];
}

export interface GovernanceExecutionReportInput {
  remediations: GovernanceRemediationProposal[];
  executionPlans: GovernanceExecutionPlan[];
  approvals: GovernanceExecutionApproval[];
  attempts: GovernanceExecutionAttempt[];
  options?: {
    since?: string;
    until?: string;
    now?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIso(s: string): number {
  return new Date(s).getTime();
}

function maxIso(a: string, b: string): string {
  return parseIso(a) >= parseIso(b) ? a : b;
}

function maxIsoOrNull(a: string, b: string | null): string {
  return b === null ? a : maxIso(a, b);
}

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items.reduce((a, b) => (parseIso(a.createdAt) >= parseIso(b.createdAt) ? a : b));
}

function latestByStartedAt<T extends { startedAt: string }>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items.reduce((a, b) => (parseIso(a.startedAt) >= parseIso(b.startedAt) ? a : b));
}

// ---------------------------------------------------------------------------
// Derive executionState for a plan
// ---------------------------------------------------------------------------

/**
 * Derive the report-only execution state for a plan, based on its approval
 * and the latest execution attempt. This is derived state — never written
 * back to the GovernanceExecutionPlan.
 */
function deriveExecutionState(
  approval: GovernanceExecutionApproval | null,
  latestAttempt: GovernanceExecutionAttempt | null,
): ExecutionState | null {
  if (approval === null) return "draft";
  if (approval.decision === "rejected") return "rejected";
  if (latestAttempt === null) return "approved";

  switch (latestAttempt.status) {
    case "succeeded": return "executed";
    case "failed":    return "failed";
    case "partial":   return "partial";
    case "reverted":  return "reverted";
    case "started":   return "approved"; // in-progress, not yet terminal
  }
}

// ---------------------------------------------------------------------------
// Build a single report item from a remediation
// ---------------------------------------------------------------------------

function buildItem(
  remediation: GovernanceRemediationProposal,
  plan: GovernanceExecutionPlan | null,
  approval: GovernanceExecutionApproval | null,
  latestAttempt: GovernanceExecutionAttempt | null,
): GovernanceExecutionReportItem {
  const hasPlan = plan !== null;
  const isAccepted = remediation.status === "accepted";

  // executionState derivation
  let executionState: ExecutionState | null;
  if (remediation.status === "superseded") {
    executionState = "superseded";
  } else if (hasPlan) {
    executionState = deriveExecutionState(approval, latestAttempt);
  } else {
    executionState = null;
  }

  // unresolved: accepted without terminal successful or replacement outcome
  let unresolved = false;
  if (isAccepted) {
    if (!hasPlan) {
      unresolved = true;
    } else if (executionState === "rejected") {
      unresolved = true;
    } else if (executionState === "failed" || executionState === "partial") {
      unresolved = true;
    } else if (executionState === "draft") {
      unresolved = true;
    } else if (executionState === "approved" && latestAttempt?.status === "started") {
      unresolved = true;
    }
  }

  // requiresAttention
  let requiresAttention = false;
  if (isAccepted) {
    if (!hasPlan) {
      requiresAttention = true;
    } else if (approval === null) {
      requiresAttention = true;
    } else if (approval.decision === "approved" && latestAttempt === null) {
      requiresAttention = true;
    } else if (latestAttempt !== null) {
      if (latestAttempt.status === "failed" || latestAttempt.status === "partial") {
        requiresAttention = true;
      } else if (latestAttempt.status === "started") {
        requiresAttention = true;
      }
    }
  }

  const updatedAt = [remediation.createdAt]
    .concat(plan ? [plan.createdAt] : [])
    .concat(approval ? [approval.createdAt] : [])
    .concat(latestAttempt ? [latestAttempt.startedAt, latestAttempt.completedAt].filter(Boolean) as string[] : [])
    .reduce(maxIso);

  return {
    remediationId: remediation.proposalId,
    sourceProposalId: plan?.sourceProposalId ?? null,
    remediationStatus: remediation.status,
    planId: plan?.planId ?? null,
    executionState,
    approvalId: approval?.approvalId ?? null,
    approvalDecision: approval?.decision ?? null,
    latestAttemptId: latestAttempt?.attemptId ?? null,
    latestAttemptStatus: latestAttempt?.status ?? null,
    riskLevel: plan?.riskLevel ?? null,
    unresolved,
    requiresAttention,
    summary: plan?.summary ?? remediation.title,
    createdAt: remediation.createdAt,
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Build items index: remediation → plan → approval → attempt
// ---------------------------------------------------------------------------

function buildItems(
  remediations: GovernanceRemediationProposal[],
  plans: GovernanceExecutionPlan[],
  approvals: GovernanceExecutionApproval[],
  attempts: GovernanceExecutionAttempt[],
  now: string,
  since: string,
  until: string,
): GovernanceExecutionReportItem[] {
  // Index plans by remediationId, take latest per remediation
  const plansByRemediation = new Map<string, GovernanceExecutionPlan[]>();
  for (const plan of plans) {
    const arr = plansByRemediation.get(plan.remediationId) ?? [];
    arr.push(plan);
    plansByRemediation.set(plan.remediationId, arr);
  }
  const latestPlanByRemediation = new Map<string, GovernanceExecutionPlan>();
  for (const [remediationId, planList] of plansByRemediation) {
    const latest = latestByCreatedAt(planList);
    if (latest) latestPlanByRemediation.set(remediationId, latest);
  }

  // Index approvals by planId
  const latestApprovalByPlan = new Map<string, GovernanceExecutionApproval>();
  for (const approval of approvals) {
    const existing = latestApprovalByPlan.get(approval.planId);
    if (existing === undefined || parseIso(approval.createdAt) >= parseIso(existing.createdAt)) {
      latestApprovalByPlan.set(approval.planId, approval);
    }
  }

  // Index attempts by planId, take latest per plan within window
  const attemptsByPlan = new Map<string, GovernanceExecutionAttempt[]>();
  for (const attempt of attempts) {
    // Filter by window
    const t = parseIso(attempt.startedAt);
    if (t < parseIso(since) || t > parseIso(until)) continue;
    const arr = attemptsByPlan.get(attempt.planId) ?? [];
    arr.push(attempt);
    attemptsByPlan.set(attempt.planId, arr);
  }
  const latestAttemptByPlan = new Map<string, GovernanceExecutionAttempt>();
  for (const [planId, attemptList] of attemptsByPlan) {
    const latest = latestByStartedAt(attemptList);
    if (latest) latestAttemptByPlan.set(planId, latest);
  }

  // Build items
  const items: GovernanceExecutionReportItem[] = [];
  for (const remediation of remediations) {
    // Filter by window on remediation.createdAt
    const t = parseIso(remediation.createdAt);
    if (t < parseIso(since) || t > parseIso(until)) continue;

    const plan = latestPlanByRemediation.get(remediation.proposalId) ?? null;
    const approval = plan ? (latestApprovalByPlan.get(plan.planId) ?? null) : null;
    const latestAttempt = plan ? (latestAttemptByPlan.get(plan.planId) ?? null) : null;

    items.push(buildItem(remediation, plan, approval, latestAttempt));
  }

  return items;
}

// ---------------------------------------------------------------------------
// Compute totals from items
// ---------------------------------------------------------------------------

function computeTotals(
  items: GovernanceExecutionReportItem[],
): ExecutionTotals {
  const totals: ExecutionTotals = {
    accepted: 0,
    planned: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    failed: 0,
    partial: 0,
    reverted: 0,
    unresolved: 0,
    superseded: 0,
  };

  for (const item of items) {
    // Remediation-level totals (per-item, not mutually exclusive with plan totals)
    if (item.remediationStatus === "accepted") totals.accepted++;
    if (item.remediationStatus === "superseded") totals.superseded++;
    if (item.unresolved) totals.unresolved++;

    // Plan-level totals: accepted remediations with a plan
    if (item.remediationStatus === "accepted" && item.planId !== null) totals.planned++;

    // Execution state totals (derived from latest attempt per plan)
    switch (item.executionState) {
      case "approved":  totals.approved++;  break;
      case "rejected":  totals.rejected++;  break;
      case "executed":  totals.executed++;  break;
      case "failed":    totals.failed++;    break;
      case "partial":   totals.partial++;   break;
      case "reverted":  totals.reverted++;  break;
      // "draft" and null do not add to state-specific totals
    }
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Sort items deterministically
// ---------------------------------------------------------------------------

function sortItems(items: GovernanceExecutionReportItem[]): GovernanceExecutionReportItem[] {
  return [...items].sort((a, b) => {
    // 1. requiresAttention desc
    if (a.requiresAttention !== b.requiresAttention) {
      return a.requiresAttention ? -1 : 1;
    }
    // 2. updatedAt asc
    const dt = parseIso(a.updatedAt) - parseIso(b.updatedAt);
    if (dt !== 0) return dt;
    // 3. remediationId asc
    if (a.remediationId < b.remediationId) return -1;
    if (a.remediationId > b.remediationId) return 1;
    // 4. planId asc, nulls last
    if (a.planId !== b.planId) {
      if (a.planId === null) return 1;
      if (b.planId === null) return -1;
      return a.planId < b.planId ? -1 : 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a read-only execution report from the given inputs.
 *
 * @param input - Remediations, plans, approvals, attempts, and options
 * @returns A deterministic, read-only execution report
 */
export function buildExecutionReport(
  input: GovernanceExecutionReportInput,
): GovernanceExecutionReport {
  const now = input.options?.now ?? new Date().toISOString();
  const until = input.options?.until ?? now;

  const sinceRaw = input.options?.since;
  const since = sinceRaw ?? new Date(parseIso(until) - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Build items
  const items = buildItems(
    input.remediations,
    input.executionPlans,
    input.approvals,
    input.attempts,
    now,
    since,
    until,
  );

  // Sort deterministically
  const sorted = sortItems(items);

  // Compute totals from sorted items
  const totals = computeTotals(sorted);

  return {
    generatedAt: now,
    windowStart: since,
    windowEnd: until,
    totals,
    items: sorted,
  };
}
