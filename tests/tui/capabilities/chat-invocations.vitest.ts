import { describe, it, expect } from 'vitest';
import { createInitialTuiAppState, appendTimelineEvent, type TabId } from '../../../src/tui/state.js';
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
    const state = createInitialTuiAppState();
    appendTimelineEvent(state.views.chat, {
      kind: 'capability', invocationId: 'inv_1', capabilityId: 'core.session.list',
      status: 'completed', output: '["s1"]',
    });
    const canvas = new TerminalCanvas(60, 20);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 60, rows: 20 }, perTab: state.views.chat, canvas };
    const view = new ChatView();
    view.render(ctx as never);
    expect(canvas.renderFrame()).toContain('core.session.list');
  });

  it('interleaves a mid-conversation capability by time (Phase-3 goal)', () => {
    const state = createInitialTuiAppState();
    const user = appendTimelineEvent(state.views.chat, { kind: 'user', text: 'first' });
    const agent = appendTimelineEvent(state.views.chat, { kind: 'agent', text: 'second' });
    const cap = appendTimelineEvent(state.views.chat, { kind: 'capability', invocationId: 'inv_1', capabilityId: 'core.session.list', status: 'completed', output: '["s1"]' });
    // Capability actually ran between the user prompt and the agent response.
    user.timestamp = 100; cap.timestamp = 150; agent.timestamp = 200;
    const canvas = new TerminalCanvas(60, 20);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 60, rows: 20 }, perTab: state.views.chat, canvas };
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
