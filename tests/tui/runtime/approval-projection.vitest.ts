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
function created(seq: number, approvalId: string, opts: { toolId?: string; reason?: string; requestId?: string; sessionId?: string } = {}): AlixEvent {
  return evt('approval.created', { approvalId, ...opts }, seq);
}
function resolvedStatus(seq: number, approvalId: string, status: 'approved' | 'denied'): AlixEvent {
  return evt('approval.resolved', { approvalId, status }, seq);
}
function expired(seq: number, approvalId: string): AlixEvent {
  return evt('approval.expired', { approvalId }, seq);
}
function revoked(seq: number, approvalId: string): AlixEvent {
  return evt('approval.revoked', { approvalId }, seq);
}
function consumed(seq: number, approvalId: string): AlixEvent {
  return evt('approval.consumed', { approvalId }, seq);
}
function invalidated(seq: number, approvalId: string): AlixEvent {
  return evt('approval.invalidated', { approvalId }, seq);
}
function reused(seq: number, approvalId: string): AlixEvent {
  return evt('approval.reused', { approvalId }, seq);
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

  it('approval.created creates a pending entry; resolved with status moves it to completed', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]);
    expect(p.snapshot().pending[0]!.status).toBe('pending');
    p.update([resolvedStatus(2, 'a1', 'approved')]);
    expect(p.snapshot().pending).toHaveLength(0);
    expect(p.snapshot().completed[0]!.status).toBe('approved');
  });

  it('merge-enrich fills missing fields on a later created; never overwrites populated fields', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]); // sparse
    p.update([created(2, 'a1', { reason: 'Modify config', toolId: 'fs' })]); // rich
    const entry = p.snapshot().pending[0]!;
    expect(entry.prompt).toBe('Modify config');
    expect(entry.toolName).toBe('fs');
    // Now a later sparse event must NOT erase
    p.update([created(3, 'a1')]);
    expect(p.snapshot().pending[0]!.prompt).toBe('Modify config');
    expect(p.snapshot().pending[0]!.toolName).toBe('fs');
  });

  it('approval.reused is a no-op (pending stays pending)', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]);
    p.update([reused(2, 'a1')]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.status).toBe('pending');
  });

  it('expired / revoked / consumed / invalidated move pending to terminal', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'e1')]);
    p.update([expired(2, 'e1')]);
    expect(p.snapshot().completed[0]!.status).toBe('expired');
    p.update([created(3, 'v1')]);
    p.update([revoked(4, 'v1')]);
    expect(p.snapshot().completed[0]!.status).toBe('revoked');
    p.update([created(5, 'c1')]);
    p.update([consumed(6, 'c1')]);
    expect(p.snapshot().completed[0]!.status).toBe('consumed');
    p.update([created(7, 'i1')]);
    p.update([invalidated(8, 'i1')]);
    expect(p.snapshot().completed[0]!.status).toBe('invalidated');
  });

  it('throws on contradictory decision+status (fail-closed)', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]);
    expect(() => p.update([evt('approval.resolved', { approvalId: 'a1', decision: 'approved', status: 'denied' }, 2)])).toThrow();
  });

  it('terminal states are immutable: approved then denied throws; expired then resumed throws; idempotent re-resolve is a no-op', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1', 'run?', 'search')]);
    p.update([resolved(2, 'a1', 'approved')]);
    expect(() => p.update([resolved(3, 'a1', 'denied')])).toThrow();
    p.update([resolved(4, 'a1', 'approved')]); // idempotent no-op
    expect(p.snapshot().completed[0]!.status).toBe('approved');
    p.update([created(5, 'e1')]);
    p.update([expired(6, 'e1')]);
    expect(() => p.update([evt('approval.resumed', { approvalId: 'e1' }, 7)])).toThrow();
  });

  it('replay determinism: same fixture replayed twice → identical snapshots', () => {
    const p1 = new ApprovalProjection();
    const p2 = new ApprovalProjection();
    const fixture: AlixEvent[] = [
      created(1, 'a1', { reason: 'r', toolId: 't' }),
      reused(2, 'a1'),
      resolvedStatus(3, 'a1', 'approved'),
      created(4, 'a2'),
      expired(5, 'a2'),
    ];
    p1.update(fixture);
    p2.update(fixture);
    expect(p1.snapshot()).toEqual(p2.snapshot());
  });

  it('historical sparse events remain readable (no enriched fields)', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]); // no toolId/reason
    p.update([resolvedStatus(2, 'a1', 'approved')]);
    expect(p.snapshot().completed[0]!.toolName).toBeUndefined();
    expect(p.snapshot().completed[0]!.status).toBe('approved');
  });

  it('POST-APPROVAL: approved entry updates to consumed/expired/revoked/invalidated (store parity)', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]);
    p.update([resolvedStatus(2, 'a1', 'approved')]);
    expect(p.snapshot().completed[0]!.status).toBe('approved');
    // consumed arrives after the entry already left pending (store consumeApproved)
    p.update([consumed(3, 'a1')]);
    expect(p.snapshot().completed[0]!.status).toBe('consumed');
    expect(p.snapshot().completed[0]!.completedAt).toBe(3 * 1000);
  });

  it('revoke is allowed on a completed non-approved entry (store revoke permits denied/edited/invalidated)', () => {
    const p = new ApprovalProjection();
    p.update([created(1, 'a1')]);
    p.update([resolvedStatus(2, 'a1', 'denied')]);
    p.update([revoked(3, 'a1')]);
    expect(p.snapshot().completed[0]!.status).toBe('revoked');
  });
});
