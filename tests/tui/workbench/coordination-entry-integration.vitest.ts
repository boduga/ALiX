import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

function fixture() {
  const harness = createWorkbenchRenderHarness();
  let release!: (value: unknown) => void;
  const runCoordination = vi.fn((_input: { goal: string }) => new Promise(resolve => { release = resolve; }));
  const processTurn = vi.fn();
  const cancelActiveTurn = vi.fn(() => true);
  const internal = harness.app as any;
  internal.opts.agentSession = { runCoordination, processTurn, cancelActiveTurn };
  vi.spyOn(internal.framePainter, 'paintFullFrame').mockImplementation(() => {});
  const raw = (text: string) => {
    if (text.startsWith('\x1b')) internal.handleRaw(Buffer.from(text));
    else for (const character of text) internal.handleRaw(Buffer.from(character));
  };
  return { ...harness, raw, runCoordination, processTurn, cancelActiveTurn,
    finish: () => release({ summary: 'Coordination complete', sessionId: 'test', toolCalls: [] }) };
}

describe('Workbench explicit coordination entry', () => {
  it('opens on c, edits an isolated objective, and Esc closes without launch or cancellation', () => {
    const f = fixture();
    f.raw('foreground draft');
    f.raw('\x01');
    f.raw('c');
    expect(f.runCoordination).not.toHaveBeenCalled();
    f.raw('coordinate four reports');
    expect(f.app.getWorkbenchStateForTest().composer.text).toBe('foreground draft');
    f.raw('\x1b');
    expect(f.runCoordination).not.toHaveBeenCalled();
    expect(f.cancelActiveTurn).not.toHaveBeenCalled();
    expect(f.app.getWorkbenchStateForTest().overlayStack).not.toContain('coordination');
  });

  it('requires explicit Enter, launches exactly once while busy, and preserves foreground draft', async () => {
    const f = fixture();
    f.raw('ordinary draft'); f.raw('\x01'); f.raw('c');
    f.raw('\x1b[200~Create four scoped reports\x1b[201~');
    expect(f.runCoordination).not.toHaveBeenCalled();
    f.raw('\r');
    await vi.waitFor(() => expect(f.runCoordination).toHaveBeenCalledTimes(1));
    expect(f.runCoordination.mock.calls[0]?.[0]).toMatchObject({ goal: 'Create four scoped reports' });
    f.raw('\r'); f.raw('\r');
    expect(f.runCoordination).toHaveBeenCalledTimes(1);
    expect(f.processTurn).not.toHaveBeenCalled();
    expect(f.app.getWorkbenchStateForTest().composer.text).toBe('ordinary draft');
    f.raw('\x1b');
    expect(f.cancelActiveTurn).not.toHaveBeenCalled();
    f.raw('\x03');
    expect(f.cancelActiveTurn).toHaveBeenCalledTimes(1);
    f.finish();
    await vi.waitFor(() => expect((f.app as any).sessionDispatchActive).toBe(false));
  });

  it('does not queue a second coordination launch behind an ordinary active turn', () => {
    const f = fixture();
    (f.app as any).sessionDispatchActive = true;
    f.raw('\x01'); f.raw('c'); f.raw('Coordinate reports'); f.raw('\r');
    expect(f.runCoordination).not.toHaveBeenCalled();
    expect(f.app.getWorkbenchStateForTest().queuedMessages).toHaveLength(0);
    expect(f.app.getWorkbenchStateForTest().coordination.draft.text).toBe('Coordinate reports');
    expect(f.app.getWorkbenchStateForTest().coordination.message).toMatch(/active/i);
  });

  it('retains failed objectives and distinguishes unverified from completed results', async () => {
    const f = fixture();
    f.runCoordination.mockRejectedValueOnce(new Error('scripted transport failure'));
    f.raw('\x01'); f.raw('c'); f.raw('Coordinate reports'); f.raw('\r');
    await vi.waitFor(() => expect(f.app.getWorkbenchStateForTest().coordination.phase).toBe('failed'));
    expect(f.app.getWorkbenchStateForTest().coordination.draft.text).toBe('Coordinate reports');
    f.runCoordination.mockResolvedValueOnce({ summary: 'Execution stopped without aggregate verification', sessionId: 'test', toolCalls: [], reason: 'completed_unverified' });
    f.raw('\r');
    await vi.waitFor(() => expect(f.app.getWorkbenchStateForTest().coordination.phase).toBe('unverified'));
    f.runCoordination.mockResolvedValueOnce({ summary: 'Verified aggregate', sessionId: 'test', toolCalls: [], reason: 'completed' });
    f.raw('\r');
    await vi.waitFor(() => expect(f.app.getWorkbenchStateForTest().coordination.phase).toBe('completed'));
  });

  it('rejects an empty objective and provides a truthful missing-port result', () => {
    const f = fixture(); f.raw('\x01'); f.raw('c'); f.raw('\r');
    expect(f.runCoordination).not.toHaveBeenCalled();
    (f.app as any).opts.agentSession = { processTurn: f.processTurn };
    f.raw('Create reports'); f.raw('\r');
    expect(f.processTurn).not.toHaveBeenCalled();
    expect(JSON.stringify(f.app.getWorkbenchStateForTest())).toMatch(/unavailable|not supported|not available/i);
  });
});
