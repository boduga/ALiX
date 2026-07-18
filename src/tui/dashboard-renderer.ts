/**
 * dashboard-renderer.ts — Renders Agent OS dashboard cards for the TUI.
 */

import type { TuiRuntimeSnapshot } from "./runtime-snapshot.js";
import { box, green, yellow, red, dim, bold, truncate } from "./box.js";
import type { HealthStatus } from "../observability/health-snapshot.js";
import type { TuiState } from "./store.js";
import type { DashboardSnapshot } from "./snapshot.js";

/** Build a snapshot-like view from store state for dashboard rendering. */
export function snapshotFromStore(s: TuiState): TuiRuntimeSnapshot {
  return {
    daemonRunning: s.daemonRunning ?? false,
    daemonPid: s.daemonPid,
    daemonTasks: s.daemonTasks ?? { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 },
    daemonTaskRecords: s.daemonTaskRecords ?? [],
    pendingApprovalsCount: s.pendingApprovalsCount ?? 0,
    pendingApprovalRecords: s.pendingApprovalRecords ?? [],
    resolvedApprovalsCount: s.resolvedApprovalsCount ?? 0,
    resolvedApprovalRecords: s.resolvedApprovalRecords ?? [],
    continuationsCount: s.continuationsCount ?? 0,
    sopsCount: s.sopsCount ?? 0,
    sopItems: s.sopItems ?? [],
    policyRulesCount: s.policyRulesCount ?? 0,
    runtimeEventCount: s.runtimeEventCount ?? 0,
    recentRuntimeEvents: s.recentRuntimeEvents ?? [],
    traceEvents: s.traceEvents ?? [],
    traceEventCount: s.traceEventCount ?? 0,
    daemonHeartbeatAge: s.daemonHeartbeatAge ?? -1,
    health: s.healthSnapshot,
    cost: s.costData,
  };
}

/**
 * Adapter: DashboardSnapshot → TuiRuntimeSnapshot shape.
 *
 * `DashboardSnapshot` (see ./snapshot.ts) exposes nullable subsystem records
 * (daemon, approvals, runtime, sops, policy, session). `TuiRuntimeSnapshot`
 * (see ./runtime-snapshot.ts) is the flat record that `renderDashboardCards`
 * and `renderCompactSummary` consume.
 *
 * Lives next to `snapshotFromStore` so every view (chat, daemon, approvals,
 * …) can reuse the same bridge without duplicating it. Subsystem data is
 * projected into the runtime-record fields the renderer iterates:
 *
 * - `policyRulesCount` ← snap.policy.rules.length
 * - `recentRuntimeEvents` ← first 10 of snap.runtime.events (kind→action;
 *   source blank — DashboardSnapshot events do not carry a source field)
 * - `pendingApprovalRecords` / `resolvedApprovalRecords` ← snap.approvals
 *   lists (toolName→capability, targetPath→reason)
 * - `daemonTaskRecords` ← [] (DaemonMetricsSnapshot exposes clients, whose
 *   shape does not match the runtime record — renderer tolerates [])
 *
 * Any subsystem that is null contributes safe defaults.
 */
export function dashboardSnapshotToRuntime(snap: DashboardSnapshot): TuiRuntimeSnapshot {
  const sopsItems = (snap.sops?.items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    version: i.version,
  }));
  const pendingApprovalRecords = (snap.approvals?.pending ?? []).map((a) => ({
    id: a.id,
    capability: a.toolName,
    reason: a.targetPath,
    createdAt: String(a.requestedAt),
  }));
  const resolvedApprovalRecords = (snap.approvals?.recentlyResolved ?? []).map((a) => ({
    id: a.id,
    capability: a.toolName,
    reason: a.targetPath,
    createdAt: String(a.requestedAt),
  }));
  const recentRuntimeEvents = (snap.runtime?.events ?? []).slice(0, 10).map((e) => ({
    id: e.id,
    action: e.kind,
    source: "",
    summary: e.summary,
    timestamp: String(e.timestamp),
  }));
  return {
    daemonRunning: snap.daemon !== null,
    daemonPid: undefined,
    daemonTasks: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 },
    daemonTaskRecords: [],
    pendingApprovalsCount: snap.approvals?.totalPending ?? 0,
    pendingApprovalRecords,
    resolvedApprovalsCount: snap.approvals?.totalResolved ?? 0,
    resolvedApprovalRecords,
    continuationsCount: 0,
    sopsCount: snap.sops?.totalLoaded ?? 0,
    sopItems: sopsItems,
    policyRulesCount: snap.policy?.rules.length ?? 0,
    runtimeEventCount: snap.runtime?.totalEventCount ?? 0,
    recentRuntimeEvents,
    traceEvents: [],
    traceEventCount: 0,
    daemonHeartbeatAge: -1,
  };
}

/** Render dashboard cards. thin = 2-row laptop layout, otherwise 3-wide. */
export function renderDashboardCards(snapshot: TuiRuntimeSnapshot, width: number, thin = false): string[] {
  if (thin) {
    const halfW = Math.max(Math.floor((width - 6) / 2), 30);
    const daemon = renderDaemonCard(snapshot, halfW);
    const center = renderCenterCard(snapshot, halfW);
    const right = renderRightCard(snapshot, halfW);
    const row1 = Math.max(daemon.length, center.length);
    const result: string[] = [];
    for (let i = 0; i < row1; i++) {
      result.push((i < daemon.length ? daemon[i] : " ".repeat(halfW + 2)) + " " + (i < center.length ? center[i] : " ".repeat(halfW + 2)));
    }
    for (let i = 0; i < right.length; i++) {
      const pad = Math.floor((width - halfW - 2) / 2);
      result.push(" ".repeat(pad) + (i < right.length ? right[i] : " ".repeat(halfW + 2)));
    }
    return result;
  }
  const cardW = Math.max(Math.floor((width - 8) / 3), 20);
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

function healthStatusLabel(status: HealthStatus | undefined): string {
  if (!status || status === "unknown") return dim("unknown");
  if (status === "healthy") return green("healthy");
  if (status === "degraded") return yellow("degraded");
  return red("unhealthy");
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
  // Health status (if available)
  if (snapshot.health) {
    lines.push("");
    const overall = snapshot.health.daemon.status;
    const mem = snapshot.health.resources.memoryRssMb;
    const memColor = mem > 1000 ? red : mem > 500 ? yellow : dim;
    lines.push(`Health  ${healthStatusLabel(overall)}  ${memColor(`${mem}MB`)}`);
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

/**
 * Canvas-based 4-panel layout for the chat tab.
 *
 * Divides the row starting at `startY` into four equal-width columns
 * (DAEMON | APPROVALS | RUNTIME | SOPS & POLICY) using the canvas's
 * coordinate-based box drawing.  This replaces the older `renderDashboardCards`
 * approach which merged APPROVALS+RUNTIME into one card.
 */
export function renderDashboardOnCanvas(
  snap: DashboardSnapshot,
  canvas: import("./canvas.js").TerminalCanvas,
  startY: number,
): void {
  const panelW = Math.floor(canvas.width / 4);
  const panelH = 12;
  const runtime = snap.runtime;
  const approvals = snap.approvals;
  const policy = snap.policy;
  const sops = snap.sops;
  const daemon = snap.daemon;

  // ── DAEMON panel ────────────────────────────────────────────────
  canvas.drawBox(0, startY, panelW, panelH, "DAEMON");
  if (daemon) {
    canvas.write(2, startY + 2, `PID      ${String(daemon.pid ?? "—")}`);
    canvas.write(2, startY + 3, `uptime   ${fmtUptime(daemon.uptimeSeconds)}`);
    canvas.write(2, startY + 4, `cpu      ${String(daemon.cpuPercent.toFixed(1))}%`);
    const memPct = daemon.memoryTotalBytes > 0 ? (daemon.memoryRssBytes / daemon.memoryTotalBytes * 100).toFixed(0) : "?";
    canvas.write(2, startY + 5, `mem      ${fmtBytes(daemon.memoryRssBytes)} (${memPct}%)`);
    canvas.drawBar(2, startY + 6, panelW - 4, daemon.cpuPercent / 100, "\x1b[36m");
    canvas.drawBar(2, startY + 7, panelW - 4,
      daemon.memoryTotalBytes > 0 ? daemon.memoryRssBytes / daemon.memoryTotalBytes : 0, "\x1b[33m");
  } else {
    canvas.write(2, startY + 2, "\x1b[90m○ not running\x1b[0m");
  }

  // ── APPROVALS panel ─────────────────────────────────────────────
  canvas.drawBox(panelW, startY, panelW, panelH, "APPROVALS");
  canvas.write(2, startY + 2, `Pending  ${approvals?.totalPending ?? 0}`);
  if (approvals && approvals.pending.length > 0) {
    for (let i = 0; i < Math.min(3, approvals.pending.length); i++) {
      canvas.write(2, startY + 3 + i, `  ○ ${approvals.pending[i]!.toolName}`);
    }
  } else {
    canvas.write(2, startY + 3, "\x1b[90m  none\x1b[0m");
  }
  canvas.write(2, startY + 7, `Resolved ${approvals?.totalResolved ?? 0}`);

  // ── RUNTIME panel ───────────────────────────────────────────────
  canvas.drawBox(panelW * 2, startY, panelW, panelH, "RUNTIME");
  canvas.write(2, startY + 2, `Events   ${runtime?.totalEventCount ?? 0}`);
  if (runtime && runtime.events.length > 0) {
    const last = runtime.events[0]!;
    canvas.write(2, startY + 3, `  ${last.summary.slice(0, panelW - 6)}`);
    canvas.write(2, startY + 4, `  ${new Date(last.timestamp).toISOString().slice(11, 19)}`);
  } else {
    canvas.write(2, startY + 3, "\x1b[90m  no events\x1b[0m");
  }
  canvas.write(2, startY + 6, `workflow  ${runtime?.workflow?.name ? truncateWS(runtime.workflow.name, 20) : "—"}`);
  if (runtime?.workflow) {
    const frac = runtime.workflow.totalSteps > 0 ? runtime.workflow.currentStep / runtime.workflow.totalSteps : 0;
    canvas.drawBar(2, startY + 7, panelW - 4, frac);
    canvas.write(2, startY + 8, `  ${runtime.workflow.currentStep} / ${runtime.workflow.totalSteps}`);
  }

  // ── SOPS & POLICY panel ─────────────────────────────────────────
  canvas.drawBox(panelW * 3, startY, panelW, panelH, "SOPS & POLICY");
  canvas.write(2, startY + 2, `SOPs     ${sops?.totalLoaded ?? 0}`);
  if (sops && sops.items.length > 0) {
    canvas.write(2, startY + 3, `  ${sops.items[0]!.id}`);
  } else {
    canvas.write(2, startY + 3, "\x1b[90m  none\x1b[0m");
  }
  canvas.write(2, startY + 5, `Rules    ${policy?.rules.length ?? 0}`);
  if (policy && policy.violations.length > 0) {
    canvas.write(2, startY + 6, `  \x1b[31m${policy.violations.length} violations\x1b[0m`);
  }
  if (policy) {
    canvas.write(2, startY + 7, `mode     ${policy.enforcementMode}`);
  }
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function truncateWS(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
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
  if (snapshot.health) {
    parts.push(`health:${healthStatusLabel(snapshot.health.daemon.status)}`);
  }
  if (snapshot.daemonTasks.running > 0) parts.push(yellow(`run:${snapshot.daemonTasks.running}`));
  if (snapshot.daemonTasks.queued > 0) parts.push(yellow(`queued:${snapshot.daemonTasks.queued}`));
  return dim("│ ") + parts.join(" " + dim("│") + " ");
}
