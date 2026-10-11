import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { applyWorkbenchIntent } from '../../../src/interfaces/tui/workbench/controller/intent.js';
import type { WorkbenchHostPorts } from '../../../src/interfaces/tui/workbench/controller/host-intent.js';
import type { SelectionSnapshot } from '../../../src/interfaces/tui/workbench/controller/selection-intent.js';

function harness() {
  const store = new WorkbenchStore(createInitialWorkbenchUiState());
  const mocks = {
    repaint: vi.fn(), syncComposer: vi.fn(), overlayScrollLimit: vi.fn(() => 10), submitCoordination: vi.fn(),
    openBuiltinSurface: vi.fn(() => false), clearSlashHint: vi.fn(), submitSlash: vi.fn(), hasSnapshot: vi.fn(() => true),
    reportSubmitUnavailable: vi.fn(), setCancelArmed: vi.fn(), setPinnedBottom: vi.fn(), setTranscriptMode: vi.fn(),
    anchorTranscriptBottom: vi.fn(), emitUserTimeline: vi.fn(), submitTurn: vi.fn(), nextQueuedId: vi.fn(() => 'q1'),
    approvalTarget: vi.fn((): { id: string } | undefined => undefined), isApprovalDecisionPending: vi.fn(() => false),
    markApprovalDecision: vi.fn(), unmarkApprovalDecision: vi.fn(), resolveApproval: vi.fn(),
    cyclePermission: vi.fn(), refresh: vi.fn(), cancelActiveTurn: vi.fn(() => false),
  };
  const ports: WorkbenchHostPorts = { ...mocks };
  const snapshot: SelectionSnapshot = { runtime: { agents: { agents: [
    { agentId: 'a1', coordinationRunId: 'r1', role: 'Researcher', state: 'thinking', ownedPaths: [], startedAt: 0, lastProgressAt: 0, usage: {} },
  ] } } };
  return { store, mocks, ports, snapshot };
}

function run(store: WorkbenchStore, ports: WorkbenchHostPorts, snapshot: SelectionSnapshot, intent: Parameters<typeof applyWorkbenchIntent>[1]) {
  return applyWorkbenchIntent(store, intent, { snapshot, ports, coordinationAvailable: true });
}

describe('applyWorkbenchIntent', () => {
  it('applies a store intent and its declared effects', () => {
    const { store, mocks, ports, snapshot } = harness();
    assert.equal(run(store, ports, snapshot, { type: 'composer.insert', text: 'hi' }), true);
    assert.equal(store.snapshot().composer.text, 'hi');
    assert.equal(mocks.syncComposer.mock.calls.length, 1);
    assert.equal(mocks.repaint.mock.calls.length, 1);
  });

  it('applies a host intent', () => {
    const { store, mocks, ports, snapshot } = harness();
    run(store, ports, snapshot, { type: 'permission.cycle' });
    assert.equal(mocks.cyclePermission.mock.calls.length, 1);
    assert.equal(mocks.refresh.mock.calls.length, 1);
  });

  it('applies a selection intent from the snapshot', () => {
    const { store, mocks, ports, snapshot } = harness();
    run(store, ports, snapshot, { type: 'agent.shortcut', index: 1 });
    assert.equal(store.snapshot().selectedAgentId, 'a1');
    assert.equal(mocks.repaint.mock.calls.length, 1);
  });

  it('toggles follow and anchors after starting', () => {
    const { store, mocks, ports, snapshot } = harness();
    const paused = new WorkbenchStore({ ...createInitialWorkbenchUiState(), followTail: false });
    run(paused, ports, snapshot, { type: 'transcript.follow.toggle' });
    assert.equal(paused.snapshot().followTail, true);
    assert.equal(mocks.anchorTranscriptBottom.mock.calls.length, 1);
    assert.equal(mocks.setPinnedBottom.mock.calls.at(-1)?.[0], true);
  });

  it('returns false for an unhandled intent', () => {
    const { store, ports, snapshot } = harness();
    assert.equal(run(store, ports, snapshot, { type: 'unhandled' }), false);
  });
});
