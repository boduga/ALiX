import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockMouse, createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
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

function mount(setup: TestRendererSetup, dimensions = { columns: 120, rows: 30 }): Harness {
  const store = new WorkbenchStore(createInitialWorkbenchUiState(dimensions));
  const { ports, calls } = makePorts();
  const signals = { turnActive: false, slashActive: false, approvalPending: false };
  const keys: string[] = [];
  const contentState = (): ContentState => {
    const state = store.snapshot();
    return {
      header: chrome, footer: chrome,
      roster: { agents: null, tasks: null, artifacts: null },
      transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: state.transcriptMode, filter: 'all', scope: 'all', followTail: state.followTail },
      inspector: { selection: 'aggregate', explicitTaskSelection: false, approvals: [], artifacts: [], tokensPartial: false, costPartial: false },
      composer: { composer: state.composer, coordination: state.coordination, queuedMessages: state.queuedMessages },
      approval: [],
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
