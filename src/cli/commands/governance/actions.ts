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
import type { ActionProposalKind, ActionProposalStatus, ActionProposalStatusTransition } from "../../../governance/action-queue.js";
import { BAR } from "./analytics.js";
import { parseInlineFlag } from "./audit.js";
import { BOLD, CYAN, DIM, GREEN, MAGENTA, RESET, YELLOW } from "./shared.js";

// ---------------------------------------------------------------------------
// P14.4 — Action Queue
// ---------------------------------------------------------------------------

export type ActionsSubcommand = "list" | "refresh" | "mark-executed" | "dismiss";


export function isActionsSubcommand(s: string): s is ActionsSubcommand {
  return ["list", "refresh", "mark-executed", "dismiss"].includes(s);
}


/** Generate a transition ID from a timestamp and proposal ID. */
export function transitionId(now: string, proposalId: string): string {
  return `trans-${now.replace(/[:.]/g, "-")}-${proposalId.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;
}


export async function runActions(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const jsonMode = args.includes("--json");

  // Determine subcommand
  const sub = args.find((a) => isActionsSubcommand(a)) ?? "list";

  switch (sub) {
    case "list":
      return runActionsList(cwd, args, jsonMode);
    case "refresh":
      return runActionsRefresh(cwd, jsonMode);
    case "mark-executed":
      return runActionsMarkExecuted(cwd, args, jsonMode);
    case "dismiss":
      return runActionsDismiss(cwd, args, jsonMode);
    default:
      console.error("Unknown actions subcommand. Use: list, refresh, mark-executed, dismiss");
      process.exit(1);
  }
}


export async function runActionsList(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../../governance/action-queue.js");
  const store = new FileActionQueueStore(cwd);

  const proposals = await store.list();

  // Resolve effective statuses for all proposals once — then filter and render synchronously.
  // This avoids the O(N*M) repeated file-read pattern and the async-filter correctness bug.
  const statusMap = new Map<string, ActionProposalStatus>();
  for (const p of proposals) {
    const transitions = await store.getTransitions(p.proposalId);
    statusMap.set(p.proposalId, deriveEffectiveStatus(p, transitions));
  }

  // Apply filters
  const statusFilter = parseInlineFlag(args, "--status") as ActionProposalStatus | null;
  const kindFilter = parseInlineFlag(args, "--kind") as ActionProposalKind | null;

  let filtered = proposals;
  if (statusFilter) {
    filtered = filtered.filter((p) => statusMap.get(p.proposalId) === statusFilter);
  }
  if (kindFilter) {
    filtered = filtered.filter((p) => p.kind === kindFilter);
  }

  if (jsonMode) {
    const withStatus = filtered.map((p) => ({
      ...p,
      effectiveStatus: statusMap.get(p.proposalId) ?? "pending",
    }));
    console.log(JSON.stringify(withStatus, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("No action proposals found.");
    return;
  }

  console.log(BOLD + "Action Proposals" + RESET);
  console.log(BAR);

  for (const p of filtered) {
    const effective = statusMap.get(p.proposalId) ?? "pending";
    const statusColor = effective === "dismissed" ? DIM : effective === "marked_executed_elsewhere" ? GREEN : YELLOW;
    const kindColor = p.kind === "escalation_review" ? MAGENTA : CYAN;

    console.log(`${BOLD}${p.proposalId}${RESET}`);
    console.log(`${DIM}Signal:${RESET} ${p.title} (${p.signalId})`);
    console.log(`${DIM}Decision:${RESET} ${p.decisionId}`);
    console.log(`${DIM}Kind:${RESET} ${kindColor}${p.kind}${RESET}`);
    console.log(`${DIM}Status:${RESET} ${statusColor}${effective}${RESET}`);
    console.log(`${DIM}Rationale:${RESET} ${p.rationale}`);
    if (p.executionRef) console.log(`${DIM}Ref:${RESET} ${p.executionRef}`);
    console.log(`${DIM}Created:${RESET} ${p.createdAt}`);
    console.log();
  }

  console.log(DIM + `${filtered.length} proposal(s)` + RESET);
}


export async function runActionsRefresh(cwd: string, jsonMode: boolean): Promise<void> {
  const { refreshProposals } = await import("../../../governance/action-queue.js");
  const { FileActionQueueStore } = await import("../../../governance/action-queue.js");
  const { FileDecisionStore } = await import("../../../governance/decision-capture.js");
  const { FileSignalStore } = await import("../../../governance/governance-signal.js");
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../../governance/audit-decorators.js");

  const decisionStore = new FileDecisionStore(cwd);
  const signalStore = new FileSignalStore(cwd);
  const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));
  const now = new Date().toISOString();

  const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, now);

  if (jsonMode) {
    console.log(JSON.stringify({ created: created.length, proposals: created }, null, 2));
    return;
  }

  if (created.length === 0) {
    console.log("No new action proposals created. All eligible decisions already have proposals.");
    return;
  }

  console.log(GREEN + `Created ${created.length} new action proposal(s):` + RESET);
  for (const p of created) {
    console.log(`  ${p.proposalId} — ${p.kind} (from ${p.decisionId})`);
  }
  console.log(BAR);
  console.log(DIM + "Proposals are advisory and not executed." + RESET);
}


export async function runActionsMarkExecuted(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const subIdx = args.findIndex((a) => isActionsSubcommand(a));
  const proposalId = subIdx >= 0 ? args.slice(subIdx + 1).find((a) => !a.startsWith("-")) : undefined;
  if (!proposalId) {
    console.error("Usage: alix governance actions mark-executed <proposal-id> --ref <reference> [--json]");
    process.exit(1);
  }

  const executionRef = parseInlineFlag(args, "--ref");
  if (!executionRef) {
    console.error("--ref is required for mark-executed");
    process.exit(1);
  }

  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../../governance/action-queue.js");
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../../governance/audit-decorators.js");
  const store = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));

  const proposal = await store.getById(proposalId);
  if (!proposal) {
    console.error(`Proposal not found: ${proposalId}`);
    process.exit(1);
  }

  const transitions = await store.getTransitions(proposalId);
  if (transitions.length > 0) {
    const current = deriveEffectiveStatus(proposal, transitions);
    console.error(`Proposal ${proposalId} already has terminal status: ${current}. Cannot change status.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const tid = transitionId(now, proposalId);

  const transition: ActionProposalStatusTransition = {
    transitionId: tid,
    proposalId,
    status: "marked_executed_elsewhere",
    reason: null,
    executionRef,
    createdAt: now,
  };

  await store.appendStatusTransition(transition);

  if (jsonMode) {
    console.log(JSON.stringify({ transition, proposal }, null, 2));
    return;
  }

  console.log(GREEN + "Proposal marked as executed elsewhere" + RESET);
  console.log(`${DIM}Proposal:${RESET} ${proposalId} (${proposal.title})`);
  console.log(`${DIM}Ref:${RESET} ${executionRef}`);
  console.log(`${DIM}Transition:${RESET} ${tid}`);
}


export async function runActionsDismiss(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const subIdx = args.findIndex((a) => isActionsSubcommand(a));
  const proposalId = subIdx >= 0 ? args.slice(subIdx + 1).find((a) => !a.startsWith("-")) : undefined;
  if (!proposalId) {
    console.error("Usage: alix governance actions dismiss <proposal-id> --reason \"...\" [--json]");
    process.exit(1);
  }

  const reason = parseInlineFlag(args, "--reason");
  if (!reason || !reason.trim()) {
    console.error("--reason is required for dismiss");
    process.exit(1);
  }

  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../../governance/action-queue.js");
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../../governance/audit-decorators.js");
  const store = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));

  const proposal = await store.getById(proposalId);
  if (!proposal) {
    console.error(`Proposal not found: ${proposalId}`);
    process.exit(1);
  }

  const transitions = await store.getTransitions(proposalId);
  if (transitions.length > 0) {
    const current = deriveEffectiveStatus(proposal, transitions);
    console.error(`Proposal ${proposalId} already has terminal status: ${current}. Cannot dismiss.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const tid = transitionId(now, proposalId);

  const transition: ActionProposalStatusTransition = {
    transitionId: tid,
    proposalId,
    status: "dismissed",
    reason: reason.trim(),
    executionRef: null,
    createdAt: now,
  };

  await store.appendStatusTransition(transition);

  if (jsonMode) {
    console.log(JSON.stringify({ transition, proposal }, null, 2));
    return;
  }

  console.log(YELLOW + "Proposal dismissed" + RESET);
  console.log(`${DIM}Proposal:${RESET} ${proposalId} (${proposal.title})`);
  console.log(`${DIM}Reason:${RESET} ${reason.trim()}`);
  console.log(`${DIM}Transition:${RESET} ${tid}`);
}
