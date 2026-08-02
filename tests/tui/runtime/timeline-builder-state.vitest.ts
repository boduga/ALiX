import { describe, it, expect } from 'vitest';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, text: string): AlixEvent {
  return {
    id: `e${seq}`, seq, version: 1, sessionId: 'chat-1',
    timestamp: new Date(seq * 1000).toISOString(), type, actor: 'user',
    payload: { text },
  } as unknown as AlixEvent;
}

describe('TimelineBuilder durable state (Phase 6.5)', () => {
  it('exportState round-trips through importState to an identical snapshot', () => {
    const b = new TimelineBuilder('chat-1');
    b.update([evt(1, 'chat.message', 'hi'), evt(2, 'chat.response', 'yo')]);
    const before = b.snapshot();

    const fresh = new TimelineBuilder('chat-1');
    fresh.importState(b.exportState());

    expect(fresh.snapshot()).toEqual(before);
  });

  it('importState throws on a malformed or unsupported-version state', () => {
    const b = new TimelineBuilder('chat-1');
    expect(() => b.importState({ version: 99, entries: [] })).toThrow();
    expect(() => b.importState({ version: 1, entries: 'nope' })).toThrow();
    expect(() => b.importState({ version: 1, entries: [{ bad: true }] })).toThrow();
  });

  it('importState reconstructs the seen-dedup set so a replay of the same events is a no-op', () => {
    const b = new TimelineBuilder('chat-1');
    b.importState({
      version: 1,
      entries: [
        { id: 'tl-1', kind: 'chat.message', sessionId: 'chat-1', startedAt: 1000, text: 'hi', sourceEvents: { firstSequence: 1 } },
      ],
    });
    b.update([evt(1, 'chat.message', 'hi')]); // same seq, already seen
    expect(b.snapshot()).toHaveLength(1);
  });

  it('importState ignores entries belonging to another session (defensive)', () => {
    const b = new TimelineBuilder('chat-1');
    b.importState({
      version: 1,
      entries: [
        { id: 'tl-x', kind: 'chat.message', sessionId: 'agent-1', startedAt: 1, text: 'other', sourceEvents: { firstSequence: 1 } },
      ],
    });
    expect(b.snapshot()).toEqual([]);
  });
});
