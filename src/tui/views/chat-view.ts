import { renderDashboardCards, dashboardSnapshotToRuntime, renderDashboardOnCanvas } from '../dashboard-renderer.js';
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
    const { snap, dimensions } = ctx;

    // ── Canvas render path (coordinate-based, no waterfall) ────────
    if (ctx.canvas) {
      const c = ctx.canvas;
      c.clear();

      // Prompt line with the current input buffer.
      const buf = ctx.perTab?.inputBuffer ?? '';
      c.write(0, 0, '\x1b[33m alix>\x1b[0m ');
      c.write(7, 0, buf);
      // Draw the cursor at the end of the typed text.
      c.write(7 + buf.length, 0, '\x1b[7m \x1b[0m');

      // 4-panel dashboard starting at y = 3.
      renderDashboardOnCanvas(snap, c, 3);

      // Busy / phase footer.
      if (snap.session && snap.session.phase !== 'Idle') {
        c.write(2, 17, `\x1b[33mbusy: ${snap.session.phase}\x1b[0m`);
      }

      // Return empty rows — the caller writes the full frame from the canvas.
      return { rows: [] };
    }

    // ── Legacy string[] render path (no canvas) ────────────────────
    const rows: string[] = [];

    // Header: input prompt placeholder (real buffer will arrive via perTab state).
    rows.push('alix> ');
    rows.push('');

    const cards = renderDashboardCards(
      dashboardSnapshotToRuntime(snap),
      dimensions.columns,
      true /* thin */,
    );
    rows.push(...cards);

    // Footer: busy indicator when session is not Idle.
    if (snap.session && snap.session.phase !== 'Idle') {
      rows.push('');
      rows.push(`busy: ${snap.session.phase}`);
    }

    return { rows };
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