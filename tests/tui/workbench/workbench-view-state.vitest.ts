import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import { createInitialPerTabState, SessionPhase } from '../../../src/interfaces/tui/state.js';
import { assembleWorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/assemble.js';
import { projectOperatorShell } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';

function snapshot(runtime: DashboardSnapshot['runtime']): DashboardSnapshot {
  return {
    generatedAt: 100,
    session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 1 },
    daemon: null,
    approvals: {
      pending: [{ id: 'ap1', toolName: 'alix_shell_run', target: 'test', args: {}, requestedAt: 5, requestedBy: 'a1', agentId: 'a1' }],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    },
    runtime,
    sops: null,
    policy: null,
    cwd: '/workspace',
  };
}

const withRoster: DashboardSnapshot['runtime'] = {
  trace: [],
  timeline: [],
  workflow: null,
  totalEventCount: 3,
  lastEventAt: null,
  sessionId: 's',
  capabilities: null,
  metrics: null,
  context: null,
  agents: {
    agents: [{
      agentId: 'a1', coordinationRunId: 'r1', role: 'frontend', state: 'tool_running',
      ownedPaths: [], startedAt: 1, lastProgressAt: 2, usage: {},
      activeTool: { toolCallId: 't1', toolName: 'alix_file_read', startedAt: 1, lastProgressAt: 2, elapsedMs: 1 },
    }],
    active: 1,
    totals: { agents: 1, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
  },
  tasks: {
    tasks: [{ taskId: 'task1', agentId: 'a1', coordinationRunId: 'r1', title: 'Build UI', state: 'running', ownedPaths: [], createdAt: 1, updatedAt: 2 }],
    queued: 0, running: 1, blocked: 0,
  },
  artifacts: {
    items: [{ id: 'art1', kind: 'artifact', status: 'available', title: 'Report', coordinationRunId: 'r1', agentId: 'a1', createdAt: 1, sourceSequence: 1 }],
    artifacts: 1, results: 0, failed: 0,
  },
};

describe('assembleWorkbenchViewState', () => {
  it('composes roster, inspector, transcript, selection, overlay, and chrome from snapshot + ui', () => {
    const snap = snapshot(withRoster);
    const chrome = projectOperatorShell(snap, createInitialPerTabState());
    const ui = {
      ...createInitialWorkbenchUiState(),
      selectedRunId: 'r1',
      selectedAgentId: 'a1',
      selectedTaskId: 'task1',
      transcriptFilter: 'tool' as const,
      transcriptScope: 'selected' as const,
      followTail: false,
      drawer: 'agents' as const,
      focus: 'drawer' as const,
      overlayStack: ['diff'] as const,
    };

    const state = assembleWorkbenchViewState({
      snapshot: snap,
      ui,
      chrome,
      transcriptSource: { timeline: [], trace: [] },
    });

    expect(state.header).toBe(chrome);
    expect(state.footer).toBe(chrome);
    expect(state.focus).toBe('drawer');
    expect(state.roster.agents?.totals.agents).toBe(1);
    expect(state.roster.tasks?.running).toBe(1);
    expect(state.roster.artifacts?.artifacts).toBe(1);

    expect(state.selection).toEqual({
      selectedRunId: 'r1', selectedAgentId: 'a1', selectedTaskId: 'task1', selectedArtifactId: undefined,
    });
    expect(state.inspector.selection).toBe('selected');
    expect(state.inspector.agent?.agentId).toBe('a1');

    expect(state.transcript.mode).toBe('compact');
    expect(state.transcript.filter).toBe('tool');
    expect(state.transcript.scope).toBe('selected');
    expect(state.transcript.followTail).toBe(false);
    expect(Array.isArray(state.transcript.conversation.items)).toBe(true);

    expect(state.composer.composer).toBe(ui.composer);
    expect(state.composer.coordination).toBe(ui.coordination);
    expect(state.composer.queuedMessages).toBe(ui.queuedMessages);
    expect(state.approval).toHaveLength(1);
    expect(state.overlay.stack).toEqual(['diff']);
    expect(state.overlay.drawer).toBe('agents');
  });

  it('keeps aggregate selection and null read models distinct when runtime is absent', () => {
    const snap = snapshot(null);
    const ui = createInitialWorkbenchUiState();
    const state = assembleWorkbenchViewState({
      snapshot: snap,
      ui,
      chrome: projectOperatorShell(snap, createInitialPerTabState()),
      transcriptSource: { timeline: [], trace: [] },
    });

    expect(state.roster).toEqual({ agents: null, tasks: null, artifacts: null });
    expect(state.selection.selectedAgentId).toBeUndefined();
    expect(state.inspector.selection).toBe('unavailable');
    // Approvals are a top-level snapshot fact, independent of the runtime roster.
    expect(state.approval).toHaveLength(1);
    expect(state.overlay.stack).toEqual([]);
    expect(state.focus).toBe('composer');
  });

  it('maps the raw transcript mode to the projection compact/detailed input', () => {
    const snap = snapshot(null);
    const ui = { ...createInitialWorkbenchUiState(), transcriptMode: 'raw' as const };
    const state = assembleWorkbenchViewState({
      snapshot: snap,
      ui,
      chrome: projectOperatorShell(snap, createInitialPerTabState()),
      transcriptSource: { timeline: [], trace: [] },
    });
    expect(state.transcript.mode).toBe('raw');
    expect(state.inspector.selection).toBe('unavailable');
  });
});
