import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import type { Invocation, CapabilityEvent, InvocationResult } from '../../../src/capability/types.js';
import { createInitialPerTabState, type TimelineEvent } from '../../../src/tui/state.js';
import { EventLog } from '../../../src/events/event-log.js';

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
}): Invocation {
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
  } as never;
}

function completed(id = 'inv_1', output?: unknown): InvocationResult {
  return { invocationId: id, status: 'completed', output, startedAt: 0, completedAt: 1 };
}

function capEvent(state: { timelineEvents: TimelineEvent[] }): Extract<TimelineEvent, { kind: 'capability' }> {
  const evt = state.timelineEvents.find((e) => e.kind === 'capability');
  if (!evt) throw new Error('no capability event');
  return evt as Extract<TimelineEvent, { kind: 'capability' }>;
}

describe('ChatInvocationPresenter', () => {
  it('appends a running capability event, then drives completion through the event path and merges output from wait()', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', { ok: true, rows: 3 }),
    });
    const p = presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    expect(state.timelineEvents).toHaveLength(1);
    expect(capEvent(state).status).toBe('running');
    await p;
    // Status came from the event path (applyEvent); output is merged from wait().
    expect(capEvent(state).status).toBe('completed');
    expect(capEvent(state).output).toEqual({ ok: true, rows: 3 });
  });

  it('drives failure through the event path (status and error from the event)', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationFailed', invocationId: 'inv_1', error: 'exec failed', at: 2 },
      // wait() reports completed — deliberately diverges so 'failed' + the
      // event's error can ONLY come from applyEvent's InvocationFailed
      // branch, never from the wait()-fallback status mapping.
      waitResult: completed('inv_1'),
    });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    const evt = capEvent(state);
    expect(evt.status).toBe('failed');
    expect(evt.error).toBe('exec failed');
    // The diverged wait() result (completed with no output) must not leak
    // output onto the event-path-failed event.
    expect(evt.output).toBeUndefined();
  });

  it('drives cancellation through the event path', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({
      terminal: { type: 'InvocationCancelled', invocationId: 'inv_1', at: 2 },
      // wait() reports completed — diverges so 'cancelled' can only come
      // from applyEvent's InvocationCancelled branch.
      waitResult: completed('inv_1'),
    });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    const evt = capEvent(state);
    expect(evt.status).toBe('cancelled');
    // The diverged wait() result must not leak output/error onto a cancelled event.
    expect(evt.output).toBeUndefined();
    expect(evt.error).toBeUndefined();
  });

  it('falls back to the settled result when the stream closes without a terminal event', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({ waitResult: completed('inv_1', { rows: 1 }) });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    const evt = capEvent(state);
    expect(evt.status).toBe('completed');
    expect(evt.output).toEqual({ rows: 1 });
  });

  it('emits ONE settled chat.response with non-empty status text when wired with an emit context (Phase 6)', async () => {
    const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-inv-')));
    await log.init();
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state, { eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', { ok: true }),
    });
    // Deterministic flush: the log notifies watchers AFTER appendFile resolves.
    const flushed = new Promise<void>((resolve) => { log.watch(() => resolve()); });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('chat.response');
    expect(events[0]!.sessionId).toBe('sess-chat');
    expect(events[0]!.actor).toBe('agent');
    // Display contract: chat.response entries always carry non-empty text.
    const text = (events[0]!.payload as { text?: string }).text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).toContain('core.session.list [completed ✓]');
  });

  it('emits a non-empty failed-status chat.response on failure (display contract)', async () => {
    const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-inv-fail-')));
    await log.init();
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state, { eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationFailed', invocationId: 'inv_1', error: 'boom', at: 2 },
      waitResult: completed('inv_1'),
    });
    const flushed = new Promise<void>((resolve) => { log.watch(() => resolve()); });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    const text = (events[0]!.payload as { text?: string }).text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).toContain('core.session.list [failed ✗] boom');
  });

  it('keeps in-memory-only behavior when no emit context is wired', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation({ waitResult: completed('inv_1', { rows: 1 }) });
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    expect(state.timelineEvents).toHaveLength(1);
    expect(capEvent(state).status).toBe('completed');
  });
});
