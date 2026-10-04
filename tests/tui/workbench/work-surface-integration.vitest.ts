import { describe, expect, it, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../../src/tui/app.js';
import { MockInput, MockOutput } from '../../../src/tui/io.js';
import { buildWorkbenchApprovalCardLines } from '../../../src/tui/workbench/views/approval-dialog.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeWorkbench(
  processTurn: (text: string) => Promise<any>,
  cancelActiveTurn = vi.fn(() => false),
  approvalManager?: { tryHandleCommand(command: string): Promise<{ handled: boolean; message: string }> },
) {
  const snapshot = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: 'test', startedAt: 1, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null, cwd: '/workspace/ALiX',
  };
  const app = new TuiApp({
    builder: { build: async () => snapshot, buildSync: () => snapshot },
    daemonMetrics: { start: () => {}, stop: async () => {} },
    agentSession: { processTurn, cancelActiveTurn },
    approvalManager,
    input: new MockInput(),
    output: new MockOutput(),
    workbenchEnabled: true,
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buffer: Buffer): void;
    getStateForTest(): any;
    getWorkbenchStateForTest(): any;
    syncPendingApprovals(): void;
    reconcileWorkbenchSelection(): void;
    workbenchStore: { dispatch(action: any): void };
  };
  internal.getStateForTest().lastSnapshot = snapshot;
  return { app, internal, cancelActiveTurn };
}

function type(internal: { handleRaw(buffer: Buffer): void }, text: string): void {
  for (const character of text) internal.handleRaw(Buffer.from(character));
}

describe('Workbench work surface integration', () => {
  it('opens inspector without executing, restores drawer, opens bounded artifacts', () => {
    const turn = vi.fn(async () => ({ summary: 'unused' }));
    const { internal } = makeWorkbench(turn);
    type(internal, 'draft c / 123 ad?');
    internal.handleRaw(Buffer.from('\x01'));
    internal.handleRaw(Buffer.from('\x05'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ focus: 'modal', overlayStack: ['inspector'], drawer: 'agents' });
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ focus: 'drawer', overlayStack: [], drawer: 'agents' });
    internal.handleRaw(Buffer.from('\x05'));
    internal.handleRaw(Buffer.from('\x12'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ focus: 'drawer', overlayStack: [], drawer: 'artifacts', composer: { text: 'draft c / 123 ad?' } });
    expect(turn).not.toHaveBeenCalled();
  });

  it('keeps invalid slash text and restores failed submitted instruction without raw stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write');
    const turn = vi.fn(async () => { throw new Error('provider unavailable'); });
    const { internal } = makeWorkbench(turn);
    type(internal, '/');
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('/');
    internal.workbenchStore.dispatch({ type: 'composer.replace', text: 'retry instruction' });
    internal.getStateForTest().views.agent.inputBuffer = 'retry instruction';
    internal.handleRaw(Buffer.from('\r'));
    await vi.waitFor(() => expect(internal.getWorkbenchStateForTest().composer.text).toBe('retry instruction'));
    expect(turn).toHaveBeenCalledWith('retry instruction');
    expect(stderr.mock.calls.flat().join('')).not.toContain('[alix-tui] agent submit error');
    stderr.mockRestore();
  });

  it('retains later draft when foreground submission fails', async () => {
    let reject!: (err: Error) => void;
    const pending = new Promise<any>((_resolve, fail) => { reject = fail; });
    const { internal } = makeWorkbench(() => pending);
    type(internal, 'first'); internal.handleRaw(Buffer.from('\r'));
    type(internal, 'later draft'); reject(new Error('offline'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('later draft');
  });

  it('restores only after every candidate fails; successful fallback leaves composer clear', async () => {
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const dispatch = (app as any).dispatchToSession.bind(app);
    await dispatch('original', 'agent', internal.getStateForTest().views.agent, [async () => { throw new Error('first failed'); }, async () => ({ summary: 'fallback accepted' })], '[agent]');
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('');
    await dispatch('no provider', 'agent', internal.getStateForTest().views.agent, [], '[agent]');
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('no provider');
  });

  it.each(['inspector', 'help', 'diagnostics'])('paints preserved authoritative approval above %s overlay', (overlay) => {
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.getStateForTest().views.agent.pendingApprovals = [{ id: 'pending-card', toolName: 'shell.run', target: 'check workspace', requestedAt: 1 }];
    internal.workbenchStore.dispatch({ type: 'overlay.toggle', overlay });
    (app as any).paintFullFrame();
    const frame = ((app as any).output as MockOutput).writes.join('').replace(/\x1b\[[0-9;]*m/gu, '');
    expect(frame).toContain('APPROVAL REQUIRED');
    expect(frame).toContain('pending-card');
    expect(frame).toContain('a approve · d deny');
  });

  it('bounds help scroll at visible end so one Up immediately changes content', () => {
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.workbenchStore.dispatch({ type: 'overlay.toggle', overlay: 'help' });
    (app as any).paintFullFrame();
    for (let i = 0; i < 20; i++) internal.handleRaw(Buffer.from('\x1b[6~'));
    const max = (app as any).framePainter.overlayScrollLimit;
    expect(max).toBeGreaterThan(0);
    expect(internal.getWorkbenchStateForTest().overlayScrollOffset).toBe(max);
    internal.handleRaw(Buffer.from('\x1b[A'));
    expect(internal.getWorkbenchStateForTest().overlayScrollOffset).toBe(max - 1);
  });

  it.each([false,true])('closes an open drawer before cancel after Ctrl+F changes focus (active: %s)', active => {
    const pending = deferred<any>(); const cancel = vi.fn(() => true);
    const { internal } = makeWorkbench(() => pending.promise, cancel);
    if (active) { type(internal, 'work'); internal.handleRaw(Buffer.from('\r')); }
    internal.handleRaw(Buffer.from('\x01'));
    internal.handleRaw(Buffer.from('\x06'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'agents', focus: 'transcript' });
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'closed', focus: 'composer' });
    expect(cancel).not.toHaveBeenCalled();
    pending.resolve({ summary: 'done' });
  });

  it('closes an idle drawer through raw Escape', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.handleRaw(Buffer.from('\x01'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'agents', focus: 'drawer' });
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'closed', focus: 'composer' });
  });

  it('closes an active drawer before a second Escape cancels the foreground turn', async () => {
    const pending = deferred<any>();
    const cancel = vi.fn(() => true);
    const { internal } = makeWorkbench(() => pending.promise, cancel);
    type(internal, 'work');
    internal.handleRaw(Buffer.from('\r'));
    internal.handleRaw(Buffer.from('\x01'));
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'closed', focus: 'composer' });
    expect(cancel).not.toHaveBeenCalled();
    internal.handleRaw(Buffer.from('\x1b'));
    expect(cancel).toHaveBeenCalledWith('operator pressed Escape');
    pending.resolve({ summary: 'cancelled' });
  });
  it.each([true, false])('resolves the globally displayed approval while inspecting another worker (frontend pending: %s)', async frontendPending => {
    const tryHandleCommand = vi.fn(async () => ({ handled: true, message: 'approved' }));
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }), vi.fn(() => false), { tryHandleCommand });
    const backend = { id: 'ap-backend', toolName: 'shell.run', target: 'backend check', requestedAt: 1, agentId: 'backend' };
    const frontend = { id: 'ap-frontend', toolName: 'shell.run', target: 'frontend check', requestedAt: 2, agentId: 'frontend' };
    internal.getStateForTest().views.agent.pendingApprovals = [backend, ...(frontendPending ? [frontend] : [])];
    internal.workbenchStore.dispatch({ type: 'agent.select', agentId: 'frontend', scrollOffset: 0 });
    internal.workbenchStore.dispatch({ type: 'transcript.scope.toggle' });
    internal.workbenchStore.dispatch({ type: 'transcript.filter', filter: 'error' });
    const output = (app as any).output as MockOutput;
    (app as any).paintFullFrame();
    expect(output.writes.join('').replace(/\x1b\[[0-9;]*m/gu, '')).toContain('ap-backend');
    internal.handleRaw(Buffer.from('a'));
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledWith('/approve ap-backend'));
    expect(tryHandleCommand).toHaveBeenCalledTimes(1);
    expect(internal.getStateForTest().views.agent.pendingApprovals[0].id).toBe('ap-backend');
  });
  it('keeps transcript controls separate from composer and inspector selection', () => {
    const processTurn = vi.fn(async () => ({ summary: 'unused' }));
    const { internal } = makeWorkbench(processTurn);
    type(internal, '12345sf');
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('12345sf');
    internal.workbenchStore.dispatch({ type: 'agent.select', agentId: 'frontend', scrollOffset: 0 });
    internal.handleRaw(Buffer.from('\x06'));
    expect(internal.getWorkbenchStateForTest().focus).toBe('transcript');
    internal.handleRaw(Buffer.from('3'));
    internal.handleRaw(Buffer.from('s'));
    internal.handleRaw(Buffer.from('f'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({
      transcriptFilter: 'tool', transcriptScope: 'selected', followTail: false,
      selectedAgentId: 'frontend', composer: { text: '12345sf' },
    });
    expect(internal.getStateForTest().views.agent.pinnedBottom).toBe(false);
    internal.handleRaw(Buffer.from('f'));
    expect(internal.getWorkbenchStateForTest().followTail).toBe(true);
    expect(internal.getStateForTest().views.agent.pinnedBottom).toBe(true);
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest().focus).toBe('composer');
    expect(processTurn).not.toHaveBeenCalled();
  });

  it('synchronizes follow with manual scroll and End while transcript focused', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const per = internal.getStateForTest().views.agent;
    (internal as unknown as { agentRuntime: unknown }).agentRuntime = {
      timeline: Array.from({ length: 60 }, (_, index) => ({ id: `message-${index}`, kind: 'agent.response',
        text: `message ${index}`, startedAt: index, sessionId: 'test', sourceEvents: { firstSequence: index + 1 } })), trace: [],
    };
    internal.handleRaw(Buffer.from('\x06'));
    internal.handleRaw(Buffer.from('\x1b[A'));
    expect(internal.getWorkbenchStateForTest().followTail).toBe(false);
    expect(per.pinnedBottom).toBe(false);
    expect(per.scrollOffset).toBeGreaterThan(0);
    internal.handleRaw(Buffer.from('\x1b[F'));
    expect(internal.getWorkbenchStateForTest().followTail).toBe(true);
    expect(per.pinnedBottom).toBe(true);
  });

  it('preserves active Escape cancellation while transcript focused', async () => {
    const pending = deferred<any>();
    const cancel = vi.fn(() => true);
    const { internal } = makeWorkbench(() => pending.promise, cancel);
    type(internal, 'work');
    internal.handleRaw(Buffer.from('\r'));
    internal.handleRaw(Buffer.from('\x06'));
    internal.handleRaw(Buffer.from('\x1b'));
    expect(cancel).toHaveBeenCalledWith('operator pressed Escape');
    expect(internal.getWorkbenchStateForTest().focus).toBe('transcript');
    pending.resolve({ summary: 'cancelled' });
  });
  it('opens artifact inspection and navigates correlated results', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.getStateForTest().lastSnapshot.runtime = {
      agents: null, tasks: null,
      artifacts: {
        artifacts: 1, results: 1, failed: 0,
        items: [
          { id: 'artifact-1', kind: 'artifact', status: 'available', title: 'Report', coordinationRunId: 'run-1', agentId: 'agent-1', createdAt: 1, sourceSequence: 1 },
          { id: 'result-1', kind: 'result', status: 'available', title: 'Worker result', coordinationRunId: 'run-1', agentId: 'agent-1', createdAt: 2, sourceSequence: 2 },
        ],
      },
    };

    type(internal, '/artifacts');
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'artifacts', focus: 'drawer' });
    internal.handleRaw(Buffer.from('j'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({
      selectedRunId: 'run-1', selectedAgentId: 'agent-1', selectedArtifactId: 'artifact-1',
    });
    internal.handleRaw(Buffer.from('j'));
    expect(internal.getWorkbenchStateForTest().selectedArtifactId).toBe('result-1');
  });

  it('opens artifact inspection with Ctrl+R', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.handleRaw(Buffer.from('\x12'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer: 'artifacts', focus: 'drawer' });
  });

  it('does not add artifact-only correlation ids to global run cycling', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.getStateForTest().lastSnapshot.runtime = {
      agents: {
        active: 1,
        totals: { agents: 1, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
        agents: [{ agentId: 'agent-1', coordinationRunId: 'run-1', role: 'worker', state: 'thinking', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} }],
      },
      tasks: null,
      artifacts: {
        artifacts: 1, results: 0, failed: 0,
        items: [{ id: 'artifact-2', kind: 'artifact', status: 'available', title: 'Detached', coordinationRunId: 'run-2', createdAt: 1, sourceSequence: 1 }],
      },
    };
    internal.handleRaw(Buffer.from('\x12'));
    internal.handleRaw(Buffer.from(']'));
    expect(internal.getWorkbenchStateForTest().selectedRunId).toBe('run-1');
    internal.handleRaw(Buffer.from(']'));
    expect(internal.getWorkbenchStateForTest().selectedRunId).toBeUndefined();
  });

  it('reconciles a vanished run before preserving still-valid agent and task focus', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.getStateForTest().lastSnapshot.runtime = {
      agents: {
        active: 1,
        totals: { agents: 1, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
        agents: [{ agentId: 'agent-1', coordinationRunId: 'run-1', role: 'worker', state: 'thinking', ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} }],
      },
      tasks: { queued: 0, running: 1, blocked: 0, tasks: [{ taskId: 'task-1', agentId: 'agent-1', coordinationRunId: 'run-1', title: 'Work', state: 'running', ownedPaths: [], createdAt: 1, updatedAt: 1 }] },
    };
    internal.workbenchStore.dispatch({ type: 'run.select', runId: 'run-1' });
    internal.workbenchStore.dispatch({ type: 'task.select', taskId: 'task-1', agentId: 'agent-1', scrollOffset: 0 });

    internal.getStateForTest().lastSnapshot.runtime.agents.agents[0].coordinationRunId = 'run-2';
    internal.getStateForTest().lastSnapshot.runtime.tasks.tasks[0].coordinationRunId = 'run-2';
    internal.reconcileWorkbenchSelection();

    expect(internal.getWorkbenchStateForTest()).toMatchObject({ selectedAgentId: 'agent-1', selectedTaskId: 'task-1' });
    expect(internal.getWorkbenchStateForTest().selectedRunId).toBeUndefined();
  });

  it('preserves pending approvals while the approval snapshot is unavailable', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const pending = { id: 'ap-persist', toolName: 'shell.run', target: 'npm test', requestedAt: 1 };
    internal.getStateForTest().views.agent.pendingApprovals = [pending];
    internal.getStateForTest().lastSnapshot.approvals = null;

    internal.syncPendingApprovals();

    expect(internal.getStateForTest().views.agent.pendingApprovals).toEqual([pending]);
  });

  it('retains approval routing through a transient empty pending sample', async () => {
    const tryHandleCommand = vi.fn(async () => ({ handled: true, message: 'approved' }));
    const { internal } = makeWorkbench(
      async () => ({ summary: 'unused' }),
      vi.fn(() => false),
      { tryHandleCommand },
    );
    const pending = { id: 'ap-gap', toolName: 'shell.run', target: 'npm test', requestedAt: 1 };
    internal.getStateForTest().views.agent.pendingApprovals = [pending];
    internal.getStateForTest().lastSnapshot.approvals = {
      pending: [],
      recentlyResolved: [],
      totalPending: 0,
      totalResolved: 0,
    };

    internal.syncPendingApprovals();
    expect(internal.getStateForTest().views.agent.pendingApprovals).toEqual([pending]);

    internal.handleRaw(Buffer.from('a'));
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledWith('/approve ap-gap'));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('');
  });

  it('suppresses duplicate approval decisions until projection confirmation', async () => {
    const decision = deferred<{ handled: boolean; message: string }>();
    const tryHandleCommand = vi.fn(() => decision.promise);
    const { internal } = makeWorkbench(
      async () => ({ summary: 'unused' }),
      vi.fn(() => false),
      { tryHandleCommand },
    );
    internal.getStateForTest().views.agent.pendingApprovals = [
      { id: 'ap-once', toolName: 'shell.run', target: 'npm test', requestedAt: 1 },
    ];

    internal.handleRaw(Buffer.from('a'));
    internal.handleRaw(Buffer.from('a'));
    expect(tryHandleCommand).toHaveBeenCalledTimes(1);

    decision.resolve({ handled: true, message: 'approved' });
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledTimes(1));
    internal.getStateForTest().lastSnapshot.approvals = {
      pending: [],
      recentlyResolved: [{ id: 'ap-once', toolName: 'shell.run', target: 'npm test', requestedAt: 1, status: 'approved', resolvedAt: 2 }],
      totalPending: 0,
      totalResolved: 1,
    };
    internal.syncPendingApprovals();
    expect(internal.getStateForTest().views.agent.pendingApprovals).toEqual([]);
  });

  it('allows an approval decision retry when the resolver does not handle it', async () => {
    const tryHandleCommand = vi.fn()
      .mockResolvedValueOnce({ handled: false, message: 'not handled' })
      .mockResolvedValueOnce({ handled: true, message: 'approved' });
    const { internal } = makeWorkbench(
      async () => ({ summary: 'unused' }),
      vi.fn(() => false),
      { tryHandleCommand },
    );
    internal.getStateForTest().views.agent.pendingApprovals = [
      { id: 'ap-retry', toolName: 'shell.run', target: 'npm test', requestedAt: 1 },
    ];

    internal.handleRaw(Buffer.from('a'));
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect((internal as any).pendingApprovalDecisions.size).toBe(0));
    internal.handleRaw(Buffer.from('a'));
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledTimes(2));
  });

  it('keeps a pending approval card stable across timer refreshes', () => {
    const approval = { id: 'ap-stable', toolName: 'shell.run', target: 'npm test', requestedAt: 1 };

    const first = buildWorkbenchApprovalCardLines(approval, 1, 76, 1_001);
    const later = buildWorkbenchApprovalCardLines(approval, 1, 76, 61_001);

    expect(later).toEqual(first);
    expect(first.join('\n')).toContain('pending · id ap-stable');
  });

  it('renders a pending approval inline on the agent work surface', () => {
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    internal.getStateForTest().lastSnapshot.approvals = {
      pending: [{ id: 'ap-visible', toolName: 'shell.run', target: 'npm test', requestedAt: 1, requestedBy: 'test' }],
      recentlyResolved: [], totalPending: 1, totalResolved: 0,
    };
    internal.syncPendingApprovals();
    const output = (app as any).output as MockOutput;
    output.writes.length = 0;
    (app as any).paintFullFrame();
    const rendered = output.writes.join('').replace(/\x1b\[[0-9;]*m/gu, '');
    expect(rendered).toContain('APPROVAL REQUIRED');
    expect(rendered).toContain('ap-visible');
    expect(rendered).toContain('shell.run');
  });
  it('isolates diagnostics from navigation, editing, and bracketed paste', () => {
    const processTurn = vi.fn(async () => ({ summary: 'unused' }));
    const { internal } = makeWorkbench(processTurn);
    type(internal, '/review');
    internal.handleRaw(Buffer.from('\r'));
    const before = internal.getWorkbenchStateForTest();
    for (const raw of ['x', '\t', '\x1b[Z', '\x1b[13;2u', '\x7f', '\x01', '\x14', '\x0f', '\r', '\x1b[200~pasted\x1b[201~']) {
      internal.handleRaw(Buffer.from(raw));
    }
    expect(internal.getStateForTest().activeTab).toBe('agent');
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('');
    expect(internal.getWorkbenchStateForTest()).toEqual(before);
    expect(processTurn).not.toHaveBeenCalled();
    internal.handleRaw(Buffer.from('\x1b'));
    type(internal, 'after');
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('after');
  });
  it('starts on the unified agent surface and submits multiline input once', async () => {
    const processTurn = vi.fn(async (text: string) => ({ summary: `done:${text}` }));
    const { internal } = makeWorkbench(processTurn);

    expect(internal.getStateForTest().activeTab).toBe('agent');
    type(internal, 'first');
    internal.handleRaw(Buffer.from('\x1b[13;2u'));
    type(internal, 'second');
    internal.handleRaw(Buffer.from('\r'));
    await vi.waitFor(() => expect(processTurn).toHaveBeenCalledTimes(1));

    expect(processTurn).toHaveBeenCalledWith('first\nsecond');
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('');
  });

  it('accepts and erases complete Unicode graphemes', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    const accent = `e\u0301`;

    internal.handleRaw(Buffer.from(emoji));
    internal.handleRaw(Buffer.from(accent));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe(emoji + accent);
    internal.handleRaw(Buffer.from('\x7f'));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe(emoji);
    internal.handleRaw(Buffer.from('\x7f'));
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('');
  });

  it('moves the cursor by grapheme and inserts within the composer', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    internal.handleRaw(Buffer.from('A'));
    internal.handleRaw(Buffer.from(emoji));
    internal.handleRaw(Buffer.from('B'));
    internal.handleRaw(Buffer.from('\x1b[D'));
    internal.handleRaw(Buffer.from('\x1b[D'));
    internal.handleRaw(Buffer.from('x'));
    expect(internal.getWorkbenchStateForTest().composer).toEqual({ text: `Ax${emoji}B`, cursor: 2 });
    expect(internal.getStateForTest().activeTab).toBe('agent');
    internal.handleRaw(Buffer.from('\x1b[F'));
    expect(internal.getWorkbenchStateForTest().composer.cursor).toBe(`Ax${emoji}B`.length);
    internal.handleRaw(Buffer.from('\x1b[H'));
    expect(internal.getWorkbenchStateForTest().composer.cursor).toBe(0);
  });

  it('deletes the complete grapheme after the cursor', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    internal.handleRaw(Buffer.from('A'));
    internal.handleRaw(Buffer.from(emoji));
    internal.handleRaw(Buffer.from('B'));
    internal.handleRaw(Buffer.from('\x1b[H'));
    internal.handleRaw(Buffer.from('\x1b[C'));
    internal.handleRaw(Buffer.from('\x1b[3~'));
    expect(internal.getWorkbenchStateForTest().composer).toEqual({ text: 'AB', cursor: 1 });
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('AB');
  });

  it('inserts normalized bracketed paste at the Workbench cursor', () => {
    const { internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    internal.handleRaw(Buffer.from('A'));
    internal.handleRaw(Buffer.from(emoji));
    internal.handleRaw(Buffer.from('B'));
    internal.handleRaw(Buffer.from('\x1b[D'));
    internal.handleRaw(Buffer.from('\x1b[200~first\r\nsecond\x1b[201~'));

    const pasted = 'first\nsecond';
    expect(internal.getWorkbenchStateForTest().composer).toEqual({
      text: `A${emoji}${pasted}B`,
      cursor: `A${emoji}${pasted}`.length,
    });
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe(`A${emoji}${pasted}B`);
  });

  it('queues active-turn follow-ups and drains them FIFO after settlement', async () => {
    const first = deferred<any>();
    const processTurn = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ summary: 'second done' });
    const { internal } = makeWorkbench(processTurn);

    type(internal, 'first');
    internal.handleRaw(Buffer.from('\r'));
    await vi.waitFor(() => expect(processTurn).toHaveBeenCalledTimes(1));
    type(internal, 'second');
    internal.handleRaw(Buffer.from('\r'));

    expect(internal.getWorkbenchStateForTest().queuedMessages.map((message: any) => message.text)).toEqual(['second']);
    expect(processTurn).toHaveBeenCalledTimes(1);

    first.resolve({ summary: 'first done' });
    await vi.waitFor(() => expect(processTurn).toHaveBeenCalledTimes(2));
    expect(processTurn.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
    expect(internal.getWorkbenchStateForTest().queuedMessages).toEqual([]);
  });

  it('uses first Ctrl+C to cancel foreground work', async () => {
    const first = deferred<any>();
    const cancelActiveTurn = vi.fn(() => true);
    const { internal } = makeWorkbench(() => first.promise, cancelActiveTurn);
    type(internal, 'work');
    internal.handleRaw(Buffer.from('\r'));
    await vi.waitFor(() => expect(internal.getWorkbenchStateForTest().composer.text).toBe(''));

    internal.handleRaw(Buffer.from('\x03'));
    expect(cancelActiveTurn).toHaveBeenCalledWith('operator pressed Ctrl+C');
    first.resolve({ summary: 'cancelled' });
  });

  it('submits when Enter arrives coalesced as CRLF in a single read', async () => {
    // Terminals/multiplexers may deliver CR+LF in one chunk; parseKey must
    // still recognise it as Enter. Previously the keystroke was dropped with
    // the composer left populated and no turn dispatched.
    const processTurn = vi.fn(async (_text: string) => ({ summary: 'ok' }));
    const { internal } = makeWorkbench(processTurn);
    type(internal, 'Is docker installed');
    internal.handleRaw(Buffer.from('\r\n'));
    await vi.waitFor(() => expect(processTurn).toHaveBeenCalledTimes(1));
    expect(processTurn.mock.calls.map((call) => call[0])).toEqual(['Is docker installed']);
    expect(internal.getWorkbenchStateForTest().composer.text).toBe('');
  });

  it('opens built-in diff review without dispatching an agent turn', () => {
    const processTurn = vi.fn(async () => ({ summary: 'unused' }));
    const { internal } = makeWorkbench(processTurn);
    type(internal, '/review');
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.getWorkbenchStateForTest().overlayStack).toEqual(['review']);
    expect(processTurn).not.toHaveBeenCalled();
    internal.handleRaw(Buffer.from('\x1b'));
    expect(internal.getWorkbenchStateForTest().overlayStack).toEqual([]);
  });

  it.each([
    ['/agents', 'agents'],
    ['/tasks', 'tasks'],
  ] as const)('opens the %s drawer without dispatching an agent turn', (command, drawer) => {
    const processTurn = vi.fn(async () => ({ summary: 'unused' }));
    const { internal } = makeWorkbench(processTurn);
    type(internal, command);
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.getWorkbenchStateForTest()).toMatchObject({ drawer, focus: 'drawer', composer: { text: '', cursor: 0 } });
    expect(processTurn).not.toHaveBeenCalled();
  });
});
