/**
 * replay-preview.ts — Reconstruct a replayable chain from trace events.
 *
 * Takes a selected TraceEvent + all trace events, classifies each step
 * by replay action, and assesses replayability. Never executes anything.
 */

import type { TraceEvent, TraceSourceType } from "./trace-events.js";
import { traceChainContext } from "./trace-events.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayAction =
  | "context-only"
  | "would-check-policy"
  | "would-require-approval"
  | "would-reuse-approval"
  | "would-run-tool"
  | "would-skip";

export type ReplayStepStatus =
  | "safe"
  | "blocked"
  | "requires-approval"
  | "not-replayable";

export type ReplayPreviewStep = {
  index: number;
  traceId: string;
  eventType: string;
  sourceType: TraceSourceType;
  timestamp: string;
  label: string;
  replayAction: ReplayAction;
  status: ReplayStepStatus;
  detail?: string;
};

export type ReplayPreview = {
  selectedTraceId: string;
  sessionId?: string;
  replayable: boolean;
  reason?: string;
  chain: ReplayPreviewStep[];
  boundaries: {
    policyDecisionIds: string[];
    approvalIds: string[];
    continuationIds: string[];
    toolCallIds: string[];
  };
  warnings: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Classify a single trace event into a replay action + status. */
export function classifyReplayStep(event: TraceEvent): { action: ReplayAction; status: ReplayStepStatus; detail?: string } {
  const rawPayload = event.rawEvent as any;
  const payload = rawPayload?.payload || {};

  // Policy
  if (event.eventType === "policy.decision") {
    const decision = payload?.decision || event.status;
    if (decision === "deny" || event.status === "denied") {
      return { action: "would-check-policy", status: "blocked", detail: "Policy denied this decision" };
    }
    return { action: "would-check-policy", status: "safe", detail: "Policy allowed" };
  }

  // Approval created (first time, ask)
  if (event.eventType === "approval.created") {
    return { action: "would-require-approval", status: "requires-approval", detail: "Would need user approval" };
  }

  // Approval reused (already pending)
  if (event.eventType === "approval.reused") {
    return { action: "would-reuse-approval", status: "safe", detail: "Reusing existing pending approval" };
  }

  // Approval resolved
  if (event.eventType === "approval.resolved") {
    if (event.status === "denied" || payload?.status === "denied") {
      return { action: "context-only", status: "not-replayable", detail: "Approval was denied — chain blocked" };
    }
    return { action: "context-only", status: "safe", detail: "Approval was granted" };
  }

  // Approval resumed
  if (event.eventType === "approval.resumed") {
    return { action: "would-reuse-approval", status: "safe", detail: "Approval was successfully resolved" };
  }

  // Continuation
  if (event.eventType === "continuation.created") {
    return { action: "context-only", status: "safe", detail: "Continuation recorded" };
  }
  if (event.eventType === "continuation.consumed") {
    if (!event.rawEvent || !payload?.toolCallId) {
      return { action: "would-run-tool", status: "not-replayable", detail: "Missing tool call payload — cannot replay" };
    }
    return { action: "would-run-tool", status: "safe", detail: "Would re-execute tool call" };
  }

  // Tool lifecycle
  if (event.sourceType === "tool") {
    if (event.eventType === "tool.started") {
      if (!event.rawEvent) {
        return { action: "would-run-tool", status: "not-replayable", detail: "Missing tool call payload — cannot replay" };
      }
      return { action: "would-run-tool", status: "safe", detail: `Would re-execute ${event.toolName || "tool"}` };
    }
    return { action: "context-only", status: "safe" };
  }

  // Everything else
  return { action: "context-only", status: "safe" };
}

/**
 * Build a ReplayPreview for the selected trace event.
 * Uses traceChainContext to find related events.
 */
export function buildReplayPreview(
  selected: TraceEvent,
  allEvents: TraceEvent[],
): ReplayPreview {
  const chainEvents = traceChainContext(allEvents, selected);

  const warnings: string[] = [];
  warnings.push("Preview only. No execution will occur.");

  const boundaries: ReplayPreview["boundaries"] = {
    policyDecisionIds: [],
    approvalIds: [],
    continuationIds: [],
    toolCallIds: [],
  };

  // Collect boundaries
  for (const e of chainEvents) {
    if (e.approvalId && !boundaries.approvalIds.includes(e.approvalId)) boundaries.approvalIds.push(e.approvalId);
    if (e.continuationId && !boundaries.continuationIds.includes(e.continuationId)) boundaries.continuationIds.push(e.continuationId);
    if (e.toolCallId && !boundaries.toolCallIds.includes(e.toolCallId)) boundaries.toolCallIds.push(e.toolCallId);
    if (e.sourceType === "policy") boundaries.policyDecisionIds.push(e.id);
  }

  // Classify each step
  const chain: ReplayPreviewStep[] = chainEvents.map((event, i) => {
    const { action, status, detail } = classifyReplayStep(event);
    return {
      index: i + 1,
      traceId: event.id,
      eventType: event.eventType,
      sourceType: event.sourceType,
      timestamp: event.timestamp,
      label: event.label,
      replayAction: action,
      status,
      detail,
    };
  });

  // Determine replayability
  const hasToolStep = chain.some(s => s.replayAction === "would-run-tool");
  const hasDeniedApproval = chain.some(s => s.status === "not-replayable" && s.eventType === "approval.resolved");
  const hasMissingPayload = chain.some(s => s.status === "not-replayable" && s.replayAction === "would-run-tool");
  const blockedSteps = chain.filter(s => s.status === "blocked" || s.status === "not-replayable");

  let replayable = hasToolStep;
  let reason: string | undefined;

  if (!hasToolStep) {
    replayable = false;
    reason = "No tool call in chain — nothing to replay";
    warnings.push(reason);
  }
  if (hasDeniedApproval) {
    replayable = false;
    reason = "Chain contains a denied approval";
    warnings.push(reason);
  }
  if (hasMissingPayload) {
    replayable = false;
    reason = "Tool call payload missing from raw event data";
    warnings.push("Tool call raw payload is missing — cannot re-execute without source data");
  }
  if (blockedSteps.length > 1) {
    warnings.push(`${blockedSteps.length} step(s) blocked or not replayable`);
  }

  return {
    selectedTraceId: selected.id,
    sessionId: selected.sessionId,
    replayable,
    reason,
    chain,
    boundaries,
    warnings,
  };
}
