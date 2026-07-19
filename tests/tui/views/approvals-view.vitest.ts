import { describe, it, expect } from 'vitest';
import { ApprovalsView } from '../../../src/tui/views/approvals-view.js';

describe('ApprovalsView', () => {
  const ctx = (snap: any = null, perTab: any = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          }) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab,
  });

  it('renders empty state when approvals is null', () => {
    const view = new ApprovalsView();
    expect(view.render(ctx()).rows.some((r) => /no pending|empty|0/i.test(r))).toBe(true);
  });

  it('renders pending list with one entry per row', () => {
    const view = new ApprovalsView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, runtime: null, sops: null, policy: null,
      approvals: {
        pending: [
          { id: 'a1', toolName: 'write_file', targetPath: '/x/foo.ts', args: {}, requestedAt: 1, requestedBy: 'agent' },
          { id: 'a2', toolName: 'shell_command', targetPath: 'git status', args: {}, requestedAt: 2, requestedBy: 'agent' },
        ],
        recentlyResolved: [],
        totalPending: 2,
        totalResolved: 0,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.filter((r) => /a[12]/.test(r) && /write_file|shell_command/.test(r)).length).toBeGreaterThanOrEqual(2);
  });

  it('handleKey returns moveCursor on arrow keys', () => {
    const view = new ApprovalsView();
    const ctxIn = ctx();
    expect(view.handleKey?.('ArrowDown', { snap: ctxIn.snap, dimensions: ctxIn.dimensions, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          } })).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('ArrowUp', { snap: ctxIn.snap, dimensions: ctxIn.dimensions, perTab: { cursor: 5, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          } })).toEqual({ type: 'moveCursor', cursor: 4 });
  });

  it('handleKey returns scheduleRefresh on approve (a) and deny (d)', () => {
    const view = new ApprovalsView();
    const ctxIn: any = { snap: { approvals: { pending: [{ id: 'a1' }] } }, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          } };
    expect(view.handleKey?.('a', ctxIn)).toEqual({ type: 'scheduleRefresh' });
    expect(view.handleKey?.('d', ctxIn)).toEqual({ type: 'scheduleRefresh' });
  });
});
