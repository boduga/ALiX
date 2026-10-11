import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { buildWorkbenchInputContext } from '../../../src/interfaces/tui/workbench/input/input-context.js';

const signals = { turnActive: false, slashActive: false, approvalPending: false };

describe('buildWorkbenchInputContext', () => {
  it('derives the base context from presentation state and signals', () => {
    const context = buildWorkbenchInputContext(createInitialWorkbenchUiState(), { turnActive: true, slashActive: true, approvalPending: true });
    assert.equal(context.turnActive, true);
    assert.equal(context.slashActive, true);
    assert.equal(context.approvalPending, true);
    assert.equal(context.focus, 'composer');
    assert.equal(context.drawer, 'closed');
    assert.equal(context.overlayOpen, false);
    assert.equal(context.inspectorOpen, false);
    assert.equal(context.coordinationOpen, false);
    assert.equal(context.coordinationBusy, false);
    assert.equal(context.transcriptMode, 'compact');
  });

  it('reads composer text and overlay stack top', () => {
    const state = {
      ...createInitialWorkbenchUiState(),
      composer: { text: '/help', cursor: 5 },
      overlayStack: ['diff', 'inspector'] as const,
      focus: 'modal' as const,
      coordination: { draft: { text: '', cursor: 0 }, phase: 'submitting' as const },
    };
    const context = buildWorkbenchInputContext(state, signals);
    assert.equal(context.composerText, '/help');
    assert.equal(context.overlayOpen, true);
    assert.equal(context.inspectorOpen, true);
    assert.equal(context.coordinationOpen, false);
    assert.equal(context.coordinationBusy, true);
    assert.equal(context.focus, 'modal');
  });
});
