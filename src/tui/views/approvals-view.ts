import type { ApprovalSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

const COL_PCT = 35;

export class ApprovalsView implements TuiView {
  readonly id = 'approvals' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const a: ApprovalSnapshot | null = snap.approvals;
    const rows: string[] = [];

    rows.push(`APPROVALS  pending: ${a?.totalPending ?? 0}  resolved: ${a?.totalResolved ?? 0}`);
    rows.push('');

    if (!a || a.pending.length === 0) {
      rows.push('○ no pending approvals');
      return { rows };
    }

    const listWidth = Math.floor((dimensions.columns * COL_PCT) / 100);
    const detailWidth = dimensions.columns - listWidth - 3;

    rows.push('─'.repeat(dimensions.columns));
    rows.push(pad('TOOL', listWidth) + ' │ TARGET');
    rows.push('─'.repeat(dimensions.columns));

    const start = ctx.perTab.scrollOffset;
    const visible = a.pending.slice(start, start + 12);
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i]!;
      const cursorLine = ctx.perTab.cursor === start + i ? '▸ ' : '  ';
      rows.push(cursorLine + pad(`${r.toolName} (${r.id})`, listWidth - 2) + ' │ ' + truncate(r.targetPath, detailWidth - 1));
    }
    rows.push('─'.repeat(dimensions.columns));
    rows.push('Keys: ↑/↓ navigate  a approve  d deny  q back');

    return { rows };
  }

  handleKey(key: string, ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'scheduleRefresh' } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown':
        return { type: 'moveCursor', cursor: ctx.perTab.cursor + 1 };
      case 'ArrowUp':
        return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      case 'a':
      case 'd':
        // Caller (TuiApp via ApprovalManager) will mark resolved and refresh.
        ctx.perTab.cursor = ctx.perTab.cursor;  // no mutation; just type-narrowing
        return { type: 'scheduleRefresh' };
      default:
        return { type: 'handled' };
    }
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n < 4) return s.slice(0, n);
  return s.slice(0, n - 1) + '…';
}
