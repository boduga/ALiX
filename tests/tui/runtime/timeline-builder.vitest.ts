import { describe, it, expect } from 'vitest';
import { TimelineBuilder, type TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, sessionId = 's1', payload: object = {}, id = `e${seq}`): AlixEvent {
  return {
    id, seq, version: 1, sessionId, runId: undefined, parentEventId: undefined,
    timestamp: new Date(seq * 1000).toISOString(), type, actor: 'user', payload,
  };
}

describe('TimelineBuilder', () => {
  it('appends one entry per chat.message event (append-only)', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt(1, 'chat.message', 's1', { text: 'hi' }),
      evt(2, 'chat.response', 's1', { text: 'hello' }),
    ]);
    const snap = b.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]!.kind).toBe('chat.message');
    expect(snap[1]!.kind).toBe('chat.response');
    expect(snap[0]!.sessionId).toBe('s1');
  });

  it('filters events by sessionId (other sessions ignored)', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1'), evt(2, 'chat.message', 's2')]);
    expect(b.snapshot()).toHaveLength(1);
  });

  it('is idempotent by (sessionId, seq) — a replay with fresh ids but same seqs must NOT overwrite entries', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1', { text: 'hi' }), evt(2, 'chat.response', 's1', { text: 'hello' })]);
    const once = b.snapshot();
    // A real replay: fresh randomUUID ids, same seqs, but DIFFERENT payload.
    // Under the correct ${sessionId}:${seq} dedup the replay is skipped, so the
    // original text survives. Under e.id dedup the tl-${seq} entries get
    // OVERWRITTEN with the new text — this assertion then fails.
    b.update([
      evt(1, 'chat.message', 's1', { text: 'DIFFERENT-HI' }, 'NEW-ID-1'),
      evt(2, 'chat.response', 's1', { text: 'DIFFERENT-HELLO' }, 'NEW-ID-2'),
    ]);
    const after = b.snapshot();
    expect(after).toEqual(once);                     // original text preserved — replay skipped
    expect(after[0]!.text).toBe('hi');               // NOT 'DIFFERENT-HI'
    expect(after).toHaveLength(2);
  });

  it('reset() clears all in-memory projection state', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1'), evt(2, 'chat.response', 's1')]);
    expect(b.snapshot()).toHaveLength(2);
    b.reset();
    expect(b.snapshot()).toEqual([]);
  });

  it('entries are never mutated after creation (append-only)', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1', { text: 'v1' })]);
    const snap = b.snapshot();
    (snap[0] as { text: string }).text = 'mutated';
    // The internal entry is NOT the same object as the snapshot entry (cloned)
    // — so a later update cannot mutate the published entry. (Verify via a
    // second snapshot — the live entry is unchanged.)
    b.update([evt(2, 'chat.response', 's1', { text: 'v2' })]);
    const live = b.snapshot().find((e) => e.id === 'tl-1')!;
    expect(live.text).toBe('v1');                            // unchanged
  });
});
