import { describe, it, expect } from 'vitest';
import { createInitialTuiAppState, type TabId } from '../../../src/tui/state.js';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

describe('capability invocation chat entries', () => {
  it('initializes timelineEvents empty for every tab', () => {
    const state = createInitialTuiAppState();
    for (const tab of Object.keys(state.views) as TabId[]) {
      expect(state.views[tab].timelineEvents).toEqual([]);
    }
  });

  it('chat view renders a completed invocation entry', () => {
    // Phase 6 (D6/D9): ChatView reads the chat sub-session's projected
    // timeline. A capability completion dual-emits as a `chat.response` entry
    // on the chat surface, so the view renders its status text inline.
    const state = createInitialTuiAppState();
    const canvas = new TerminalCanvas(60, 20);
    const ctx = {
      snap: state.lastSnapshot,
      dimensions: { columns: 60, rows: 20 },
      perTab: state.views.chat,
      canvas,
      runtime: {
        chat: {
          trace: [],
          timeline: [
            { id: 'tl-1', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 1, text: 'core.session.list [completed ✓]', sourceEvents: { firstSequence: 1 } },
          ],
          workflow: null, totalEventCount: 1, lastEventAt: 1, sessionId: 'sess-chat',
        },
        agent: null,
      },
    };
    const view = new ChatView();
    view.render(ctx as never);
    expect(canvas.renderFrame()).toContain('core.session.list');
  });

  it('interleaves a mid-conversation capability by time (Phase-3 goal)', () => {
    // The chat projection preserves chronological order: the capability's
    // `chat.response` entry sits between the user prompt and the agent reply.
    const state = createInitialTuiAppState();
    const canvas = new TerminalCanvas(60, 20);
    const ctx = {
      snap: state.lastSnapshot,
      dimensions: { columns: 60, rows: 20 },
      perTab: state.views.chat,
      canvas,
      runtime: {
        chat: {
          trace: [],
          timeline: [
            { id: 'tl-1', kind: 'chat.message', sessionId: 'sess-chat', startedAt: 100, text: 'first', sourceEvents: { firstSequence: 1 } },
            { id: 'tl-2', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 150, text: 'core.session.list [completed ✓]', sourceEvents: { firstSequence: 2 } },
            { id: 'tl-3', kind: 'chat.response', sessionId: 'sess-chat', startedAt: 200, text: 'second', sourceEvents: { firstSequence: 3 } },
          ],
          workflow: null, totalEventCount: 3, lastEventAt: 200, sessionId: 'sess-chat',
        },
        agent: null,
      },
    };
    const view = new ChatView();
    view.render(ctx as never);
    const frame = canvas.renderFrame();
    // Row order in the scrollback: user prompt, then the capability (which
    // ran mid-conversation), then the agent response.
    expect(frame).toContain('first');
    expect(frame.indexOf('first')).toBeLessThan(frame.indexOf('core.session.list'));
    expect(frame.indexOf('core.session.list')).toBeLessThan(frame.indexOf('second'));
  });
});
