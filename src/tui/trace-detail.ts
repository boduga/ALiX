/**
 * trace-detail.ts — Detail panel renderers for the Trace drilldown.
 *
 * Four modes: summary, json, links, chain.
 * Each returns an array of lines to display in the detail section.
 */

import type { TraceEvent } from "../runtime/trace-events.js";

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
