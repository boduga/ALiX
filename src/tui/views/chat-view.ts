import { renderDashboard } from '../dashboard-renderer.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';

/**
 * ChatView — default landing tab. Renders the input prompt placeholder
 * followed by a compact 4-panel coordinate-based dashboard (DAEMON,
 * APPROVALS, RUNTIME, SOPS & POLICY) when a canvas is provided via
 * `ctx.canvas`.  Falls back to the legacy string[] render path when
 * no canvas is available.
 *
 * Pure: render(ctx) never mutates ctx; same input → same output.
 * Passive: only reads from ctx.snap — does not import any subsystem.
 */
export class ChatView implements TuiView {
  readonly id: TabId = 'chat';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;

    // Prompt line with the current input buffer (placed below the 3-row header).
    const buf = ctx.perTab.inputBuffer;
    c.write(0, 4, '\x1b[33m alix>\x1b[0m ');
    c.write(7, 4, buf);
    // Draw the cursor at the end of the typed text.
    c.write(7 + buf.length, 4, '\x1b[7m \x1b[0m');

    // Pin the 4-panel dashboard to the bottom of the canvas, flush above
    // the 3-row footer painted by app.ts (tab row at N-3, gap row at N-2,
    // status row at N-1). Floor at 0 so very small canvases still render
    // a meaningful frame instead of overlapping the prompt.
    const PANEL_H = 14;
    const FOOTER_H = 3;
    const startY = Math.max(0, ctx.dimensions.rows - PANEL_H - FOOTER_H);
    renderDashboard(ctx.snap, c, startY);

    // Return empty rows — the caller writes the full frame from the canvas.
    return { rows: [] };
  }

  handleKey(key: string, _ctx: ViewInputContext): { type: 'handled' } {
    // Real input handling arrives in a later iteration. For now swallow keys.
    void key;
    return { type: 'handled' };
  }

  onActivate(_perTab: PerTabState): void {
    // No-op for now.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}