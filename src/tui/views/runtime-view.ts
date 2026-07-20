import { writeRowsToCanvas } from '../canvas.js';
import type { RuntimeSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext, ViewAction } from './types.js';

export class RuntimeView implements TuiView {
  readonly id = 'runtime' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const r: RuntimeSnapshot | null = snap.runtime;
    const rows: string[] = [];

    rows.push('RUNTIME');

    if (!r) {
      rows.push('○ no runtime events');
      return { rows };
    }

    rows.push(`  events: ${r.totalEventCount}  last: ${r.lastEventAt ? new Date(r.lastEventAt).toISOString() : '—'}`);

    if (r.workflow) {
      const w = r.workflow;
      const pct = w.totalSteps > 0 ? Math.round((w.currentStep / w.totalSteps) * 24) : 0;
      rows.push(`  workflow: ${w.name}`);
      rows.push(`  progress: [${'█'.repeat(pct)}${'░'.repeat(24 - pct)}] ${w.currentStep}/${w.totalSteps}`);
    }

    // Auto-follow the tail: if the user hasn't manually scrolled (or
    // is at the bottom), keep the offset pinned to the last window of
    // events. The `pinnedBottom` flag is set to false when the user
    // scrolls up, and reset to true via onActivate when the tab is
    // re-entered. Events are ordered newest-first by the collector, so
    // "bottom" is offset 0.
    const pinned = ctx.perTab.pinnedBottom ?? true;
    const eventCount = r.events.length;
    // Reserve the top 2-3 lines for the workflow section when present.
    const reserved = r.workflow ? 4 : 1;
    // Reserve: 1 row header + 1 top padding + 1 bottom padding.
    const winSize = Math.max(3, dimensions.rows - reserved - 2);
    const maxStart = Math.max(0, eventCount - winSize);
    let start = ctx.perTab.scrollOffset;
    if (pinned) {
      // Follow the tail: anchor the bottom row at the last event.
      start = maxStart;
    } else if (start > maxStart) {
      // User had the cursor below the new bottom — clamp.
      start = maxStart;
    }
    const visible = r.events.slice(start, start + winSize);
    for (const e of visible) {
      rows.push(`  [${new Date(e.timestamp).toISOString().slice(11, 19)}] ${e.kind.padEnd(20, ' ')} ${e.summary}`);
    }

    if (ctx.canvas) {
      writeRowsToCanvas(ctx.canvas, rows, 0, 0);
      return { rows: [] };
    }

    return { rows };
  }

  handleKey(key: string, _ctx: ViewInputContext): ViewAction {
    // Cursor moves within the runtime tab release the auto-follow-the-tail
    // pin so the user can read history without losing their position.
    const onCursor = (cursor: number): ViewAction => ({ type: 'moveCursor', cursor, pinnedBottom: false });
    switch (key) {
      case 'ArrowDown': return onCursor((_ctx.perTab.cursor ?? 0) + 1);
      case 'ArrowUp': return onCursor(Math.max(0, (_ctx.perTab.cursor ?? 0) - 1));
      case 'PageDown': return onCursor((_ctx.perTab.cursor ?? 0) + 10);
      case 'PageUp': return onCursor(Math.max(0, (_ctx.perTab.cursor ?? 0) - 10));
      case 'Home': return onCursor(0);
      case 'End': return onCursor(1000);
      case 'Escape': return { type: 'switchTab', tab: 'chat' };
      case '/': return { type: 'scheduleRefresh' };
      default: return { type: 'handled' };
    }
  }
}
