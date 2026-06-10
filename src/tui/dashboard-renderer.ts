/**
 * dashboard-renderer.ts — Renders Agent OS dashboard cards for the TUI.
 */

import type { TuiRuntimeSnapshot } from "./runtime-snapshot.js";
import { box, green, yellow, red, dim, bold, truncate, formatAge } from "./box.js";
import type { TuiState } from "./store.js";

/** Build a snapshot-like view from store state for dashboard rendering. */
export function snapshotFromStore(s: TuiState): TuiRuntimeSnapshot {
  return {
    daemonRunning: s.daemonRunning ?? false,
    daemonPid: s.daemonPid,
    daemonTasks: s.daemonTasks ?? { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 },
    daemonTaskRecords: s.daemonTaskRecords ?? [],
    pendingApprovalsCount: s.pendingApprovalsCount ?? 0,
    pendingApprovalRecords: s.pendingApprovalRecords ?? [],
    sopsCount: s.sopsCount ?? 0,
    sopItems: s.sopItems ?? [],
    policyRulesCount: s.policyRulesCount ?? 0,
    runtimeEventCount: s.runtimeEventCount ?? 0,
    recentRuntimeEvents: s.recentRuntimeEvents ?? [],
    daemonHeartbeatAge: s.daemonHeartbeatAge ?? -1,
  };
}

/** Render a row of dashboard cards for the current snapshot. */
export function renderDashboardCards(snapshot: TuiRuntimeSnapshot, width: number): string[] {
  const cardW = Math.max(Math.floor((width - 8) / 3), 20);
  // 3-card layout: daemon | approvals+runtime | sops+policy
  const daemon = renderDaemonCard(snapshot, cardW);
  const center = renderCenterCard(snapshot, cardW);
  const right = renderRightCard(snapshot, cardW);
  const rows = Math.max(daemon.length, center.length, right.length);
  const result: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = i < daemon.length ? daemon[i] : " ".repeat(cardW + 2);
    const mid = i < center.length ? center[i] : " ".repeat(cardW + 2);
    const r = i < right.length ? right[i] : " ".repeat(cardW + 2);
    result.push(left + " " + mid + " " + r);
  }
  return result;
}

function renderDaemonCard(snapshot: TuiRuntimeSnapshot, w: number): string[] {
  const d = snapshot;
  const lines: string[] = [];
  const status = d.daemonRunning ? green("● running") : dim("○ stopped");
  lines.push(`Status  ${status}`);
  if (d.daemonRunning) {
    lines.push(`PID     ${dim(String(snapshot.daemonPid || ""))}`);
    if (d.daemonHeartbeatAge >= 0) {
      const age = d.daemonHeartbeatAge > 60 ? yellow(`${d.daemonHeartbeatAge}s`) : `${d.daemonHeartbeatAge}s`;
      lines.push(`Beat    ${age}`);
    }
  }
  lines.push("");
  const t = d.daemonTasks;
  const tasksLine = `run:${bold(String(t.running))} queued:${yellow(String(t.queued))} done:${green(String(t.completed))}`;
  lines.push(truncate(tasksLine, w));
  if (t.failed > 0) lines.push(`fail:   ${red(String(t.failed))}`);
  return box("DAEMON", lines, w);
}

function renderCenterCard(snapshot: TuiRuntimeSnapshot, w: number): string[] {
  const lines: string[] = [];
  // Approvals section
  lines.push(`Pending ${yellow(String(snapshot.pendingApprovalsCount))}`);
  if (snapshot.pendingApprovalRecords.length > 0) {
    for (const a of snapshot.pendingApprovalRecords.slice(0, 2)) {
      const cap = truncate(a.capability || "?", 14);
      lines.push(`  ${yellow("○")} ${cap}`);
    }
  } else {
    lines.push(dim("  none"));
  }
  lines.push("");
  // Runtime
  lines.push(`Events  ${bold(String(snapshot.runtimeEventCount))}`);
  if (snapshot.recentRuntimeEvents.length > 0) {
    const last = snapshot.recentRuntimeEvents[0];
    const src = truncate(last.source, 10);
    const act = truncate(last.action, 18);
    lines.push(`  ${dim(src)} ${act}`);
  } else {
    lines.push(dim("  no events"));
  }
  return box("APPROVALS / RUNTIME", lines, w);
}

function renderRightCard(snapshot: TuiRuntimeSnapshot, w: number): string[] {
  const lines: string[] = [];
  // SOPs
  lines.push(`SOPs    ${bold(String(snapshot.sopsCount))}`);
  if (snapshot.sopItems && snapshot.sopItems.length > 0) {
    for (const s of snapshot.sopItems.slice(0, 2)) {
      const n = s.nodeCount ? `${s.nodeCount}n` : "?";
      lines.push(`  ${dim(s.id)} ${green(n)}`);
    }
  }
  lines.push("");
  // Policy
  lines.push(`Rules   ${bold(String(snapshot.policyRulesCount))}`);
  if (snapshot.policyRulesCount > 0) {
    lines.push(dim("  alix policy eval"));
  }
  return box("SOPS / POLICY", lines, w);
}

/** Compact one-line summary for medium terminals. */
export function renderCompactSummary(snapshot: TuiRuntimeSnapshot, width: number): string {
  const parts: string[] = [];
  const daemon = snapshot.daemonRunning ? green("daemon") : dim("daemon stopped");
  parts.push(daemon);
  parts.push(`approvals:${snapshot.pendingApprovalsCount}`);
  parts.push(`events:${snapshot.runtimeEventCount}`);
  parts.push(`SOPs:${snapshot.sopsCount}`);
  parts.push(`rules:${snapshot.policyRulesCount}`);
  if (snapshot.daemonTasks.running > 0) parts.push(yellow(`run:${snapshot.daemonTasks.running}`));
  if (snapshot.daemonTasks.queued > 0) parts.push(yellow(`queued:${snapshot.daemonTasks.queued}`));
  return dim("│ ") + parts.join(" " + dim("│") + " ");
}
