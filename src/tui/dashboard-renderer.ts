/**
 * dashboard-renderer.ts — Canvas-based 4-panel layout for the chat tab.
 *
 * Divides the row starting at `startY` into four equal-width columns
 * (DAEMON | APPROVALS | RUNTIME | SOPS & POLICY) using the TerminalCanvas
 * coordinate-based box drawing.
 */

import type { DashboardSnapshot } from "./snapshot.js";
import type { TerminalCanvas } from "./canvas.js";

/** All dashboard panels share this fixed height (in canvas rows). */
const PANEL_H = 14;

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
  if (panelW < 20) {
    // Canvas too narrow for 4-panel layout — render compact summary.
    const daemonStatus = snap.daemon
      ? "\x1b[32m●\x1b[0m"
      : "\x1b[90m○\x1b[0m";
    const appsCount = snap.approvals?.totalPending ?? 0;
    const events = snap.runtime?.totalEventCount ?? 0;
    const policyMode = snap.policy?.enforcementMode ?? "—";
    const summary =
      `D:${daemonStatus} A:${appsCount} E:${events} P:${policyMode}`;
    canvas.write(0, startY + 1, summary);
    return;
  }
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
  // Layout per row (relative to startY):
  //   0:  title bar — "RUNTIME" (green, left) + "events: N" (green if >0, gray =0, right)
  //   1:  top rule
  //   2:  Last event:  <kind>           <relative-time-ago>
  //   3:  Active step: Step N / —       <relative-time>
  //   4:  Workflow:    <workflow-name>
  //   5:  Started:     <HH:MM:SS ago>
  //   6:  mid rule
  //   7:  Steps completed: <current> / <total>
  //   8:  progress bar (labeled bar — Steps fraction = currentStep / totalSteps)
  //   9:  bottom rule
  //   10: footer hint "Run 'runtime' for live stream"
  //   11: blank
  renderRuntimePanel(canvas, snap, panelW, startY);

  // ── SOPS & POLICY panel (index 3) ───────────────────────────────
  // Layout per row (relative to startY):
  //   0:  title bar — "SOPS & POLICY" (green, left) + "SOPs: N | Rules: M"
  //       (green when both >0, gray otherwise; right-aligned)
  //   1:  top rule
  //   2:  "Loaded SOPs: N" header
  //   3..5: up to 3 SOP items ("● <name> …… <version>")
  //   6:  "… and K more" overflow indicator (only when items.length > 3)
  //   7:  mid rule (between SOP list and Policy block)
  //   8:  "Policy:     <mode>" (mode in green when 'strict')
  //   9:  "Violations: <count>" (count in red when >0)
  //   10: bottom rule
  //   11: footer hint (shortened to fit narrow canvases)
  renderSopsAndPolicyPanel(canvas, snap, panelW, startY);
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
  // Light quartile-block edges (▏ / ▕) frame the bar like the target
  // design — thin vertical strokes at start/end, distinguishable from the
  // full-block fill (█) and light-shade empty cells (░) inside.
  const innerWidth = Math.max(0, barWidth - 2);
  const filledInner = Math.round(clamp01(fraction) * innerWidth);
  canvas.write(x + 12, y, "\x1b[90m▏\x1b[0m");
  for (let i = 0; i < innerWidth; i++) {
    if (i < filledInner) canvas.write(x + 13 + i, y, "\x1b[32m█\x1b[0m");
    else canvas.write(x + 13 + i, y, "\x1b[90m░\x1b[0m");
  }
  canvas.write(x + 13 + innerWidth, y, "\x1b[90m▕\x1b[0m");
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

  // Bounding box around the panel — top edge stays clean (no title overlay).
  canvas.drawBox(0, startY, panelW, PANEL_H);

  // Row 1 — title bar (inside the box, below the top edge).
  canvas.write(2, startY + 1, "\x1b[32mDAEMON\x1b[0m");
  if (daemon) {
    canvas.write(panelW - 12, startY + 1, "\x1b[32m● running\x1b[0m");
  } else {
    canvas.write(panelW - 12, startY + 1, "\x1b[90m○ stopped\x1b[0m");
  }

  if (!daemon) {
    // Offline body: a single dim "not running" line, no metadata, no metrics.
    canvas.write(2, startY + 3, "\x1b[90m○ not running\x1b[0m");
    return;
  }

  // Rows 3..6 — metadata block (row 2 left blank as breathing room after the title).
  const metaLabel = (k: string): string => `${k.padEnd(12)}`;
  const contentW = panelW - 4;
  const meta = (rowOffset: number, line: string): void => {
    canvas.write(2, startY + rowOffset, line.slice(0, contentW));
  };

  meta(3, `${metaLabel("PID:")}${daemon.pid ?? "—"}`);
  meta(4, `${metaLabel("Uptime:")}${fmtUptime(daemon.uptimeSeconds)}`);
  meta(5, `${metaLabel("Version:")}${snap.session?.version ?? "—"}`);
  meta(6, `${metaLabel("Workspace:")}—`);

  // Row 7 — mid rule (between metadata and metrics).
  // Width: `panelW - 3` cols centered with 1-col padding on each side, so the
  // rule stays strictly inside the box's vertical `│` borders instead of
  // overwriting the right edge.
  for (let i = 0; i < panelW - 3; i++) canvas.write(2 + i, startY + 7, "\x1b[90m─\x1b[0m");

  // Rows 8..12 — metrics block. Rows 9 and 11 are intentionally blank
  // for breathing room between CPU↔MEM (row 9) and MEM↔DISK (row 11).
  const cpuFrac = daemon.cpuPercent / 100;
  const memFrac = daemon.memoryTotalBytes > 0 ? daemon.memoryRssBytes / daemon.memoryTotalBytes : 0;
  const diskFrac = daemon.diskTotalBytes > 0 ? daemon.diskUsedBytes / daemon.diskTotalBytes : -1;

  drawLabeledBar(canvas, 2, startY + 8, contentW, "CPU", cpuFrac);
  drawLabeledBar(canvas, 2, startY + 10, contentW, "MEM", memFrac);
  drawLabeledBar(canvas, 2, startY + 12, contentW, "DISK", diskFrac);
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

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(panelW, startY, panelW, PANEL_H);

  // Row 1 — title bar (inside the box).
  canvas.write(x, startY + 1, "\x1b[32mAPPROVALS\x1b[0m");
  const counterText = `${totalPending} pending`;
  const counterColor = totalPending > 0 ? "\x1b[33m" : "\x1b[90m";
  canvas.write(x + contentW - counterText.length, startY + 1, `${counterColor}${counterText}\x1b[0m`);

  if (items.length === 0) {
    canvas.write(x, startY + 3, "\x1b[90m○ no pending approvals\x1b[0m");
  } else {
    const now = Date.now();
    let row = 3;
    for (const item of items) {
      if (row + 1 > 11) break; // leave row 12 for footer, row 13 for box bottom edge
      paintApprovalItemRow(canvas, x, startY + row, contentW, item);
      paintApprovalSubRow(canvas, x, startY + row + 1, contentW, item, now);
      row += 2;
    }
  }

  // Row 12 — footer hint (inside the box, just above the bottom edge at row 13).
  canvas.write(x, startY + 12, "\x1b[32mRun 'approvals' to review\x1b[0m");
  if (overflow > 0) {
    const overflowText = `+${overflow} more`;
    canvas.write(x + contentW - overflowText.length, startY + 12, `\x1b[90m${overflowText}\x1b[0m`);
  }
}

function paintMetaLine(
  canvas: TerminalCanvas,
  x: number,
  y: number,
  contentW: number,
  label: string,
  value: string,
  rightSuffix: string = "",
): void {
  const labelField = label.padEnd(14);
  const valueStart = x + labelField.length;
  const valueBudget = contentW - labelField.length - (rightSuffix ? rightSuffix.length + 1 : 0);
  const valueText = truncateWS(value, Math.max(0, valueBudget));
  canvas.write(x, y, `${labelField}${valueText}`);
  if (rightSuffix) {
    canvas.write(x + contentW - rightSuffix.length, y, rightSuffix);
  }
}

/** Format a millisecond timestamp as a short bare-duration: "18s", "2m", "1h 5m". */
function formatShortDuration(ms: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Format an integer with thousands separators, e.g. 21,530. */
function formatThousands(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Render the redesigned RUNTIME panel at row `startY`. Mirrors the DAEMON
 * panel's chrome pattern (title bar + counter, top rule, metadata block,
 * mid rule, metric block, bottom rule, footer hint) without using
 * `TerminalCanvas.drawBox`.
 */
function renderRuntimePanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  panelW: number,
  startY: number,
): void {
  const x = panelW * 2 + 2;
  const contentW = panelW - 4;
  const runtime = snap.runtime;
  const workflow = runtime?.workflow ?? null;

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(panelW * 2, startY, panelW, PANEL_H);

  // Row 1 — title bar (inside the box).
  canvas.write(x, startY + 1, "\x1b[32mRUNTIME\x1b[0m");
  const totalEvents = runtime?.totalEventCount ?? 0;
  if (totalEvents > 0) {
    const counter = `events: ${formatThousands(totalEvents)}`;
    canvas.write(x + contentW - counter.length, startY + 1, `\x1b[32m${counter}\x1b[0m`);
  } else {
    const counter = "events: 0";
    canvas.write(x + contentW - counter.length, startY + 1, `\x1b[90m${counter}\x1b[0m`);
  }

  // Rows 2..5 — metadata block.
  const now = Date.now();
  const lastEvent = runtime && runtime.events.length > 0 ? runtime.events[0]! : null;
  const lastKind = lastEvent?.kind ?? "—";
  const lastAgo = lastEvent ? `${formatRelative(lastEvent.timestamp, now)}` : "";
  paintMetaLine(canvas, x, startY + 3, contentW, "Last event:", lastKind, lastAgo);

  // Active step: schema lacks per-step name + start. Use "Step N" placeholder
  // and approximate duration from lastEventAt (close enough to "18s ago"-style).
  const stepLabel = workflow ? `Step ${workflow.currentStep}` : "—";
  const stepDurSrc = runtime?.lastEventAt ?? workflow?.startedAt ?? null;
  const stepDur = stepDurSrc !== null ? formatShortDuration(stepDurSrc, now) : "";
  paintMetaLine(canvas, x, startY + 4, contentW, "Active step:", stepLabel, stepDur);

  paintMetaLine(
    canvas,
    x,
    startY + 5,
    contentW,
    "Workflow:",
    workflow ? truncateWS(workflow.name, contentW - 16) : "—",
  );

  paintMetaLine(
    canvas,
    x,
    startY + 6,
    contentW,
    "Started:",
    workflow ? `${fmtUptime((now - workflow.startedAt) / 1000)} ago` : "—",
  );

  // Row 7 — mid rule (between metadata and metrics).
  // Width: panelW - 3 cols (1-col padding on each side) so the rule stays
  // inside the box's `│` borders instead of overwriting the right edge.
  for (let i = 0; i < panelW - 3; i++) canvas.write(x + i, startY + 7, "\x1b[90m─\x1b[0m");

  // Row 8 — progress label / empty-state note.
  if (workflow) {
    canvas.write(
      x,
      startY + 8,
      `Steps completed: ${workflow.currentStep} / ${workflow.totalSteps}`,
    );
    // Row 9 — progress bar.
    const frac = workflow.totalSteps > 0 ? workflow.currentStep / workflow.totalSteps : 0;
    drawLabeledBar(canvas, x, startY + 9, contentW, "%", frac);
  } else {
    canvas.write(x, startY + 8, "\x1b[90m○ no active workflow\x1b[0m");
  }

  // Row 12 — footer hint (just above box bottom edge at row 13).
  canvas.write(x, startY + 12, "\x1b[32mLive 'runtime' stream\x1b[0m");
}

/**
 * Render the redesigned SOPS & POLICY panel at row `startY`. Mirrors the
 * same chrome pattern used by the other three dashboard panels:
 * drawBox-bordered rectangle + internal sections + footer hint inside
 * the box bottom row.
 */
function renderSopsAndPolicyPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  panelW: number,
  startY: number,
): void {
  const x = panelW * 3 + 2;
  const contentW = panelW - 4;
  const sops = snap.sops;
  const policy = snap.policy;

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(panelW * 3, startY, panelW, PANEL_H);

  // Row 1 — title bar (inside the box).
  canvas.write(x, startY + 1, "\x1b[32mSOPS & POLICY\x1b[0m");
  const sopCount = sops?.totalLoaded ?? 0;
  const ruleCount = policy?.rules.length ?? 0;
  const counterText = `SOPs: ${sopCount} | Rules: ${ruleCount}`;
  const counterColor = sopCount > 0 && ruleCount > 0 ? "\x1b[32m" : "\x1b[90m";
  canvas.write(x + contentW - counterText.length, startY + 1, `${counterColor}${counterText}\x1b[0m`);

  // Row 3 — Loaded SOPs header.
  canvas.write(x, startY + 3, `Loaded SOPs: ${sopCount}`);

  // Rows 4..6 — SOP items (up to 3).
  if (sops && sops.items.length > 0) {
    const max = Math.min(3, sops.items.length);
    for (let i = 0; i < max; i++) {
      const item = sops.items[i]!;
      const prefix = `● ${item.name} `;
      const versionBudget = Math.max(0, contentW - prefix.length);
      const versionText = truncateWS(item.version, versionBudget);
      canvas.write(x, startY + 4 + i, `● ${item.name}`);
      canvas.write(x + contentW - versionText.length, startY + 4 + i, versionText);
    }

    // Row 7 — overflow indicator (only when more items than the cap).
    const overflow = sops.items.length - max;
    if (overflow > 0) {
      canvas.write(x, startY + 7, `\x1b[90m… and ${overflow} more\x1b[0m`);
    }
  } else {
    // Empty-state at row 4 when no SOPs.
    canvas.write(x, startY + 4, "\x1b[90m○ no SOPs loaded\x1b[0m");
  }

  // Row 8 — mid rule (between SOP list and Policy block).
  // Width: panelW - 3 cols (1-col padding on each side) so the rule stays
  // inside the box's `│` borders instead of overwriting the right edge.
  for (let i = 0; i < panelW - 3; i++) canvas.write(x + i, startY + 8, "\x1b[90m─\x1b[0m");

  // Row 9 — Policy mode.
  const modeText = policy?.enforcementMode ?? "—";
  const modeColor = modeText === "strict" ? "\x1b[32m" : "";
  canvas.write(x, startY + 9, `Policy:     ${modeColor}${modeText}\x1b[0m`);

  // Row 10 — Violations count.
  const vCount = policy?.recentViolationCount ?? 0;
  const vColor = vCount > 0 ? "\x1b[31m" : "";
  canvas.write(x, startY + 10, `Violations: ${vColor}${vCount}\x1b[0m`);

  // Row 12 — footer hint (just above box bottom edge at row 13).
  canvas.write(x, startY + 12, "\x1b[32mOpen sops or policy\x1b[0m");
}
