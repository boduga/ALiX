import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { OperatorShellSnapshot } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import { mountOpenTuiWorkbenchHost } from '../../../src/interfaces/tui/workbench/opentui/host.js';
import type { ContentState } from '../../../src/interfaces/tui/workbench/opentui/workbench-content.js';
import { disposeTestRenderer } from './opentui-native-harness.js';

const chrome: OperatorShellSnapshot = { workspace: '/w', mode: 'auto', transcriptMode: 'compact', running: false, queuedMessages: 0 };

function view() {
  const state = createInitialWorkbenchUiState({ columns: 120, rows: 30 });
  const contentState = (): ContentState => ({
    header: chrome, footer: chrome,
    roster: { agents: null, tasks: null, artifacts: null },
    transcript: { conversation: { items: [], hiddenDiagnostics: 0 }, mode: state.transcriptMode, filter: 'all', scope: 'all', followTail: state.followTail },
    inspector: { selection: 'aggregate', explicitTaskSelection: false, approvals: [], artifacts: [], tokensPartial: false, costPartial: false },
    composer: { composer: state.composer, coordination: state.coordination, queuedMessages: state.queuedMessages },
    approval: [],
    selection: {},
    overlay: { stack: state.overlayStack, scrollOffset: state.overlayScrollOffset, drawer: state.drawer, drawerScrollOffset: state.drawerScrollOffset, agentRosterExpanded: state.agentRosterExpanded },
  });
  return { layoutState: () => ({ composer: contentState().composer, overlay: contentState().overlay }), contentState };
}

test('OpenTUI host forwards normalized keys and paste to the controller', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 });
  try {
    const { layoutState, contentState } = view();
    const keys: string[] = [];
    const pastes: string[] = [];
    const host = mountOpenTuiWorkbenchHost(setup.renderer, {
      layoutState,
      contentState,
      onKey: (key) => { keys.push(key); return true; },
      onPaste: (text) => { pastes.push(text); return true; },
    });
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Composer/);

    await setup.mockInput.typeText('hi');
    assert.deepEqual(keys, ['h', 'i']);
    setup.mockInput.pressKey('e', { ctrl: true });
    assert.equal(keys.at(-1), 'Ctrl+e');
    assert.equal(keys.includes('Ctrl+E'), false);

    setup.renderer.keyInput.processPaste(new TextEncoder().encode('a\r\nb'));
    assert.deepEqual(pastes, ['a\nb']);

    assert.equal(host.layout.regions.transcript.visible, true);
    host.dispose();
  } finally {
    await disposeTestRenderer(setup);
  }
});
