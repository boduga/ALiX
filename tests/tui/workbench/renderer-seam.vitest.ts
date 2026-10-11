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

    assert.equal(app.routeWorkbenchKey('x'), true);
    assert.equal(frames.at(-1)!.composer.composer.text, 'x');
  });
});
