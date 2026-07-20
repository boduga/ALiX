import { describe, it, expect } from 'vitest';
import { SopsView } from '../../../src/tui/views/sops-view.js';

describe('SopsView', () => {
  const ctx = (
    snap: any = null,
    perTab: any = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          },
  ) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab,
  });

  it('renders empty state when no SOPs', () => {
    const view = new SopsView();
    expect(view.render(ctx()).rows.some((r) => /no sops|total:\s*0/i.test(r))).toBe(true);
  });

  it('renders loaded SOPs', () => {
    const view = new SopsView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, policy: null,
      sops: {
        items: [
          { id: 'coding-standards', name: 'Coding Standards', version: '1.2.0', description: 'd', sourcePath: '/x', lastUsedAt: null },
        ],
        totalLoaded: 1,
      },
    };
    expect(view.render(ctx(snap)).rows.some((r) => /coding-standards/.test(r))).toBe(true);
  });

  it('cursor moves down on ArrowDown, up on ArrowUp', () => {
    const view = new SopsView();
    const baseCtx = {
      snap: ctx().snap,
      dimensions: { columns: 100, rows: 30 },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          },
    };
    expect(view.handleKey?.('ArrowDown', baseCtx)).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('ArrowUp', { ...baseCtx, perTab: { ...baseCtx.perTab, cursor: 1 } })).toEqual({ type: 'moveCursor', cursor: 0 });
  });

  it('handleKey returns handled for / and other keys', () => {
    const view = new SopsView();
    const baseCtx = {
      snap: ctx().snap,
      dimensions: { columns: 100, rows: 30 },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          },
    };
    expect(view.handleKey?.('/', baseCtx)).toEqual({ type: 'handled' });
    expect(view.handleKey?.('x', baseCtx)).toEqual({ type: 'handled' });
  });
});
