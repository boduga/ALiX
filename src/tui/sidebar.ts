/**
 * sidebar.ts — Vertical-stack sidebar for the 75/25 terminal split.
 *
 * The sidebar takes the right ~25% of the screen width and renders the
 * same 4 dashboard panels (DAEMON → APPROVALS → RUNTIME → SOPS & POLICY)
 * that the chat tab renders horizontally at the bottom of its scrollback.
 *
 * Visual identity is important — every panel is rendered through the same
 * `paint*Panel` exports from `dashboard-renderer.ts`, so a sidebar panel
 * is byte-for-byte the same render as the matching horizontal panel
 * (just with `x=0` instead of `x=columnIndex * panelW`). This file only
 * owns the *layout* — where each panel's rectangle starts — plus the
 * per-panel `scrollOffset` / `focused` plumbing for J/K scrolling.
 */

import type { DashboardSnapshot } from './snapshot.js';
import type { PanelFocusId, PanelScrollOffsets } from './state.js';
import { TerminalCanvas } from './canvas.js';
import {
  DEFAULT_PANEL_H,
  paintApprovalsPanel,
  paintDaemonPanel,
  paintRuntimePanel,
  paintSopsAndPolicyPanel,
} from './dashboard-renderer.js';

/**
 * Render the 4 dashboard panels stacked vertically into a sidebar canvas
 * sized `width × height`. The first panel starts at row `startY`; the
 * panel block ends at row `height - footerHeight - 1` (so it sits flush
 * above the tab bar / status row).
 *
 * `scrollOffsets` and `focusedPanel` flow from the active tab's per-tab
 * state: approvals and sops tabs own their respective sidebar panel's
 * scroll cursor. Other tabs leave the offsets alone.
 *
 * Returns the rendered sidebar canvas so the caller can `blit()` it into
 * the main canvas at the right offset.
 */
export function renderSidebar(
  snap: DashboardSnapshot,
  width: number,
  height: number,
  startY: number,
  footerHeight: number,
  scrollOffsets: PanelScrollOffsets = { approvals: 0, sops: 0 },
  focusedPanel: PanelFocusId | null = null,
): TerminalCanvas {
  const c = new TerminalCanvas(width, height);
  const available = Math.max(1, height - startY - footerHeight);

  // Sidebar target mirrors the horizontal dashboard — each panel is
  // DEFAULT_PANEL_H rows tall when there's room.  If the terminal can't
  // fit 4 panels at DEFAULT_PANEL_H rows, we scale down uniformly so all
  // four panels stay equal height (no visual jitter between them).
  const target = DEFAULT_PANEL_H * 4;
  const perPanelH = target <= available
    ? DEFAULT_PANEL_H
    : Math.max(5, Math.floor(available / 4));

  let y = startY;
  type PanelSpec = {
    readonly paint: (
      canvas: TerminalCanvas,
      snap: DashboardSnapshot,
      x: number,
      y: number,
      w: number,
      h: number,
      options: { scrollOffset?: number; focused?: boolean },
    ) => void;
    readonly scrollOffset: number;
    readonly id: PanelFocusId | null;
  };
  const panels: ReadonlyArray<PanelSpec> = [
    { paint: paintDaemonPanel, scrollOffset: 0, id: null },
    { paint: paintApprovalsPanel, scrollOffset: scrollOffsets.approvals, id: 'approvals' },
    { paint: paintRuntimePanel, scrollOffset: 0, id: null },
    { paint: paintSopsAndPolicyPanel, scrollOffset: scrollOffsets.sops, id: 'sops' },
  ];
  for (const panel of panels) {
    if (y + perPanelH > height - footerHeight) break;
    panel.paint(c, snap, 0, y, width, perPanelH, {
      scrollOffset: panel.scrollOffset,
      focused: panel.id !== null && panel.id === focusedPanel,
    });
    y += perPanelH;
  }
  return c;
}
