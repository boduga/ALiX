/**
 * P18.1–P18.3 — Governance Workbench Read Model.
 *
 * Read-only aggregate view across P14–P17 governance stores: operator queues,
 * lifecycle detail traces, and aggregate summary.
 *
 * Core invariant: pure read model — no store writes, no audit emitter imports,
 * no lifecycle mutation, no operator ranking.
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
import type {
  GovernanceExecutionReport,
  GovernanceExecutionReportItem,
} from "./execution-report.js";
import type { GovernanceSignal } from "./governance-signal.js";
import type { InvestigationRecommendation } from "./investigation-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkbenchQueueName =
  | "needs_acceptance"
  | "needs_planning"
  | "needs_approval"
  | "needs_followup";

export type WorkbenchSeverity = "info" | "warning" | "critical";

export interface WorkbenchQueueItem {
  queue: WorkbenchQueueName;
  remediationId: string;
  proposalId: string;
  planId: string | null;
  approvalId: string | null;
  latestAttemptId: string | null;
  reason: string;
  severity: WorkbenchSeverity;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchLifecycleHop {
  kind:
    | "signal"
    | "investigation"
    | "proposal"
    | "plan"
    | "approval"
    | "attempt"
    | "report";
  id: string;
  status: string;
  summary: string;
  timestamp: string;
  /** true when this hop is absent (a gap in the lifecycle chain) */
  gap: boolean;
}

export interface WorkbenchLifecycleTrace {
  remediationId: string;
  hops: WorkbenchLifecycleHop[];
}

export interface WorkbenchQueueCounts {
  needs_acceptance: number;
  needs_planning: number;
  needs_approval: number;
  needs_followup: number;
  total: number;
}

export interface WorkbenchSummary {
  queueCounts: WorkbenchQueueCounts;
  lifecycleTotals: {
    accepted: number;
    planned: number;
    approved: number;
    executed: number;
    failed: number;
    partial: number;
    reverted: number;
    unresolved: number;
    superseded: number;
  };
  oldestItems: WorkbenchQueueItem[];
  staleness: Record<WorkbenchQueueName, number | null>;
}

export interface GovernanceWorkbenchSnapshot {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  queue: Record<WorkbenchQueueName, WorkbenchQueueItem[]>;
  summary: WorkbenchSummary;
}

export interface GovernanceWorkbenchInput {
  signals?: GovernanceSignal[];
  investigations?: InvestigationRecommendation[];
  remediations: GovernanceRemediationProposal[];
  executionPlans: GovernanceExecutionPlan[];
  approvals: GovernanceExecutionApproval[];
  attempts: GovernanceExecutionAttempt[];
  report?: GovernanceExecutionReport | null;
  options?: {
    since?: string;
    until?: string;
    now?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUEUE_PRIORITY: Record<WorkbenchQueueName, number> = {
  needs_acceptance: 0,
  needs_planning: 1,
  needs_approval: 2,
  needs_followup: 3,
};

const SEVERITY_ORDER: Record<WorkbenchSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function parseIso(s: string): number {
  return new Date(s).getTime();
}

/** Map remediation severity to workbench severity */
function mapSeverity(
  severity: string | undefined,
): WorkbenchSeverity {
  switch (severity) {
    case "critical":
      return "critical";
    case "high":
    case "medium":
      return "warning";
    default:
      return "info";
  }
}

// ---------------------------------------------------------------------------
// Queue classification
// ---------------------------------------------------------------------------

function classifyQueue(
  remediation: GovernanceRemediationProposal,
  hasPlan: boolean,
  approval: GovernanceExecutionApproval | null,
  latestAttempt: GovernanceExecutionAttempt | null,
): {
  queue: WorkbenchQueueName | null;
  severity: WorkbenchSeverity;
  reason: string;
} | null {
  const isAccepted = remediation.status === "accepted";

  if (remediation.status === "open") {
    return {
      queue: "needs_acceptance",
      severity: mapSeverity(remediation.severity),
      reason: `Remediation "${remediation.title}" needs operator acceptance`,
    };
  }

  if (isAccepted && !hasPlan) {
    return {
      queue: "needs_planning",
      severity: mapSeverity(remediation.severity),
      reason: `Accepted remediation "${remediation.title}" has no execution plan`,
    };
  }

  if (isAccepted && hasPlan && approval === null) {
    return {
      queue: "needs_approval",
      severity: "warning",
      reason: `Execution plan for "${remediation.title}" needs operator approval`,
    };
  }

  if (
    isAccepted &&
    hasPlan &&
    approval !== null &&
    approval.decision === "approved"
  ) {
    if (latestAttempt === null) {
      return {
        queue: "needs_followup",
        severity: "warning",
        reason: `Approved plan for "${remediation.title}" has no execution attempt`,
      };
    }
    switch (latestAttempt.status) {
      case "failed":
        return {
          queue: "needs_followup",
          severity: "critical",
          reason: `Execution attempt for "${remediation.title}" failed: ${latestAttempt.failureReason ?? "Unknown error"}`,
        };
      case "partial":
        return {
          queue: "needs_followup",
          severity: "warning",
          reason: `Execution attempt for "${remediation.title}" partially completed`,
        };
      case "started":
        return {
          queue: "needs_followup",
          severity: "warning",
          reason: `Execution attempt for "${remediation.title}" started but not completed`,
        };
    }
  }

  // Terminal states (dismissed, resolved, superseded,
  // or approved+succeeded/reverted) — no queue
  return null;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items.reduce((a, b) => (parseIso(a.createdAt) >= parseIso(b.createdAt) ? a : b));
}

function latestByStartedAt(items: GovernanceExecutionAttempt[]): GovernanceExecutionAttempt | null {
  if (items.length === 0) return null;
  return items.reduce((a, b) => (parseIso(a.startedAt) >= parseIso(b.startedAt) ? a : b));
}

// ---------------------------------------------------------------------------
// Build queues
// ---------------------------------------------------------------------------

function buildQueues(
  remediations: GovernanceRemediationProposal[],
  plansByRemediation: Map<string, GovernanceExecutionPlan>,
  approvalsByPlan: Map<string, GovernanceExecutionApproval>,
  attemptsByPlan: Map<string, GovernanceExecutionAttempt>,
  since: string,
  until: string,
): Record<WorkbenchQueueName, WorkbenchQueueItem[]> {
  const queues: Record<WorkbenchQueueName, WorkbenchQueueItem[]> = {
    needs_acceptance: [],
    needs_planning: [],
    needs_approval: [],
    needs_followup: [],
  };

  for (const remediation of remediations) {
    // Filter by window
    const t = parseIso(remediation.createdAt);
    if (t < parseIso(since) || t > parseIso(until)) continue;

    const plan = plansByRemediation.get(remediation.proposalId) ?? null;
    const hasPlan = plan !== null;
    const approval = plan ? (approvalsByPlan.get(plan.planId) ?? null) : null;
    const latestAttempt = plan ? (attemptsByPlan.get(plan.planId) ?? null) : null;

    const classified = classifyQueue(remediation, hasPlan, approval, latestAttempt);
    if (classified === null || classified.queue === null) continue;

    // Compute updatedAt across all referenced entities
    const updatedAt = [
      remediation.createdAt,
      plan?.createdAt,
      approval?.createdAt,
      latestAttempt?.startedAt,
      latestAttempt?.completedAt,
    ]
      .filter((s): s is string => s !== null && s !== undefined)
      .reduce((a, b) => (parseIso(a) >= parseIso(b) ? a : b));

    queues[classified.queue].push({
      queue: classified.queue,
      remediationId: remediation.proposalId,
      proposalId: remediation.proposalId,
      planId: plan?.planId ?? null,
      approvalId: approval?.approvalId ?? null,
      latestAttemptId: latestAttempt?.attemptId ?? null,
      reason: classified.reason,
      severity: classified.severity,
      createdAt: remediation.createdAt,
      updatedAt,
    });
  }

  // Sort each queue deterministically
  for (const queueName of Object.keys(queues) as WorkbenchQueueName[]) {
    queues[queueName].sort(queueItemSorter);
  }

  return queues;
}

// ---------------------------------------------------------------------------
// Deterministic queue item sorting
// ---------------------------------------------------------------------------

function queueItemSorter(a: WorkbenchQueueItem, b: WorkbenchQueueItem): number {
  // 1. Queue priority asc (already same queue, but belt-and-suspenders)
  const qp = QUEUE_PRIORITY[a.queue] - QUEUE_PRIORITY[b.queue];
  if (qp !== 0) return qp;

  // 2. Severity desc (critical → warning → info)
  const sp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sp !== 0) return sp;

  // 3. createdAt asc
  const ct = parseIso(a.createdAt) - parseIso(b.createdAt);
  if (ct !== 0) return ct;

  // 4. remediationId asc
  if (a.remediationId < b.remediationId) return -1;
  if (a.remediationId > b.remediationId) return 1;

  // 5. planId asc, nulls last
  if (a.planId !== b.planId) {
    if (a.planId === null) return 1;
    if (b.planId === null) return -1;
    return a.planId < b.planId ? -1 : 1;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Lifecycle trace
// ---------------------------------------------------------------------------

export function buildLifecycleTrace(
  remediationId: string,
  remediations: GovernanceRemediationProposal[],
  plansByRemediation: Map<string, GovernanceExecutionPlan>,
  approvalsByPlan: Map<string, GovernanceExecutionApproval>,
  attemptsByPlan: Map<string, GovernanceExecutionAttempt>,
  signalsById: Map<string, GovernanceSignal>,
  investigationsById: Map<string, InvestigationRecommendation>,
  reportItemsByRemediation: Map<string, GovernanceExecutionReportItem>,
): WorkbenchLifecycleTrace {
  const remediation = remediations.find((r) => r.proposalId === remediationId);
  const hops: WorkbenchLifecycleHop[] = [];

  if (!remediation) {
    return { remediationId, hops: [{ kind: "proposal", id: remediationId, status: "not_found", summary: "Remediation not found", timestamp: "", gap: true }] };
  }

  // Signal hop: find by sourceRecommendationIds → signalId match
  // Signals are linked via investigations.sourceArtifactId which
  // should match a proposal's sourceRecommendationIds
  // For now, try to match signalIds directly through the investigation chain
  let signalFound = false;
  for (const srcId of remediation.sourceRecommendationIds) {
    const investigation = investigationsById.get(srcId);
    if (investigation) {
      // Check if investigation.sourceArtifactId is a signalId
      const signal = signalsById.get(investigation.sourceArtifactId);
      if (signal) {
        hops.push({
          kind: "signal",
          id: signal.signalId,
          status: signal.status,
          summary: signal.title,
          timestamp: signal.createdAt,
          gap: false,
        });
        hops.push({
          kind: "investigation",
          id: investigation.id,
          status: investigation.status,
          summary: investigation.title,
          timestamp: investigation.createdAt,
          gap: false,
        });
        signalFound = true;
        break;
      }
    }
  }

  if (!signalFound) {
    hops.push({
      kind: "signal",
      id: "",
      status: "unknown",
      summary: "No linked signal found",
      timestamp: "",
      gap: true,
    });
    hops.push({
      kind: "investigation",
      id: "",
      status: "unknown",
      summary: "No linked investigation found",
      timestamp: "",
      gap: true,
    });
  }

  // Proposal hop
  hops.push({
    kind: "proposal",
    id: remediation.proposalId,
    status: remediation.status,
    summary: remediation.title,
    timestamp: remediation.createdAt,
    gap: false,
  });

  // Plan hop
  const plan = plansByRemediation.get(remediationId) ?? null;
  if (plan) {
    hops.push({
      kind: "plan",
      id: plan.planId,
      status: "plan_created",
      summary: `Execution plan with ${plan.proposedActions.length} action(s)`,
      timestamp: plan.createdAt,
      gap: false,
    });

    // Approval hop
    const approval = approvalsByPlan.get(plan.planId) ?? null;
    if (approval) {
      hops.push({
        kind: "approval",
        id: approval.approvalId,
        status: approval.decision,
        summary: approval.rationale,
        timestamp: approval.createdAt,
        gap: false,
      });

      // Attempt hop
      const attempt = attemptsByPlan.get(plan.planId) ?? null;
      if (attempt) {
        hops.push({
          kind: "attempt",
          id: attempt.attemptId,
          status: attempt.status,
          summary: attempt.failureReason
            ? `Failed: ${attempt.failureReason}`
            : `Execution ${attempt.status}`,
          timestamp: attempt.startedAt,
          gap: false,
        });
      } else {
        hops.push({
          kind: "attempt",
          id: "",
          status: "not_started",
          summary: "No execution attempt recorded",
          timestamp: "",
          gap: true,
        });
      }
    } else {
      hops.push({
        kind: "approval",
        id: "",
        status: "pending",
        summary: "Awaiting operator approval",
        timestamp: "",
        gap: true,
      });
      hops.push({
        kind: "attempt",
        id: "",
        status: "not_started",
        summary: "No execution attempt before approval",
        timestamp: "",
        gap: true,
      });
    }
  } else {
    hops.push({
      kind: "plan",
      id: "",
      status: "not_created",
      summary: "No execution plan created",
      timestamp: "",
      gap: true,
    });
    hops.push({
      kind: "approval",
      id: "",
      status: "pending",
      summary: "No plan to approve",
      timestamp: "",
      gap: true,
    });
    hops.push({
      kind: "attempt",
      id: "",
      status: "not_started",
      summary: "No plan to execute",
      timestamp: "",
      gap: true,
    });
  }

  // Report hop
  const reportItem = reportItemsByRemediation.get(remediationId) ?? null;
  if (reportItem) {
    hops.push({
      kind: "report",
      id: remediationId,
      status: reportItem.executionState ?? "unknown",
      summary: `Execution state: ${reportItem.executionState ?? "unknown"}${reportItem.requiresAttention ? " (requires attention)" : ""}`,
      timestamp: reportItem.updatedAt,
      gap: false,
    });
  } else {
    hops.push({
      kind: "report",
      id: "",
      status: "not_generated",
      summary: "Not yet included in execution report",
      timestamp: "",
      gap: true,
    });
  }

  return { remediationId, hops };
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(
  queues: Record<WorkbenchQueueName, WorkbenchQueueItem[]>,
  report: GovernanceExecutionReport | null,
): WorkbenchSummary {
  const queueCounts: WorkbenchQueueCounts = {
    needs_acceptance: queues.needs_acceptance.length,
    needs_planning: queues.needs_planning.length,
    needs_approval: queues.needs_approval.length,
    needs_followup: queues.needs_followup.length,
    total:
      queues.needs_acceptance.length +
      queues.needs_planning.length +
      queues.needs_approval.length +
      queues.needs_followup.length,
  };

  const lifecycleTotals = report
    ? { ...report.totals }
    : {
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

  // Oldest items: take the earliest createdAt from each queue
  const oldestItems: WorkbenchQueueItem[] = [];
  for (const queueName of Object.keys(queues) as WorkbenchQueueName[]) {
    const items = queues[queueName];
    if (items.length > 0) {
      oldestItems.push(items[0]!); // Already sorted by createdAt asc within each queue
    }
  }
  oldestItems.sort(queueItemSorter);
  const topOldest = oldestItems.slice(0, 5);

  // Staleness: days since oldest unattended item per queue
  const now = Date.now();
  const staleness: Record<WorkbenchQueueName, number | null> = {
    needs_acceptance: null,
    needs_planning: null,
    needs_approval: null,
    needs_followup: null,
  };
  for (const queueName of Object.keys(queues) as WorkbenchQueueName[]) {
    const items = queues[queueName];
    if (items.length > 0) {
      const oldest = items[0]!;
      staleness[queueName] = Math.floor(
        (now - parseIso(oldest.createdAt)) / (24 * 60 * 60 * 1000),
      );
    }
  }

  return { queueCounts, lifecycleTotals, oldestItems: topOldest, staleness };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a read-only governance workbench snapshot.
 *
 * Cross-references remediations, plans, approvals, attempts, signals,
 * investigations, and the execution report to produce deterministic
 * operator views: queues, lifecycle traces, and aggregate summary.
 *
 * Pure function — no store writes, no audit emitter imports, no mutation.
 */
export function buildWorkbenchSnapshot(
  input: GovernanceWorkbenchInput,
): GovernanceWorkbenchSnapshot {
  const now = input.options?.now ?? new Date().toISOString();
  const until = input.options?.until ?? now;

  const sinceRaw = input.options?.since;
  const since = sinceRaw ?? new Date(parseIso(until) - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Index plans by remediationId (latest per remediation)
  const plansByRemediation = new Map<string, GovernanceExecutionPlan>();
  for (const plan of input.executionPlans) {
    const existing = plansByRemediation.get(plan.remediationId);
    if (
      existing === undefined ||
      parseIso(plan.createdAt) >= parseIso(existing.createdAt)
    ) {
      plansByRemediation.set(plan.remediationId, plan);
    }
  }

  // Index approvals by planId (latest per plan)
  const approvalsByPlan = new Map<string, GovernanceExecutionApproval>();
  for (const approval of input.approvals) {
    const existing = approvalsByPlan.get(approval.planId);
    if (
      existing === undefined ||
      parseIso(approval.createdAt) >= parseIso(existing.createdAt)
    ) {
      approvalsByPlan.set(approval.planId, approval);
    }
  }

  // Index attempts by planId (latest per plan, within window)
  const attemptsByPlan = new Map<string, GovernanceExecutionAttempt>();
  for (const attempt of input.attempts) {
    const existing = attemptsByPlan.get(attempt.planId);
    if (
      existing === undefined ||
      parseIso(attempt.startedAt) >= parseIso(existing.startedAt)
    ) {
      attemptsByPlan.set(attempt.planId, attempt);
    }
  }

  // Index signals by signalId
  const signalsById = new Map<string, GovernanceSignal>();
  for (const signal of input.signals ?? []) {
    signalsById.set(signal.signalId, signal);
  }

  // Index investigations by id
  const investigationsById = new Map<string, InvestigationRecommendation>();
  for (const inv of input.investigations ?? []) {
    investigationsById.set(inv.id, inv);
  }

  // Index report items by remediationId
  const reportItemsByRemediation = new Map<
    string,
    GovernanceExecutionReportItem
  >();
  for (const item of input.report?.items ?? []) {
    reportItemsByRemediation.set(item.remediationId, item);
  }

  // Build queues
  const queues = buildQueues(
    input.remediations,
    plansByRemediation,
    approvalsByPlan,
    attemptsByPlan,
    since,
    until,
  );

  // Build lifecycle traces (for all remediations within window)
  const inWindowRemediations = input.remediations.filter((r) => {
    const t = parseIso(r.createdAt);
    return t >= parseIso(since) && t < parseIso(until);
  });
  const lifecycleTraces = inWindowRemediations.map((r) =>
    buildLifecycleTrace(
      r.proposalId,
      input.remediations,
      plansByRemediation,
      approvalsByPlan,
      attemptsByPlan,
      signalsById,
      investigationsById,
      reportItemsByRemediation,
    ),
  );

  // Compute summary
  const summary = computeSummary(queues, input.report ?? null);

  return {
    generatedAt: now,
    windowStart: since,
    windowEnd: until,
    queue: queues,
    summary,
  };
}
