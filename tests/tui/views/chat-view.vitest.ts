import { describe, it, expect } from 'vitest';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';

function ctx(overrides: Partial<{ snap: any; perTab: any; dims: any }> = {}): ViewRenderContext {
  const snap = overrides.snap ?? {
    generatedAt: 1,
    session: { mode: 'auto', phase: 'Executing', version: '1', startedAt: 0, turns: 0 },
    daemon: null,
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };
  return {
    snap,
    dimensions: overrides.dims ?? { columns: 120, rows: 30 },
    perTab: overrides.perTab ?? { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '' },
  };
}

describe('ChatView', () => {
  it('renders the input prompt line', () => {
    const view = new ChatView();
    const result = view.render(ctx());
    expect(result.rows.some((r) => r.includes('alix>'))).toBe(true);
  });

  it('renders 4 dashboard panels (one row each in compact mode)', () => {
    const view = new ChatView();
    const result = view.render(ctx({ dims: { columns: 120, rows: 30 } }));
    expect(result.rows.some((r) => /DAEMON/.test(r))).toBe(true);
    expect(result.rows.some((r) => /APPROVALS/.test(r))).toBe(true);
    expect(result.rows.some((r) => /RUNTIME/.test(r))).toBe(true);
    expect(result.rows.some((r) => /SOPS/.test(r))).toBe(true);
  });

  it('renders the offline notice when daemon snapshot is null', () => {
    const view = new ChatView();
    const result = view.render(ctx({ snap: { ...ctx().snap, daemon: null } }));
    expect(result.rows.some((r) => /not running|offline|○/.test(r))).toBe(true);
  });

  it('does not mutate perTab state on render', () => {
    const view = new ChatView();
    const perTab = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '' };
    const before = JSON.stringify(perTab);
    view.render({ ...ctx({ perTab }), perTab });
    expect(JSON.stringify(perTab)).toBe(before);
  });

  it('returns same rows for same context (purity)', () => {
    const view = new ChatView();
    const c = ctx({ dims: { columns: 80, rows: 24 } });
    expect(view.render(c).rows).toEqual(view.render(c).rows);
  });
});