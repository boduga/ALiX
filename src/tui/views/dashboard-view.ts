import type { PerTabState, TabId } from '../state.js';
import type {
  TuiView,
  ViewAction,
  ViewInputContext,
  ViewRenderContext,
  ViewRenderResult,
} from './types.js';
import type { TerminalCanvas } from '../canvas.js';
import {
  DEFAULT_PANEL_H,
  paintApprovalsPanel,
  paintDaemonPanel,
  paintRuntimePanel,
  paintSopsAndPolicyPanel,
} from '../dashboard-renderer.js';

/**
 * DashboardView — the default landing tab. Renders the same 4 panels
 * that used to live in the right-hand sidebar (DAEMON, APPROVALS,
 * RUNTIME, SOPs & POLICY), now consuming the full viewport.
 *
 * Layout adapts to terminal size so the operator can resize without
 * losing information density:
 *   - cols >= 120 AND bodyH >= 28: 2x2 grid (panels side by side)
 *   - otherwise:                  4 panels stacked vertically
 *
 * Each panel is rendered through the same `paint*Panel` exports from
 * `dashboard-renderer.ts`, so a dashboard panel is byte-for-byte the
 * same render as the matching per-tab view. This view owns only the
 * *layout* — where each panel's rectangle starts — and per-panel
 * focus/scroll plumbing (approvals and sops only).
 */
export class DashboardView implements TuiView {
  readonly id: TabId = 'dashboard';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas as TerminalCanvas;
    const cols = ctx.dimensions.columns;
    const rows = ctx.dimensions.rows;

    const HEADER_H = 3;
    const FOOTER_H = 3;
    const top = HEADER_H;
    const bottom = Math.max(top, rows - FOOTER_H - 1);
    const bodyH = Math.max(1, bottom - top + 1);
    const bodyW = Math.max(20, cols);

    const useGrid = cols >= 120 && bodyH >= 28;

    if (useGrid) {
      this.renderGrid(ctx, c, top, bodyW, bodyH);
    } else {
      this.renderStack(ctx, c, top, bodyW, bodyH);
    }

    return { rows: [] };
  }

  private renderGrid(
    ctx: ViewRenderContext,
    c: TerminalCanvas,
    top: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const halfW = Math.max(40, Math.floor(bodyW / 2));
    const halfH = Math.max(10, Math.floor(bodyH / 2));
    const panelW = halfW - 1;
    const perTab = ctx.perTab;
    const snap = ctx.snap;

    // Top-left: DAEMON. Top-right: APPROVALS.
    paintDaemonPanel(c, snap, 0, top, panelW, halfH);
    paintApprovalsPanel(
      c, snap, halfW, top, panelW, halfH,
      {
        scrollOffset: perTab.panelScrollOffsets.approvals,
        focused: perTab.panelFocus === 'approvals',
      },
    );
    // Bottom-left: RUNTIME. Bottom-right: SOPs & POLICY.
    paintRuntimePanel(c, snap, 0, top + halfH, panelW, halfH);
    paintSopsAndPolicyPanel(
      c, snap, halfW, top + halfH, panelW, halfH,
      {
        scrollOffset: perTab.panelScrollOffsets.sops,
        focused: perTab.panelFocus === 'sops',
      },
    );
  }

  private renderStack(
    ctx: ViewRenderContext,
    c: TerminalCanvas,
    top: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const perTab = ctx.perTab;
    const snap = ctx.snap;

    const target = DEFAULT_PANEL_H * 4;
    const perPanelH = target <= bodyH
      ? DEFAULT_PANEL_H
      : Math.max(5, Math.floor(bodyH / 4));

    let y = top;
    paintDaemonPanel(c, snap, 0, y, bodyW, perPanelH);
    y += perPanelH;
    paintApprovalsPanel(
      c, snap, 0, y, bodyW, perPanelH,
      {
        scrollOffset: perTab.panelScrollOffsets.approvals,
        focused: perTab.panelFocus === 'approvals',
      },
    );
    y += perPanelH;
    paintRuntimePanel(c, snap, 0, y, bodyW, perPanelH);
    y += perPanelH;
    paintSopsAndPolicyPanel(
      c, snap, 0, y, bodyW, perPanelH,
      {
        scrollOffset: perTab.panelScrollOffsets.sops,
        focused: perTab.panelFocus === 'sops',
      },
    );
  }

  handleKey(_key: string, _ctx: ViewInputContext): ViewAction {
    // Dashboard is read-only overview — J/K scrolling is handled by
    // app.ts for the dedicated tabs (approvals, sops). Keys here are
    // swallowed so they don't echo into the prompt line.
    return { type: 'handled' };
  }

  onActivate(_perTab: PerTabState): void {
    // No-op.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op.
  }
}
