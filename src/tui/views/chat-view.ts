import { renderDashboardCards, dashboardSnapshotToRuntime } from '../dashboard-renderer.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';

/**
 * ChatView — default landing tab. Renders the input prompt placeholder
 * followed by a compact 4-panel dashboard (DAEMON, APPROVALS, RUNTIME,
 * SOPS / POLICY) reusing `renderDashboardCards` in `thin` mode.
 *
 * Pure: render(ctx) never mutates ctx; same input → same output.
 * Passive: only reads from ctx.snap — does not import any subsystem.
 */
export class ChatView implements TuiView {
  readonly id: TabId = 'chat';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const rows: string[] = [];
    const { snap, dimensions } = ctx;

    // Header: input prompt placeholder (real buffer will arrive via perTab state).
    rows.push('alix> ');
    rows.push('');

    // Compact dashboard. The renderer's thin mode clamps each card to a
    // minimum of 30 cols and computes right-card padding from the supplied
    // `width`, so we pass the total available columns (not a per-card width)
    // to avoid a negative-pad crash on narrower terminals.
    //
    // LAYOUT DEVIATION (accepted): the brief asks for "1/4-width 4 panels"
    // (DAEMON, APPROVALS, RUNTIME, SOPS as four narrow columns). The
    // renderer's current thin mode is hard-coded to a 2-row 2-up layout
    // (DAEMON on row 1 left, APPROVALS + RUNTIME on row 1 right, SOPS +
    // POLICY on row 2). Each card is clamped to halfW ≈ 30 cols, so on a
    // 120-col terminal we get 2 cards ≈ 1/2 width each. To produce true
    // 1/4-width 4-up panels the renderer needs a 4-up thin mode — out of
    // scope for this task (renderer is a protected file per the brief).
    // A follow-up issue tracks the renderer enhancement.
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