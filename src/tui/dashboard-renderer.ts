/**
 * dashboard-renderer.ts — Canvas-based 4-panel layout for the chat tab.
 *
 * Divides the row starting at `startY` into four equal-width columns
 * (DAEMON | APPROVALS | RUNTIME | SOPS & POLICY) using the TerminalCanvas
 * coordinate-based box drawing.
 */

import type { DashboardSnapshot } from "./snapshot.js";

/**
 * Render the 4-panel dashboard onto the provided canvas at the given
 * starting row.  Each panel is 1/4 of the canvas width.
 */
export function renderDashboard(
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

  const cx = (panelIndex: number, col = 2) => col + panelW * panelIndex;

  // ── DAEMON panel (index 0) ──────────────────────────────────────
  canvas.drawBox(0, startY, panelW, panelH, "DAEMON");
  if (daemon) {
    canvas.write(cx(0, 2), startY + 2, `PID      ${String(daemon.pid ?? "—")}`);
    canvas.write(cx(0, 2), startY + 3, `uptime   ${fmtUptime(daemon.uptimeSeconds)}`);
    canvas.write(cx(0, 2), startY + 4, `cpu      ${String(daemon.cpuPercent.toFixed(1))}%`);
    const memPct = daemon.memoryTotalBytes > 0 ? (daemon.memoryRssBytes / daemon.memoryTotalBytes * 100).toFixed(0) : "?";
    canvas.write(cx(0, 2), startY + 5, `mem      ${fmtBytes(daemon.memoryRssBytes)} (${memPct}%)`);
    canvas.drawBar(cx(0, 2), startY + 6, panelW - 4, daemon.cpuPercent / 100, "\x1b[36m");
    canvas.drawBar(cx(0, 2), startY + 7, panelW - 4,
      daemon.memoryTotalBytes > 0 ? daemon.memoryRssBytes / daemon.memoryTotalBytes : 0, "\x1b[33m");
  } else {
    canvas.write(cx(0, 2), startY + 2, "\x1b[90m○ not running\x1b[0m");
  }

  // ── APPROVALS panel (index 1) ───────────────────────────────────
  canvas.drawBox(panelW, startY, panelW, panelH, "APPROVALS");
  canvas.write(cx(1, 2), startY + 2, `Pending  ${approvals?.totalPending ?? 0}`);
  if (approvals && approvals.pending.length > 0) {
    for (let i = 0; i < Math.min(3, approvals.pending.length); i++) {
      canvas.write(cx(1, 2), startY + 3 + i, `  ○ ${approvals.pending[i]!.toolName}`);
    }
  } else {
    canvas.write(cx(1, 2), startY + 3, "\x1b[90m  none\x1b[0m");
  }
  canvas.write(cx(1, 2), startY + 7, `Resolved ${approvals?.totalResolved ?? 0}`);

  // ── RUNTIME panel (index 2) ─────────────────────────────────────
  canvas.drawBox(panelW * 2, startY, panelW, panelH, "RUNTIME");
  canvas.write(cx(2, 2), startY + 2, `Events   ${runtime?.totalEventCount ?? 0}`);
  if (runtime && runtime.events.length > 0) {
    const last = runtime.events[0]!;
    canvas.write(cx(2, 2), startY + 3, `  ${last.summary.slice(0, panelW - 6)}`);
    canvas.write(cx(2, 2), startY + 4, `  ${new Date(last.timestamp).toISOString().slice(11, 19)}`);
  } else {
    canvas.write(cx(2, 2), startY + 3, "\x1b[90m  no events\x1b[0m");
  }
  canvas.write(cx(2, 2), startY + 6, `workflow  ${runtime?.workflow?.name ? truncateWS(runtime.workflow.name, 20) : "—"}`);
  if (runtime?.workflow) {
    const frac = runtime.workflow.totalSteps > 0 ? runtime.workflow.currentStep / runtime.workflow.totalSteps : 0;
    canvas.drawBar(cx(2, 2), startY + 7, panelW - 4, frac);
    canvas.write(cx(2, 2), startY + 8, `  ${runtime.workflow.currentStep} / ${runtime.workflow.totalSteps}`);
  }

  // ── SOPS & POLICY panel (index 3) ───────────────────────────────
  canvas.drawBox(panelW * 3, startY, panelW, panelH, "SOPS & POLICY");
  canvas.write(cx(3, 2), startY + 2, `SOPs     ${sops?.totalLoaded ?? 0}`);
  if (sops && sops.items.length > 0) {
    canvas.write(cx(3, 2), startY + 3, `  ${sops.items[0]!.id}`);
  } else {
    canvas.write(cx(3, 2), startY + 3, "\x1b[90m  none\x1b[0m");
  }
  canvas.write(cx(3, 2), startY + 5, `Rules    ${policy?.rules.length ?? 0}`);
  if (policy && policy.violations.length > 0) {
    canvas.write(cx(3, 2), startY + 6, `  \x1b[31m${policy.violations.length} violations\x1b[0m`);
  }
  if (policy) {
    canvas.write(cx(3, 2), startY + 7, `mode     ${policy.enforcementMode}`);
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
