import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { buildExecutionTrace } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { TimelineBuilder } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';
import { ArtifactProjection } from '../../../src/interfaces/tui/workbench/projections/artifact-projection.js';
import { ConversationProjection } from '../../../src/interfaces/tui/workbench/projections/conversation-projection.js';
import { TaskProjection } from '../../../src/interfaces/tui/workbench/projections/task-projection.js';
import { disposeTestRenderer } from './opentui-native-harness.js';
import type { AgentInspectorModel } from '../../../src/interfaces/tui/workbench/model/agent-inspector.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import type { WorkbenchDrawer } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { WorkbenchViewComposer, WorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/types.js';
import { ansiRowToNativeParts, mountOpenTuiWorkbenchContent, type ContentState } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';
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
      if (!overlay) assert.equal(layout.regions.transcript.visible, true);
      assert.equal(layout.regions.composer.visible, true);
      assert.match(frame, /┌─/);
      assert.equal(layout.regions.inspector.visible, inspector);
      assert.equal(layout.regions.overlay.visible, overlay);
      const geometry = layout.update(layoutState(drawer));
      assert.equal(layout.regions.transcript.screenX, geometry.regions.transcript.x);
      assert.equal(layout.regions.transcript.screenY, geometry.regions.transcript.y);
      if (drawer !== 'closed' || width >= 160 && height >= 36) assert.equal(layout.regions.roster.visible || layout.regions.overlay.visible, true);
      layout.dispose();
      layout.dispose();
      await setup.renderOnce();
      assert.doesNotMatch(setup.captureCharFrame(), /┌─/);
    } finally {
      await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
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
          { id: 'u', kind: 'user', text: 'Please research FAILED TOOL ✓', startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 1 } },
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
    assert.match(frame, /AGENTS & TASKS/);
    assert.match(frame, /LIVE TRANSCRIPT/);
    assert.match(frame, /\[ALL\]  RESPONSE  TOOL  ACTIVITY  ERROR/);
    assert.match(frame, /Auto-follow: ON/);
    // Transcript row labels are LOCAL wall-clock; epoch+1ms is not 00:00:00
    // outside UTC, so derive the expectation instead of hardcoding UTC.
    const epochLocal = new Date(1);
    const epPad = (n: number): string => String(n).padStart(2, '0');
    assert.match(frame, new RegExp(`\\[${epPad(epochLocal.getHours())}:${epPad(epochLocal.getMinutes())}:`));
    assert.match(frame, /Researcher/);
    assert.match(frame, /RUN run-a/);
    assert.match(frame, /Find sources/);
    assert.doesNotMatch(frame, /Builder/);
    assert.match(frame, /Please research/);
    const prose = content.transcript.chunks.find(chunk => chunk.text.includes('Please research FAILED TOOL ✓'));
    assert.equal(prose?.fg?.toInts().slice(0, 3).join(','), '230,237,243');
    assert.match(frame, /Sources ready/);
    assert.doesNotMatch(frame, /Other run response/);
    assert.match(frame, /TOOL search/);
    assert.match(frame, /lines: unavailable/);
    assert.ok(content.roster.chunks.filter(chunk => chunk.bg?.toInts().slice(0, 3).join(',') === '6,49,61').length >= 2);

    const rosterNode = content.roster;
    content.update({ ...state, transcript: { ...state.transcript, filter: 'response' } });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    assert.strictEqual(content.roster, rosterNode);
    assert.doesNotMatch(frame, /TOOL search/);
    assert.match(frame, /Sources ready/);
    content.update({ ...state, transcript: { ...state.transcript, filter: 'error' } });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    assert.match(frame, /TOOL fetch/);
    assert.doesNotMatch(frame, /TOOL search/);
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
    await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
  }
});

test('native transcript shows older rows at a paused scroll offset', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const shell = layoutState('closed');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const conversation = { items: Array.from({ length: 30 }, (_, index) => ({
      id: `row-${index}`, kind: 'assistant' as const, text: `ROW ${String(index).padStart(2, '0')}`,
      startedAt: index, sourceEvents: { firstSequence: index, lastSequence: index },
    })), hiddenDiagnostics: 0 };
    const base: ContentState = {
      inspector: inspectorState(), composer: contentComposer(), approval: [],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, base);
    await setup.renderOnce();
    assert.match(content.transcript.plainText, /ROW 29/);
    assert.doesNotMatch(content.transcript.plainText, /ROW 00/);

    content.update({ ...base, transcript: { ...base.transcript, followTail: false, scrollRowsFromTail: 3 } });
    await setup.renderOnce();
    assert.match(content.transcript.plainText, /ROW 14/);
    assert.doesNotMatch(content.transcript.plainText, /ROW 29/);

    content.update({ ...base, transcript: { ...base.transcript, followTail: false, scrollRowsFromTail: 100 } } as ContentState);
    await setup.renderOnce();
    assert.match(content.transcript.plainText, /ROW 00/);
    assert.doesNotMatch(content.transcript.plainText, /ROW 29/);
    assert.equal(content.resolvedScrollRows, 17);
    content.dispose();
    layout.dispose();
  } finally {
    await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
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

    const fullWidth = `Q${'x'.repeat(114)}Z`;
    const filled = layoutState('agents', fullWidth);
    layout.update(filled);
    content.update({ ...base, composer: filled.composer });
    await setup.renderOnce();
    assert.equal(content.composer.width, 118);
    assert.ok(content.composer.plainText.includes(fullWidth));

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
    await disposeTestRenderer(setup);
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
    await disposeTestRenderer(setup);
  }
});

test('native approval card renders inline in the transcript', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const shell = layoutState('closed');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const state: ContentState = {
      inspector: inspectorState(), composer: contentComposer(), approval: [
        { id: 'ap-1', toolName: 'write_file', target: 'src/x.ts', args: {}, requestedAt: 1, requestedBy: 'worker-1', agentId: 'worker-1' },
      ],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [{ id: 'approval-1', kind: 'approval', text: 'Approval required', startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 1 } }], hiddenDiagnostics: 0 }, mode: 'compact', filter: 'all', scope: 'all', followTail: true },
      selection: {}, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /APPROVAL REQUIRED/);
    assert.match(frame, /write_file/);
    assert.match(frame, /src\/x\.ts/);
    assert.match(frame, /a approve · d deny/);
    assert.equal(content.approval.visible, false);
    const transcriptRows = frame.split('\n').slice(layout.regions.transcript.screenY, layout.regions.transcript.screenY + layout.regions.transcript.height);
    assert.match(transcriptRows.join('\n'), /APPROVAL REQUIRED/);

    content.update({ ...state, approval: [] });
    await setup.renderOnce();
    assert.equal(content.approval.visible, false);
    assert.doesNotMatch(setup.captureCharFrame(), /APPROVAL REQUIRED/);
    content.dispose();
    layout.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('native transcript renders markdown, local time, and a tight gutter', async () => {
  const setup = await createTestRenderer({ width: 150, height: 34 });
  try {
    const shell = layoutState('closed');
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const markdown = [
      'Here is the list:',
      '',
      'This is **bold** and *italic*.',
      '',
      '| Country | President |',
      '| --- | --- |',
      '| **Benin** | Patrice Talon |',
      '| Ghana | John Mahama |',
    ].join('\n');
    const state: ContentState = {
      inspector: inspectorState(), composer: contentComposer(), approval: [],
      header: chromeState(), footer: chromeState(),
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: {
        conversation: { items: [
          { kind: 'assistant', text: markdown, startedAt: Date.now(), id: 'md-1' },
          { kind: 'tool-group', tools: [{ id: 't-1', name: 'web.search', status: 'completed', args: { query: 'x' } }], startedAt: Date.now(), id: 'tg-1' },
        ] as never, hiddenDiagnostics: 0 },
        mode: 'compact', filter: 'all', scope: 'all', followTail: true,
      },
      selection: {}, overlay: shell.overlay,
    };
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();

    // 1. Markdown is rendered, not echoed: the table separator row and bold
    //    markers in prose must not reach the transcript.
    assert.match(frame, /Here is the list:/);
    assert.doesNotMatch(frame, /\| --- \| --- \|/);
    assert.match(frame, /Benin/);
    assert.match(frame, /Patrice Talon/);
    // Inline emphasis in ordinary prose is consumed.
    assert.doesNotMatch(frame, /This is \*\*bold\*\*/);

    // 2. Timestamps are LOCAL wall-clock, not UTC. Rendered from `Date.now()`
    //    so the label must match the local clock, never toISOString()'s UTC.
    const local = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const localLabel = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
    const utcLabel = new Date().toISOString().slice(11, 16);
    assert.match(frame, new RegExp(`\\[${localLabel}`), 'row label uses local time');
    if (localLabel !== utcLabel) assert.doesNotMatch(frame, new RegExp(`\\[${utcLabel}`), 'row label is not UTC');

    // 3. The gutter is tight: prose starts near its responder, not ~40 columns in.
    const proseRow = frame.split('\n').find(line => line.includes('Here is the list'))!;
    const responderCol = proseRow.indexOf('ALiX');
    const textCol = proseRow.indexOf('Here is the list');
    assert.ok(textCol > responderCol, 'prose follows its responder');
    assert.ok(textCol - responderCol <= 12, `gutter must stay tight (was ${textCol - responderCol})`);

    const cardRow = frame.split('\n').find(line => line.includes('╭'))!;
    assert.equal(cardRow.indexOf('╭'), textCol, 'tool card aligns with response prose');
    const success = content.transcript.chunks.find(chunk => chunk.text.includes('✓ success'));
    assert.deepEqual(success?.fg?.toInts().slice(0, 3), [61, 244, 81], 'success label and tick are green');
    const toolBadge = content.transcript.chunks.find(chunk =>
      chunk.text === 'TOOL' && chunk.bg?.toInts().slice(0, 3).join(',') === '6,201,239');
    assert.deepEqual(toolBadge?.bg?.toInts().slice(0, 3), [6, 201, 239], 'TOOL badge has cyan background');
    assert.equal(frame.match(/TOOL\s+web\.search/g)?.length, 1, 'tool label appears only inside card');

    // 4. No connector artifact in front of the tool card. The connector guide is
    //    a vertical bar joined to a corner (`│├─`/`│└─`); the card's OWN border
    //    also uses └─ and ┌─, so assert on the vertical-bar form only.
    assert.doesNotMatch(frame, /│[├└]/, 'tool card carries no connector guide');

    content.dispose();
    layout.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('native ANSI mapper consumes truecolor tuples atomically', () => {
  assert.deepEqual(ansiRowToNativeParts('\x1b[38;2;61;244;81m✓ success\x1b[0m'), [
    { text: '✓ success', color: 'green' },
  ]);
  assert.deepEqual(ansiRowToNativeParts('\x1b[38;2;255;99;110m✗ failed\x1b[0m'), [
    { text: '✗ failed', color: 'red' },
  ]);
  assert.deepEqual(ansiRowToNativeParts('\x1b[48;2;6;201;239m\x1b[38;2;8;21;27mTOOL\x1b[0m'), [
    { text: 'TOOL', color: 'background', background: 'cyan' },
  ]);
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
    const brand = content.header.chunks.find(chunk => chunk.text === 'ALiX WORKBENCH');
    const workspace = content.header.chunks.find(chunk => chunk.text === '/work/project');
    assert.ok(brand?.attributes, 'brand uses terminal bold');
    assert.deepEqual(brand.fg?.toInts().slice(0, 3), [6, 201, 239]);
    assert.deepEqual(workspace?.fg?.toInts().slice(0, 3), [6, 201, 239]);
    assert.match(frame, /TOKENS 1,234/);
    assert.match(frame, /a approve/);
    assert.match(frame, /d deny/);
    assert.match(frame, /Esc cancel/);
    // Row 0 groups are workspace | mode | warnings | counters; the run status
    // never joins them. Warning groups take precedence over the counters.
    const headerRow = content.header.plainText.split('\n')[0] ?? '';
    assert.match(headerRow, /workspace: \/work\/project\s+\|\s+ask\s+\|\s+1 approval\s+\|\s+4 agents • 2 running/);
    assert.doesNotMatch(headerRow, /RUNNING|WAITING FOR APPROVAL/);
    // A running turn paints its status on the reserved status row, not row 0.
    content.update({ ...state, header: chromeState({ ...chrome, status: { kind: 'liveness', startedAt: Date.now() - 5_000, lastProgressAt: Date.now() - 1_000, state: 'healthy' } }) });
    await setup.renderOnce();
    const statusRow = content.header.plainText.split('\n')[1] ?? '';
    assert.match(statusRow, /^RUNNING \d/);
    content.update({ ...state, header: chromeState({ ...chrome, status: undefined }) });
    await setup.renderOnce();
    assert.doesNotMatch(content.header.plainText, /RUNNING|WAITING FOR APPROVAL/);
    content.update({ ...state, header: chromeState({ workspace: '/漢\n\x1b[31mwork' }) });
    await setup.renderOnce();
    assert.doesNotMatch(content.header.plainText, /\n|\x1b/);
    assert.match(content.header.plainText, /workspace: \/漢 work/);
    content.dispose();
    layout.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('native wide frame renders the event-backed preview scene', async () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/tui/workbench-preview-events.json', 'utf8')) as {
    now: string; workspace: string; sessionId: string; selectedAgentId: string; events: AlixEvent[];
  };
  const now = Date.parse(fixture.now);
  const agentProjection = new AgentRosterProjection();
  const taskProjection = new TaskProjection();
  const artifactProjection = new ArtifactProjection();
  const timeline = new TimelineBuilder(fixture.sessionId);
  agentProjection.update(fixture.events);
  taskProjection.update(fixture.events);
  artifactProjection.update(fixture.events);
  timeline.update(fixture.events);
  const agents = agentProjection.snapshot(now);
  const tasks = taskProjection.snapshot();
  const artifacts = artifactProjection.snapshot();
  const agent = agents.agents.find(entry => entry.agentId === fixture.selectedAgentId)!;
  const shell = layoutState('agents');
  const chrome = chromeState({
    demo: true, workspace: fixture.workspace, mode: 'bypass', running: true,
    agents: { active: agents.active, total: agents.totals.agents, running: agents.totals.running,
      waitingApproval: 0, stalled: 0, costCoverage: 0 },
    tokensUsed: 7352, filesTouched: artifacts.artifacts, eventCount: fixture.events.length,
  });
  const state: ContentState = {
    header: chrome, footer: chrome,
    roster: { agents, tasks, artifacts },
    transcript: { conversation: new ConversationProjection().project({
      timeline: timeline.snapshot(), trace: buildExecutionTrace(fixture.events), mode: 'compact',
    }), mode: 'compact', filter: 'all', scope: 'all', followTail: true },
    inspector: inspectorState({
      selection: 'selected', agent, task: tasks.tasks.find(entry => entry.agentId === fixture.selectedAgentId),
      artifacts: artifacts.items.filter(entry => entry.agentId === fixture.selectedAgentId),
      tokens: agent.usage.totalTokens,
      activity: agent.activeTool && { toolName: agent.activeTool.toolName, toolCallId: agent.activeTool.toolCallId,
        startedAt: agent.activeTool.startedAt, elapsedMs: now - agent.activeTool.startedAt, status: 'writing file...' },
    }),
    composer: contentComposer(), approval: [],
    selection: { selectedAgentId: fixture.selectedAgentId }, overlay: shell.overlay,
  };
  const setup = await createTestRenderer({ width: 200, height: 44 });
  try {
    const layout = mountOpenTuiWorkbenchLayout(setup.renderer, shell);
    const content = mountOpenTuiWorkbenchContent(setup.renderer, layout, state);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    for (const text of ['AGENTS & TASKS', 'LIVE TRANSCRIPT', 'AGENT DETAILS', 'frontend-agent',
      'backend-agent', 'test-agent', 'review-agent', 'Planning phase complete.',
      'sidebar.tsx', 'right-sidebar.ts', 'Auto-follow: ON', 'Tokens', '7,352']) {
      assert.ok(frame.includes(text), `preview frame missing ${text}\n${content.transcript.plainText}`);
    }
    assert.match(frame, /5 agents • 3 running/);
    assert.match(frame, /frontend-agent.*3/);
    assert.doesNotMatch(frame, /THINKING|WAITING_DEPENDENCY/);
    assert.match(frame, /CONCEPT PREVIEW/);
    assert.match(frame, /EVENTS 38/);
    content.dispose();
    layout.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});
