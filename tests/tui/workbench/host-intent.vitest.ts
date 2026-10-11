import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { applyWorkbenchHostIntent, type WorkbenchHostPorts } from '../../../src/interfaces/tui/workbench/controller/host-intent.js';

function harness(overrides: Partial<WorkbenchHostPorts> = {}) {
  const store = new WorkbenchStore(createInitialWorkbenchUiState());
  const mocks = {
    repaint: vi.fn(),
    syncComposer: vi.fn(),
    overlayScrollLimit: vi.fn(() => 10),
    submitCoordination: vi.fn(),
    openBuiltinSurface: vi.fn(() => false),
    clearSlashHint: vi.fn(),
    submitSlash: vi.fn(),
    hasSnapshot: vi.fn(() => true),
    reportSubmitUnavailable: vi.fn(),
    setCancelArmed: vi.fn(),
    setPinnedBottom: vi.fn(),
    setTranscriptMode: vi.fn(),
    anchorTranscriptBottom: vi.fn(),
    emitUserTimeline: vi.fn(),
    submitTurn: vi.fn(),
    nextQueuedId: vi.fn(() => 'q1'),
    approvalTarget: vi.fn((): { id: string } | undefined => undefined),
    isApprovalDecisionPending: vi.fn(() => false),
    markApprovalDecision: vi.fn(),
    unmarkApprovalDecision: vi.fn(),
    resolveApproval: vi.fn(),
    cyclePermission: vi.fn(),
    refresh: vi.fn(),
    cancelActiveTurn: vi.fn(() => false),
  };
  const ports: WorkbenchHostPorts = { ...mocks, ...overrides };
  return { store, mocks, ports };
}

describe('applyWorkbenchHostIntent', () => {
  it('clamps overlay scroll and repaints', () => {
    const { store, mocks, ports } = harness();
    assert.equal(applyWorkbenchHostIntent(store, { type: 'overlay.scroll', delta: 999 }, ports), true);
    assert.equal(store.snapshot().overlayScrollOffset, 10);
    assert.equal(mocks.repaint.mock.calls.length, 1);
  });

  it('submits a turn through the ports in order', () => {
    const { store, mocks, ports } = harness();
    store.dispatch({ type: 'composer.insert', text: 'hello' });
    assert.equal(applyWorkbenchHostIntent(store, { type: 'turn.submit' }, ports), true);
    assert.equal(store.snapshot().composer.text, '');
    assert.deepEqual(mocks.emitUserTimeline.mock.calls[0], ['hello']);
    assert.deepEqual(mocks.submitTurn.mock.calls[0], ['hello']);
    assert.deepEqual(mocks.setCancelArmed.mock.calls[0], [false]);
    assert.deepEqual(mocks.setPinnedBottom.mock.calls[0], [true]);
  });

  it('reports an unavailable submission without a snapshot', () => {
    const { store, mocks, ports } = harness({ hasSnapshot: vi.fn(() => false) });
    assert.equal(applyWorkbenchHostIntent(store, { type: 'turn.submit' }, ports), true);
    assert.equal(mocks.reportSubmitUnavailable.mock.calls.length, 1);
    assert.equal(mocks.submitTurn.mock.calls.length, 0);
  });

  it('queues a follow-up with the host id', () => {
    const { store, ports } = harness();
    store.dispatch({ type: 'composer.insert', text: 'next' });
    applyWorkbenchHostIntent(store, { type: 'turn.queue' }, ports);
    assert.deepEqual(store.snapshot().queuedMessages.map((m) => m.id), ['q1']);
    assert.equal(store.snapshot().composer.text, '');
  });

  it('resolves an approval once, unmarking on failure', () => {
    const resolveApproval = vi.fn((_id: string, _decision: 'approved' | 'denied', onSettled: (h: boolean) => void) => onSettled(false));
    const { store, mocks, ports } = harness({ approvalTarget: vi.fn(() => ({ id: 'ap-1' })), resolveApproval });
    assert.equal(applyWorkbenchHostIntent(store, { type: 'approval.resolve', decision: 'approved' }, ports), true);
    assert.deepEqual(mocks.markApprovalDecision.mock.calls[0], ['ap-1']);
    assert.deepEqual(mocks.unmarkApprovalDecision.mock.calls[0], ['ap-1']);
    assert.deepEqual(resolveApproval.mock.calls[0]!.slice(0, 2), ['ap-1', 'approved']);
  });

  it('leaves unhandled intents to the caller', () => {
    const { store, ports } = harness();
    assert.equal(applyWorkbenchHostIntent(store, { type: 'drawer.move', direction: 1 }, ports), false);
    assert.equal(applyWorkbenchHostIntent(store, { type: 'unhandled' }, ports), false);
  });
});
