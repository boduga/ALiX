import type { RuntimeSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

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
    rows.push('');

    if (r.workflow) {
      const w = r.workflow;
      const pct = w.totalSteps > 0 ? Math.round((w.currentStep / w.totalSteps) * 24) : 0;
      rows.push(`  workflow: ${w.name}`);
      rows.push(`  progress: [${'█'.repeat(pct)}${'░'.repeat(24 - pct)}] ${w.currentStep}/${w.totalSteps}`);
      rows.push('');
    }

    rows.push('─'.repeat(dimensions.columns));
    const start = ctx.perTab.scrollOffset;
    const visible = r.events.slice(start, start + 15);
    for (const e of visible) {
      rows.push(`  [${new Date(e.timestamp).toISOString().slice(11, 19)}] ${e.kind.padEnd(20, ' ')} ${e.summary}`);
    }
    rows.push('─'.repeat(dimensions.columns));
    rows.push('Keys: ↑/↓/PgUp/PgDn scroll  / search');

    return { rows };
  }

  handleKey(key: string, _ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown': return { type: 'moveCursor', cursor: (_ctx.perTab.cursor ?? 0) + 1 };
      case 'ArrowUp': return { type: 'moveCursor', cursor: Math.max(0, (_ctx.perTab.cursor ?? 0) - 1) };
      case '/': return { type: 'handled' };  // TuiApp opens search UI
      default: return { type: 'handled' };
    }
  }
}
