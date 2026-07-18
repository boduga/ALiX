import type { PolicySnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

export class PolicyView implements TuiView {
  readonly id = 'policy' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const p: PolicySnapshot | null = ctx.snap.policy;
    const rows: string[] = [];

    rows.push(`POLICY mode: ${p?.enforcementMode ?? '—'}`);
    if (!p) {
      rows.push('○ policy engine unavailable');
      return { rows };
    }

    rows.push(`  rules: ${p.rules.length}  violations: ${p.recentViolationCount}`);
    rows.push('');

    for (const r of p.rules) {
      rows.push(`  [${r.severity}] ${r.id}: ${r.name} — ${r.lastResult}`);
    }

    rows.push('');
    rows.push('Keys: ↑/↓ navigate  / search');
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
