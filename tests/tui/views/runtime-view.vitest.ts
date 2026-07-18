import { describe, it, expect } from 'vitest';
import { RuntimeView } from '../../../src/tui/views/runtime-view.js';

describe('RuntimeView', () => {
  const ctx = (snap: any = null) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
  });

  it('renders current workflow state when available', () => {
    const view = new RuntimeView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, sops: null, policy: null,
      runtime: {
        events: [], workflow: { name: 'research-and-implement', currentStep: 7, totalSteps: 12, startedAt: 1 },
        totalEventCount: 42,
        lastEventAt: 1,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /research-and-implement/.test(r))).toBe(true);
    expect(out.rows.some((r) => /7\s*\/\s*12/.test(r))).toBe(true);
  });

  it('renders event stream', () => {
    const view = new RuntimeView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, sops: null, policy: null,
      runtime: {
        events: [
          { id: 'e1', kind: 'tool.call', summary: 'write_file /x', timestamp: 1 },
          { id: 'e2', kind: 'verify.pass', summary: 'tests ok', timestamp: 2 },
        ],
        workflow: null,
        totalEventCount: 100,
        lastEventAt: 2,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.filter((r) => /tool\.call|verify\.pass/.test(r)).length).toBeGreaterThanOrEqual(2);
    expect(out.rows.some((r) => /\b100\b/.test(r))).toBe(true);   // total event count
  });

  it('handleKey scrolls via ArrowDown/Up; search opens on /', () => {
    const view = new RuntimeView();
    expect(view.handleKey?.('ArrowDown', { snap: { runtime: { events: [{ id: '1' }, { id: '2' }] } } as any, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('/', { snap: {} as any, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'handled' });
  });
});
