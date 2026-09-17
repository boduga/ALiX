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
  };
  internal.getStateForTest().lastSnapshot = snapshot;
  return { app, internal, cancelActiveTurn };
}

function type(internal: { handleRaw(buffer: Buffer): void }, text: string): void {
  for (const character of text) internal.handleRaw(Buffer.from(character));
}

describe('Workbench work surface integration', () => {
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
    await vi.waitFor(() => expect(tryHandleCommand).toHaveBeenCalledWith('approve ap-gap'));
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
});
