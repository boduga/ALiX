import { describe, it, expect } from 'vitest';
import { ChatInvocationPresenter, type InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import { createInitialPerTabState, type TimelineEvent } from '../../../src/tui/state.js';
import type { Invocation, CapabilityEvent } from '../../../src/capability/types.js';

function makeInvocation(id = 'inv_1', capabilityId = 'core.session.list'): Invocation & { __push(e: CapabilityEvent): void } {
  const events: CapabilityEvent[] = [];
  const push = (e: CapabilityEvent) => { events.push(e); };
  return {
    id, status: 'running', cancel: () => {}, subscribe: () => () => {},
    wait: () => Promise.resolve({ invocationId: id, status: 'completed', startedAt: 0, completedAt: 1, output: '["s1"]' }),
    result: () => undefined,
    events: () => ({ [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { if (i < events.length) return { value: events[i++]!, done: false }; return { value: undefined, done: true }; } };
    } }),
    __push: push,
  } as never;
}

function capEvent(state: { timelineEvents: TimelineEvent[] }): Extract<TimelineEvent, { kind: 'capability' }> {
  const evt = state.timelineEvents.find((e) => e.kind === 'capability');
  if (!evt) throw new Error('no capability event');
  return evt as Extract<TimelineEvent, { kind: 'capability' }>;
}

describe('ChatInvocationPresenter', () => {
  it('appends a running capability event, then updates it to completed with output', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation();
    const p = presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    expect(state.timelineEvents).toHaveLength(1);
    expect(capEvent(state).status).toBe('running');
    inv.__push({ type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 });
    await p;
    expect(capEvent(state).status).toBe('completed');
    expect(capEvent(state).output).toBe('["s1"]');
  });

  it('falls back to wait() output when the stream closes without a terminal event', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    await presenter.present({ invocation: makeInvocation(), capabilityId: 'core.session.list', args: {} });
    expect(capEvent(state).status).toBe('completed');
    expect(capEvent(state).output).toBe('["s1"]');
  });
});
