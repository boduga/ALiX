import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import type { AgentInspectorModel } from '../../../src/interfaces/tui/workbench/model/agent-inspector.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import type { WorkbenchDrawer } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { WorkbenchViewComposer, WorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/types.js';
import { mountOpenTuiWorkbenchContent, type ContentState } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';
import { mountOpenTuiWorkbenchLayout } from '../../../src/interfaces/tui/workbench/opentui/workbench-layout.js';

function chromeState(overrides: Partial<OperatorShellSnapshot> = {}): OperatorShellSnapshot {
  return { workspace: '/w', mode: 'auto', transcriptMode: 'compact', running: false, queuedMessages: 0, ...overrides };
}

function inspectorState(overrides: Partial<AgentInspectorModel> = {}): AgentInspectorModel {
  return { selection: 'aggregate', explicitTaskSelection: false, approvals: [], artifacts: [], tokensPartial: false, costPartial: false, ...overrides };
}

function contentComposer(text = '', cursor = text.length): WorkbenchViewComposer {
  return { composer: { text, cursor }, coordination: { draft: { text: '', cursor: 0 }, phase: 'idle' }, queuedMessages: [] };
}

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
      assert.doesNotMatch(setup.captureCharFrame(), /Composer/);
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
    const state: ContentState = {
      inspector: inspectorState(),
      composer: contentComposer(),
      approval: [],
      header: chromeState(),
      footer: chromeState(),
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
    const state: ContentState = {
      inspector: inspectorState(),
      composer: contentComposer(),
      approval: [],
      header: chromeState(),
      footer: chromeState(),
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
    const state: ContentState = {
      inspector: inspectorState(),
      composer: contentComposer(),
      approval: [],
      header: chromeState(),
      footer: chromeState(),
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
    const state: ContentState = {
      inspector: inspectorState(),
      composer: contentComposer(),
      approval: [],
      header: chromeState(),
      footer: chromeState(),
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

test('native inspector shows bounded agent sections and updates in place', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const shellState = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const agent = {
      agentId: 'worker-1', role: 'Researcher', model: 'gpt-test', state: 'tool_running' as const,
      taskLabel: 'Find sources', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: { totalTokens: 1200 },
    };
    const selected = inspectorState({
      selection: 'selected', agent, tokens: 1200,
      activity: { toolName: 'search', toolCallId: 'call-1', startedAt: 1, elapsedMs: 4200, status: 'running tool' },
    });
    const state: ContentState = {
      inspector: selected, composer: contentComposer(), approval: [],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: { selectedAgentId: 'worker-1' }, overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /AGENT DETAILS/);
    assert.match(frame, /Researcher/);
    assert.match(frame, /Find sources/);
    assert.match(frame, /LIVE ACTIVITY/);
    assert.match(frame, /search/);
    assert.match(frame, /No pending approvals/);
    assert.match(frame, /1,200/);
    assert.ok(content.inspector.plainText.split('\n').length <= 38);

    const inspectorNode = content.inspector;
    content.update({ ...state, inspector: inspectorState({ selection: 'aggregate', agentCount: 3, runningCount: 2 }) });
    await setup.renderOnce();
    assert.strictEqual(content.inspector, inspectorNode);
    assert.match(setup.captureCharFrame(), /All agents/);
    assert.doesNotMatch(setup.captureCharFrame(), /Researcher/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('native composer shows placeholder, draft, and multiline rows', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const shellState = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shellState);
    const base: ContentState = {
      inspector: inspectorState(), composer: shellState.composer, approval: [],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shellState.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, base);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Add your next instruction/);

    const composerNode = content.composer;
    const draft = layoutState('agents', 'hello world');
    layout.update(draft);
    content.update({ ...base, composer: draft.composer });
    await setup.renderOnce();
    assert.strictEqual(content.composer, composerNode);
    assert.match(setup.captureCharFrame(), /> hello world/);

    const multiline = layoutState('agents', 'line one\nline two\nline three\nline four\nline five\nline six\nline seven');
    layout.update(multiline);
    content.update({ ...base, composer: multiline.composer });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /… line three/);
    assert.doesNotMatch(frame, /line one/);
    assert.match(frame, /line seven/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('native drawers render task and artifact bodies by drawer selection', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const shell = layoutState('tasks');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const base: ContentState = {
      inspector: inspectorState(), composer: shell.composer, approval: [],
      header: chromeState(), footer: chromeState(),
      roster: {
        agents: null,
        tasks: { tasks: [
          { taskId: 't1', agentId: 'worker-1', coordinationRunId: 'run-a', title: 'Build draft', state: 'running', ownedPaths: ['src/x.ts'], createdAt: 1, updatedAt: 2 },
          { taskId: 't2', agentId: 'worker-1', coordinationRunId: 'run-a', title: 'Publish', state: 'completed', ownedPaths: [], createdAt: 1, updatedAt: 2 },
        ], blocked: 0, running: 1, queued: 0 },
        artifacts: { items: [
          { id: 'a1', kind: 'artifact', status: 'available', title: 'report.md', artifactType: 'markdown', uri: 'file:///out/report.md', sizeBytes: 2048, coordinationRunId: 'run-a', taskId: 't1', createdAt: 1, sourceSequence: 1 },
        ], artifacts: 1, results: 0, failed: 0 },
      },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: { selectedRunId: 'run-a', selectedTaskId: 't1', selectedArtifactId: 'a1' }, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, base);
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    assert.match(frame, /Build draft/);
    assert.match(frame, /1 running/);
    assert.match(frame, /src\/x\.ts/);

    const artifactShell = layoutState('artifacts');
    layout.update(artifactShell);
    content.update({ ...base, composer: artifactShell.composer, overlay: artifactShell.overlay });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    assert.match(frame, /report\.md/);
    assert.match(frame, /1 files · 0 results/);
    assert.match(frame, /2\.0 KiB/);
    assert.doesNotMatch(frame, /Build draft/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('native approval card paints above the drawer overlay', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const shell = layoutState('agents');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const state: ContentState = {
      inspector: inspectorState(), composer: contentComposer(), approval: [
        { id: 'ap-1', toolName: 'write_file', target: 'src/x.ts', args: {}, requestedAt: 1, requestedBy: 'worker-1', agentId: 'worker-1' },
        { id: 'ap-2', toolName: 'run_shell', target: 'npm test', args: {}, requestedAt: 2, requestedBy: 'worker-1', agentId: 'worker-1' },
      ],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /APPROVAL REQUIRED/);
    assert.match(frame, /write_file/);
    assert.match(frame, /npm test/);
    assert.match(frame, /1 OF 2/);
    assert.match(frame, /a approve · d deny/);
    assert.equal(content.approval.visible, true);
    assert.ok(content.approval.screenY < layout.regions.overlay.screenY + layout.regions.overlay.height);
    const rows = frame.split('\n');
    assert.match(rows[content.approval.screenY] ?? '', /APPROVAL REQUIRED/);

    content.update({ ...state, approval: [] });
    await setup.renderOnce();
    assert.equal(content.approval.visible, false);
    assert.doesNotMatch(setup.captureCharFrame(), /APPROVAL REQUIRED/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});

test('native header and footer render operator chrome', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const shell = layoutState('closed');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const chrome = chromeState({
      mode: 'ask', running: true, workspace: '/work/project', tokensUsed: 1234,
      filesTouched: 3, eventCount: 9, escapeAction: 'cancel',
      agents: { active: 2, total: 4, running: 2, waitingApproval: 1, stalled: 0, costCoverage: 0 },
      approval: { count: 2, toolName: 'write_file' },
      focus: 'composer',
    });
    const state: ContentState = {
      inspector: inspectorState(), composer: contentComposer(), approval: [],
      header: chrome, footer: chrome,
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /ALiX WORKBENCH/);
    assert.match(frame, /PREVIEW/);
    assert.match(frame, /workspace: \/work\/project/);
    assert.match(frame, /TOKENS 1,234/);
    assert.match(frame, /a approve/);
    assert.match(frame, /d deny/);
    assert.match(frame, /Esc cancel/);
    content.dispose();
    layout.dispose();
  } finally {
    await dispose(setup);
  }
});
