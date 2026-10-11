import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { moveAgentSelection, moveArtifactSelection, moveRunSelection, moveTaskSelection, selectAgentShortcut, type SelectionSnapshot } from '../../../src/interfaces/tui/workbench/controller/selection-intent.js';

const snapshot: SelectionSnapshot = {
  runtime: {
    agents: { agents: [
      { agentId: 'a1', coordinationRunId: 'r1', role: 'Researcher', state: 'thinking', ownedPaths: [], startedAt: 0, lastProgressAt: 0, usage: {} },
      { agentId: 'a2', coordinationRunId: 'r2', role: 'Builder', state: 'completed', ownedPaths: [], startedAt: 0, lastProgressAt: 0, usage: {} },
    ] },
    tasks: { tasks: [
      { taskId: 't1', agentId: 'a1', coordinationRunId: 'r1', title: 'First', state: 'running', ownedPaths: [], createdAt: 0, updatedAt: 0 },
      { taskId: 't2', agentId: 'a1', coordinationRunId: 'r1', title: 'Second', state: 'queued', ownedPaths: [], createdAt: 0, updatedAt: 0 },
    ] },
    artifacts: { items: [
      { id: 'x1', kind: 'artifact', status: 'available', title: 'one', coordinationRunId: 'r1', agentId: 'a1', createdAt: 0, sourceSequence: 0 },
      { id: 'x2', kind: 'result', status: 'available', title: 'two', coordinationRunId: 'r2', createdAt: 0, sourceSequence: 0 },
    ] },
  },
};

describe('selection-intent', () => {
  it('selects an agent by 1-based shortcut and rejects out-of-range', () => {
    const state = createInitialWorkbenchUiState();
    assert.deepEqual(selectAgentShortcut(snapshot, state, 2), { agentId: 'a2', scrollOffset: 0 });
    assert.equal(selectAgentShortcut(snapshot, state, 5), undefined);
  });

  it('moves agent selection within the aggregate-first list', () => {
    const state = createInitialWorkbenchUiState();
    assert.deepEqual(moveAgentSelection(snapshot, state, 1), { agentId: 'a1', scrollOffset: 0 });
    assert.deepEqual(moveAgentSelection(snapshot, { ...state, selectedAgentId: 'a1' }, 1), { agentId: 'a2', scrollOffset: 0 });
  });

  it('moves task selection and returns undefined when empty', () => {
    const state = createInitialWorkbenchUiState();
    const moved = moveTaskSelection(snapshot, state, 1);
    assert.equal(moved?.taskId, 't1');
    const empty: SelectionSnapshot = { runtime: { tasks: { tasks: [] } } };
    assert.equal(moveTaskSelection(empty, state, 1), undefined);
  });

  it('moves artifact selection within the current scope', () => {
    const state = { ...createInitialWorkbenchUiState(), selectedRunId: 'r1' };
    const moved = moveArtifactSelection(snapshot, state, 1);
    assert.equal(moved?.artifactId, 'x1');
    assert.equal(moved?.runId, 'r1');
  });

  it('cycles run selection through aggregate and each run', () => {
    const state = createInitialWorkbenchUiState();
    assert.equal(moveRunSelection(snapshot, state, 1).runId, 'r1');
    assert.equal(moveRunSelection(snapshot, { ...state, selectedRunId: 'r2' }, 1).runId, undefined);
  });
});
