import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';
import type { ResolvedApproval } from '../state.js';

/**
 * Approvals tab — historical log of resolved approval requests.
 *
 * Live (pending) approvals are shown inline in the AGENT tab scrollback so
 * the operator can resolve them with `a`/`d` without switching tabs. This
 * view is now read-only and shows a chronological log with status icons.
 */
export class ApprovalsView implements TuiView {
  readonly id = 'approvals' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions, perTab } = ctx;
    const pendingCount = snap.approvals?.totalPending ?? 0;
    const rows: string[] = [];

    rows.push(`APPROVAL LOG  pending: ${pendingCount}  resolved: ${perTab.resolvedApprovals.length}`);
    rows.push('');
    rows.push('─'.repeat(dimensions.columns));
    rows.push(pad('STATUS', 8) + pad('TOOL', 14) + 'TARGET  /  TIMESTAMP');
    rows.push('─'.repeat(dimensions.columns));

    const visible = perTab.resolvedApprovals.slice(perTab.scrollOffset, perTab.scrollOffset + dimensions.rows - 6);

    if (visible.length === 0) {
      rows.push('');
      rows.push('  ○ no resolved approvals yet — pending requests appear inline in the agent tab.');
      rows.push(`  ○ use 'a' / 'd' in the agent tab to approve or deny them.`);
    } else {
      for (const a of visible) {
        rows.push(this.formatResolved(a));
      }
    }

    rows.push('─'.repeat(dimensions.columns));
    rows.push('Keys: ↑/↓ scroll');

    return { rows };
  }

  private formatResolved(a: ResolvedApproval): string {
    const icon = a.status === 'approved' ? '\x1b[32m✓\x1b[0m' : a.status === 'denied' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m◌\x1b[0m';
    const ts = new Date(a.resolvedAt).toLocaleTimeString();
    const target = a.target ? a.target : '(no target)';
    return `${icon}  ${pad(a.status, 7)}${pad(a.toolName, 14)}${target}  · ${ts}`;
  }

  handleKey(key: string, ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown':
        return { type: 'moveCursor', cursor: Math.min(ctx.perTab.cursor + 1, Math.max(0, ctx.perTab.resolvedApprovals.length - 1)) };
      case 'ArrowUp':
        return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      default:
        return { type: 'handled' };
    }
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}
