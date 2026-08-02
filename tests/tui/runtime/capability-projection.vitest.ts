import { describe, it, expect } from 'vitest';
import { CapabilityProjection } from '../../../src/tui/runtime/capability-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  // capability.* events carry `at` in the payload; tool events carry `timestamp`.
  return { id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(at).toISOString(), type, actor: 'system', payload: { ...payload, at } };
}

describe('CapabilityProjection', () => {
  it('reconciles invocation lifecycle into per-capability stats', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'filesystem.read' }, 1, 1000)]);
    p.update([evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 3000)]);
    const s = p.snapshot();
    const stat = s.capabilities['filesystem.read']!;
    expect(stat.invocationCount).toBe(1);
    expect(stat.invocationSucceeded).toBe(1);
    expect(stat.invocationTotalDurationMs).toBe(2000);   // 3000 − 1000
    expect(s.activeInvocations).toBe(0);
  });

  it('tracks active invocations and computes duration on failure', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'shell.exec' }, 1, 1000)]);
    expect(p.snapshot().activeInvocations).toBe(1);
    p.update([evt('capability.InvocationFailed', { invocationId: 'i1', error: 'boom' }, 2, 2500)]);
    const stat = p.snapshot().capabilities['shell.exec']!;
    expect(stat.invocationFailed).toBe(1);
    expect(stat.invocationTotalDurationMs).toBe(1500);
    expect(p.snapshot().activeInvocations).toBe(0);
  });

  it('terminal without start is a no-op (strictly single-pass)', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationCompleted', { invocationId: 'ghost' }, 1, 1000)]);
    expect(p.snapshot()).toEqual({ capabilities: {}, activeInvocations: 0 });
  });

  it('a Started arriving after its terminal does NOT retroactively reconstruct', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationFailed', { invocationId: 'i1', error: 'x' }, 1, 1000)]);
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'repo.read' }, 2, 2000)]);
    // Spec key decision #3: the late Started is a NO-OP — the invocation is
    // already terminalized, so it must not re-open (which would leak a phantom
    // active invocation for a completed lifecycle). The failed terminal left
    // no stat; nothing may appear after the late Start either.
    expect(p.snapshot().activeInvocations).toBe(0);
    expect(p.snapshot().capabilities).toEqual({});
  });

  it('a NEW-seq duplicate terminal never double-counts a closed invocation', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'filesystem.read' }, 1, 1000)]);
    p.update([evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 3000)]);
    // A duplicate terminal with a NEW seq for the same (now closed) invocation
    // must be a no-op — the closed invocation is tracked so a late/duplicate
    // terminal cannot re-count invocationCount or invocationTotalDurationMs.
    p.update([evt('capability.InvocationCompleted', { invocationId: 'i1' }, 3, 5000)]);
    const stat = p.snapshot().capabilities['filesystem.read']!;
    expect(stat.invocationCount).toBe(1);
    expect(stat.invocationSucceeded).toBe(1);
    expect(stat.invocationTotalDurationMs).toBe(2000);
    expect(p.snapshot().activeInvocations).toBe(0);
  });

  it('tracks tool telemetry as a separate non-overlapping counter set', () => {
    const p = new CapabilityProjection();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read', capability: 'file.read', canonicalCapability: 'filesystem.read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', canonicalCapability: 'filesystem.read', durationMs: 500 }, 2, 1500),
    ]);
    const stat = p.snapshot().capabilities['filesystem.read']!;
    expect(stat.toolInvocationCount).toBe(1);
    expect(stat.toolDurationMs).toBe(500);
    expect(stat.invocationCount).toBe(0);   // invocation stream untouched
  });

  it('unknown capabilities appear (history outlives the registry)', () => {
    const p = new CapabilityProjection();
    p.update([evt('tool.completed', { toolCallId: 't1', toolName: 'x', canonicalCapability: 'foo.bar', durationMs: 10 }, 1, 1000)]);
    expect(p.snapshot().capabilities['foo.bar']!.toolInvocationCount).toBe(1);
  });

  it('exportState/importState round-trips durable state', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000)]);
    p.update([evt('tool.completed', { toolCallId: 't1', canonicalCapability: 'a.b', durationMs: 5 }, 2, 1500)]);
    const state = p.exportState();
    const p2 = new CapabilityProjection();
    p2.importState(state);
    expect(p2.snapshot()).toEqual(p.snapshot());
  });

  it('is idempotent on an at-least-once replay of already-seen seqs', () => {
    const p = new CapabilityProjection();
    const batch = [
      evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'filesystem.read' }, 1, 1000),
      evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 3000),
      evt('tool.completed', { toolCallId: 't1', canonicalCapability: 'filesystem.read', durationMs: 100 }, 3, 4000),
    ];
    p.update(batch);
    const first = p.snapshot();
    // The collector's save-failure path re-reads the SAME events on the next
    // sample ("idempotent builders by seq") — re-feeding them must not throw
    // nor double-count any counter.
    p.update(batch);
    expect(p.snapshot()).toEqual(first);
    expect(p.snapshot().capabilities['filesystem.read']!.invocationCount).toBe(1);
    expect(p.snapshot().capabilities['filesystem.read']!.toolInvocationCount).toBe(1);
  });

  it('throws on a malformed event timestamp (deterministic replay)', () => {
    const p = new CapabilityProjection();
    // capability.* events carry `at` (ms) in the payload; a non-finite `at` is
    // a malformed timestamp and must throw, never fall back to Date.now().
    const bad = { ...evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000), payload: { invocationId: 'i1', capabilityId: 'a.b', at: 'not-a-date' } };
    expect(() => p.update([bad])).toThrow(/timestamp/);
  });

  it('importState rejects a malformed stat counter field', () => {
    const p = new CapabilityProjection();
    expect(() => p.importState({ version: 1, stats: [{ id: 'a.b', stat: { invocationCount: 'banana' } }], open: [], closedInvocations: [], lastSeq: 1 } as never)).toThrow(/malformed stat/);
  });

  it('importState rejects a malformed open lifecycle timestamp (isFinite rigor)', () => {
    const p = new CapabilityProjection();
    // The startedAt field gets the SAME isFinite rigor as the stat counters —
    // NaN must be rejected, not silently accepted.
    expect(() => p.importState({ version: 1, stats: [], open: [{ id: 'i1', lifecycle: { invocationId: 'i1', capabilityId: 'a.b', startedAt: NaN } }], closedInvocations: [], lastSeq: 1 } as never)).toThrow(/malformed open lifecycle/);
  });

  it('importState rejects a malformed closedInvocations entry', () => {
    const p = new CapabilityProjection();
    expect(() => p.importState({ version: 1, stats: [], open: [], closedInvocations: [42], lastSeq: 1 } as never)).toThrow(/malformed closedInvocations/);
  });

  it('exportState/importState round-trips a terminalized invocation as closed', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000)]);
    p.update([evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 2000)]);
    const p2 = new CapabilityProjection();
    p2.importState(p.exportState());
    expect(p2.snapshot()).toEqual(p.snapshot());
    // After a restart the closed invocation must STILL be terminalized: a late
    // Started must remain a no-op across the durable round-trip.
    p2.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 3, 3000)]);
    expect(p2.snapshot().activeInvocations).toBe(0);
  });

  it('reset clears everything', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000)]);
    p.reset();
    expect(p.snapshot()).toEqual({ capabilities: {}, activeInvocations: 0 });
  });
});
