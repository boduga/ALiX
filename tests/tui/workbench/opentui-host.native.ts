import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockMouse, createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { AgentSummary } from '../../../src/interfaces/tui/workbench/model/agent-roster.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import type { WorkbenchHostPorts } from '../../../src/interfaces/tui/workbench/controller/host-intent.js';
import { applyWorkbenchIntent } from '../../../src/interfaces/tui/workbench/controller/intent.js';
import { buildWorkbenchInputContext } from '../../../src/interfaces/tui/workbench/input/input-context.js';
import { routeWorkbenchInput } from '../../../src/interfaces/tui/workbench/input/input-router.js';
import { mountOpenTuiWorkbenchHost, type OpenTuiWorkbenchHost } from '../../../src/interfaces/tui/workbench/opentui/host.js';
import type { ContentState } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';
import { disposeTestRenderer } from './opentui-native-harness.js';

const chrome: OperatorShellSnapshot = { workspace: '/w', mode: 'auto', transcriptMode: 'compact', running: false, queuedMessages: 0 };

function makePorts() {
  const calls = { submitSlash: 0, cancelActiveTurn: 0, resolveApproval: [] as Array<[string, string]> };
  let seq = 0;
  const ports: WorkbenchHostPorts = {
    repaint: () => {}, syncComposer: () => {}, overlayScrollLimit: () => 10, submitCoordination: () => {},
    openBuiltinSurface: () => false, clearSlashHint: () => {}, submitSlash: () => { calls.submitSlash++; }, hasSnapshot: () => true,
    reportSubmitUnavailable: () => {}, setCancelArmed: () => {}, setPinnedBottom: () => {}, setTranscriptMode: () => {},
    anchorTranscriptBottom: () => {}, emitUserTimeline: () => {}, submitTurn: () => {}, nextQueuedId: () => { seq++; return `q${seq}`; },
    approvalTarget: () => ({ id: 'ap1' }), isApprovalDecisionPending: () => false, markApprovalDecision: () => {},
    unmarkApprovalDecision: () => {}, resolveApproval: (id, decision) => { calls.resolveApproval.push([id, decision]); },
    cyclePermission: () => {}, refresh: () => {}, cancelActiveTurn: () => { calls.cancelActiveTurn++; return true; },
  };
  return { ports, calls };
}

interface Harness {
  store: WorkbenchStore;
  host: OpenTuiWorkbenchHost;
  calls: ReturnType<typeof makePorts>['calls'];
  keys: string[];
  signals: { turnActive: boolean; slashActive: boolean; approvalPending: boolean };
}

function pressEscape(setup: TestRendererSetup): void {
  setup.renderer.keyInput.processParsedKey({
    name: 'escape', ctrl: false, meta: false, shift: false, option: false,
    sequence: '\u001b', number: false, raw: '\u001b', eventType: 'press', source: 'raw',
  });
}

function mount(
  setup: TestRendererSetup, dimensions = { columns: 120, rows: 30 }, agents: readonly AgentSummary[] = [],
  overrides: Partial<Pick<ContentState, 'roster' | 'approval' | 'inspector'>> = {},
): Harness {
  const store = new WorkbenchStore(createInitialWorkbenchUiState(dimensions));
  const { ports, calls } = makePorts();
  const signals = { turnActive: false, slashActive: false, approvalPending: false };
  const keys: string[] = [];
  const contentState = (): ContentState => {
    const state = store.snapshot();
    return {
      header: chrome, footer: chrome,
      roster: overrides.roster ?? { agents: agents.length > 0 ? {
        agents, active: agents.length,
        totals: { agents: agents.length, running: agents.length, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
      } : null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: state.transcriptMode, filter: state.transcriptFilter, scope: state.transcriptScope, followTail: state.followTail },
      inspector: overrides.inspector ?? { selection: 'aggregate', explicitTaskSelection: false, approvals: [], artifacts: [], tokensPartial: false, costPartial: false },
      composer: { composer: state.composer, coordination: state.coordination, queuedMessages: state.queuedMessages },
      approval: overrides.approval ?? [],
      selection: {},
      overlay: { stack: state.overlayStack, scrollOffset: state.overlayScrollOffset, drawer: state.drawer, drawerScrollOffset: state.drawerScrollOffset, agentRosterExpanded: state.agentRosterExpanded },
    };
  };
  const host = mountOpenTuiWorkbenchHost(setup.renderer, {
    layoutState: () => ({ composer: contentState().composer, overlay: contentState().overlay }),
    contentState,
    onKey: (key) => {
      keys.push(key);
      applyWorkbenchIntent(store, routeWorkbenchInput(key, buildWorkbenchInputContext(store.snapshot(), signals)), {
        snapshot: undefined, ports, coordinationAvailable: true,
      });
      host.update();
    },
    onPaste: (text) => {
      store.dispatch({ type: 'composer.insert', text });
      host.update();
    },
    onClick: (action) => {
      if (action.type === 'agent.select' || action.type === 'task.select' || action.type === 'artifact.select') store.dispatch(action);
      else if (action.type === 'artifact.open') {
        const item = overrides.roster?.artifacts?.items.find(entry => entry.id === action.artifactId);
        if (item) {
          store.dispatch({ type: 'artifact.select', artifactId: item.id, runId: item.coordinationRunId,
            agentId: item.agentId, taskId: item.taskId, scrollOffset: 0 });
          if (store.snapshot().drawer !== 'artifacts') store.dispatch({ type: 'drawer.toggle', drawer: 'artifacts' });
        }
      }
      else if (action.type === 'tab.next') keys.push('Tab');
      else if (action.type === 'approval.resolve') applyWorkbenchIntent(store, { type: action.type, decision: action.decision, approvalId: action.approvalId }, { snapshot: undefined, ports, coordinationAvailable: true });
      else applyWorkbenchIntent(store, action, { snapshot: undefined, ports, coordinationAvailable: true });
      host.update();
    },
  });
  return { store, host, calls, keys, signals };
}

test('OpenTUI host routes typing and Ctrl+e into the store', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { store, host } = mount(setup);
    await setup.renderOnce();
    await setup.mockInput.typeText('hi');
    await setup.renderOnce();
    assert.equal(store.snapshot().composer.text, 'hi');
    assert.match(setup.captureCharFrame(), /hi/);
    setup.mockInput.pressKey('e', { ctrl: true });
    await setup.renderOnce();
    assert.equal(store.snapshot().overlayStack.at(-1), 'inspector');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI host normalizes paste and routes Unicode keys', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { store, host } = mount(setup);
    setup.renderer.keyInput.processPaste(new TextEncoder().encode('a\r\nb'));
    await setup.renderOnce();
    assert.equal(store.snapshot().composer.text, 'a\nb');
    await setup.mockInput.typeText('漢');
    await setup.renderOnce();
    assert.equal(store.snapshot().composer.text, 'a\nb漢');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI host closes an open overlay and routes cancellation', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const status = mount(setup);
    status.store.dispatch({ type: 'overlay.toggle', overlay: 'help' });
    pressEscape(setup);
    await setup.renderOnce();
    assert.deepEqual(status.store.snapshot().overlayStack, []);

    status.signals.turnActive = true;
    status.store.dispatch({ type: 'focus.set', focus: 'transcript' });
    pressEscape(setup);
    await setup.renderOnce();
    assert.equal(status.calls.cancelActiveTurn, 1);
    status.host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI host routes approval, queue, and slash', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const approval = mount(setup);
    approval.signals.approvalPending = true;
    setup.mockInput.pressKey('a');
    await setup.renderOnce();
    assert.deepEqual(approval.calls.resolveApproval, [['ap1', 'approved']]);
    approval.host.dispose();

    const queued = mount(setup);
    queued.signals.turnActive = true;
    queued.store.dispatch({ type: 'composer.replace', text: 'job' });
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    assert.equal(queued.store.snapshot().queuedMessages.length, 1);
    queued.host.dispose();

    const slash = mount(setup);
    slash.signals.slashActive = true;
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    assert.equal(slash.calls.submitSlash, 1);
    slash.host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI host re-lays-out on resize', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const { host } = mount(setup, { columns: 180, rows: 40 });
    await setup.renderOnce();
    const wideX = host.layout.regions.transcript.screenX;
    setup.resize(80, 24);
    await setup.renderOnce();
    assert.notEqual(host.layout.regions.transcript.screenX, wideX);
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI transcript wheel routes scroll keys', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { host, keys } = mount(setup);
    await setup.renderOnce();
    const mouse = createMockMouse(setup.renderer);
    await mouse.scroll(host.layout.regions.transcript.screenX + 10, host.layout.regions.transcript.screenY + 5, 'up');
    assert.ok(keys.includes('ArrowUp'));
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI clicks focus the transcript and composer and use toolbar controls', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { host, store } = mount(setup);
    const mouse = createMockMouse(setup.renderer);
    await setup.renderOnce();
    await mouse.click(host.content.transcript.screenX + 8, host.content.transcript.screenY + 5);
    assert.equal(store.snapshot().focus, 'transcript');
    await mouse.click(host.content.composer.screenX + 3, host.content.composer.screenY);
    assert.equal(store.snapshot().focus, 'composer');

    const toolbar = host.content.transcript.plainText.split('\n');
    const toolbarRow = toolbar.findIndex(line => line.includes('TOOL') && line.includes('Auto-follow:'));
    assert.ok(toolbarRow >= 0);
    await mouse.click(host.content.transcript.screenX + toolbar[toolbarRow]!.indexOf('TOOL'), host.content.transcript.screenY + toolbarRow);
    assert.equal(store.snapshot().transcriptFilter, 'tool');
    store.dispatch({ type: 'transcript.follow', followTail: false });
    host.update();
    await setup.renderOnce();
    const followToolbar = host.content.transcript.plainText.split('\n');
    const followRow = followToolbar.findIndex(line => line.includes('Auto-follow:'));
    await mouse.click(host.content.transcript.screenX + followToolbar[followRow]!.indexOf('Auto-follow:'), host.content.transcript.screenY + followRow);
    assert.equal(store.snapshot().followTail, true);
    setup.resize(60, 24);
    await setup.renderOnce();
    const narrowToolbar = host.content.transcript.plainText.split('\n');
    const narrowRow = narrowToolbar.findIndex(line => line.includes('RESPONSE') && line.includes('Auto-follow:'));
    assert.equal(narrowRow, 1);
    await mouse.click(host.content.transcript.screenX + narrowToolbar[narrowRow]!.indexOf('RESPONSE'), host.content.transcript.screenY + narrowRow);
    assert.equal(store.snapshot().transcriptFilter, 'response');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI roster clicks select by agent identity and ignore covered or right clicks', async () => {
  const setup = await createTestRenderer({ width: 180, height: 30 });
  try {
    const agents: AgentSummary[] = [
      { agentId: 'worker-1', role: 'worker', state: 'thinking', taskLabel: 'First task', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} },
      { agentId: 'worker-2', role: 'worker', state: 'thinking', taskLabel: 'Second task', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} },
    ];
    const { host, store } = mount(setup, { columns: 180, rows: 30 }, agents);
    const mouse = createMockMouse(setup.renderer);
    await setup.renderOnce();
    const roster = host.content.roster.plainText.split('\n');
    const secondRow = roster.findIndex(line => line.includes('Second task'));
    assert.ok(secondRow >= 0);
    const x = host.content.roster.screenX + 3;
    const y = host.content.roster.screenY + secondRow;
    await mouse.click(x, y, 2);
    assert.equal(store.snapshot().selectedAgentId, undefined);
    await mouse.drag(x, y, x, y + 1);
    assert.equal(store.snapshot().selectedAgentId, undefined);
    await mouse.click(x, y);
    assert.equal(store.snapshot().selectedAgentId, 'worker-2');

    store.dispatch({ type: 'overlay.toggle', overlay: 'help' });
    host.update();
    await setup.renderOnce();
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + 2);
    assert.equal(store.snapshot().selectedAgentId, 'worker-2');
    store.dispatch({ type: 'overlay.close' });
    host.update();
    await setup.renderOnce();
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + 2);
    assert.equal(store.snapshot().selectedAgentId, undefined);

    store.dispatch({ type: 'agentRoster.toggle' });
    host.update();
    await setup.renderOnce();
    const collapsedRow = host.content.roster.plainText.split('\n').findIndex(line => line.includes('Enter to expand roster'));
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + collapsedRow);
    assert.equal(store.snapshot().agentRosterExpanded, true);
    host.update();
    await setup.renderOnce();
    const coordinationRow = host.content.roster.plainText.split('\n').findIndex(line => line.includes('Coordination Run'));
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + coordinationRow);
    assert.equal(store.snapshot().overlayStack.at(-1), 'coordination');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI narrow drawer uses its visible roster rows for clicks', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const agents: AgentSummary[] = [
      { agentId: 'worker-1', role: 'worker', state: 'thinking', taskLabel: 'First task', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} },
    ];
    const { host, store } = mount(setup, { columns: 80, rows: 24 }, agents);
    store.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    host.update();
    await setup.renderOnce();
    assert.equal(host.layout.regions.overlay.visible, true);
    const rows = host.content.overlay.plainText.split('\n');
    const row = rows.findIndex(line => line.includes('First task'));
    assert.ok(row >= 0);
    const mouse = createMockMouse(setup.renderer);
    await mouse.click(host.content.overlay.screenX + 3, host.content.overlay.screenY + row);
    assert.equal(store.snapshot().selectedAgentId, 'worker-1');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI task and artifact rows select projected identities', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const { host, store } = mount(setup, { columns: 180, rows: 40 }, [], { roster: {
      agents: null,
      tasks: { tasks: [
        { taskId: 'task-1', agentId: 'worker-1', title: 'Build draft', state: 'running', ownedPaths: [], createdAt: 1, updatedAt: 2 },
        { taskId: 'task-2', agentId: 'worker-2', title: 'Publish', state: 'completed', ownedPaths: [], createdAt: 1, updatedAt: 2 },
      ], blocked: 0, running: 1, queued: 0 },
      artifacts: { items: [
        { id: 'artifact-1', kind: 'artifact', status: 'available', title: 'report.md', agentId: 'worker-2', taskId: 'task-2', createdAt: 1, sourceSequence: 1 },
      ], artifacts: 1, results: 0, failed: 0 },
    } });
    const mouse = createMockMouse(setup.renderer);
    store.dispatch({ type: 'drawer.toggle', drawer: 'tasks' });
    host.update();
    await setup.renderOnce();
    const taskRow = host.content.roster.plainText.split('\n').findIndex(line => line.includes('Publish'));
    assert.ok(taskRow >= 0);
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + taskRow);
    assert.equal(store.snapshot().selectedTaskId, 'task-2');
    assert.equal(store.snapshot().selectedAgentId, 'worker-2');

    store.dispatch({ type: 'drawer.toggle', drawer: 'artifacts' });
    host.update();
    await setup.renderOnce();
    const artifactRow = host.content.roster.plainText.split('\n').findIndex(line => line.includes('report.md'));
    assert.ok(artifactRow >= 0);
    await mouse.click(host.content.roster.screenX + 3, host.content.roster.screenY + artifactRow);
    assert.equal(store.snapshot().selectedArtifactId, 'artifact-1');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI narrow task overlay uses visible row targets', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  try {
    const { host, store } = mount(setup, { columns: 80, rows: 24 }, [], { roster: {
      agents: null,
      tasks: { tasks: [
        { taskId: 'task-1', title: 'Narrow task', state: 'running', ownedPaths: [], createdAt: 1, updatedAt: 2 },
      ], blocked: 0, running: 1, queued: 0 },
      artifacts: null,
    } });
    store.dispatch({ type: 'drawer.toggle', drawer: 'tasks' });
    host.update();
    await setup.renderOnce();
    assert.equal(host.layout.regions.overlay.visible, true);
    const row = host.content.overlay.plainText.split('\n').findIndex(line => line.includes('Narrow task'));
    assert.ok(row >= 0);
    await createMockMouse(setup.renderer).click(host.content.overlay.screenX + 3, host.content.overlay.screenY + row);
    assert.equal(store.snapshot().selectedTaskId, 'task-1');
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI inspector and footer hints respond to clicks', async () => {
  const setup = await createTestRenderer({ width: 180, height: 40 });
  try {
    const artifact = { id: 'inspector-artifact', kind: 'artifact', status: 'available', title: 'inspector.md',
      createdAt: 1, sourceSequence: 1 } as const;
    const { host, store, keys } = mount(setup, { columns: 180, rows: 40 }, [], {
      roster: { agents: null, tasks: null, artifacts: { items: [artifact], artifacts: 1, results: 0, failed: 0 } },
      inspector: { selection: 'aggregate', explicitTaskSelection: false, approvals: [], artifacts: [artifact], tokensPartial: false, costPartial: false },
    });
    const mouse = createMockMouse(setup.renderer);
    await setup.renderOnce();
    const artifactsRow = host.content.inspector.plainText.split('\n').findIndex(line => line.includes('inspector.md'));
    assert.ok(artifactsRow >= 0);
    await mouse.click(host.content.inspector.screenX + 2, host.content.inspector.screenY + artifactsRow);
    assert.equal(store.snapshot().selectedArtifactId, 'inspector-artifact');
    assert.equal(store.snapshot().drawer, 'artifacts');
    await mouse.click(host.content.footer.screenX + 2, host.content.footer.screenY);
    assert.deepEqual(keys, ['Tab']);
    // Section headings are structure, not controls; they must not open anything.
    const detailsRow = host.content.inspector.plainText.split('\n').findIndex(line => line.includes('AGENT DETAILS'));
    assert.ok(detailsRow >= 0);
    await mouse.click(host.content.inspector.screenX + 2, host.content.inspector.screenY + detailsRow);
    assert.equal(store.snapshot().overlayStack.at(-1), undefined);
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});

test('OpenTUI approval buttons resolve the visible approval while blocking covered panes', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { host, store, calls } = mount(setup, { columns: 120, rows: 30 }, [], { approval: [
      { id: 'ap1', toolName: 'write_file', target: 'src/x.ts', args: {}, requestedAt: 1, requestedBy: 'worker-1' },
      { id: 'ap2', toolName: 'run_shell', target: 'npm test', args: {}, requestedAt: 2, requestedBy: 'worker-2' },
    ] });
    const mouse = createMockMouse(setup.renderer);
    await setup.renderOnce();
    await mouse.click(host.content.transcript.screenX + 3, host.content.transcript.screenY + 4);
    assert.equal(store.snapshot().focus, 'composer');
    const frame = setup.captureCharFrame();
    // Every authoritative card keeps the shared decision row; each click
    // resolves the approval that card names, not the oldest one.
    assert.equal(frame.split('a approve').length - 1, 2);
    assert.doesNotMatch(frame, /Resolve oldest approval first/);
    const firstRow = frame.split('\n')[host.content.approval.screenY + 3]!;
    await mouse.click(firstRow.indexOf('a approve'), host.content.approval.screenY + 3);
    await mouse.click(firstRow.indexOf('d deny'), host.content.approval.screenY + 3);
    assert.deepEqual(calls.resolveApproval, [['ap1', 'approved'], ['ap1', 'denied']]);
    const secondRow = frame.split('\n')[host.content.approval.screenY + 9]!;
    await mouse.click(secondRow.indexOf('a approve'), host.content.approval.screenY + 9);
    assert.deepEqual(calls.resolveApproval, [['ap1', 'approved'], ['ap1', 'denied'], ['ap2', 'approved']]);
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});
