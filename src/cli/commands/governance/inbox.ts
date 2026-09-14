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
import { randomUUID } from "node:crypto";
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
import type { GovernanceSignal } from "../../../governance/governance-signal.js";
import type { DecisionKind } from "../../../governance/decision-capture.js";
import { BAR, severityColor } from "./analytics.js";
import { extractPositionalArg, parseInlineFlag } from "./audit.js";
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW, parseFlags } from "./shared.js";

// ---------------------------------------------------------------------------
// P14.1 — Inbox
// ---------------------------------------------------------------------------

export async function runInbox(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "refresh") {
    return runInboxRefresh(args.slice(1));
  }
  return runInboxList(args);
}


export async function runInboxList(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { FileSignalStore } = await import("../../../governance/governance-signal.js");

  const store = new FileSignalStore(cwd);
  const signals = await store.list();

  // Parse filters
  const statusFilter = parseInlineFlag(args, "--status");
  const sourceFilter = parseInlineFlag(args, "--source");
  const jsonMode = args.includes("--json");

  let filtered = signals;
  if (statusFilter) {
    filtered = filtered.filter((s) => s.status === statusFilter);
  }
  if (sourceFilter) {
    filtered = filtered.filter((s) => s.sourcePhase === sourceFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  renderInboxList(filtered, signals.length);
}


export function renderInboxList(signals: GovernanceSignal[], totalStored: number): void {
  console.log(BOLD + "Governance Signal Inbox" + RESET);
  console.log(`Total stored: ${totalStored}  |  Showing: ${signals.length}`);
  console.log(BAR);

  if (signals.length === 0) {
    console.log(DIM + "No signals match the current filters." + RESET);
    return;
  }

  const statusColor: Record<string, string> = {
    new: YELLOW,
    reviewing: CYAN,
    decided: GREEN,
    dismissed: DIM,
    escalated: RED,
  };

  for (const s of signals) {
    const sevColor = severityColor(s.severity === "critical" ? "high" : s.severity);
    console.log(
      sevColor + `[${s.severity.toUpperCase()}]` + RESET +
      ` ${s.title}`,
    );
    console.log(
      `  ${DIM}ID: ${s.signalId}${RESET}`,
    );
    console.log(
      `  ${DIM}Source: ${s.sourcePhase} | Type: ${s.signalType} | Conf: ${(s.confidence * 100).toFixed(0)}%${RESET}`,
    );
    console.log(
      `  ${statusColor[s.status] ?? DIM}Status: ${s.status}${RESET}  ${DIM}${s.createdAt}${RESET}`,
    );
    console.log("");
  }
}


export async function runInboxRefresh(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { windowDays } = parseFlags(args);
  const now = new Date().toISOString();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  // Helper: fetch + filter a store by window (same pattern as runReport)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowed = async <T extends { timestamp: string }>(
    store: { list: (limit?: number) => Promise<T[]> },
  ): Promise<T[]> =>
    (await store.list()).filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  // Dynamic imports — P13 modules
  const { FileLedgerStore } = await import("../../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../../governance/failure-memory.js");
  const { computeAnalytics, computePeriodRollups } = await import("../../../governance/ledger-analytics.js");
  const { computeFailureAnalysis } = await import("../../../governance/failure-clustering.js");
  const { computePolicySuggestions } = await import("../../../governance/policy-suggestions.js");
  const { computeFrictionReport } = await import("../../../governance/approval-friction.js");
  const { FileSignalStore, normalizeSignalOutputs } = await import("../../../governance/governance-signal.js");

  // Read P13 store data (same pattern as runReport)
  const entries = await windowed(new FileLedgerStore(cwd));
  const records = await windowed(new FileFailureMemoryStore(cwd));

  // Run P13 pure functions
  const analytics = computeAnalytics(entries, windowDays);
  const rollups = computePeriodRollups(entries);
  const failureAnalysis = computeFailureAnalysis(records);
  const policySuggestions = computePolicySuggestions(entries, records);
  const frictionReport = computeFrictionReport(entries);

  // Create audited signal store — outgoing append emits exactly one audit event
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditSignalStore } = await import("../../../governance/audit-decorators.js");
  const auditStore = new FileAuditStore(cwd);
  const signalStore = auditSignalStore(new FileSignalStore(cwd), auditStore);

  const existingSignals = await signalStore.list();

  // Normalise and dedup
  const newSignals = normalizeSignalOutputs(
    existingSignals,
    analytics,
    rollups,
    failureAnalysis,
    policySuggestions,
    frictionReport,
    now,
  );

  // Append new signals — decorator handles audit emission
  let appended = 0;
  for (const signal of newSignals) {
    await signalStore.append(signal);
    appended++;
  }

  // Report
  const jsonMode = args.includes("--json");
  if (jsonMode) {
    console.log(JSON.stringify({
      newSignals: appended,
      totalSignals: existingSignals.length + appended,
      timestamp: now,
    }, null, 2));
    return;
  }

  console.log(BOLD + "Governance Inbox Refresh" + RESET);
  console.log(`Window: ${windowDays} days`);
  console.log(`Timestamp: ${now}`);
  console.log(BAR);
  console.log(`${GREEN}${appended} new signals${RESET} appended to inbox (${existingSignals.length + appended} total)`);
  if (appended > 0) {
    console.log("");
    console.log(`  ${CYAN}→${RESET} Run \`alix governance inbox\` to view signals`);
  }
  console.log(
    DIM + "  Advisory only — no policies or gates modified." + RESET,
  );
  if (appended === 0) {
    console.log(DIM + "  (All signals deduplicated against existing inbox items.)" + RESET);
  }
}


// ---------------------------------------------------------------------------
// P14.2 — Review
// ---------------------------------------------------------------------------

export async function runReview(args: string[]): Promise<void> {
  const signalId = extractPositionalArg(args, ["--as", "--notes", "--classification"]);
  if (!signalId) {
    console.error("Usage: alix governance review <signal-id> [--notes ...] [--classification ...] [--json] [--as ...]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const notes = parseInlineFlag(args, "--notes");
  const classification = parseInlineFlag(args, "--classification");
  const jsonMode = args.includes("--json");
  const explicitAs = parseInlineFlag(args, "--as");

  const { FileSignalStore } = await import("../../../governance/governance-signal.js");
  const signalStore = new FileSignalStore(cwd);
  const signal = await signalStore.getById(signalId);

  if (!signal) {
    console.error(`Signal not found: ${signalId}`);
    process.exit(1);
  }

  // Read-only mode — no --notes or --classification
  if (notes === null && classification === null) {
    const { FileReviewStore } = await import("../../../governance/operator-review.js");
    const reviewStore = new FileReviewStore(cwd);
    const priorReviews = await reviewStore.getBySignalId(signalId);

    if (jsonMode) {
      console.log(JSON.stringify({ signal, priorReviews }, null, 2));
      return;
    }

    renderReviewShow(signal, priorReviews);
    return;
  }

  // Create mode — use audited review store for single audit emission
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditReviewStore } = await import("../../../governance/audit-decorators.js");
  const { FileReviewStore, createOperatorReview, resolveReviewer } = await import("../../../governance/operator-review.js");
  const reviewStore = auditReviewStore(new FileReviewStore(cwd), new FileAuditStore(cwd));
  const reviewer = resolveReviewer(explicitAs ?? undefined);
  const now = new Date().toISOString();
  const reviewId = `rev-${now.replace(/[:.]/g, "-")}-${signalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const review = await createOperatorReview(
    reviewId,
    signalId,
    signal, // pass fetched signal to avoid redundant store read inside createOperatorReview
    reviewer,
    notes,
    classification,
    now,
  );

  await reviewStore.append(review);

  if (jsonMode) {
    console.log(JSON.stringify({ signal, review }, null, 2));
    return;
  }

  renderReviewCreated(signal, review);
}


export function renderReviewShow(
  signal: { signalId: string; title: string; severity: string; sourcePhase: string; signalType: string; confidence: number; createdAt: string; description: string },
  priorReviews: { reviewId: string; reviewer: string; notes: string | null; classification: string | null; createdAt: string }[],
): void {
  console.log(BOLD + "Signal Detail" + RESET);
  console.log(`${DIM}ID:${RESET} ${signal.signalId}`);
  console.log(`${DIM}Title:${RESET} ${signal.title}`);
  console.log(`${DIM}Severity:${RESET} ${severityColor(signal.severity === "critical" ? "high" : signal.severity as "high" | "medium" | "low")}${signal.severity.toUpperCase()}${RESET}`);
  console.log(`${DIM}Source:${RESET} ${signal.sourcePhase} | ${signal.signalType} | Conf: ${(signal.confidence * 100).toFixed(0)}%`);
  console.log(`${DIM}Created:${RESET} ${signal.createdAt}`);
  console.log(`${DIM}Description:${RESET} ${signal.description}`);
  console.log(BAR);

  if (priorReviews.length === 0) {
    console.log(DIM + "No prior reviews." + RESET);
  } else {
    console.log(BOLD + `Prior Reviews (${priorReviews.length})` + RESET);
    for (const r of priorReviews) {
      console.log(`  ${CYAN}Review:${RESET} ${r.reviewId} | ${r.reviewer} | ${r.createdAt}`);
      if (r.notes) console.log(`  ${DIM}Notes:${RESET} ${r.notes}`);
      if (r.classification) console.log(`  ${DIM}Classification:${RESET} ${r.classification}`);
      console.log("");
    }
  }
  console.log(DIM + "To create a review, use: --notes \"...\" or --classification \"...\"" + RESET);
}


export function renderReviewCreated(
  signal: { signalId: string; title: string; severity: string },
  review: { reviewId: string; reviewer: string; notes: string | null; classification: string | null; createdAt: string },
): void {
  console.log(GREEN + "Review Created" + RESET);
  console.log(`${DIM}Signal:${RESET} ${signal.title} (${signal.signalId})`);
  console.log(`${DIM}Review ID:${RESET} ${review.reviewId}`);
  console.log(`${DIM}Reviewer:${RESET} ${review.reviewer}`);
  if (review.notes) console.log(`${DIM}Notes:${RESET} ${review.notes}`);
  if (review.classification) console.log(`${DIM}Classification:${RESET} ${review.classification}`);
  console.log(`${DIM}Created:${RESET} ${review.createdAt}`);
  console.log(GREEN + "✓ Review appended to store." + RESET);
  console.log(DIM + "  Advisory only — no signal or policy mutation." + RESET);
}


// ---------------------------------------------------------------------------
// P14.3 — Decision Capture
// ---------------------------------------------------------------------------

export const KIND_FLAGS = ["--accept", "--dismiss", "--defer", "--escalate", "--convert-to-issue"] as const;

export const KIND_MAP: Record<string, string> = {
  "--accept": "accept",
  "--dismiss": "dismiss",
  "--defer": "defer",
  "--escalate": "escalate",
  "--convert-to-issue": "convert_to_issue",
};


export async function runDecide(args: string[]): Promise<void> {
  const signalId = extractPositionalArg(args, ["--as", "--review", "--reason"]);
  if (!signalId) {
    console.error("Usage: alix governance decide <signal-id> --<kind> --reason \"...\" [--as ...] [--review ...] [--json]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const jsonMode = args.includes("--json");
  const explicitAs = parseInlineFlag(args, "--as");
  const reviewId = parseInlineFlag(args, "--review");
  const rationale = parseInlineFlag(args, "--reason");

  // Exactly one kind flag
  const providedKindFlags = KIND_FLAGS.filter((f) => args.includes(f));
  if (providedKindFlags.length === 0) {
    console.error("Exactly one decision kind flag is required: --accept, --dismiss, --defer, --escalate, or --convert-to-issue.");
    process.exit(1);
  }
  if (providedKindFlags.length > 1) {
    console.error(`Multiple decision kind flags provided: ${providedKindFlags.join(", ")}. Exactly one is allowed.`);
    process.exit(1);
  }

  const decisionKind = KIND_MAP[providedKindFlags[0]!]!;

  // Rationale required
  if (!rationale || !rationale.trim()) {
    console.error("Rationale is required and must be non-empty. Use --reason \"...\"");
    process.exit(1);
  }

  const { FileSignalStore } = await import("../../../governance/governance-signal.js");
  const signalStore = new FileSignalStore(cwd);
  const signal = await signalStore.getById(signalId);

  if (!signal) {
    console.error(`Signal not found: ${signalId}`);
    process.exit(1);
  }

  const { FileDecisionStore, createOperatorDecision, resolveReviewer } = await import("../../../governance/decision-capture.js");
  const { FileReviewStore } = await import("../../../governance/operator-review.js");
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { auditDecisionStore } = await import("../../../governance/audit-decorators.js");
  const decisionStore = auditDecisionStore(new FileDecisionStore(cwd), new FileAuditStore(cwd));
  const reviewStore = new FileReviewStore(cwd);
  const decider = resolveReviewer(explicitAs ?? undefined);
  const now = new Date().toISOString();
  const decisionId = `dec-${now.replace(/[:.]/g, "-")}-${signalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const decision = await createOperatorDecision(
    decisionId,
    signalId,
    signal,
    decisionKind as DecisionKind,
    rationale,
    decider,
    reviewId,
    reviewStore,
    now,
  );

  await decisionStore.append(decision);

  if (jsonMode) {
    console.log(JSON.stringify({ signal, decision }, null, 2));
    return;
  }

  renderDecisionCreated(signal, decision);
}


export function renderDecisionCreated(
  signal: { signalId: string; title: string; severity: string },
  decision: {
    decisionId: string;
    decision: string;
    rationale: string;
    decider: string;
    reviewId: string | null;
    actionProposalId: null;
    createdAt: string;
  },
): void {
  console.log(GREEN + "Decision Captured" + RESET);
  console.log(`${DIM}Signal:${RESET} ${signal.title} (${signal.signalId})`);
  console.log(`${DIM}Decision:${RESET} ${CYAN}${decision.decision}${RESET}`);
  console.log(`${DIM}Rationale:${RESET} ${decision.rationale}`);
  console.log(`${DIM}Decider:${RESET} ${decision.decider}`);
  if (decision.reviewId) console.log(`${DIM}Review:${RESET} ${decision.reviewId}`);
  console.log(`${DIM}Decision ID:${RESET} ${decision.decisionId}`);
  console.log(`${DIM}Created:${RESET} ${decision.createdAt}`);
  console.log(BAR);
  console.log(GREEN + "✓ Decision appended to store." + RESET);
  console.log(DIM + "  Advisory only — no action taken. No signal, policy, or gate mutation." + RESET);
}
