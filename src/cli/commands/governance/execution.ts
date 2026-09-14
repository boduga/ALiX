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

import { join } from "node:path";
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
import type { GovernanceResponseRecommendation } from "../../../governance/response-recommendations.js";
import type { GovernanceRemediationProposal } from "../../../governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../../governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../../governance/execution-approval.js";
import type { GovernanceExecutionAttempt } from "../../../governance/execution-recorder.js";
import { parseInlineFlag } from "./audit.js";
import { colorForState } from "./workbench.js";

// ---------------------------------------------------------------------------
// P17.5 — Execution report subcommands
// ---------------------------------------------------------------------------

export const EXECUTION_STORE_SUBDIR = join(".alix", "governance");


/**
 * Load all persisted P17 lifecycle collections from their JSONL stores.
 * Attempts live in the shared ExecutionStore under `.alix/governance/`.
 */
export async function loadExecutionStores(): Promise<{
  remediations: GovernanceRemediationProposal[];
  executionPlans: GovernanceExecutionPlan[];
  approvals: GovernanceExecutionApproval[];
  attempts: GovernanceExecutionAttempt[];
}> {
  const cwd = process.cwd();
  const { ExecutionStore } = await import("../../../governance/execution-store.js");
  const { RemediationStore } = await import("../../../governance/remediation-store.js");
  const { ExecutionPlanStore } = await import("../../../governance/execution-plan-store.js");
  const { ExecutionApprovalStore } = await import("../../../governance/execution-approval-store.js");

  const remediationStore = new RemediationStore(cwd);
  const planStore = new ExecutionPlanStore(cwd);
  const approvalStore = new ExecutionApprovalStore(cwd);
  const attemptStore = new ExecutionStore(cwd, EXECUTION_STORE_SUBDIR);

  const [remediations, executionPlans, approvals, attempts] = await Promise.all([
    remediationStore.list(),
    planStore.list(),
    approvalStore.list(),
    attemptStore.list(),
  ]);

  return { remediations, executionPlans, approvals, attempts };
}


export async function runExecution(args: string[]): Promise<void> {
  const sub = args[0] ?? "";
  const jsonMode = args.includes("--json");

  switch (sub) {
    case "report":
      return runExecutionReport(args.slice(1), jsonMode);
    case "remediate":
      return runExecutionRemediate(args.slice(1), jsonMode);
    case "accept":
    case "dismiss":
    case "reject":
      return runExecutionRemediationTransition(sub as "accept" | "dismiss" | "reject", args.slice(1), jsonMode);
    case "plan":
      return runExecutionPlan(args.slice(1), jsonMode);
    case "approve":
    case "reject-plan":
      return runExecutionApproval(sub as "approve" | "reject-plan", args.slice(1), jsonMode);
    case "record":
      return runExecutionRecord(args.slice(1), jsonMode);
    default:
      console.log("Unknown execution subcommand. Usage:");
      console.log("  alix governance execution report [--since <iso>] [--until <iso>] [--json]");
      console.log("  alix governance execution remediate <recommendations.json> [--window-start <iso>] [--window-end <iso>] [--json]");
      console.log("  alix governance execution {accept|reject|dismiss} <proposalId> [--json]");
      console.log("  alix governance execution plan <proposalId> [--json]");
      console.log("  alix governance execution approve <planId> <operatorId> <rationale> [--action <id>...] [--json]");
      console.log("  alix governance execution reject-plan <planId> <operatorId> <rationale> [--json]");
      console.log("  alix governance execution record <planId> <approvalId> <operatorId> <status> [--failure <msg>] [--json]");
  }
}


// ---------------------------------------------------------------------------
// P17 lifecycle write subcommands
//
// These drive the pure P17 factories and persist validated records through the
// JSONL stores. The pure modules never persist; the CLI/operator is the caller
// boundary that appends records (P17.0 audited-store contract).
// ---------------------------------------------------------------------------

export async function runExecutionRemediate(args: string[], jsonMode: boolean): Promise<void> {
  const { readFileSync, existsSync } = await import("node:fs");
  const { createRemediationProposalsFromRecommendations } = await import("../../../governance/remediation-queue.js");
  const { RemediationStore } = await import("../../../governance/remediation-store.js");

  const inputPath = args.find((a) => !a.startsWith("--"));
  if (!inputPath || !existsSync(inputPath)) {
    console.error("Usage: alix governance execution remediate <recommendations.json> [--window-start <iso>] [--window-end <iso>] [--json]");
    return;
  }

  const recommendations = JSON.parse(readFileSync(inputPath, "utf-8")) as GovernanceResponseRecommendation[];
  const windowStart = parseInlineFlag(args, "--window-start") ?? "";
  const windowEnd = parseInlineFlag(args, "--window-end") ?? "";

  const proposals = createRemediationProposalsFromRecommendations(recommendations, {
    windowStart,
    windowEnd,
    now: new Date().toISOString(),
  });

  const store = new RemediationStore(process.cwd());
  for (const proposal of proposals) {
    await store.append(proposal);
  }

  if (jsonMode) {
    console.log(JSON.stringify(proposals, null, 2));
    return;
  }
  for (const p of proposals) {
    console.log(`  ${p.proposalId}  ${p.severity.toUpperCase()}  ${p.status}  ${p.title}`);
  }
  console.log(`\nPersisted ${proposals.length} remediation proposal(s).`);
}


export async function runExecutionRemediationTransition(
  action: "accept" | "dismiss" | "reject",
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { transitionRemediationState, InvalidTransitionError } = await import("../../../governance/remediation-lifecycle.js");
  const { RemediationStore } = await import("../../../governance/remediation-store.js");

  const proposalId = args.find((a) => !a.startsWith("--"));
  if (!proposalId) {
    console.error(`Usage: alix governance execution ${action} <proposalId> [--json]`);
    return;
  }

  const store = new RemediationStore(process.cwd());
  const existing = await store.get(proposalId);
  if (!existing) {
    console.error(`Remediation proposal not found: ${proposalId}`);
    return;
  }

  const target: Parameters<typeof transitionRemediationState>[1] =
    action === "accept" ? "accepted" : action === "dismiss" ? "dismissed" : "superseded";

  try {
    const result = transitionRemediationState(existing.status, target, {
      now: new Date().toISOString(),
    });
    const updated = await store.updateStatus(proposalId, result.newState);
    if (jsonMode) {
      console.log(JSON.stringify({ transition: result, proposal: updated }, null, 2));
    } else {
      console.log(`  ${proposalId}  ${existing.status} → ${updated?.status}`);
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      console.error(`Invalid transition ${existing.status} → ${target}: ${err.message}`);
    } else {
      throw err;
    }
  }
}


export async function runExecutionPlan(args: string[], jsonMode: boolean): Promise<void> {
  const { createExecutionPlanFromRemediation, RemediationNotAcceptedException } = await import("../../../governance/execution-plans.js");
  const { RemediationStore } = await import("../../../governance/remediation-store.js");
  const { ExecutionPlanStore } = await import("../../../governance/execution-plan-store.js");

  const proposalId = args.find((a) => !a.startsWith("--"));
  if (!proposalId) {
    console.error("Usage: alix governance execution plan <proposalId> [--json]");
    return;
  }

  const remediationStore = new RemediationStore(process.cwd());
  const remediation = await remediationStore.get(proposalId);
  if (!remediation) {
    console.error(`Remediation proposal not found: ${proposalId}`);
    return;
  }

  try {
    const plan = createExecutionPlanFromRemediation(remediation, {
      now: new Date().toISOString(),
    });
    const planStore = new ExecutionPlanStore(process.cwd());
    await planStore.append(plan);

    if (jsonMode) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`  ${plan.planId}  risk=${plan.riskLevel}  actions=${plan.proposedActions.length}`);
      console.log(`  Summary: ${plan.summary}`);
      console.log(`\nPersisted execution plan.`);
    }
  } catch (err) {
    if (err instanceof RemediationNotAcceptedException) {
      console.error(`Remediation must be accepted before planning (current: ${remediation.status}): ${err.message}`);
    } else {
      throw err;
    }
  }
}


export async function runExecutionApproval(
  action: "approve" | "reject-plan",
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { approveExecutionPlan, rejectExecutionPlan } = await import("../../../governance/execution-approval.js");
  const { ExecutionPlanStore } = await import("../../../governance/execution-plan-store.js");
  const { ExecutionApprovalStore } = await import("../../../governance/execution-approval-store.js");

  const positional = args.filter((a) => !a.startsWith("--"));
  const planId = positional[0];
  const operatorId = positional[1];
  const rationale = positional[2];
  if (!planId || !operatorId || !rationale) {
    console.error(`Usage: alix governance execution ${action} <planId> <operatorId> <rationale> [--action <id>...] [--json]`);
    return;
  }

  const planStore = new ExecutionPlanStore(process.cwd());
  const plan = await planStore.get(planId);
  if (!plan) {
    console.error(`Execution plan not found: ${planId}`);
    return;
  }

  const actions = args
    .map((a, i) => (a === "--action" ? args[i + 1] : undefined))
    .filter((a): a is string => !!a);

  let approval;
  if (action === "approve") {
    approval = approveExecutionPlan(plan, operatorId, rationale, actions, {
      now: new Date().toISOString(),
    });
  } else {
    approval = rejectExecutionPlan(plan, operatorId, rationale, {
      now: new Date().toISOString(),
    });
  }

  const approvalStore = new ExecutionApprovalStore(process.cwd());
  await approvalStore.append(approval);

  if (jsonMode) {
    console.log(JSON.stringify(approval, null, 2));
  } else {
    console.log(`  ${approval.approvalId}  ${approval.decision.toUpperCase()}  actions=${approval.approvedActionIds.length}`);
    console.log(`\nPersisted execution approval.`);
  }
}


export async function runExecutionRecord(args: string[], jsonMode: boolean): Promise<void> {
  const { recordExecutionAttempt, AttemptValidationError } = await import("../../../governance/execution-recorder.js");
  const { ExecutionPlanStore } = await import("../../../governance/execution-plan-store.js");
  const { ExecutionApprovalStore } = await import("../../../governance/execution-approval-store.js");
  const { ExecutionStore } = await import("../../../governance/execution-store.js");

  const positional = args.filter((a) => !a.startsWith("--"));
  const planId = positional[0];
  const approvalId = positional[1];
  const operatorId = positional[2];
  const status = positional[3] as NonNullable<Parameters<typeof recordExecutionAttempt>[0]["status"]> | undefined;
  if (!planId || !approvalId || !operatorId || !status) {
    console.error("Usage: alix governance execution record <planId> <approvalId> <operatorId> <status> [--failure <msg>] [--json]");
    return;
  }

  const planStore = new ExecutionPlanStore(process.cwd());
  const approvalStore = new ExecutionApprovalStore(process.cwd());
  const plan = await planStore.get(planId);
  const approval = await approvalStore.get(approvalId);
  if (!plan || !approval) {
    console.error(`Plan or approval not found (plan=${planId}, approval=${approvalId})`);
    return;
  }

  const failureReason = parseInlineFlag(args, "--failure") ?? undefined;

  try {
    const attempt = recordExecutionAttempt({
      plan,
      approval,
      status,
      executedBy: operatorId,
      actionResults: [],
      failureReason,
      now: new Date().toISOString(),
    });
    const attemptStore = new ExecutionStore(process.cwd(), EXECUTION_STORE_SUBDIR);
    await attemptStore.append(attempt);

    if (jsonMode) {
      console.log(JSON.stringify(attempt, null, 2));
    } else {
      console.log(`  ${attempt.attemptId}  ${attempt.status}  ${attempt.startedAt}`);
      console.log(`\nPersisted execution attempt.`);
    }
  } catch (err) {
    if (err instanceof AttemptValidationError) {
      console.error(`Attempt rejected: ${err.message}`);
    } else {
      throw err;
    }
  }
}


export async function runExecutionReport(args: string[], jsonMode: boolean): Promise<void> {
  const { buildExecutionReport } = await import("../../../governance/execution-report.js");

  const since = parseInlineFlag(args, "--since") ?? undefined;
  const until = parseInlineFlag(args, "--until") ?? undefined;

  const { remediations, executionPlans, approvals, attempts } =
    await loadExecutionStores();

  // Build the report with persisted lifecycle data
  const report = buildExecutionReport({
    remediations,
    executionPlans,
    approvals,
    attempts,
    options: {
      since,
      until,
      now: new Date().toISOString(),
    },
  });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Text output
  const { GREEN: _G, RED: R, YELLOW: Y, CYAN: C, DIM: D, RESET: X } = {
    GREEN: "\x1b[32m",
    RED: "\x1b[31m",
    YELLOW: "\x1b[33m",
    CYAN: "\x1b[36m",
    DIM: "\x1b[2m",
    RESET: "\x1b[0m",
  };

  const t = report.totals;
  console.log(`\n  ${C}Execution Report${X}`);
  console.log(`  ${D}${report.windowStart} — ${report.windowEnd}${X}`);
  console.log("");
  console.log(`  ${D}Totals:${X}`);
  console.log(`    Accepted:     ${t.accepted}`);
  console.log(`    Planned:      ${t.planned}`);
  console.log(`    Approved:     ${t.approved}`);
  console.log(`    Rejected:     ${t.rejected}`);
  console.log(`    Executed:     ${t.executed}`);
  console.log(`    Failed:       ${t.failed}`);
  console.log(`    Partial:      ${t.partial}`);
  console.log(`    Reverted:     ${t.reverted}`);
  console.log(`    Unresolved:   ${t.unresolved}`);
  console.log(`    Superseded:   ${t.superseded}`);

  if (report.items.length === 0) return;

  console.log(`\n  ${D}Items:${X}`);
  for (const item of report.items) {
    const attention = item.requiresAttention ? R + " ATTENTION" + X : "";
    const state = colorForState(item.executionState);
    console.log(
      `  ${D}${item.remediationId}${X}` +
      `  ${state}${item.executionState ?? "no_plan"}${X}` +
      attention
    );
    console.log(`    ${D}Status:${X} ${item.remediationStatus}  ${D}Plan:${X} ${item.planId ?? "—"}`);
    console.log(`    ${D}Updated:${X} ${item.updatedAt}`);
    if (item.unresolved) console.log(`    ${Y}Unresolved${X}`);
  }
}
