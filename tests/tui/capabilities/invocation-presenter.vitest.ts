import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import type { Invocation, CapabilityEvent, InvocationResult } from '../../../src/capability/types.js';
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

/** Deterministic flush: the log notifies watchers AFTER appendFile resolves. */
async function flushedAfter(log: EventLog, count: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let seen = 0;
    log.watch(() => { if (++seen >= count) resolve(); });
  });
}

async function makeLog(): Promise<EventLog> {
  const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-inv-')));
  await log.init();
  return log;
}

describe('ChatInvocationPresenter', () => {
  // Phase 6 (D9): the presenter no longer pushes into any per-tab state. The
  // single observable surface is the settled `chat.response` log entry, whose
  // text carries the capability status line (capabilityStatusText). All
  // assertions below are on that emitted text.

  it('renders completed output through the schema renderer when a resultSchema is supplied (#413)', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', ['session-1', 'session-2']),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({
      invocation: inv,
      capabilityId: 'core.session.list',
      // An array resultSchema → itemized rendering, not JSON.stringify.
      resultSchema: { type: 'array', items: { type: 'string' } },
    });
    await flushed;
    const events = await log.readAll();
    const text = (events[0]!.payload as { text?: string }).text!;
    // Structured itemized lines replace the raw JSON array.
    expect(text).toContain('- session-1');
    expect(text).toContain('- session-2');
    expect(text).not.toContain('["session-1","session-2"]');
  });

  it('keeps JSON.stringify output when no resultSchema is supplied (#413)', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', ['session-1', 'session-2']),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    const text = (events[0]!.payload as { text?: string }).text!;
    expect(text).toContain(JSON.stringify(['session-1', 'session-2']));
  });

  it('drives completion through the event path and merges output from wait() into the emitted text', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 },
      waitResult: completed('inv_1', { ok: true, rows: 3 }),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('chat.response');
    expect(events[0]!.sessionId).toBe('sess-chat');
    expect(events[0]!.actor).toBe('agent');
    // Display contract: chat.response entries always carry non-empty text.
    const text = (events[0]!.payload as { text?: string }).text!;
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('core.session.list [completed ✓]');
    // wait() output is merged into the status line.
    expect(text).toContain('{"ok":true,"rows":3}');
  });

  it('drives failure through the event path (status and error from the event; diverged wait() output does not leak)', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationFailed', invocationId: 'inv_1', error: 'exec failed', at: 2 },
      // wait() reports completed — deliberately diverges so 'failed' + the
      // event's error can ONLY come from applyEvent's InvocationFailed
      // branch, never from the wait()-fallback status mapping.
      waitResult: completed('inv_1', { rows: 99 }),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    const text = (events[0]!.payload as { text?: string }).text!;
    expect(text).toContain('core.session.list [failed ✗] exec failed');
    // The diverged wait() output must not leak onto an event-path failure.
    expect(text).not.toContain('rows');
  });

  it('drives cancellation through the event path', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationCancelled', invocationId: 'inv_1', at: 2 },
      // wait() reports completed — diverges so 'cancelled' can only come
      // from applyEvent's InvocationCancelled branch.
      waitResult: completed('inv_1', { rows: 99 }),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    const text = (events[0]!.payload as { text?: string }).text!;
    expect(text).toContain('core.session.list [cancelled]');
    // The diverged wait() result must not leak output onto a cancelled event.
    expect(text).not.toContain('rows');
  });

  it('falls back to the settled result when the stream closes without a terminal event', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({ waitResult: completed('inv_1', { rows: 1 }) });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    const text = (events[0]!.payload as { text?: string }).text!;
    expect(text).toContain('core.session.list [completed ✓]');
    expect(text).toContain('{"rows":1}');
  });

  it('emits a non-empty failed-status chat.response on failure (display contract)', async () => {
    const log = await makeLog();
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const inv = makeInvocation({
      terminal: { type: 'InvocationFailed', invocationId: 'inv_1', error: 'boom', at: 2 },
      waitResult: completed('inv_1'),
    });
    const flushed = flushedAfter(log, 1);
    await presenter.present({ invocation: inv, capabilityId: 'core.session.list' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    const text = (events[0]!.payload as { text?: string }).text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).toContain('core.session.list [failed ✗] boom');
  });

  it('does not throw and emits nothing when no emit context is wired', async () => {
    const presenter = new ChatInvocationPresenter();
    const inv = makeInvocation({ waitResult: completed('inv_1', { rows: 1 }) });
    await expect(presenter.present({ invocation: inv, capabilityId: 'core.session.list' })).resolves.toBeUndefined();
  });
});
