import { describe, it, expect } from 'vitest';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, payload: Record<string, unknown> = {}): AlixEvent {
  return {
    id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload,
  } as unknown as AlixEvent;
}

describe('IncrementalExecutionTraceBuilder durable state (Phase 6.5)', () => {
  it('exportState round-trips through importState to an identical snapshot', () => {
    const b = new IncrementalExecutionTraceBuilder();
    b.update([
      evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' }),
      evt(2, 'tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }),
      evt(3, 'tool.started', { toolCallId: 't2', toolName: 'y' }),
    ]);
    const before = b.snapshot();

    const fresh = new IncrementalExecutionTraceBuilder();
    fresh.importState(b.exportState());

    expect(fresh.snapshot()).toEqual(before);
  });

  it('importState throws on malformed or unsupported-version state', () => {
    const b = new IncrementalExecutionTraceBuilder();
    expect(() => b.importState({ version: 99 })).toThrow();
    expect(() => b.importState({ version: 1, seenSequences: 'nope' })).toThrow();
  });

  it('importState reconstructs open lifecycles (running entries) exactly', () => {
    const b = new IncrementalExecutionTraceBuilder();
    b.update([evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' })]);
    const running = b.snapshot();
    expect(running).toHaveLength(1);
    expect(running[0]!.status).toBe('running');

    const fresh = new IncrementalExecutionTraceBuilder();
    fresh.importState(b.exportState());
    const restored = fresh.snapshot();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.status).toBe('running');
    expect(restored[0]!.title).toBe('tool.x');
  });

  it('closedFirstSequences/closedByKey round-trip preserves D5 duplicate-terminal suppression', () => {
    // closedFirstSequences/closedByKey are load-bearing for D5: a NEW-seq
    // duplicate terminal after resume resolves its id via closedByKey and dedups
    // via closedFirstSequences. snapshot()/materializeTrace never read them, so
    // this exercises the exported state directly.
    const b = new IncrementalExecutionTraceBuilder();
    b.update([
      evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' }),
      evt(2, 'tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }),
    ]);
    expect(b.snapshot()).toHaveLength(1);

    const fresh = new IncrementalExecutionTraceBuilder();
    fresh.importState(b.exportState());

    // NEW-seq duplicate terminal (same toolCallId) after resume must be
    // suppressed — no synthesized second entry, id resolves to the closed tr-1.
    fresh.update([evt(4, 'tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 999 })]);
    const restored = fresh.snapshot();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('tr-1');
    expect(restored[0]!.durationMs).toBe(5); // first-write-wins, not 999
  });

  it('importState validates element shape BEFORE mutating — malformed elements throw and leave prior state intact', () => {
    const b = new IncrementalExecutionTraceBuilder();
    b.update([evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' })]);
    const prior = b.snapshot();
    expect(prior).toHaveLength(1);

    // null element in openByKey — must throw cleanly, not a raw TypeError mid-loop.
    const nullElem = b.exportState();
    (nullElem.openByKey as unknown[]).push(null as never);
    expect(() => b.importState(nullElem)).toThrow();
    expect(b.snapshot()).toEqual(prior); // builder untouched (not half-imported)

    // numeric element in terminalById — must throw, not silently set(undefined, ...).
    const numericElem = b.exportState();
    (numericElem.terminalById as unknown[]).push(42 as never);
    expect(() => b.importState(numericElem)).toThrow();
    expect(b.snapshot()).toEqual(prior);

    // malformed nested field (non-array detailParts) — must throw.
    const badDetail = b.exportState();
    ((badDetail.openByKey[0] as { lifecycle: { detailParts: unknown } }).lifecycle.detailParts) = 'nope' as never;
    expect(() => b.importState(badDetail)).toThrow();
    expect(b.snapshot()).toEqual(prior);
  });
});
