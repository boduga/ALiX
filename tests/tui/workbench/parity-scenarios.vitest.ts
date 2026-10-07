import { describe, expect, it, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../../src/tui/app.js';
import { MockInput, MockOutput } from '../../../src/tui/io.js';
import type { WorkbenchInspectableItem } from '../../../src/tui/workbench/model/artifact-inspection.js';
import { buildAgentInspectorModel } from '../../../src/tui/workbench/model/agent-inspector.js';
import { buildAgentInspectorSections } from '../../../src/tui/workbench/views/agent-inspector.js';
import { agent, paintInspectorFrame as paintInspector, scenarioSnapshot } from './parity-helpers.js';

// Shared `agent()` factory, roster-totals literal, `scenarioSnapshot()` and
// the stripped inspector paint live in parity-helpers.ts (shared with
// parity-charset.vitest.ts). `denyHarness` stays here: its TuiApp +
// approval-manager wiring is unique to this suite.

function denyHarness(tryHandleCommand: (command: string) => Promise<{ handled: boolean; message: string }>) {
  const snapshot = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: 'test', startedAt: 1, turns: 0 },
    daemon: null,
    approvals: {
      pending: [{ id: 'ap-deny', toolName: 'shell.run', target: 'npm test', args: {}, requestedAt: 1, requestedBy: 'operator' }],
      recentlyResolved: [], totalPending: 1, totalResolved: 0,
    },
    runtime: null, sops: null, policy: null, cwd: '/workspace/ALiX',
  };
  const app = new TuiApp({
    builder: { build: async () => snapshot, buildSync: () => snapshot },
    daemonMetrics: { start: () => {}, stop: async () => {} },
    agentSession: { processTurn: async () => ({ summary: 'unused' }), cancelActiveTurn: vi.fn(() => false) },
    approvalManager: { tryHandleCommand },
    input: new MockInput(),
    output: new MockOutput(),
    workbenchEnabled: true,
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buffer: Buffer): void;
    getStateForTest(): any;
    getWorkbenchStateForTest(): any;
    syncPendingApprovals(): void;
    workbenchStore: { dispatch(action: any): void };
  };
  internal.getStateForTest().lastSnapshot = snapshot;
  internal.syncPendingApprovals();
  return { internal };
}

describe('Phase 10 parity scenarios', () => {
  it('R01 empty/aggregate/missing agents — inspector renders distinct fallbacks, counts and activity rows', () => {
    const aggregate = buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a'), agent('b', { state: 'completed' })] }));
    expect(aggregate.selection).toBe('aggregate');
    expect(buildAgentInspectorSections(aggregate)[0]?.rows).toEqual([
      { label: 'Name', value: 'All agents' },
      { label: 'Agents', value: '2' },
      { label: 'Running', value: '1' },
    ]);
    const aggregateText = paintInspector(aggregate);
    expect(aggregateText).toContain('All agents');
    expect(aggregateText).toContain('Select an agent for activity');

    const empty = buildAgentInspectorModel(scenarioSnapshot({ agents: [] }));
    expect(empty.selection).toBe('aggregate');
    expect(empty.agentCount).toBe(0);
    expect(buildAgentInspectorSections(empty)[0]?.rows).toEqual([
      { label: 'Name', value: 'All agents' },
      { label: 'Agents', value: '0' },
      { label: 'Running', value: '0' },
    ]);

    const missing = buildAgentInspectorModel(scenarioSnapshot(), { selectedAgentId: 'gone' });
    expect(missing.selection).toBe('missing');
    expect(buildAgentInspectorSections(missing)[0]?.rows).toEqual([
      { label: 'Name', value: 'Selection unavailable' },
      { label: 'Agents', value: '1' },
      { label: 'Running', value: '1' },
    ]);
    const missingText = paintInspector(missing);
    expect(missingText).toContain('Selection unavailable');
    expect(missingText).toContain('Activity unavailable');

    const unavailable = buildAgentInspectorModel(scenarioSnapshot({ rosterUnavailable: true }));
    expect(unavailable.selection).toBe('unavailable');
    expect(buildAgentInspectorSections(unavailable)[0]?.rows).toEqual([
      { label: 'Name', value: 'Snapshot unavailable' },
      { label: 'Agents', value: 'unavailable' },
      { label: 'Running', value: 'unavailable' },
    ]);
    expect(paintInspector(unavailable)).toContain('Snapshot unavailable');
  });

  it.each([
    ['waiting', 'waiting'],
    ['waiting_approval', 'approval'],
    ['waiting_dependency', 'waiting'],
    ['failed', 'failed'],
    ['partial', 'partial'],
    ['cancelling', 'cancelling'],
    ['cancelled', 'cancelled'],
  ] as const)('R04 %s agent state — inspector derives the lifecycle word from presentation', (state, word) => {
    const model = buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a', { state })] }), { selectedAgentId: 'a' });
    const stateRow = buildAgentInspectorSections(model)[0]?.rows.find((row) => row.label === 'State');
    expect(stateRow?.value).toBe(word);
  });

  it('R04 painted inspector keeps failed, partial and cancelled words visible', () => {
    for (const [state, word] of [['failed', 'failed'], ['partial', 'partial'], ['cancelled', 'cancelled']] as const) {
      const text = paintInspector(buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a', { state })] }), { selectedAgentId: 'a' }));
      expect(text).toContain(word);
    }
  });

  it('R11 stale approval snapshot — inspector separates unavailable approvals from authoritative empty', () => {
    const unavailable = paintInspector(buildAgentInspectorModel(scenarioSnapshot({ approvals: null })));
    expect(unavailable).toContain('Approvals unavailable');
    expect(unavailable).not.toContain('No pending approvals');

    const empty = paintInspector(buildAgentInspectorModel(scenarioSnapshot()));
    expect(empty).toContain('No pending approvals');
    expect(empty).not.toContain('Approvals unavailable');
  });

  it('F04/R11 deny approval — d resolves through the approval manager and clears only after projection confirmation', async () => {
    const tryHandleCommand = vi.fn(async () => ({ handled: true, message: 'denied' }));
    const { internal } = denyHarness(tryHandleCommand);
    internal.workbenchStore.dispatch({ type: 'composer.replace', text: 'draft' });

    internal.handleRaw(Buffer.from('d'));
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledWith('/deny ap-deny'));
    internal.handleRaw(Buffer.from('d'));
    expect(tryHandleCommand).toHaveBeenCalledTimes(1);
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('draft');

    // The card survives while the pending projection still names the approval.
    internal.syncPendingApprovals();
    expect(internal.getStateForTest().views.agent.pendingApprovals.map((entry: { id: string }) => entry.id)).toEqual(['ap-deny']);

    internal.getStateForTest().lastSnapshot.approvals = {
      pending: [],
      recentlyResolved: [{
        id: 'ap-deny', toolName: 'shell.run', target: 'npm test', args: {},
        requestedAt: 1, requestedBy: 'operator', status: 'denied', resolvedAt: 2,
      }],
      totalPending: 0, totalResolved: 1,
    };
    internal.syncPendingApprovals();
    expect(internal.getStateForTest().views.agent.pendingApprovals).toEqual([]);
    expect(internal.getStateForTest().views.agent.resolvedApprovals[0]).toMatchObject({ id: 'ap-deny', status: 'denied' });
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('draft');
  });

  it('R02/R05/R12 long agent, task and artifact names stay bounded inside the inspector', () => {
    const longRole = 'agent-'.repeat(60);
    const longTask = 'implement responsive sidebar component variants for layout systems '.repeat(8);
    const longArtifact = `${'nested/'.repeat(40)}artifact.ts`;
    const artifact: WorkbenchInspectableItem = {
      id: 'art-long', kind: 'artifact', status: 'available', title: longArtifact,
      agentId: 'a', coordinationRunId: 'run1', createdAt: 1000, sourceSequence: 1,
    };
    const model = buildAgentInspectorModel(scenarioSnapshot({
      agents: [agent('a', { role: longRole, taskLabel: longTask })], artifacts: [artifact],
    }), { selectedAgentId: 'a' });

    const width = 48;
    const text = paintInspector(model, width, 40);
    const rows = text.split('\n');
    expect(rows.every((row) => row.length <= width)).toBe(true);
    expect(text).not.toContain(longRole);
    expect(text).not.toContain(longTask);
    expect(text).not.toContain(longArtifact);
    expect(text).toContain('Name');
    expect(text).toContain('Task');
    const taskRow = rows.findIndex((row) => row.includes('Task'));
    expect(taskRow).toBeGreaterThan(-1);
    expect(rows[taskRow + 1]).toMatch(/^│ {12}\S/u);
    expect(text).toMatch(/[…~]/u);
  });

  it('R12 deleted and unavailable artifacts — inspector reports status, empty and unavailable distinctly', () => {
    const items: readonly WorkbenchInspectableItem[] = [
      { id: 'gone', kind: 'artifact', status: 'unavailable', title: 'deleted.ts', agentId: 'a', coordinationRunId: 'run1', createdAt: 1000, sourceSequence: 1 },
      { id: 'broken', kind: 'artifact', status: 'failed', title: 'broken.ts', agentId: 'a', coordinationRunId: 'run1', createdAt: 1000, sourceSequence: 2 },
    ];
    const withStatus = paintInspector(buildAgentInspectorModel(scenarioSnapshot({ artifacts: items }), { selectedAgentId: 'a' }));
    expect(withStatus).toContain('deleted.ts (unavailable)');
    expect(withStatus).toContain('broken.ts (failed)');

    const deleted = paintInspector(buildAgentInspectorModel(scenarioSnapshot({ artifacts: [] }), { selectedAgentId: 'a' }));
    expect(deleted).toContain('No artifacts');
    expect(deleted).not.toContain('Artifacts unavailable');

    const absent = paintInspector(buildAgentInspectorModel(scenarioSnapshot({ artifacts: null }), { selectedAgentId: 'a' }));
    expect(absent).toContain('Artifacts unavailable');
    expect(absent).not.toContain('No artifacts');
  });

  it('R14/R16 usage/cost — inspector renders explicit zero, unavailable and partial aggregates distinctly', () => {
    const zero = buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a', { usage: { totalTokens: 0, costUsd: 0 } })] }), { selectedAgentId: 'a' });
    const zeroUsage = buildAgentInspectorSections(zero)[4]?.rows;
    expect(zeroUsage?.find((row) => row.label === 'Tokens')?.value).toBe('0');
    expect(zeroUsage?.find((row) => row.label === 'Cost')?.value).toBe('$0.0000');
    expect(zeroUsage?.find((row) => row.label === 'Context')?.value).toBe('unavailable');
    expect(paintInspector(zero)).toContain('$0.0000');

    const missing = buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a', { usage: {} })] }), { selectedAgentId: 'a' });
    const missingUsage = buildAgentInspectorSections(missing)[4]?.rows;
    expect(missingUsage?.find((row) => row.label === 'Tokens')?.value).toBe('unavailable');
    expect(missingUsage?.find((row) => row.label === 'Cost')?.value).toBe('unavailable');

    const partial = buildAgentInspectorModel(scenarioSnapshot({ agents: [agent('a', { usage: { totalTokens: 700, costUsd: 0.5 } }), agent('b', { usage: {} })] }));
    expect(partial.tokensPartial).toBe(true);
    expect(partial.costPartial).toBe(true);
    const partialText = paintInspector(partial);
    expect(partialText).toContain('700+');
    expect(partialText).toContain('$0.5000+');
  });
});
