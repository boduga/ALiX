/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import type { GovernanceRemediationProposal } from "../../../governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../../governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../../governance/execution-approval.js";
import { loadExecutionStores } from "./execution.js";

// ---------------------------------------------------------------------------
// P18 — Governance Workbench CLI handlers
// ---------------------------------------------------------------------------

export const WK_CYAN = "\x1b[36m";

export const WK_DIM = "\x1b[2m";

export const WK_RED = "\x1b[31m";

export const WK_YELLOW = "\x1b[33m";

export const WK_GREEN = "\x1b[32m";

export const WK_RESET = "\x1b[0m";


export const QUEUE_LABELS: Record<string, string> = {
  needs_acceptance: "Needs Acceptance",
  needs_planning: "Needs Planning",
  needs_approval: "Needs Approval",
  needs_followup: "Needs Follow-up",
};


export async function runWorkbench(args: string[]): Promise<void> {
  const sub = args[0] ?? "";
  const jsonMode = args.includes("--json");

  switch (sub) {
    case "queue":
      return runWorkbenchQueue(jsonMode);
    case "trace":
      return runWorkbenchTrace(args.slice(1), jsonMode);
    case "summary":
      return runWorkbenchSummary(jsonMode);
    default:
      console.log("Unknown workbench subcommand. Usage:");
      console.log("  alix governance workbench queue [--json]");
      console.log("  alix governance workbench trace <remediationId> [--json]");
      console.log("  alix governance workbench summary [--json]");
  }
}


export async function loadWorkbenchSnapshot() {
  const { buildWorkbenchSnapshot } = await import("../../../governance/governance-workbench.js");

  const { remediations, executionPlans, approvals, attempts } =
    await loadExecutionStores();

  return buildWorkbenchSnapshot({
    remediations,
    executionPlans,
    approvals,
    attempts,
    options: { now: new Date().toISOString() },
  });
}


// ---------------------------------------------------------------------------
// runWorkbenchQueue
// ---------------------------------------------------------------------------

export async function runWorkbenchQueue(jsonMode: boolean): Promise<void> {
  const snapshot = await loadWorkbenchSnapshot();

  if (jsonMode) {
    console.log(JSON.stringify({ queue: snapshot.queue, summary: snapshot.summary }, null, 2));
    return;
  }

  const total = snapshot.summary.queueCounts.total;
  if (total === 0) {
    console.log(`${WK_GREEN}No pending items. All remediations resolved.${WK_RESET}`);
    return;
  }

  for (const [queueName, items] of Object.entries(snapshot.queue)) {
    if (items.length === 0) continue;
    console.log(`\n${WK_CYAN}${QUEUE_LABELS[queueName] ?? queueName} (${items.length})${WK_RESET}`);
    console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);
    for (const item of items) {
      const sevColor = item.severity === "critical" ? WK_RED
        : item.severity === "warning" ? WK_YELLOW
        : WK_DIM;
      console.log(`  ${sevColor}${item.severity.toUpperCase()}${WK_RESET} ${item.remediationId}`);
      console.log(`    ${WK_DIM}Reason:${WK_RESET} ${item.reason}`);
      console.log(`    ${WK_DIM}Plan:${WK_RESET} ${item.planId ?? "—"}  ${WK_DIM}Approval:${WK_RESET} ${item.approvalId ?? "—"}`);
      console.log(`    ${WK_DIM}Created:${WK_RESET} ${item.createdAt}`);
    }
  }
}


// ---------------------------------------------------------------------------
// runWorkbenchTrace
// ---------------------------------------------------------------------------

export async function runWorkbenchTrace(args: string[], jsonMode: boolean): Promise<void> {
  const remediationId = args.find((a) => !a.startsWith("--"));
  if (!remediationId) {
    console.error("Usage: alix governance workbench trace <remediationId> [--json]");
    return;
  }

  const { buildWorkbenchSnapshot, buildLifecycleTrace }
    = await import("../../../governance/governance-workbench.js");

  const { remediations, executionPlans, approvals, attempts } =
    await loadExecutionStores();

  // Load snapshot for summary context; build trace via the exported pure function
  buildWorkbenchSnapshot({
    remediations,
    executionPlans,
    approvals,
    attempts,
    options: { now: new Date().toISOString() },
  });

  // Build index maps from persisted data for buildLifecycleTrace
  const attemptsByPlan = new Map();
  for (const attempt of attempts) {
    const existing = attemptsByPlan.get(attempt.planId);
    if (existing === undefined || attempt.startedAt >= existing.startedAt) {
      attemptsByPlan.set(attempt.planId, attempt);
    }
  }
  const plansByRemediation = new Map<string, GovernanceExecutionPlan>();
  for (const plan of executionPlans) {
    const existing = plansByRemediation.get(plan.remediationId);
    if (existing === undefined || plan.createdAt >= existing.createdAt) {
      plansByRemediation.set(plan.remediationId, plan);
    }
  }
  const approvalsByPlan = new Map<string, GovernanceExecutionApproval>();
  for (const approval of approvals) {
    const existing = approvalsByPlan.get(approval.planId);
    if (existing === undefined || approval.createdAt >= existing.createdAt) {
      approvalsByPlan.set(approval.planId, approval);
    }
  }
  const remediationsById = new Map<string, GovernanceRemediationProposal>();
  for (const remediation of remediations) {
    remediationsById.set(remediation.proposalId, remediation);
  }

  const trace = buildLifecycleTrace(
    remediationId,
    remediations,
    plansByRemediation,
    approvalsByPlan,
    attemptsByPlan,
    new Map(),                                       // signalsById — TODO
    new Map(),                                       // investigationsById — TODO
    new Map(),                                       // reportItemsByRemediation — TODO
  );

  if (jsonMode) {
    console.log(JSON.stringify({ trace }, null, 2));
    return;
  }

  console.log(`\n${WK_CYAN}Lifecycle Trace: ${remediationId}${WK_RESET}`);
  console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);

  if (!trace || trace.hops.length === 0) {
    console.log(`${WK_DIM}Remediation not found: ${remediationId}${WK_RESET}`);
    return;
  }

  // All hops would be gaps when no stores are populated — show a clear message
  const allGaps = trace.hops.every((h) => h.gap);
  if (allGaps) {
    console.log(`${WK_DIM}No lifecycle data found for: ${remediationId}${WK_RESET}`);
    console.log(`${WK_DIM}Cause: no persisted lifecycle records for this remediation (attempts: ${attempts.length})${WK_RESET}`);
    return;
  }

  for (const hop of trace.hops) {
    const marker = hop.gap ? `${WK_DIM}○${WK_RESET}` : "●";
    const color = hop.gap ? WK_DIM : WK_RESET;
    const id = hop.id || "—";
    const status = hop.status || "—";
    console.log(`  ${hop.kind.padEnd(12)} ${marker} ${color}${id}${WK_RESET}  ${WK_DIM}${status}${WK_RESET}  ${color}${hop.summary}${WK_RESET}`);
  }
}


// ---------------------------------------------------------------------------
// runWorkbenchSummary
// ---------------------------------------------------------------------------

export async function runWorkbenchSummary(jsonMode: boolean): Promise<void> {
  const snapshot = await loadWorkbenchSnapshot();

  if (jsonMode) {
    console.log(JSON.stringify(snapshot.summary, null, 2));
    return;
  }

  const s = snapshot.summary;

  console.log(`\n${WK_CYAN}Governance Workbench Summary${WK_RESET}`);
  console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);
  console.log(`  ${WK_DIM}Queues:${WK_RESET}`);
  console.log(`    ${s.queueCounts.needs_acceptance} needs acceptance`);
  console.log(`    ${s.queueCounts.needs_planning} needs planning`);
  console.log(`    ${s.queueCounts.needs_approval} needs approval`);
  console.log(`    ${s.queueCounts.needs_followup} needs follow-up`);
  console.log(`    ${WK_GREEN}${s.queueCounts.total}${WK_RESET} total pending`);

  console.log(`\n  ${WK_DIM}Lifecycle Totals:${WK_RESET}`);
  console.log(`    ${s.lifecycleTotals.accepted} accepted`);
  console.log(`    ${s.lifecycleTotals.planned} planned`);
  console.log(`    ${s.lifecycleTotals.executed} executed`);
  console.log(`    ${s.lifecycleTotals.failed} failed`);
  console.log(`    ${s.lifecycleTotals.partial} partial`);
  console.log(`    ${s.lifecycleTotals.reverted} reverted`);
  console.log(`    ${s.lifecycleTotals.unresolved} unresolved`);

  if (s.oldestItems.length > 0) {
    console.log(`\n  ${WK_DIM}Oldest pending items:${WK_RESET}`);
    for (const item of s.oldestItems) {
      console.log(`    ${item.remediationId} — ${item.reason}`);
    }
  }
}


export function colorForState(state: string | null): string {
  switch (state) {
    case "executed": return "\x1b[32m";  // GREEN
    case "failed":
    case "partial":  return "\x1b[31m";  // RED
    case "reverted": return "\x1b[33m";  // YELLOW
    case "approved": return "\x1b[36m";  // CYAN
    case "rejected": return "\x1b[31m";  // RED
    case "draft":    return "\x1b[2m";   // DIM
    default:         return "\x1b[0m";   // RESET
  }
}
