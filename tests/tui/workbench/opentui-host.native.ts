import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import type { WorkbenchHostPorts } from '../../../src/interfaces/tui/workbench/controller/host-intent.js';
import { mountOpenTuiWorkbenchHost } from '../../../src/interfaces/tui/workbench/opentui/host.js';
import type { ContentState } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';

const chrome: OperatorShellSnapshot = { workspace: '/w', mode: 'auto', transcriptMode: 'compact', running: false, queuedMessages: 0 };

function stubPorts(): WorkbenchHostPorts {
  return {
    repaint: () => {}, syncComposer: () => {}, overlayScrollLimit: () => 10, submitCoordination: () => {},
    openBuiltinSurface: () => false, clearSlashHint: () => {}, submitSlash: () => {}, hasSnapshot: () => true,
    reportSubmitUnavailable: () => {}, setCancelArmed: () => {}, setPinnedBottom: () => {}, setTranscriptMode: () => {},
    anchorTranscriptBottom: () => {}, emitUserTimeline: () => {}, submitTurn: () => {}, nextQueuedId: () => 'q',
    approvalTarget: () => undefined, isApprovalDecisionPending: () => false, markApprovalDecision: () => {},
    unmarkApprovalDecision: () => {}, resolveApproval: () => {}, cyclePermission: () => {}, refresh: () => {},
    cancelActiveTurn: () => false,
  };
}

async function dispose(setup: TestRendererSetup): Promise<void> {
  setup.renderer.destroy();
  await (setup.renderer as typeof setup.renderer & { closed: Promise<void> }).closed;
}

test('OpenTUI host routes keys into the store and repaints', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const store = new WorkbenchStore(createInitialWorkbenchUiState());
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
      store,
      layoutState: () => ({ composer: contentState().composer, overlay: contentState().overlay }),
      contentState,
      signals: () => ({ turnActive: false, slashActive: false, approvalPending: false }),
      snapshot: () => undefined,
      ports: stubPorts(),
      coordinationAvailable: true,
    });

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
    await dispose(setup);
  }
});
