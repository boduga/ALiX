/**
 * dashboard-renderer.ts — Canvas-based 4-panel layout for the chat tab.
 *
 * Divides the row starting at `startY` into four equal-width columns
 * (DAEMON | APPROVALS | RUNTIME | SOPS & POLICY) using the TerminalCanvas
 * coordinate-based box drawing.
 */

import type { DashboardSnapshot } from "./snapshot.js";
import type { TerminalCanvas } from "./canvas.js";

/**
 * Render the 4-panel dashboard onto the provided canvas at the given
 * starting row.  Each panel is 1/4 of the canvas width.
 */
export function renderDashboard(
  snap: DashboardSnapshot,
  canvas: TerminalCanvas,
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
  // Layout per row (relative to startY):
  //   0: title bar  — "DAEMON" (left, green) + "● running" (right, green)
  //   1: top rule   — dim "─" × panelW - 2
  //   2..5: 4-row metadata block — PID / Uptime / Version / Workspace
  //   6: mid rule   — dim "─" × panelW - 2
  //   7..9: 3-row metrics block — CPU / MEM / DISK with labeled bar
  //   10..11: unused
  renderDaemonPanel(canvas, snap, panelW, startY);

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

/** Render uptime as `HH:MM:SS` (matches target's `Uptime: 00:12:47` style). */
function fmtUptime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Render a single labeled-bar row at (x, y) with the entire row fitting in
 * `totalWidth` columns. Layout within the row:
 *
 *   cols 0..3   : label (4 chars, e.g. "CPU ", "MEM ", "DISK")
 *   col  4      : space
 *   cols 5..10  : percent right-aligned in 6-char field, "XX.X%" / "(?)%"
 *   col  11     : space
 *   cols 12..   : bar cells (█ filled, ░ empty), green
 *
 * Resolves the panel-overflow bug in `TerminalCanvas.drawBar`, whose bracket
 * + trailing-percent suffixes went past `barWidth` and bled into the next
 * panel column.
 */
function drawLabeledBar(
  canvas: TerminalCanvas,
  x: number,
  y: number,
  totalWidth: number,
  label: string,
  fraction: number,
): void {
  const labelFixed = label.padEnd(4).slice(0, 4);
  canvas.write(x, y, labelFixed);
  canvas.write(x + 4, y, " ");

  const pctField = formatPctField(fraction);
  canvas.write(x + 5, y, pctField);
  canvas.write(x + 11, y, " ");

  const barWidth = Math.max(0, totalWidth - 12);
  if (barWidth === 0) return;
  const filled = Math.round(clamp01(fraction) * barWidth);
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  canvas.write(x + 12, y, green);
  for (let i = 0; i < barWidth; i++) {
    canvas.write(x + 12 + i, y, i < filled ? "█" : "░");
  }
  canvas.write(x + 12 + barWidth, y, reset);
}

/** Render percentage in a 6-char right-aligned field, e.g. `"  0.0%"`, `"100.0%"`, or `"(?)%"` when unavailable. */
function formatPctField(fraction: number): string {
  if (fraction < 0 || !Number.isFinite(fraction)) return "(?)%".padStart(6);
  const pct = Math.max(0, Math.min(100, fraction * 100));
  const text = `${pct.toFixed(1)}%`;
  return text.padStart(6);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Render the redesigned DAEMON panel at row `startY`. Replaces the prior
 * boxed style (`drawBox` corners + vertical sides) with thin horizontal
 * rules and a Title-Case metadata + metrics block, matching the design
 * target.
 *
 * Offline case (`snap.daemon === null`) shows only the offline notice —
 * no title or rules, matching the target's empty-state intent.
 */
function renderDaemonPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  panelW: number,
  startY: number,
): void {
  const daemon = snap.daemon;

  // Row 0 — title bar (always painted so the panel header is present in all states).
  canvas.write(2, startY, "\x1b[32mDAEMON\x1b[0m");
  if (daemon) {
    canvas.write(panelW - 12, startY, "\x1b[32m● running\x1b[0m");
  } else {
    canvas.write(panelW - 12, startY, "\x1b[90m○ stopped\x1b[0m");
  }

  // Row 1 — top rule.
  for (let i = 0; i < panelW - 2; i++) canvas.write(2 + i, startY + 1, "\x1b[90m─\x1b[0m");

  if (!daemon) {
    // Offline body: a single dim "not running" line, no metadata, no metrics.
    canvas.write(2, startY + 2, "\x1b[90m○ not running\x1b[0m");
    return;
  }

  // Rows 2..5 — metadata block.
  const metaLabel = (k: string): string => `${k.padEnd(12)}`;
  const contentW = panelW - 4;
  const meta = (rowOffset: number, line: string): void => {
    canvas.write(2, startY + rowOffset, line.slice(0, contentW));
  };

  meta(2, `${metaLabel("PID:")}${daemon.pid ?? "—"}`);
  meta(3, `${metaLabel("Uptime:")}${fmtUptime(daemon.uptimeSeconds)}`);
  meta(4, `${metaLabel("Version:")}${snap.session?.version ?? "—"}`);
  meta(5, `${metaLabel("Workspace:")}—`);

  // Row 6 — mid rule.
  for (let i = 0; i < panelW - 2; i++) canvas.write(2 + i, startY + 6, "\x1b[90m─\x1b[0m");

  // Rows 7..9 — metrics block.
  const cpuFrac = daemon.cpuPercent / 100;
  const memFrac = daemon.memoryTotalBytes > 0 ? daemon.memoryRssBytes / daemon.memoryTotalBytes : 0;
  const diskFrac = daemon.diskTotalBytes > 0 ? daemon.diskUsedBytes / daemon.diskTotalBytes : -1;

  drawLabeledBar(canvas, 2, startY + 7, contentW, "CPU", cpuFrac);
  drawLabeledBar(canvas, 2, startY + 8, contentW, "MEM", memFrac);
  drawLabeledBar(canvas, 2, startY + 9, contentW, "DISK", diskFrac);
}

function truncateWS(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
