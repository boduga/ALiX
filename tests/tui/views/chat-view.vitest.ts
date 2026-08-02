import { describe, it, expect } from 'vitest';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

function ctx(overrides: Partial<{ snap: any; perTab: any; dims: any; runtime: any }> = {}): ViewRenderContext {
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
                pinnedBottom: true,
            pendingApprovals: [], resolvedApprovals: [], timelineEvents: []
          },
    canvas: new TerminalCanvas(dims.columns, dims.rows),
    ...(overrides.runtime !== undefined ? { runtime: overrides.runtime } : {}),
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

  // === removed: dashboard panels moved to DashboardView ===
  // The DAEMON/APPROVALS/RUNTIME/SOPs panels used to render at the
  // bottom of the chat tab. They now live in the dashboard tab. See
  // tests/tui/views/dashboard-view.vitest.ts for equivalent coverage.

  it('does not mutate perTab state on render', () => {
    const view = new ChatView();
    const perTab = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
                pinnedBottom: true,
            pendingApprovals: [], resolvedApprovals: [], timelineEvents: []
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

  it('renders fenced code blocks with bordered chrome in chat responses', () => {
    const view = new ChatView();
    const c = ctx({
      dims: { columns: 120, rows: 30 },
      runtime: {
        chat: {
          trace: [],
          timeline: [
            { id: 'tl-1', kind: 'chat.message', sessionId: 'sess-chat', startedAt: 1, text: 'show me a function', sourceEvents: { firstSequence: 1 } },
            { id: 'tl-2', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 2, text: '```python\ndef f(): pass\n```', sourceEvents: { firstSequence: 2 } },
          ],
          workflow: null,
          totalEventCount: 2,
          lastEventAt: 2,
          sessionId: 'sess-chat',
        },
        agent: null,
      },
    });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toMatch(/[┌╭]/);
    expect(frame).toMatch(/[└╰┘]/);
    expect(frame).toContain('python');
  });

  it('renders chat.message/chat.response entries from RuntimeSnapshot.timeline (replacing r.timelineEvents)', () => {
    const view = new ChatView();
    // The transitional in-memory cache is emptied; the view reads the chat
    // collector's projected timeline (D6/D9). `chat.message` renders as a
    // user prompt (→), `chat.response` as an agent reply (←).
    const c = ctx({
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
        inputBuffer: '', pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [] },
      runtime: {
        chat: {
          trace: [],
          timeline: [
            { id: 'tl-1', kind: 'chat.message', sessionId: 'c1', startedAt: 1, text: 'hello', sourceEvents: { firstSequence: 1 } },
            { id: 'tl-2', kind: 'chat.response', sessionId: 'c1', startedAt: 2, text: 'hi there', sourceEvents: { firstSequence: 2 } },
          ],
          workflow: null,
          totalEventCount: 2,
          lastEventAt: 2,
          sessionId: 'c1',
        },
        agent: null,
      },
    });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toContain('hello');
    expect(frame).toContain('hi there');
  });

  it('ignores non-chat kinds in the chat timeline projection', () => {
    const view = new ChatView();
    // Agent-authored entries and capability/tool entries never appear on the
    // chat tab — the chat collector projects the chat sub-session, and the
    // view filters to `chat.*` kinds.
    const c = ctx({
      runtime: {
        chat: {
          trace: [],
          timeline: [
            { id: 'tl-1', kind: 'chat.message', sessionId: 'c1', startedAt: 1, text: 'user prompt', sourceEvents: { firstSequence: 1 } },
            { id: 'tl-2', kind: 'agent.message', sessionId: 'c1', startedAt: 2, text: 'agent-only', sourceEvents: { firstSequence: 2 } },
            { id: 'tl-3', kind: 'chat.response', sessionId: 'c1', startedAt: 3, text: 'agent reply', sourceEvents: { firstSequence: 3 } },
          ],
          workflow: null,
          totalEventCount: 3,
          lastEventAt: 3,
          sessionId: 'c1',
        },
        agent: null,
      },
    });
    view.render(c);
    const frame = c.canvas!.renderFrame();
    expect(frame).toContain('user prompt');
    expect(frame).toContain('agent reply');
    expect(frame).not.toContain('agent-only');
  });
});