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
  // Layout per row (relative to startY):
  //   0:  title bar — "APPROVALS" (green, left) + "N pending" (yellow if >0, gray =0, right)
  //   1:  top rule
  //   2..9: item list (2 rows each: dot row + "  Requested:" sub-line); up to 4 items
  //   10: bottom rule (only when at least one item was rendered)
  //   11: footer hint "Run 'approvals' to review"
  renderApprovalsPanel(canvas, snap, panelW, startY);

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

/** Format a millisecond timestamp as `18s ago` / `2m ago` / `7h ago`. */
function formatRelative(requestedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - requestedAt) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

interface DisplayApprovalItem {
  readonly toolName: string;
  readonly targetPath: string;
  readonly requestedAt: number;
  readonly kind: "pending" | "resolved";
}

/** Pick up to `max` approval items, pending first then recently-resolved. */
function collectDisplayItems(
  approvals: DashboardSnapshot["approvals"],
  max: number,
): { items: DisplayApprovalItem[]; overflow: number } {
  if (!approvals) return { items: [], overflow: 0 };
  const items: DisplayApprovalItem[] = [];
  for (const a of approvals.pending) {
    if (items.length >= max) break;
    items.push({ toolName: a.toolName, targetPath: a.targetPath, requestedAt: a.requestedAt, kind: "pending" });
  }
  for (const a of approvals.recentlyResolved) {
    if (items.length >= max) break;
    items.push({ toolName: a.toolName, targetPath: a.targetPath, requestedAt: a.requestedAt, kind: "resolved" });
  }
  const total = approvals.pending.length + approvals.recentlyResolved.length;
  return { items, overflow: total - items.length };
}

function paintApprovalItemRow(
  canvas: TerminalCanvas,
  x: number,
  y: number,
  contentW: number,
  item: DisplayApprovalItem,
): void {
  const dot = item.kind === "pending" ? "●" : "○";
  const dotColor = item.kind === "pending" ? "\x1b[33m" : "";
  const tag = "\x1b[32m✓ approved\x1b[0m";
  const tagLen = "✓ approved".length;

  canvas.write(x, y, `${dotColor}${dot}\x1b[0m ${item.toolName}`);

  if (item.kind === "resolved") {
    canvas.write(x + contentW - tagLen, y, tag);
    return;
  }

  // Pending: right-align the target path within remaining cols.
  const prefix = `● ${item.toolName} `;
  const pathBudget = Math.max(0, contentW - prefix.length);
  const path = truncateWS(item.targetPath, pathBudget);
  canvas.write(x + contentW - path.length, y, path);
}

function paintApprovalSubRow(
  canvas: TerminalCanvas,
  x: number,
  y: number,
  contentW: number,
  item: DisplayApprovalItem,
  now: number,
): void {
  const text = `  Requested: ${formatRelative(item.requestedAt, now)}`;
  canvas.write(x, y, text.slice(0, contentW));
}

/**
 * Render the redesigned APPROVALS panel at row `startY`. Replaces the prior
 * boxed summary (counts + bullet list) with a thin-rule item list that mirrors
 * the target design: 2-row per item (dot+tool/path) + indented `Requested:`
 * sub-line. Pending items appear before recently-resolved items. When the
 * list is empty, only the empty-state note + footer are shown.
 */
function renderApprovalsPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  panelW: number,
  startY: number,
): void {
  const approvals = snap.approvals;
  const totalPending = approvals?.totalPending ?? 0;
  const { items, overflow } = collectDisplayItems(approvals, 4);

  const x = panelW + 2;
  const contentW = panelW - 4;

  // Row 0 — title bar.
  canvas.write(x, startY, "\x1b[32mAPPROVALS\x1b[0m");
  const counterText = `${totalPending} pending`;
  const counterColor = totalPending > 0 ? "\x1b[33m" : "\x1b[90m";
  canvas.write(x + contentW - counterText.length, startY, `${counterColor}${counterText}\x1b[0m`);

  // Row 1 — top rule.
  for (let i = 0; i < panelW - 2; i++) canvas.write(x + i, startY + 1, "\x1b[90m─\x1b[0m");

  if (items.length === 0) {
    canvas.write(x, startY + 2, "\x1b[90m○ no pending approvals\x1b[0m");
  } else {
    const now = Date.now();
    let row = 2;
    for (const item of items) {
      if (row + 1 > 9) break; // leave rows 10..11 for rule+footer
      paintApprovalItemRow(canvas, x, startY + row, contentW, item);
      paintApprovalSubRow(canvas, x, startY + row + 1, contentW, item, now);
      row += 2;
    }
    // Bottom rule (only when there were items).
    for (let i = 0; i < panelW - 2; i++) canvas.write(x + i, startY + 10, "\x1b[90m─\x1b[0m");
  }

  // Row 11 — footer hint; add right-aligned "+N more" overflow indicator.
  canvas.write(x, startY + 11, "\x1b[32mRun 'approvals' to review\x1b[0m");
  if (overflow > 0) {
    const overflowText = `+${overflow} more`;
    canvas.write(x + contentW - overflowText.length, startY + 11, `\x1b[90m${overflowText}\x1b[0m`);
  }
}
