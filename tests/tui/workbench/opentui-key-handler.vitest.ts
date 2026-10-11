import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import type { WorkbenchHostPorts } from '../../../src/interfaces/tui/workbench/controller/host-intent.js';
import { handleOpenTuiKey, handleOpenTuiPaste, type OpenTuiInputDeps } from '../../../src/interfaces/tui/workbench/opentui/key-handler.js';
import type { OpenTuiKey } from '../../../src/interfaces/tui/workbench/opentui/input.js';

function deps() {
  const store = new WorkbenchStore(createInitialWorkbenchUiState());
  const ports = {
    repaint: vi.fn(), syncComposer: vi.fn(), overlayScrollLimit: vi.fn(() => 10), submitCoordination: vi.fn(),
    openBuiltinSurface: vi.fn(() => false), clearSlashHint: vi.fn(), submitSlash: vi.fn(), hasSnapshot: vi.fn(() => true),
    reportSubmitUnavailable: vi.fn(), setCancelArmed: vi.fn(), setPinnedBottom: vi.fn(), setTranscriptMode: vi.fn(),
    anchorTranscriptBottom: vi.fn(), emitUserTimeline: vi.fn(), submitTurn: vi.fn(), nextQueuedId: vi.fn(() => 'q1'),
    approvalTarget: vi.fn((): { id: string } | undefined => undefined), isApprovalDecisionPending: vi.fn(() => false),
    markApprovalDecision: vi.fn(), unmarkApprovalDecision: vi.fn(), resolveApproval: vi.fn(),
    cyclePermission: vi.fn(), refresh: vi.fn(), cancelActiveTurn: vi.fn(() => false),
  } satisfies WorkbenchHostPorts;
  const input: OpenTuiInputDeps = {
    store,
    signals: () => ({ turnActive: false, slashActive: false, approvalPending: false }),
    snapshot: () => undefined,
    ports,
    coordinationAvailable: true,
  };
  return { store, ports, input };
}

function key(overrides: Partial<OpenTuiKey> & { name: string }): OpenTuiKey {
  return { ctrl: false, meta: false, shift: false, option: false, sequence: '', ...overrides };
}

describe('handleOpenTuiKey', () => {
  it('inserts printable keys into the composer', () => {
    const { store, input } = deps();
    assert.equal(handleOpenTuiKey(key({ name: 'x', sequence: 'x' }), input), true);
    assert.equal(store.snapshot().composer.text, 'x');
  });

  it('opens the inspector on Ctrl+e', () => {
    const { store, input } = deps();
    assert.equal(handleOpenTuiKey(key({ name: 'e', ctrl: true }), input), true);
    assert.equal(store.snapshot().overlayStack.at(-1), 'inspector');
  });

  it('drops OS-owned modifier combos', () => {
    const { input } = deps();
    assert.equal(handleOpenTuiKey(key({ name: 'x', meta: true, sequence: 'x' }), input), false);
  });
});

describe('handleOpenTuiPaste', () => {
  it('inserts a normalized paste block at the cursor', () => {
    const { store, input } = deps();
    store.dispatch({ type: 'composer.insert', text: 'end' });
    store.dispatch({ type: 'composer.move', direction: 'start' });
    assert.equal(handleOpenTuiPaste({ bytes: new TextEncoder().encode('a\r\nb') }, input), true);
    assert.equal(store.snapshot().composer.text, 'a\nbend');
  });
});
