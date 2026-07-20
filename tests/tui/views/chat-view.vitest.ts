import { describe, it, expect } from 'vitest';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

function ctx(overrides: Partial<{ snap: any; perTab: any; dims: any }> = {}): ViewRenderContext {
  const dims = overrides.dims ?? { columns: 120, rows: 30 };
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
    dimensions: dims,
    perTab: overrides.perTab ?? { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          },
    canvas: new TerminalCanvas(dims.columns, dims.rows),
  };
}

describe('ChatView', () => {
  it('renders the input prompt line on the canvas', () => {
    const view = new ChatView();
    const c = ctx();
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toContain('alix>');
  });

  it('renders 4 dashboard panels on the canvas', () => {
    const view = new ChatView();
    const c = ctx({ dims: { columns: 120, rows: 30 } });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toMatch(/DAEMON/);
    expect(frame).toMatch(/APPROVALS/);
    expect(frame).toMatch(/RUNTIME/);
    expect(frame).toMatch(/SOPS/);
  });

  it('renders the offline notice when daemon snapshot is null', () => {
    const view = new ChatView();
    const c = ctx({ snap: { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null } });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toContain('not running');
  });

  it('does not mutate perTab state on render', () => {
    const view = new ChatView();
    const perTab = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: [],
            agentResponses: []
          };
    const before = JSON.stringify(perTab);
    const c = ctx({ perTab });
    view.render(c);
    expect(JSON.stringify(perTab)).toBe(before);
  });

  it('returns same canvas frame for same context (purity)', () => {
    const view = new ChatView();
    const cx = ctx({ dims: { columns: 80, rows: 24 } });
    const a = view.render(cx);
    const b = view.render(cx);
    expect(a.rows).toEqual(b.rows);
  });
});