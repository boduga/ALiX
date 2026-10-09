import { describe, it, expect } from 'vitest';
import { TimelineBuilder } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';

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


describe('safe activity checkpoint validation', () => {
  it.each([
    { userSafe: 'true' }, { userSafe: 1 }, { userSafe: null },
    { verifiedOutcome: true }, { verifiedOutcome: 'completed' }, { verifiedOutcome: {} },
    { activityState: {} }, { activityState: 1 }, { activityState: 'private thought' },
  ])('rejects malformed activity metadata without replacing durable entries: %j', (metadata) => {
    const b = new TimelineBuilder('chat-1');
    b.update([evt(1, 'chat.message', 'preserved')]);
    const before = b.snapshot();
    expect(() => b.importState({ version: 1, entries: [{
      id: 'unsafe', kind: 'agent.state_changed', sessionId: 'chat-1', startedAt: 2,
      sourceEvents: { firstSequence: 2 }, ...metadata,
    }] })).toThrow('malformed entry');
    expect(b.snapshot()).toEqual(before);
  });
  it('accepts version-one legacy entries and typed activity metadata', () => {
    const b = new TimelineBuilder('chat-1');
    b.importState({ version: 1, entries: [
      { id: 'legacy', kind: 'agent.message', sessionId: 'chat-1', startedAt: 1, text: 'old', sourceEvents: { firstSequence: 1 } },
      { id: 'safe', kind: 'agent.progress', sessionId: 'chat-1', startedAt: 2, text: 'Inspecting', userSafe: true, verifiedOutcome: 'success', sourceEvents: { firstSequence: 2 } },
      { id: 'state', kind: 'agent.state_changed', sessionId: 'chat-1', startedAt: 3, activityState: 'waiting_dependency', sourceEvents: { firstSequence: 3 } },
    ] });
    expect(b.snapshot()).toHaveLength(3);
    expect(b.snapshot()[1]).toMatchObject({ userSafe: true, verifiedOutcome: 'success' });
    expect(b.snapshot()[2]).toMatchObject({ activityState: 'waiting_dependency' });
  });
});
