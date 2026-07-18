import { writeRowsToCanvas } from '../canvas.js';
import type { SopSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

export class SopsView implements TuiView {
  readonly id = 'sops' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const s: SopSnapshot | null = ctx.snap.sops;
    const rows: string[] = [];

    rows.push('SOPS');
    if (!s || s.items.length === 0) {
      rows.push('○ no SOPs loaded');
      rows.push(`  total: 0`);
      if (ctx.canvas) {
        writeRowsToCanvas(ctx.canvas, rows, 0, 0);
        return { rows: [] };
      }
      return { rows };
    }
    rows.push(`  total: ${s.totalLoaded}`);
    rows.push('');
    const filtered = s.items.filter(
      (i) => i.name.includes(ctx.perTab.searchQuery) || i.id.includes(ctx.perTab.searchQuery),
    );
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i]!;
      const cursor = ctx.perTab.cursor === i ? '▸ ' : '  ';
      rows.push(`${cursor}${item.id} v${item.version} ${item.name}`);
    }
    rows.push('');
    rows.push('Keys: ↑/↓ navigate  / search  Tab detail');
    if (ctx.canvas) {
      writeRowsToCanvas(ctx.canvas, rows, 0, 0);
      return { rows: [] };
    }
    return { rows };
  }

  handleKey(
    key: string,
    ctx: ViewInputContext,
  ): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown':
        return { type: 'moveCursor', cursor: ctx.perTab.cursor + 1 };
      case 'ArrowUp':
        return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      case '/':
        return { type: 'handled' };
      default:
        return { type: 'handled' };
    }
  }
}
