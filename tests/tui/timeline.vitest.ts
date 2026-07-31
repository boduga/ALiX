// tests/tui/timeline.vitest.ts
import { describe, it, expect } from 'vitest';
import {
  createInitialPerTabState, appendTimelineEvent, getOrderedTimeline,
  capabilityStatusText, formatTimelineEvent,
  type TimelineEvent,
} from '../../src/tui/state.js';

describe('appendTimelineEvent', () => {
  it('stamps id/timestamp/sequence/source and returns the stored object', () => {
    const state = createInitialPerTabState();
    const event = appendTimelineEvent(state, { kind: 'user', text: 'hi' });
    expect(state.timelineEvents[0]).toBe(event);          // identity — no clone
    expect(event.id).toBe(`tl-${event.sequence}`);
    expect(typeof event.timestamp).toBe('number');
    expect(event.source).toBe('operator');
  });

  it('maps source from kind', () => {
    const state = createInitialPerTabState();
    expect(appendTimelineEvent(state, { kind: 'agent', text: 'ok' }).source).toBe('agent');
    expect(appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'c', status: 'running' }).source).toBe('capability');
  });

  it('sequence is monotonic across appends', () => {
    const state = createInitialPerTabState();
    const a = appendTimelineEvent(state, { kind: 'user', text: 'a' });
    const b = appendTimelineEvent(state, { kind: 'user', text: 'b' });
    const c = appendTimelineEvent(state, { kind: 'user', text: 'c' });
    expect(a.sequence).toBeLessThan(b.sequence);
    expect(b.sequence).toBeLessThan(c.sequence);
  });
});

describe('getOrderedTimeline', () => {
  it('sorts by timestamp then sequence — stored order differs from display order', () => {
    const state = createInitialPerTabState();
    const user = appendTimelineEvent(state, { kind: 'user', text: 'hello' });
    const agent = appendTimelineEvent(state, { kind: 'agent', text: 'done' });
    const cap = appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'running' });
    // Capability ran between user and agent.
    user.timestamp = 100;
    cap.timestamp = 150;
    agent.timestamp = 200;
    // Stored order (append order) vs display order (time order).
    expect(state.timelineEvents.map(e => e.kind)).toEqual(['user', 'agent', 'capability']);
    expect(getOrderedTimeline(state.timelineEvents).map(e => e.kind)).toEqual(['user', 'capability', 'agent']);
  });

  it('does not mutate the input array', () => {
    const state = createInitialPerTabState();
    appendTimelineEvent(state, { kind: 'user', text: 'a' });
    appendTimelineEvent(state, { kind: 'user', text: 'b' });
    const before = state.timelineEvents.map(e => e.kind);
    getOrderedTimeline(state.timelineEvents);
    expect(state.timelineEvents.map(e => e.kind)).toEqual(before);
  });

  it('preserves append order on identical timestamps (sequence tiebreak)', () => {
    const state = createInitialPerTabState();
    const user = appendTimelineEvent(state, { kind: 'user', text: 'hello' });
    const agent = appendTimelineEvent(state, { kind: 'agent', text: 'done' });
    user.timestamp = 100;
    agent.timestamp = 100;
    expect(getOrderedTimeline(state.timelineEvents).map(e => e.kind)).toEqual(['user', 'agent']);
  });
});

describe('capabilityStatusText + formatTimelineEvent', () => {
  it('formats all capability statuses', () => {
    const state = createInitialPerTabState();
    const cap = appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'running' }) as Extract<TimelineEvent, { kind: 'capability' }>;
    expect(capabilityStatusText(cap)).toBe('core.session.list [running]');
    cap.status = 'completed'; cap.output = ["s1"];
    expect(capabilityStatusText(cap)).toBe('core.session.list [completed ✓] ["s1"]');
    cap.status = 'failed'; cap.error = 'boom';
    expect(capabilityStatusText(cap)).toBe('core.session.list [failed ✗] boom');
    cap.status = 'cancelled';
    expect(capabilityStatusText(cap)).toBe('core.session.list [cancelled]');
  });

  it('completed with empty-string output omits the trailing output suffix', () => {
    const state = createInitialPerTabState();
    const cap = appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'running' }) as Extract<TimelineEvent, { kind: 'capability' }>;
    cap.status = 'completed'; cap.output = '';
    expect(capabilityStatusText(cap)).toBe('core.session.list [completed ✓]');
  });

  it('formatTimelineEvent produces one-liners', () => {
    const state = createInitialPerTabState();
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'user', text: 'hi' }))).toBe('→ hi');
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'agent', text: 'ok' }))).toBe('← ok');
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'c', status: 'completed' }))).toBe('⚡ c [completed ✓]');
  });
});
