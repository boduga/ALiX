/**
 * trace-detail.ts — Detail panel renderers for the Trace drilldown.
 *
 * Five modes: summary, json, links, chain, replay.
 * Each returns an array of lines to display in the detail section.
 */

import type { TraceEvent } from "../runtime/trace-events.js";
import type { ReplayPreview } from "../runtime/replay-preview.js";
import type { ReplayResult } from "../runtime/replay-executor.js";

export function renderTraceSummary(event: TraceEvent): string[] {
  const lines: string[] = [];
  lines.push(`  Type:        ${event.eventType}`);
  if (event.status) lines.push(`  Status:       ${event.status}`);
  if (event.label) lines.push(`  Label:       ${event.label}`);
  if (event.toolName) lines.push(`  Tool:        ${event.toolName}`);
  if (event.toolCallId) lines.push(`  ToolCall:    ${event.toolCallId}`);
  if (event.capability) lines.push(`  Capability:  ${event.capability}`);
  if (event.approvalId) lines.push(`  Approval:    ${event.approvalId}`);
  if (event.continuationId) lines.push(`  Continuation: ${event.continuationId}`);
  if (event.taskId) lines.push(`  Task:        ${event.taskId}`);
  if (event.sessionId) lines.push(`  Session:     ${event.sessionId}`);
  if (event.sessionFilePath) lines.push(`  File:        ${event.sessionFilePath}`);
  if (event.detail) lines.push(`  Detail:      ${event.detail}`);
  return lines;
}

export function renderTraceJson(event: TraceEvent): string[] {
  const raw = event.rawEvent ?? event;
  return JSON.stringify(raw, null, 2).split("\n").slice(0, 30);
}

export function renderTraceLinks(event: TraceEvent): string[] {
  const lines: string[] = [];
  lines.push("  Entity IDs:");
  lines.push(`    Id:           ${event.id}`);
  if (event.sessionId) lines.push(`    SessionId:    ${event.sessionId}`);
  if (event.approvalId) lines.push(`    ApprovalId:   ${event.approvalId}`);
  if (event.continuationId) lines.push(`    Continuation: ${event.continuationId}`);
  if (event.toolCallId) lines.push(`    ToolCallId:   ${event.toolCallId}`);
  if (event.taskId) lines.push(`    TaskId:       ${event.taskId}`);
  if (event.capability) lines.push(`    Capability:   ${event.capability}`);
  if (event.toolName) lines.push(`    ToolName:     ${event.toolName}`);
  if (event.sessionFilePath) {
    lines.push("  Source:");
    lines.push(`    ${event.sessionFilePath}`);
  }
  return lines;
}

export function renderTraceChain(
  selected: TraceEvent,
  chainEvents: TraceEvent[],
): string[] {
  const lines: string[] = [];
  if (chainEvents.length === 0) {
    lines.push("  No related events found.");
    return lines;
  }
  lines.push(`  Chain context (${chainEvents.length} related):`);
  for (const e of chainEvents) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const marker = e.id === selected.id ? ">" : " ";
    const iconMap: Record<string, string> = {
      allowed: "●", denied: "✗", pending: "○",
      running: "▶", success: "✔", failed: "✗", completed: "✔",
    };
    const icon = e.status ? (iconMap[e.status] || " ") : " ";
    lines.push(`  ${marker} ${time} ${icon} ${e.sourceType.padEnd(12)} ${e.label.slice(0, 40)}`);
  }
  return lines;
}

export function renderTraceReplay(preview: ReplayPreview): string[] {
  const lines: string[] = [];
  lines.push(`  Selected: ${preview.chain.length > 0 ? preview.chain[0]?.label : "?"}`);
  lines.push(`  Replayable: ${preview.replayable ? "✓ yes" : "✗ no"}`);
  if (preview.reason) lines.push(`  Reason: ${preview.reason}`);
  lines.push("");

  if (preview.chain.length > 0) {
    lines.push("  Chain:");
    for (const step of preview.chain) {
      const iconMap: Record<string, string> = {
        safe: "●", blocked: "✗", "requires-approval": "○", "not-replayable": "✗",
      };
      const icon = iconMap[step.status] || " ";
      const action = step.replayAction.padEnd(24);
      lines.push(`  ${icon} ${step.index}. ${action} ${step.label.slice(0, 40)}`);
      if (step.detail) lines.push(`       ${step.detail.slice(0, 60)}`);
    }
  }

  lines.push("");
  lines.push("  Boundaries:");
  if (preview.boundaries.policyDecisionIds.length > 0) {
    lines.push(`    Policy:      ${preview.boundaries.policyDecisionIds.join(", ")}`);
  }
  if (preview.boundaries.approvalIds.length > 0) {
    lines.push(`    Approval:    ${preview.boundaries.approvalIds.join(", ")}`);
  }
  if (preview.boundaries.continuationIds.length > 0) {
    lines.push(`    Continuation: ${preview.boundaries.continuationIds.join(", ")}`);
  }
  if (preview.boundaries.toolCallIds.length > 0) {
    lines.push(`    ToolCall:    ${preview.boundaries.toolCallIds.join(", ")}`);
  }
  if (preview.sessionId) {
    lines.push(`    Session:     ${preview.sessionId}`);
  }

  if (preview.warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of preview.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  return lines;
}

export function renderReplayResult(result: ReplayResult): string[] {
  const lines: string[] = [];
  lines.push(`  Mode: ${result.mode}`);
  const total = result.steps.length;
  const completed = result.successCount;
  const blocked = result.blockedCount;
  const failed = result.failedCount;
  lines.push(`  Steps: ${total} total, ${completed} completed, ${blocked} blocked, ${failed} failed`);
  lines.push(`  Duration: ${result.totalDurationMs}ms`);
  lines.push("");

  if (result.steps.length > 0) {
    lines.push("  Chain:");
    for (const step of result.steps) {
      const iconMap: Record<string, string> = {
        completed: "✔", blocked: "✗", skipped: "○", failed: "✗",
      };
      const icon = iconMap[step.status] || " ";
      const action = step.action.padEnd(24);
      const duration = step.durationMs !== undefined ? `${step.durationMs}ms` : "";
      lines.push(`  ${icon} ${step.index}. ${action} ${(step.toolName || "").slice(0, 30)} ${duration}`);
      if (step.output) {
        const firstLine = step.output.split("\n")[0].slice(0, 60);
        lines.push(`       ${firstLine}`);
      }
      if (step.blockReason) {
        lines.push(`       ⛔ ${step.blockReason.slice(0, 60)}`);
      }
      if (step.error) {
        lines.push(`       ❌ ${step.error.slice(0, 60)}`);
      }
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of result.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  return lines;
}
