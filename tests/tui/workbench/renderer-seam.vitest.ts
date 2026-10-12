import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { WorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/types.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

describe('TuiApp OpenTUI renderer seam', () => {
  it('emits assembled view state instead of painting, and routes keys', () => {
    const frames: WorkbenchViewState[] = [];
    const { app, output, paint } = createWorkbenchRenderHarness('hello', {
      renderer: 'opentui',
      onWorkbenchFrame: (state) => frames.push(state),
    });
    paint();
    assert.equal(frames.length, 1);
    assert.ok(frames[0]!.roster);
    assert.ok(frames[0]!.transcript);
    assert.equal(output.writes.length, 0);

    app.routeWorkbenchKey('x');
    assert.equal(frames.at(-1)!.composer.composer.text, 'x');
  });

  it('routes paste into the composer and the coordination draft', () => {
    const { app, paint } = createWorkbenchRenderHarness('hello', { renderer: 'opentui' });
    paint();
    app.routeWorkbenchPaste('pasted');
    assert.equal(app.getWorkbenchStateForTest().composer.text, 'pasted');

    const store = (app as unknown as { workbenchStore: { dispatch(action: unknown): void } }).workbenchStore;
    store.dispatch({ type: 'overlay.toggle', overlay: 'coordination' });
    app.routeWorkbenchPaste('objective');
    assert.equal(app.getWorkbenchStateForTest().composer.text, 'pasted');
    assert.equal(app.getWorkbenchStateForTest().coordination.draft.text, 'objective');
  });

  it('routes clicks through Workbench state and rejects stale agent rows', () => {
    const { app, paint } = createWorkbenchRenderHarness('hello', { renderer: 'opentui' });
    paint();
    app.routeWorkbenchClick({ type: 'focus.set', focus: 'transcript' });
    app.routeWorkbenchClick({ type: 'transcript.filter', filter: 'tool' });
    assert.equal(app.getWorkbenchStateForTest().focus, 'transcript');
    assert.equal(app.getWorkbenchStateForTest().transcriptFilter, 'tool');

    app.routeWorkbenchClick({ type: 'agent.select', agentId: 'missing', scrollOffset: 0 });
    assert.equal(app.getWorkbenchStateForTest().selectedAgentId, undefined);
    const store = (app as unknown as { workbenchStore: { dispatch(action: unknown): void } }).workbenchStore;
    store.dispatch({ type: 'overlay.toggle', overlay: 'help' });
    app.routeWorkbenchClick({ type: 'focus.set', focus: 'composer' });
    assert.equal(app.getWorkbenchStateForTest().focus, 'modal');
  });
});
