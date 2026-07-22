/**
 * dashboard-renderer.ts — Canvas-based 4-panel layout for the chat tab.
 *
 * Divides the row starting at `startY` into four equal-width columns
 * (DAEMON | APPROVALS | RUNTIME | SOPS & POLICY) using the TerminalCanvas
 * coordinate-based box drawing.
 *
 * The four panel painters below are exported so other layouts (e.g. the
 * right-sidebar 75/25 split) can reuse the EXACT SAME visual style. Each
 * painter accepts `(canvas, snap, x, y, w, h)` and renders its content into
 * the rectangle. When `h` is less than `DEFAULT_PANEL_H`, the painter
 * gracefully drops content from the bottom (e.g. skips the DISK bar when
 * the panel can't fit all three resource bars).
 */

import type { DashboardSnapshot } from "./snapshot.js";
import type { TerminalCanvas } from "./canvas.js";

/** Default panel height in rows — matches the historical bottom-of-chat dashboard. */
export const DEFAULT_PANEL_H = 14;

/**
 * Render the 4-panel dashboard onto the provided canvas at the given
 * starting row.  Each panel is 1/4 of the canvas width.
 */
export function renderDashboard(
  snap: DashboardSnapshot,
  canvas: TerminalCanvas,
  startY: number,
  options: { h?: number } = {},
): void {
  const h = options.h ?? DEFAULT_PANEL_H;
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
  paintDaemonPanel(canvas, snap, 0, startY, panelW, h);
  paintApprovalsPanel(canvas, snap, panelW, startY, panelW, h);
  paintRuntimePanel(canvas, snap, panelW * 2, startY, panelW, h);
  paintSopsAndPolicyPanel(canvas, snap, panelW * 3, startY, panelW, h);
}

/* ─── Panel painters (exported for the sidebar layout) ───────────── */

/**
 * Render the DAEMON panel at `(x, y)` with `w × h` dimensions.
 *
 * Layout when `h >= 14` (default):
 *   0:    top border (box top edge)
 *   1:    title bar — "DAEMON" + status indicator
 *   2:    breathing room
 *   3..6: PID / Uptime / Version / Workspace
 *   7:    mid rule
 *   8:    CPU bar
 *   9:    blank
 *   10:   MEM bar
 *   11:   blank
 *   12:   DISK bar
 *   13:   bottom border (box bottom edge)
 *
 * When `h < 14`, content rows are dropped from the bottom up:
 *   - h < 13: skip DISK bar
 *   - h < 12: also skip MEM bar (CPU stays at y+8)
 *   - h < 9:  skip the metadata block AND the bar block
 *   - h < 5:  only the title remains visible
 */
export function paintDaemonPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  x: number,
  y: number,
  w: number,
  h: number = DEFAULT_PANEL_H,
): void {
  // Bounding box around the panel — top edge stays clean (no title overlay).
  canvas.drawBox(x, y, w, h);

  // Row 1 — title bar (inside the box, below the top edge).
  canvas.write(x + 2, y + 1, "\x1b[32mDAEMON\x1b[0m");
  if (snap.daemon) {
    canvas.write(x + w - 12, y + 1, "\x1b[32m● running\x1b[0m");
  } else {
    canvas.write(x + w - 12, y + 1, "\x1b[90m○ stopped\x1b[0m");
  }

  if (!snap.daemon) {
    if (h >= 5) canvas.write(x + 2, y + 3, "\x1b[90m○ not running\x1b[0m");
    return;
  }

  // Rows 3..6 — metadata block. Only render rows that actually fit.
  const contentW = w - 4;
  const metaRows: string[] = [
    `PID:        ${snap.daemon.pid ?? "—"}`,
    `Uptime:   ${fmtUptime(snap.daemon.uptimeSeconds)}`,
    `Version:  ${snap.session?.version ?? "—"}`,
    `Workspace:  —`,
  ];
  let metaEnd = 2; // no metadata rendered yet
  if (h >= 9) {
    for (let i = 0; i < metaRows.length && i + 3 < h - 1; i++) {
      canvas.write(x + 2, y + 3 + i, metaRows[i]!.slice(0, contentW));
      metaEnd = i + 3;
    }
  }

  // Row metaEnd+1 — mid rule (between metadata and metrics).
  if (h >= 10) {
    const ruleY = y + metaEnd + 1;
    for (let i = 0; i < w - 3; i++) canvas.write(x + 2 + i, ruleY, "\x1b[90m─\x1b[0m");

    // Bars below the rule, fit what we can.
    const cpuFrac = snap.daemon.cpuPercent / 100;
    const memFrac = snap.daemon.memoryTotalBytes > 0 ? snap.daemon.memoryRssBytes / snap.daemon.memoryTotalBytes : 0;
    const diskFrac = snap.daemon.diskTotalBytes > 0 ? snap.daemon.diskUsedBytes / snap.daemon.diskTotalBytes : -1;
    drawLabeledBar(canvas, x + 2, ruleY + 1, contentW, "CPU", cpuFrac);
    // Each bar occupies 2 rows (label + breathing space). Bars must fit
    // before the box bottom edge at y + h - 1.
    let nextBarY = ruleY + 3;
    if (nextBarY < y + h - 1) {
      drawLabeledBar(canvas, x + 2, nextBarY, contentW, "MEM", memFrac);
      nextBarY += 2;
      if (nextBarY < y + h - 1) {
        drawLabeledBar(canvas, x + 2, nextBarY, contentW, "DISK", diskFrac);
      }
    }
  }
}

/**
 * Render the APPROVALS panel at `(x, y)` with `w × h` dimensions.
 *
 * Layout when `h >= 14`:
 *   0:    top border
 *   1:    title — "APPROVALS" + "N pending" counter
 *   2:    breathing room
 *   3..10: approval items (2 rows each, up to 4)
 *   11:   breathing room
 *   12:   footer hint (+ optional "+N more" overflow)
 *   13:   bottom border
 *
 * When `h < 14`, the footer is dropped first; when `h < 11`, fewer
 * items are shown; when `h < 5`, only the title remains.
 */
export function paintApprovalsPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  x: number,
  y: number,
  w: number,
  h: number = DEFAULT_PANEL_H,
  options: { scrollOffset?: number; focused?: boolean } = {},
): void {
  const focused = options.focused === true;
  const approvals = snap.approvals;
  const totalPending = approvals?.totalPending ?? 0;
  // Hard cap of 4 visible items matches the production design — adding more
  // dilutes the panel. Tighter layouts drop the cap further (each item
  // needs 2 rows + breathing room before the footer / box bottom edge).
  const APPROVAL_LIST_MAX = 4;
  const itemRows = 2;
  const footerRows = h >= 14 ? 1 : 0;
  const availableRows = Math.max(0, h - 3 /* title+rule+gap */ - footerRows);
  const maxItems = Math.max(0, Math.min(APPROVAL_LIST_MAX, Math.floor(availableRows / itemRows)));
  // Ordered collection — pending (newest first), then recently-resolved — so
  // the operator sees the items most likely to need attention at the top.
  // Slicing from `scrollOffset` gives the panel its scroll behaviour; the
  // caller is responsible for clamping the offset against `totalItems`.
  const { items, totalItems, above } = collectDisplayItems(approvals, options.scrollOffset ?? 0, maxItems);

  const contentW = w - 4;

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(x, y, w, h);

  // Row 1 — title bar (inside the box). Brighter cyan when focused so the
  // operator sees at a glance which panel owns the `J`/`K` keys.
  const titleColor = focused ? "\x1b[1;36m" : "\x1b[32m";
  canvas.write(x + 2, y + 1, `${titleColor}APPROVALS\x1b[0m`);
  const counterText = `${totalPending} pending`;
  const counterColor = totalPending > 0 ? "\x1b[33m" : "\x1b[90m";
  canvas.write(x + 2 + contentW - counterText.length, y + 1, `${counterColor}${counterText}\x1b[0m`);

  // "↑ N above" / "↓ N below" chrome — only renders when the panel actually
  // has content off-screen in that direction. Tells the operator that
  // scrolling has content to land on.
  const overflowStartRow = 2;
  if (above > 0 || totalItems - (options.scrollOffset ?? 0) - items.length > 0) {
    const aboveText = above > 0 ? `↑ ${above} above` : "";
    const belowText = totalItems - items.length - above > 0 ? `↓ ${totalItems - items.length - above} below` : "";
    const overflow = `${aboveText}${aboveText && belowText ? "  " : ""}${belowText}`.trim();
    if (overflow && h >= 5) canvas.write(x + 2, y + overflowStartRow, `\x1b[90m${overflow}\x1b[0m`.slice(0, contentW + 10));
  }

  if (items.length === 0) {
    if (h >= 5 && above === 0) canvas.write(x + 2, y + 3, "\x1b[90m○ no pending approvals\x1b[0m");
  } else {
    const now = Date.now();
    let row = overflowStartRow + 1;
    for (const item of items) {
      if (row + itemRows - 1 > h - 2 - footerRows) break;
      paintApprovalItemRow(canvas, x + 2, y + row, contentW, item);
      paintApprovalSubRow(canvas, x + 2, y + row + 1, contentW, item, now);
      row += itemRows;
    }
  }

  // Footer row inside the box, just above the bottom edge — only when h >= 14.
  if (footerRows > 0) {
    canvas.write(x + 2, y + h - 2, "\x1b[32mRun 'approvals' to review\x1b[0m");
  }
  // Last-letter-of-footer overflow indicator — replaced by ↓ N below.
  // (Old "+N more" suffix at footer position used to confuse with the
  // ↑ N above / ↓ N below chrome inside the title area.)
  void footerRows;
}

/**
 * Render the RUNTIME panel at `(x, y)` with `w × h` dimensions.
 *
 * Layout when `h >= 14`:
 *   0:    top border
 *   1:    title — "RUNTIME" + "events: N" counter
 *   2:    breathing room
 *   3..6: Last event / Active step / Workflow / Started
 *   7:    mid rule
 *   8:    Steps completed label (or empty-state note)
 *   9:    progress bar
 *   10..11: breathing room
 *   12:   footer hint
 *   13:   bottom border
 */
export function paintRuntimePanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  x: number,
  y: number,
  w: number,
  h: number = DEFAULT_PANEL_H,
): void {
  const contentW = w - 4;
  const runtime = snap.runtime;
  const workflow = runtime?.workflow ?? null;

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(x, y, w, h);

  // Row 1 — title bar (inside the box).
  canvas.write(x + 2, y + 1, "\x1b[32mRUNTIME\x1b[0m");
  const totalEvents = runtime?.totalEventCount ?? 0;
  if (totalEvents > 0) {
    const counter = `events: ${formatThousands(totalEvents)}`;
    canvas.write(x + 2 + contentW - counter.length, y + 1, `\x1b[32m${counter}\x1b[0m`);
  } else {
    const counter = "events: 0";
    canvas.write(x + 2 + contentW - counter.length, y + 1, `\x1b[90m${counter}\x1b[0m`);
  }

  const now = Date.now();
  const lastEvent = runtime && runtime.events.length > 0 ? runtime.events[0]! : null;
  const lastKind = lastEvent?.kind ?? "—";
  const lastAgo = lastEvent ? `${formatRelative(lastEvent.timestamp, now)}` : "";

  // Metadata block (rows 3..6) — only when h >= 9.
  if (h >= 9) {
    paintMetaLine(canvas, x + 2, y + 3, contentW, "Last event:", lastKind, lastAgo);
    const stepLabel = workflow ? `Step ${workflow.currentStep}` : "—";
    const stepDurSrc = runtime?.lastEventAt ?? workflow?.startedAt ?? null;
    const stepDur = stepDurSrc !== null ? formatShortDuration(stepDurSrc, now) : "";
    paintMetaLine(canvas, x + 2, y + 4, contentW, "Active step:", stepLabel, stepDur);
    paintMetaLine(canvas, x + 2, y + 5, contentW, "Workflow:", workflow ? truncateWS(workflow.name, contentW - 16) : "—");
    paintMetaLine(canvas, x + 2, y + 6, contentW, "Started:", workflow ? `${fmtUptime((now - workflow.startedAt) / 1000)} ago` : "—");
  }

  // Mid rule (between metadata and metrics).
  if (h >= 10) {
    for (let i = 0; i < w - 3; i++) canvas.write(x + 2 + i, y + 7, "\x1b[90m─\x1b[0m");
  }

  // Steps label + progress bar. Compress to a single line when tight.
  if (h >= 12) {
    if (workflow) {
      canvas.write(x + 2, y + 8, `Steps completed: ${workflow.currentStep} / ${workflow.totalSteps}`);
      const frac = workflow.totalSteps > 0 ? workflow.currentStep / workflow.totalSteps : 0;
      drawLabeledBar(canvas, x + 2, y + 9, contentW, "%", frac);
    } else {
      canvas.write(x + 2, y + 8, "\x1b[90m○ no active workflow\x1b[0m");
    }
  } else if (h >= 11) {
    if (workflow) {
      canvas.write(
        x + 2,
        y + 8,
        `Steps completed: ${workflow.currentStep} / ${workflow.totalSteps}`,
      );
    } else {
      canvas.write(x + 2, y + 8, "\x1b[90m○ no active workflow\x1b[0m");
    }
  } else if (h >= 6 && !workflow) {
    canvas.write(x + 2, y + 3, "\x1b[90m○ no active workflow\x1b[0m");
  }

  // Footer hint (row h-2) — only when h >= 14.
  if (h >= 14) {
    canvas.write(x + 2, y + h - 2, "\x1b[32mLive 'runtime' stream\x1b[0m");
  }
}

/**
 * Render the SOPS & POLICY panel at `(x, y)` with `w × h` dimensions.
 *
 * Layout when `h >= 14`:
 *   0:    top border
 *   1:    title — "SOPS & POLICY" + "SOPs: N | Rules: M" counter
 *   2:    breathing room
 *   3:    "Loaded SOPs: N" header
 *   4..6: SOP items (up to 3)
 *   7:    overflow indicator (when more than 3 SOPs)
 *   8:    mid rule
 *   9:    Policy mode
 *   10:   Violations count
 *   11:   breathing room
 *   12:   footer hint
 *   13:   bottom border
 */
export function paintSopsAndPolicyPanel(
  canvas: TerminalCanvas,
  snap: DashboardSnapshot,
  x: number,
  y: number,
  w: number,
  h: number = DEFAULT_PANEL_H,
  options: { scrollOffset?: number; focused?: boolean } = {},
): void {
  const focused = options.focused === true;
  const contentW = w - 4;
  const sops = snap.sops;
  const policy = snap.policy;
  const allSops = sops?.items ?? [];

  // Bounding box around the panel — top edge stays clean.
  canvas.drawBox(x, y, w, h);

  // Row 1 — title bar (inside the box). Brighter cyan when focused.
  const titleColor = focused ? "\x1b[1;36m" : "\x1b[32m";
  canvas.write(x + 2, y + 1, `${titleColor}SOPS & POLICY\x1b[0m`);
  const sopCount = sops?.totalLoaded ?? 0;
  const ruleCount = policy?.rules.length ?? 0;
  const counterText = `SOPs: ${sopCount} | Rules: ${ruleCount}`;
  const counterColor = sopCount > 0 && ruleCount > 0 ? "\x1b[32m" : "\x1b[90m";
  canvas.write(x + 2 + contentW - counterText.length, y + 1, `${counterColor}${counterText}\x1b[0m`);

  // SOP list rows budget: 1 header row + N item rows + 1 optional overflow + 1 mid rule.
  if (h >= 5) {
    canvas.write(x + 2, y + 3, `Loaded SOPs: ${sopCount}`);

    if (allSops.length > 0) {
      // Cap dynamically to whatever fits between the header (y+3) and the
      // mid rule at y+8 (only when the rule renders). Otherwise stop before
      // the box bottom edge.
      const max = h >= 10 ? Math.min(3, allSops.length) : Math.max(0, Math.min(allSops.length, h - 8));
      // ↑ N above / ↓ N below chrome — tells the operator there is more in
      // the list to scroll into. Same semantics as the approvals panel.
      const scrollOffset = options.scrollOffset ?? 0;
      const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, allSops.length - max)));
      const above = clampedOffset;
      const below = allSops.length - max - clampedOffset;
      if (above > 0 && h >= 5) {
        canvas.write(x + 2, y + 4, `\x1b[90m↑ ${above} above\x1b[0m`);
      }
      const itemsStartY = above > 0 ? y + 5 : y + 4;
      let listRow = itemsStartY;
      const itemsEndY = y + (h >= 10 ? 7 : h - 1 - 1);
      for (let i = 0; i < max; i++) {
        const sourceIdx = clampedOffset + i;
        if (sourceIdx >= allSops.length) break;
        const item = allSops[sourceIdx]!;
        const versionBudget = Math.max(0, contentW - (2 + item.name.length + 1));
        const versionText = truncateWS(item.version, versionBudget);
        if (listRow > itemsEndY) break;
        canvas.write(x + 2, listRow, `● ${item.name}`);
        canvas.write(x + 2 + contentW - versionText.length, listRow, versionText);
        listRow++;
      }
      if (below > 0 && h >= 9) {
        const indicatorY = h >= 10 ? y + 7 : y + h - 3;
        canvas.write(x + 2, indicatorY, `\x1b[90m↓ ${below} below\x1b[0m`);
      }
    } else if (h >= 6) {
      canvas.write(x + 2, y + 4, "\x1b[90m○ no SOPs loaded\x1b[0m");
    }
  }

  // Mid rule between SOP list and Policy block.
  if (h >= 10) {
    for (let i = 0; i < w - 3; i++) canvas.write(x + 2 + i, y + 8, "\x1b[90m─\x1b[0m");
  }

  // Policy + violations rows.
  if (h >= 11) {
    const modeText = policy?.enforcementMode ?? "—";
    const modeColor = modeText === "strict" ? "\x1b[32m" : "";
    canvas.write(x + 2, y + 9, `Policy:     ${modeColor}${modeText}\x1b[0m`);

    const vCount = policy?.recentViolationCount ?? 0;
    const vColor = vCount > 0 ? "\x1b[31m" : "";
    canvas.write(x + 2, y + 10, `Violations: ${vColor}${vCount}\x1b[0m`);
  } else if (h >= 7) {
    const modeText = policy?.enforcementMode ?? "—";
    canvas.write(x + 2, y + 5, `Policy: ${modeText}`.slice(0, contentW));
    const vCount = policy?.recentViolationCount ?? 0;
    canvas.write(x + 2, y + 6, `Violations: ${vCount}`.slice(0, contentW));
  }

  // Footer hint.
  if (h >= 14) {
    canvas.write(x + 2, y + h - 2, "\x1b[32mOpen sops or policy\x1b[0m");
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

/** Pick at most `max` approval items starting at index `scrollOffset`, ordered pending-newest-first then recently-resolved-newest-first. Returns the visible slice plus totalItems (for clamping at the caller) and the count of items-above-the-window (for the ↑ N above chrome). */
function collectDisplayItems(
  approvals: DashboardSnapshot["approvals"],
  scrollOffset: number,
  max: number,
): { items: DisplayApprovalItem[]; totalItems: number; above: number } {
  if (!approvals) return { items: [], totalItems: 0, above: 0 };
  // Build the ordered queue and then slice. Sorting once keeps the scroll
  // math simple — index N of the ordered list is what the user sees.
  const pendingSorted = approvals.pending
    .slice()
    .sort((a, b) => b.requestedAt - a.requestedAt);
  const resolvedSorted = approvals.recentlyResolved
    .slice()
    .sort((a, b) => b.requestedAt - a.requestedAt);
  const all: DisplayApprovalItem[] = [
    ...pendingSorted.map((a) => ({ toolName: a.toolName, targetPath: a.targetPath, requestedAt: a.requestedAt, kind: "pending" as const })),
    ...resolvedSorted.map((a) => ({ toolName: a.toolName, targetPath: a.targetPath, requestedAt: a.requestedAt, kind: "resolved" as const })),
  ];
  const totalItems = all.length;
  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalItems - max)));
  const items = all.slice(clampedOffset, clampedOffset + max);
  return { items, totalItems, above: clampedOffset };
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
