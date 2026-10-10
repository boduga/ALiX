import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing';
import type { WorkbenchDrawer } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { WorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/types.js';
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
