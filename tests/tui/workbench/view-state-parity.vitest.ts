import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import type { TimelineEntry } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import { createInitialPerTabState } from '../../../src/interfaces/tui/state.js';
import { assembleWorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/assemble.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { projectOperatorShell } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import { agent, roster } from './parity-helpers.js';

/**
 * Slice 3 semantic-parity evidence. The OpenTUI renderer is still experimental,
 * so parity is asserted on the shared boundary both renderers consume: the
 * four-worker transcripts, roster, tasks, artifacts, approvals, inspector join,
 * and operator presentation state must all survive in `WorkbenchViewState`.
 */
function fourWorkerSnapshot(): { snapshot: DashboardSnapshot; timeline: readonly TimelineEntry[] } {
  const base = createWorkbenchRenderHarness().state.lastSnapshot!;
  const timeline: TimelineEntry[] = [1, 2, 3, 4].map((n) => ({
    id: `message-${n}`, kind: 'agent.message', actor: 'assistant', sessionId: 's',
    text: `Report ${n} complete`, startedAt: n * 1000, agentId: `alix#${n}`,
    sourceEvents: { firstSequence: n, lastSequence: n },
  }));
  const agents = [1, 2, 3, 4].map((n) =>
    agent(`alix#${n}`, { state: 'completed', role: 'worker', coordinationRunId: 'run1', currentTaskId: `t${n}` }));
  const tasks = [1, 2, 3, 4].map((n) => ({
    taskId: `t${n}`, agentId: `alix#${n}`, assignedAgentId: `alix#${n}`, coordinationRunId: 'run1',
    title: `Report ${n}`, state: 'completed' as const, ownedPaths: [], createdAt: n, updatedAt: n,
  }));
  const artifacts = [1, 2, 3, 4].map((n) => ({
    id: `artifact-${n}`, kind: 'artifact' as const, status: 'available' as const, title: `Report ${n}`,
    coordinationRunId: 'run1', agentId: `alix#${n}`, taskId: `t${n}`, createdAt: n, sourceSequence: n,
  }));
  return {
    timeline,
    snapshot: {
      ...base, generatedAt: 10_000,
      approvals: {
        pending: [{ id: 'ap1', toolName: 'alix_shell_run', target: 'report', args: {}, requestedAt: 9_000, requestedBy: 'alix#2', agentId: 'alix#2' }],
        recentlyResolved: [], totalPending: 1, totalResolved: 0,
      },
      runtime: {
        ...base.runtime!, trace: [], timeline,
        agents: roster(agents, 0),
        tasks: { tasks, queued: 0, running: 0, blocked: 0 },
        artifacts: { items: artifacts, artifacts: 4, results: 0, failed: 0 },
      },
    },
  };
}

function assemble(snapshot: DashboardSnapshot, timeline: readonly TimelineEntry[], ui = createInitialWorkbenchUiState()) {
  return assembleWorkbenchViewState({
    snapshot, ui,
    chrome: projectOperatorShell(snapshot, createInitialPerTabState()),
    transcriptSource: { timeline, trace: [] },
  });
}

describe('WorkbenchViewState four-worker semantic parity', () => {
  it('carries transcript, roster, tasks, artifacts, and approvals', () => {
    const { snapshot, timeline } = fourWorkerSnapshot();
    const state = assemble(snapshot, timeline);

    expect(state.roster.agents?.agents).toHaveLength(4);
    expect(new Set(state.roster.agents?.agents.map((a) => a.agentId)).size).toBe(4);
    expect(state.roster.agents?.agents.every((a) => a.state === 'completed')).toBe(true);
    expect(state.roster.tasks?.tasks).toHaveLength(4);
    expect(state.roster.artifacts?.artifacts).toBe(4);

    expect(state.transcript.conversation.items.some((item) =>
      item.kind === 'assistant' && item.text.includes('Report 1'))).toBe(true);
    expect(state.approval.map((a) => a.id)).toEqual(['ap1']);
  });

  it('joins the selected worker to its task, artifacts, and approval', () => {
    const { snapshot, timeline } = fourWorkerSnapshot();
    const ui = { ...createInitialWorkbenchUiState(), selectedRunId: 'run1', selectedAgentId: 'alix#2' };
    const state = assemble(snapshot, timeline, ui);

    expect(state.inspector.selection).toBe('selected');
    expect(state.inspector.agent?.agentId).toBe('alix#2');
    expect(state.inspector.task?.taskId).toBe('t2');
    expect(state.inspector.artifacts?.map((a) => a.id)).toEqual(['artifact-2']);
    expect(state.inspector.approvals?.map((a) => a.id)).toEqual(['ap1']);
  });

  it('carries operator presentation state and is independent of terminal size', () => {
    const { snapshot, timeline } = fourWorkerSnapshot();
    const wide = assemble(snapshot, timeline, {
      ...createInitialWorkbenchUiState({ columns: 180, rows: 44 }),
      drawer: 'agents', focus: 'drawer', overlayStack: ['diagnostics'], transcriptFilter: 'activity',
    });
    const narrow = assemble(snapshot, timeline, createInitialWorkbenchUiState({ columns: 80, rows: 24 }));

    expect(wide.overlay.drawer).toBe('agents');
    expect(wide.focus).toBe('drawer');
    expect(wide.overlay.stack).toEqual(['diagnostics']);
    expect(wide.transcript.filter).toBe('activity');

    // Layout varies; the four-worker semantics do not.
    for (const state of [wide, narrow]) {
      expect(state.roster.agents?.agents).toHaveLength(4);
      expect(state.roster.tasks?.tasks).toHaveLength(4);
      expect(state.roster.artifacts?.artifacts).toBe(4);
      expect(state.approval).toHaveLength(1);
    }
  });
});
