/**
 * replay-plan.ts — Build an executable replay plan from a ReplayPreview.
 *
 * Converts the chain classification from replay-preview.ts into a
 * structured plan with per-step status (ready/blocked) and tool call
 * data extracted from trace events.
 */

import type { TraceEvent } from "./trace-events.js";
import { traceChainContext } from "./trace-events.js";
import type { ReplayPreview, ReplayAction } from "./replay-preview.js";
import { hashArgs } from "../tools/executor.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayMode = "dry-run" | "sandbox";

export type ReplayPlanStep = {
  index: number;
  traceId: string;
  eventType: string;
  replayAction: ReplayAction;
  toolName?: string;
  args?: Record<string, unknown>;
  argsHash?: string;
  status: "ready" | "blocked" | "skipped";
  blockReason?: string;
};

export type ReplayPlan = {
  mode: ReplayMode;
  sessionId?: string;
  steps: ReplayPlanStep[];
  toolCount: number;
  blockedSteps: number;
  executable: boolean;
  reason?: string;
  approvals: Array<{
    approvalId: string;
    status: string;
    recheckPassed: boolean;
  }>;
  warnings: string[];
};

// ─── Network tools blocked in dry-run/sandbox ────────────────────────

const NETWORK_TOOLS = new Set([
  "web_search", "web_fetch", "delegate",
]);

function isNetworkTool(toolName: string): boolean {
  if (toolName.startsWith("mcp.")) return true;
  return NETWORK_TOOLS.has(toolName);
}

// ─── Builder ─────────────────────────────────────────────────────────

/**
 * Extract tool call data from a raw trace event payload.
 */
function extractToolCall(event: TraceEvent): { toolName: string; args: Record<string, unknown>; argsHash?: string } | null {
  const raw = event.rawEvent as any;
  const payload = raw?.payload || {};
  const toolName = payload.toolName || event.toolName || "";
  if (!toolName) return null;
  const args = (payload.args || {}) as Record<string, unknown>;
  const argsHash = payload.argsHash || (Object.keys(args).length > 0 ? hashArgs(args) : undefined);
  return { toolName, args, argsHash };
}

/**
 * Build a ReplayPlan from a ReplayPreview and the full event list.
 *
 * Includes the selected trace event (excluded from traceChainContext)
 * so the plan covers the full chain from the selected event outward.
 */
export function buildReplayPlan(
  preview: ReplayPreview,
  allEvents: TraceEvent[],
  mode: ReplayMode,
): ReplayPlan {
  const selectedEvent = allEvents.find(e => e.id === preview.selectedTraceId);
  const chainEvents = traceChainContext(allEvents, selectedEvent ?? allEvents[0]);

  // Include the selected event (excluded from traceChainContext) and sort chronologically
  const planEvents = selectedEvent
    ? [selectedEvent, ...chainEvents].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    : chainEvents;

  const steps: ReplayPlanStep[] = [];
  const approvals: ReplayPlan["approvals"] = [];
  const warnings = [...preview.warnings];
  let toolCount = 0;
  let blockedSteps = 0;

  for (let i = 0; i < planEvents.length; i++) {
    const event = planEvents[i];
    const step: ReplayPlanStep = {
      index: i + 1,
      traceId: event.id,
      eventType: event.eventType,
      replayAction: "context-only",
      status: "ready",
    };

    // Deterministic action from chain context
    if (event.sourceType === "policy") step.replayAction = "would-check-policy";
    else if (event.sourceType === "approval") {
      if (event.eventType === "approval.created") step.replayAction = "would-require-approval";
      else step.replayAction = "context-only";
    }
    else if (event.sourceType === "tool") step.replayAction = "would-run-tool";
    else if (event.sourceType === "continuation") step.replayAction = "context-only";
    else step.replayAction = "context-only";

    // Extract tool call for tool events
    if (event.sourceType === "tool" || event.eventType === "continuation.consumed") {
      const toolCall = extractToolCall(event);
      if (toolCall) {
        step.toolName = toolCall.toolName;
        step.args = toolCall.args;
        step.argsHash = toolCall.argsHash;
        toolCount++;

        // Block network tools in both modes
        if (isNetworkTool(toolCall.toolName)) {
          step.status = "blocked";
          step.blockReason = `"${toolCall.toolName}" is not available in ${mode} mode`;
          blockedSteps++;
        }
      }
    }

    // Check approval status
    if (event.eventType === "approval.resolved" && event.approvalId) {
      const appStatus = event.status === "denied" ? "denied" : "approved";
      if (appStatus === "denied") {
        step.status = "blocked";
        step.blockReason = "Approval was denied";
        blockedSteps++;
      }
      approvals.push({ approvalId: event.approvalId, status: appStatus, recheckPassed: appStatus === "approved" });
    }

    steps.push(step);
  }

  // Determine overall executable
  const hasDeniedApproval = approvals.some(a => a.status === "denied");
  const readySteps = steps.filter(s => s.status === "ready");

  let executable = readySteps.length > 0;
  let reason: string | undefined;

  if (toolCount === 0) {
    executable = false;
    reason = "No tool call in chain — nothing to replay";
    warnings.push(reason);
  }
  if (hasDeniedApproval) {
    executable = false;
    reason = "Chain contains a denied approval";
    warnings.push(reason);
  }
  if (readySteps.length === 0 && toolCount > 0 && !hasDeniedApproval) {
    executable = false;
    reason = "All tool steps are blocked by mode restrictions";
    warnings.push(reason);
  }

  return {
    mode,
    sessionId: preview.sessionId,
    steps,
    toolCount,
    blockedSteps,
    executable,
    reason,
    approvals,
    warnings,
  };
}
