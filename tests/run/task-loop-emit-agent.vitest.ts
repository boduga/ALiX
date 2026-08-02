/**
 * emitAgent — the task-loop helper that stamps agent-conversation events into
 * the `${sessionId}-agent` projection domain (Phase 6 rule: an event's
 * sessionId identifies its projection domain, not the runtime that emitted it).
 *
 * The task-loop runs in the OUTER runtime but emits ON BEHALF of the agent
 * conversation, so its `agent.message` / `agent.reasoning` / `agent.decision`
 * events must carry the agent sub-session id — that is the only way the agent
 * tab's collector (`${sessionId}-agent`) projects them. These tests pin that
 * stamping contract and prove the events land in the agent timeline (and NOT
 * the outer one).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { emitAgent } from '../../src/run/task-loop.js';
import { TimelineBuilder } from '../../src/tui/runtime/timeline-builder.js';

async function makeLog(): Promise<EventLog> {
  const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-emit-agent-')));
  await log.init();
  return log;
}

/** Deterministic flush: the log notifies watchers AFTER appendFile resolves. */
function flushedAfter(log: EventLog, count: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let seen = 0;
    log.watch(() => { if (++seen >= count) resolve(); });
  });
}

describe('emitAgent', () => {
  it('stamps agent events into the ${sessionId}-agent projection domain with the agent actor', async () => {
    const log = await makeLog();
    const flushed = flushedAfter(log, 1);
    await emitAgent(log, { sessionId: 'outer-1' }, 'agent.message', { text: 'hello' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe('outer-1-agent');
    expect(events[0]!.actor).toBe('agent');
    expect(events[0]!.type).toBe('agent.message');
    expect(events[0]!.payload).toEqual({ text: 'hello' });
  });

  it('preserves the payload for every agent conversation kind', async () => {
    const log = await makeLog();
    const session = { sessionId: 'outer-2' };
    const flushed = flushedAfter(log, 3);
    await emitAgent(log, session, 'agent.reasoning', { text: 'thinking', toolCalls: ['file.read'], iteration: 0 });
    await emitAgent(log, session, 'agent.decision', { kind: 'tool_selection', iteration: 0, description: 'Called file.read', summary: 'read', outcome: 'executed' });
    await emitAgent(log, session, 'agent.decision', { kind: 'repair', iteration: 1, description: 'Entering repair loop', outcome: 'executed' });
    await flushed;
    const events = await log.readAll();
    expect(events.map((e) => e.sessionId)).toEqual(['outer-2-agent', 'outer-2-agent', 'outer-2-agent']);
    expect(events.map((e) => e.type)).toEqual(['agent.reasoning', 'agent.decision', 'agent.decision']);
    expect(events[1]!.payload).toMatchObject({ kind: 'tool_selection', outcome: 'executed' });
  });

  it('projects into the agent sub-session timeline, not the outer one', async () => {
    const log = await makeLog();
    const flushed = flushedAfter(log, 1);
    await emitAgent(log, { sessionId: 'outer-3' }, 'agent.message', { text: 'hello' });
    await flushed;
    const all = await log.readAll();

    // The agent collector (TimelineBuilder on `${sessionId}-agent`) sees the
    // event — this is what renders the agent tab conversation.
    const agent = new TimelineBuilder('outer-3-agent');
    agent.update(all);
    expect(agent.snapshot()).toHaveLength(1);
    expect(agent.snapshot()[0]!.kind).toBe('agent.message');
    expect(agent.snapshot()[0]!.text).toBe('hello');

    // The outer-scoped timeline (Runtime tab trace projection) must NOT pick
    // up agent-conversation events.
    const outer = new TimelineBuilder('outer-3');
    outer.update(all);
    expect(outer.snapshot()).toHaveLength(0);
  });
});
