import { describe, it, expect } from 'vitest';
import { ApprovalProjection, MAX_COMPLETED } from '../../../src/tui/runtime/approval-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, ts = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(ts).toISOString(), type, actor: 'system', payload };
}
function requested(seq: number, approvalId: string, prompt = 'run?', toolName?: string): AlixEvent {
  return evt('approval.requested', { approvalId, prompt, ...(toolName ? { toolCallId: 't1', toolName } : {}) }, seq);
}
function resolved(seq: number, approvalId: string, decision: 'approved' | 'denied' | 'edited'): AlixEvent {
  return evt('approval.resolved', { approvalId, decision }, seq);
}

describe('ApprovalProjection', () => {
  it('requested creates a pending entry; resolved moves it to completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1', 'run?', 'search')]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.status).toBe('pending');
    p.update([resolved(2, 'a1', 'approved')]);
    expect(p.snapshot().pending).toHaveLength(0);
    expect(p.snapshot().completed).toHaveLength(1);
    expect(p.snapshot().completed[0]!.status).toBe('approved');
    expect(p.snapshot().completed[0]!.completedAt).toBe(2 * 1000);
  });

  it('completed is bounded by MAX_COMPLETED (FIFO drop of oldest)', () => {
    const p = new ApprovalProjection();
    const ids = Array.from({ length: MAX_COMPLETED + 5 }, (_, i) => `a${i}`);
    const events: AlixEvent[] = [];
    ids.forEach((id, i) => { events.push(requested(i * 2 + 1, id)); events.push(resolved(i * 2 + 2, id, 'approved')); });
    p.update(events);
    const completed = p.snapshot().completed;
    expect(completed).toHaveLength(MAX_COMPLETED);
    expect(completed.some((e) => e.approvalId === 'a0')).toBe(false);      // oldest 5 dropped
    expect(completed.some((e) => e.approvalId === `a${MAX_COMPLETED + 4}`)).toBe(true);
  });

  it('ignores non-approval events and unknown approval ids', () => {
    const p = new ApprovalProjection();
    p.update([evt('chat.message', { text: 'hi' }, 1), resolved(2, 'nope', 'denied')]);
    expect(p.snapshot()).toEqual({ pending: [], completed: [] });
  });

  it('resumed marks a pending entry resumed and stays pending; resume.failed is ignored', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), evt('approval.resumed', { approvalId: 'a1' }, 2)]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.status).toBe('resumed');
    p.update([evt('approval.resume.failed', { approvalId: 'a1' }, 3)]);
    expect(p.snapshot().pending).toHaveLength(1);          // still pending
    expect(p.snapshot().pending[0]!.status).toBe('resumed');
  });

  it('requested after a completed lifecycle with the same id starts a NEW lifecycle', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.update([requested(3, 'a1')]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.requestedAt).toBe(3 * 1000);   // NEW lifecycle
    expect(p.snapshot().completed).toHaveLength(1);               // old completed retained
  });

  it('throws on a malformed event timestamp (deterministic replay)', () => {
    const p = new ApprovalProjection();
    const bad = { ...requested(1, 'a1'), timestamp: 'not-a-date' };
    expect(() => p.update([bad])).toThrow(/timestamp/);
    // An approval-typed event with a malformed timestamp throws EVEN when the
    // payload has no approvalId (not silently ignored).
    const noIdBad = { ...evt('approval.requested', {}, 2), payload: {}, timestamp: 'not-a-date' };
    expect(() => p.update([noIdBad])).toThrow(/timestamp/);
  });

  it('pending entries preserve first-request sequence order', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'b2'), requested(3, 'a1'), requested(5, 'c3')]);
    expect(p.snapshot().pending.map((e) => e.approvalId)).toEqual(['b2', 'a1', 'c3']);
  });

  it('throws on an approval.resolved with an unrecognized decision (no resolved catch-all)', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1')]);
    const badResolve = evt('approval.resolved', { approvalId: 'a1', decision: 'maybe' }, 2);
    expect(() => p.update([badResolve])).toThrow(/decision/);
  });

  it('importState rejects an unknown persisted status enum value', () => {
    const p = new ApprovalProjection();
    expect(() => p.importState({ pending: [{ approvalId: 'a1', status: 'banana', requestedAt: 1 }], completed: [], lastSeq: 3 } as never)).toThrow(/malformed entry/);
  });

  it('importState rejects a non-finite requestedAt/completedAt/lastSeq (deterministic replay state)', () => {
    const p = new ApprovalProjection();
    expect(() => p.importState({ pending: [{ approvalId: 'a1', status: 'pending', requestedAt: 'banana' }], completed: [], lastSeq: 3 } as never)).toThrow(/malformed entry/);
    expect(() => p.importState({ pending: [], completed: [{ approvalId: 'a1', status: 'approved', requestedAt: 1, completedAt: 'banana' }], lastSeq: 3 } as never)).toThrow(/malformed entry/);
    expect(() => p.importState({ pending: [], completed: [], lastSeq: 'x' } as never)).toThrow(/malformed lastSeq/);
  });

  it('rejects non-monotonic event sequences (deterministic replay)', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    expect(() => p.update([requested(3, 'a2')])).not.toThrow();   // monotonic continues
    expect(() => p.update([requested(1, 'a3')])).toThrow(/non-monotonic/);   // replay from a stale seq
  });

  it('duplicate approval.requested is idempotent (replay-safe)', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), requested(2, 'a1')]);   // same id requested twice
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.requestedAt).toBe(1 * 1000);   // first request wins
  });

  it('exportState/importState round-trips pending + completed + lastSeq', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), requested(2, 'a2'), resolved(3, 'a1', 'denied')]);
    const state = p.exportState();
    expect((state as { lastSeq: number }).lastSeq).toBe(3);   // lastSeq captured
    const p2 = new ApprovalProjection();
    p2.importState(state);
    expect(p2.snapshot().pending.find((e) => e.approvalId === 'a2')?.status).toBe('pending');
    expect(p2.snapshot().completed.find((e) => e.approvalId === 'a1')?.status).toBe('denied');
    // imported state is CLONED — external mutation cannot alias internals
    expect(() => p2.update([requested(1, 'a3')])).toThrow(/non-monotonic/);   // lastSeq survived import
  });

  it('reset clears pending and completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.reset();
    expect(p.snapshot()).toEqual({ pending: [], completed: [] });
  });
});
