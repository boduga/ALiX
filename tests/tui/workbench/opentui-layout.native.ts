import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import type { WorkbenchDrawer } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { WorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/types.js';
import { mountOpenTuiWorkbenchContent } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';
import { mountOpenTuiWorkbenchLayout } from '../../../src/interfaces/tui/workbench/opentui/workbench-layout.js';

function layoutState(drawer: WorkbenchDrawer, text = ''): Pick<WorkbenchViewState, 'composer' | 'overlay'> {
  return {
    composer: {
      composer: { text, cursor: text.length },
      coordination: { draft: { text: '', cursor: 0 }, phase: 'idle' },
      queuedMessages: [],
    },
    overlay: {
      stack: [], scrollOffset: 0, drawer, drawerScrollOffset: 0, agentRosterExpanded: true,
    },
  };
}

async function dispose(setup: TestRendererSetup): Promise<void> {
  setup.renderer.destroy();
  await (setup.renderer as typeof setup.renderer & { closed: Promise<void> }).closed;
}

for (const { name, width, height, drawer, inspector, overlay } of [
  { name: 'wide', width: 180, height: 40, drawer: 'closed', inspector: true, overlay: false },
  { name: 'medium', width: 120, height: 30, drawer: 'agents', inspector: false, overlay: false },
  { name: 'narrow', width: 80, height: 24, drawer: 'agents', inspector: false, overlay: true },
  { name: 'short', width: 80, height: 10, drawer: 'closed', inspector: false, overlay: false },
] as const) {
  test(`${name} native frame follows Workbench regions`, async () => {
    const setup = await createTestRenderer({ width, height });
    try {
      const layout = mountOpenTuiWorkbenchLayout(setup.renderer, layoutState(drawer));
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      assert.match(frame, /ALiX WORKBENCH/);
      if (!overlay) assert.match(frame, /Transcript/);
      assert.match(frame, /Composer/);
      assert.equal(layout.regions.inspector.visible, inspector);
      assert.equal(layout.regions.overlay.visible, overlay);
      const geometry = layout.update(layoutState(drawer));
      assert.equal(layout.regions.transcript.screenX, geometry.regions.transcript.x);
      assert.equal(layout.regions.transcript.screenY, geometry.regions.transcript.y);
      if (inspector) assert.match(frame, /Inspector/);
      if (drawer !== 'closed' || width >= 160 && height >= 36) assert.match(frame, /Agents/);
      layout.dispose();
      layout.dispose();
      await setup.renderOnce();
      assert.doesNotMatch(setup.captureCharFrame(), /ALiX WORKBENCH/);
    } finally {
      await dispose(setup);
    }
  });
}

test('resize updates retained pane positions and composer height', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const wrappedText = 'wide grapheme 漢🙂 '.repeat(12);
    const state = layoutState('agents', wrappedText);
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, state);
    const transcript = layout.regions.transcript;
    await setup.renderOnce();
    const wideX = transcript.screenX;
    const wideComposerHeight = layout.regions.composer.height;
    setup.resize(80, 24);
    const geometry = layout.update(state);
    await setup.renderOnce();
    assert.strictEqual(layout.regions.transcript, transcript);
    assert.notEqual(transcript.screenX, wideX);
    assert.equal(transcript.screenX, geometry.regions.transcript.x);
    assert.equal(layout.regions.composer.height, geometry.regions.composer.height);
    assert.ok(layout.regions.composer.height > wideComposerHeight);
    assert.equal(layout.regions.overlay.visible, true);
  } finally {
    await dispose(setup);
  }
});

test('native roster and transcript show selected run content and update in place', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const shellState = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const state: Pick<WorkbenchViewState, 'roster' | 'transcript' | 'selection' | 'overlay'> = {
      roster: {
        agents: {
          agents: [
            { agentId: 'worker-1', coordinationRunId: 'run-a', role: 'Researcher', state: 'thinking', taskLabel: 'Find sources', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} },
            { agentId: 'worker-2', coordinationRunId: 'run-b', role: 'Builder', state: 'completed', taskLabel: 'Build draft', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} },
          ],
          active: 1,
          totals: { agents: 2, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
        },
        tasks: null,
        artifacts: null,
      },
      transcript: {
        conversation: { items: [
          { id: 'u', kind: 'user', text: 'Please research', startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 1 } },
          { id: 'a', kind: 'assistant', agentId: 'worker-1', text: 'Sources ready', startedAt: 2, sourceEvents: { firstSequence: 2, lastSequence: 2 } },
          { id: 'other', kind: 'assistant', agentId: 'worker-2', text: 'Other run response', startedAt: 2, sourceEvents: { firstSequence: 2, lastSequence: 2 } },
          { id: 't', kind: 'tool-group', agentId: 'worker-1', startedAt: 3, sourceEvents: { firstSequence: 3, lastSequence: 3 }, tools: [
            { id: 'tool-1', name: 'search', status: 'completed', sourceEvents: { firstSequence: 3, lastSequence: 3 } },
            { id: 'tool-2', name: 'fetch', status: 'failed', detail: 'HTTP 503', sourceEvents: { firstSequence: 3, lastSequence: 3 } },
          ] },
        ], hiddenDiagnostics: 0 },
        mode: 'compact', filter: 'all', scope: 'selected', followTail: true,
      },
      selection: { selectedRunId: 'run-a', selectedAgentId: 'worker-1' },
      overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    assert.match(frame, /Researcher/);
    assert.match(frame, /RUN run-a/);
    assert.match(frame, /Find sources/);
    assert.doesNotMatch(frame, /Builder/);
    assert.match(frame, /Please research/);
    assert.match(frame, /Sources ready/);
    assert.doesNotMatch(frame, /Other run response/);
    assert.match(frame, /TOOL  search/);

    const rosterNode = content.roster;
    content.update({ ...state, transcript: { ...state.transcript, filter: 'response' } });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    assert.strictEqual(content.roster, rosterNode);
    assert.doesNotMatch(frame, /TOOL  search/);
    assert.match(frame, /Sources ready/);
    content.update({ ...state, transcript: { ...state.transcript, filter: 'error' } });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    assert.match(frame, /TOOL  fetch/);
    assert.doesNotMatch(frame, /TOOL  search/);
    content.update({ ...state, transcript: { ...state.transcript, mode: 'detailed', filter: 'error' } });
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /HTTP 503/);
    const laterItem = { id: 'later', kind: 'assistant' as const, text: 'New streamed result', startedAt: 4, sourceEvents: { firstSequence: 4, lastSequence: 4 } };
    content.update({ ...state, transcript: { ...state.transcript, followTail: false } });
    content.update({ ...state, transcript: { ...state.transcript, followTail: false, conversation: {
      ...state.transcript.conversation, items: [...state.transcript.conversation.items, laterItem],
    } } });
    await setup.renderOnce();
    assert.doesNotMatch(setup.captureCharFrame(), /New streamed result/);
    setup.resize(120, 30);
    layout.update(shellState);
    content.update({ ...state, transcript: { ...state.transcript, followTail: false, filter: 'response', conversation: {
      ...state.transcript.conversation, items: [...state.transcript.conversation.items, laterItem],
    } } });
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Sources ready/);
    assert.doesNotMatch(setup.captureCharFrame(), /New streamed result/);
    content.update({ ...state, transcript: { ...state.transcript, conversation: {
      ...state.transcript.conversation, items: [...state.transcript.conversation.items, laterItem],
    } } });
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /New streamed result/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('very long transcript item stays bounded to native viewport', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const shellState = layoutState('closed');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const state: Pick<WorkbenchViewState, 'roster' | 'transcript' | 'selection' | 'overlay'> = {
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [
        { id: 'long', kind: 'assistant', text: `${'word '.repeat(60_000)}TAIL MARKER`, startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 1 } },
      ], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /TAIL MARKER/);
    assert.ok(content.transcript.plainText.length < 2_000);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('narrow roster keeps selected agent visible after resize', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const shellState = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const agents = Array.from({ length: 8 }, (_, index) => ({
      agentId: `worker-${index}`, role: `Role-${index}`, state: 'thinking' as const,
      taskLabel: `Task-${index}`, ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {},
    }));
    const state: Pick<WorkbenchViewState, 'roster' | 'transcript' | 'selection' | 'overlay'> = {
      roster: { agents: { agents, active: 8, totals: { agents: 8, running: 8, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 } }, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: { selectedAgentId: 'worker-7' }, overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    setup.resize(80, 10);
    layout.update(shellState);
    content.update(state);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Role-7/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('native content preserves unavailable roster and moves into narrow overlay', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const shellState = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const state: Pick<WorkbenchViewState, 'roster' | 'transcript' | 'selection' | 'overlay'> = {
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Roster unavailable/);
    setup.resize(80, 24);
    layout.update(shellState);
    content.update(state);
    await setup.renderOnce();
    assert.equal(layout.regions.overlay.visible, true);
    assert.match(setup.captureCharFrame(), /Roster unavailable/);
    assert.ok(content.overlay.screenX > layout.regions.overlay.screenX);
    assert.ok(content.overlay.screenX < layout.regions.overlay.screenX + layout.geometry.regions.overlay!.width);
    content.dispose();
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});
