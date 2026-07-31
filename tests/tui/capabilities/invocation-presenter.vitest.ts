import { describe, it, expect, vi } from 'vitest';
import { ChatInvocationPresenter, type InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import type { Invocation, CapabilityEvent } from '../../../src/capability/types.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';

function makeInvocation(id = 'inv_1', capabilityId = 'core.session.list'): Invocation & { __push(e: CapabilityEvent): void } {
  const events: CapabilityEvent[] = [];
  const push = (e: CapabilityEvent) => { events.push(e); };
  return {
    id, status: 'running', cancel: () => {}, subscribe: () => () => {},
    wait: () => Promise.resolve({ invocationId: id, status: 'completed', startedAt: 0, completedAt: 1 }),
    result: () => undefined,
    events: () => ({ [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { if (i < events.length) return { value: events[i++]!, done: false }; return { value: undefined, done: true }; } };
    } }),
    __push: push,
  } as never;
}

describe('ChatInvocationPresenter', () => {
  it('appends a running entry then updates it to completed with output', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation();
    const p = presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    expect(state.capabilityInvocations).toHaveLength(1);
    expect(state.capabilityInvocations[0]!.status).toBe('running');
    inv.__push({ type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 });
    await p;
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('completed');
  });
});
