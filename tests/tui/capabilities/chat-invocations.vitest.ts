import { describe, it, expect } from 'vitest';
import { createInitialTuiAppState, type CapabilityInvocationEntry, type TabId } from '../../../src/tui/state.js';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

describe('capability invocation chat entries', () => {
  it('initializes capabilityInvocations empty for every tab', () => {
    const state = createInitialTuiAppState();
    for (const tab of Object.keys(state.views) as TabId[]) {
      expect(state.views[tab].capabilityInvocations).toEqual([]);
    }
  });

  it('chat view renders a completed invocation entry', () => {
    const state = createInitialTuiAppState();
    state.views.chat.capabilityInvocations.push({
      invocationId: 'inv_1', capabilityId: 'core.session.list', args: {},
      status: 'completed', output: '["s1"]', at: 1,
    });
    const canvas = new TerminalCanvas(60, 20);
    const ctx = {
      snap: state.lastSnapshot,
      dimensions: { columns: 60, rows: 20 },
      perTab: state.views.chat,
      canvas,
    };
    const view = new ChatView();
    view.render(ctx as never);
    // The invocation entry should appear in the scrollback (written to the canvas).
    expect(canvas.renderFrame()).toContain('core.session.list');
  });
});
