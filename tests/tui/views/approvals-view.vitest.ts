import { describe, it, expect } from 'vitest';
import { ApprovalsView } from '../../../src/tui/views/approvals-view.js';
import type { PerTabState, ResolvedApproval } from '../../../src/tui/state.js';

function makePerTab(overrides: Partial<PerTabState> = {}): PerTabState {
  return {
    cursor: 0,
    scrollOffset: 0,
    pinnedBottom: true,
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
    inputBuffer: '',
    submittedPrompts: [],
    agentResponses: [],
    pendingApprovals: [],
    resolvedApprovals: [],
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
    ...overrides,
  };
}

describe('ApprovalsView (historical log)', () => {
  const ctx = (snap: any = null, perTab: PerTabState = makePerTab()) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab,
  });

  it('renders empty state when log is empty', () => {
    const view = new ApprovalsView();
    const out = view.render(ctx());
    expect(out.rows.some((r) => /no resolved approvals yet/i.test(r))).toBe(true);
  });

  it('renders resolved approvals as a chronological log', () => {
    const view = new ApprovalsView();
    const resolved: ResolvedApproval[] = [
      { id: 'a1', toolName: 'shell.run', target: 'npm test', status: 'approved', requestedAt: 1, resolvedAt: 2 },
      { id: 'a2', toolName: 'file.write', target: '/tmp/foo.ts', status: 'denied', requestedAt: 3, resolvedAt: 4 },
    ];
    const out = view.render(ctx(null, makePerTab({ resolvedApprovals: resolved })));
    const joined = out.rows.join('\n');
    expect(joined).toContain('APPROVAL LOG');
    expect(joined).toContain('shell.run');
    expect(joined).toContain('file.write');
    expect(joined).toContain('npm test');
    expect(joined).toContain('/tmp/foo.ts');
  });

  it('shows pending count from snapshot', () => {
    const view = new ApprovalsView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, runtime: null, sops: null, policy: null,
      approvals: { pending: [], recentlyResolved: [], totalPending: 5, totalResolved: 3 },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /pending: 5/.test(r))).toBe(true);
  });

  it('handleKey ArrowDown increments cursor up to log length', () => {
    const view = new ApprovalsView();
    const resolved: ResolvedApproval[] = [
      { id: 'a1', toolName: 'shell.run', target: 'a', status: 'approved', requestedAt: 1, resolvedAt: 2 },
      { id: 'a2', toolName: 'shell.run', target: 'b', status: 'approved', requestedAt: 1, resolvedAt: 2 },
    ];
    const baseCtx = ctx(null, makePerTab({ resolvedApprovals: resolved, cursor: 0 }));
    expect(view.handleKey?.('ArrowDown', baseCtx)).toEqual({ type: 'moveCursor', cursor: 1 });
  });

  it('handleKey ArrowUp decrements cursor from non-zero', () => {
    const view = new ApprovalsView();
    const baseCtx = ctx(null, makePerTab({ cursor: 3 }));
    expect(view.handleKey?.('ArrowUp', baseCtx)).toEqual({ type: 'moveCursor', cursor: 2 });
  });

  it('handleKey returns handled for non-arrow keys', () => {
    const view = new ApprovalsView();
    const baseCtx = ctx();
    expect(view.handleKey?.('a', baseCtx)).toEqual({ type: 'handled' });
    expect(view.handleKey?.('Enter', baseCtx)).toEqual({ type: 'handled' });
  });
});
