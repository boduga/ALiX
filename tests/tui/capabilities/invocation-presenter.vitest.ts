import { describe, it, expect } from 'vitest';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import type { Invocation, CapabilityEvent, InvocationResult } from '../../../src/capability/types.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';

interface MockInvocation extends Invocation {
  __push(e: CapabilityEvent): void;
}

/**
 * Mock invocation. `events()` yields any seeded terminal event up front so
 * the presenter's `for await` drives `applyEvent`; `wait()` resolves to
 * `waitResult`. Both the event-driven path and the wait()-fallback path
 * can be exercised independently by seeding/omitting `terminal`.
 */
function makeInvocation(opts: {
  id?: string;
  terminal?: CapabilityEvent;
  waitResult: InvocationResult;
}): MockInvocation {
  const events: CapabilityEvent[] = [];
  if (opts.terminal) events.push(opts.terminal);
  return {
    id: opts.id ?? 'inv_1',
    status: 'running',
    cancel: () => {},
    subscribe: () => () => {},
    wait: () => Promise.resolve(opts.waitResult),
    result: () => undefined,
    events: () => ({ [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() {
        if (i < events.length) return { value: events[i++]!, done: false };
        return { value: undefined, done: true };
      } };
    } }),
    __push: (e: CapabilityEvent) => { events.push(e); },
  } as never;
}

function completed(id = 'inv_1', output?: unknown): InvocationResult {
  return { invocationId: id, status: 'completed', output, startedAt: 0, completedAt: 1 };
}
function failed(id = 'inv_1', error = 'boom'): InvocationResult {
  return { invocationId: id, status: 'failed', error, startedAt: 0, completedAt: 1 };
}
function cancelled(id = 'inv_1'): InvocationResult {
  return { invocationId: id, status: 'cancelled', startedAt: 0, completedAt: 1 };
}

describe('ChatInvocationPresenter', () => {
  it('appends a running entry then updates it to completed with output', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({ waitResult: completed() });
    const p = presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    expect(state.capabilityInvocations).toHaveLength(1);
    expect(state.capabilityInvocations[0]!.status).toBe('running');
    inv.__push({ type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 });
    await p;
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('completed');
  });

  it('drives completion through the event path and merges output from wait()', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', { ok: true, rows: 3 }),
    });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('completed');
    // Regression guard for the output drop: InvocationCompleted carries no
    // output, so the entry must be populated from the wait() result.
    expect(entry.output).toEqual({ ok: true, rows: 3 });
  });

  it('drives failure through the event path and merges the error from wait()', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationFailed', invocationId: 'inv_1', error: 'exec failed', at: 2 },
      waitResult: failed('inv_1', 'exec failed'),
    });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('exec failed');
  });

  it('drives cancellation through the event path', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationCancelled', invocationId: 'inv_1', at: 2 },
      waitResult: cancelled('inv_1'),
    });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('cancelled');
  });

  it('falls back to the settled result when the stream closes without a terminal event', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({ waitResult: completed('inv_1', { rows: 1 }) });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('completed');
    expect(entry.output).toEqual({ rows: 1 });
  });
});
