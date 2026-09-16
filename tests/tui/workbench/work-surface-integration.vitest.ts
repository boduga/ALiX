import { describe, expect, it, vi } from 'vitest';
import { TuiApp, type TuiAppOptions } from '../../../src/tui/app.js';
import { MockInput, MockOutput } from '../../../src/tui/io.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeWorkbench(processTurn: (text: string) => Promise<any>, cancelActiveTurn = vi.fn(() => false)) {
  const snapshot = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: 'test', startedAt: 1, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null, cwd: '/workspace/ALiX',
  };
  const app = new TuiApp({
    builder: { build: async () => snapshot, buildSync: () => snapshot },
    daemonMetrics: { start: () => {}, stop: async () => {} },
    agentSession: { processTurn, cancelActiveTurn },
    input: new MockInput(),
    output: new MockOutput(),
    workbenchEnabled: true,
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buffer: Buffer): void;
    getStateForTest(): any;
    getWorkbenchStateForTest(): any;
  };
  internal.getStateForTest().lastSnapshot = snapshot;
  return { app, internal, cancelActiveTurn };
}

function type(internal: { handleRaw(buffer: Buffer): void }, text: string): void {
  for (const character of text) internal.handleRaw(Buffer.from(character));
}

describe('Workbench work surface integration', () => {
  it('keeps the pending approval card visible above a review overlay', () => {
    const { app, internal } = makeWorkbench(async () => ({ summary: 'unused' }));
    type(internal, '/review');
    internal.handleRaw(Buffer.from('\r'));
    internal.getStateForTest().lastSnapshot.approvals = {
      pending: [{ id: 'ap-visible', toolName: 'shell.run', target: 'npm test', requestedAt: 1, requestedBy: 'test' }],
      recentlyResolved: [], totalPending: 1, totalResolved: 0,
    };
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
