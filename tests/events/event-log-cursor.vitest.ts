// tests/events/event-log-cursor.vitest.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import type { EventLogCursor } from '../../src/events/event-log.js';

async function makeLog(): Promise<EventLog> {
  const dir = mkdtempSync(join(tmpdir(), 'alix-evt-'));
  const log = new EventLog(dir);
  await log.init();
  return log;
}

describe('EventLog cursor', () => {
  it('beginningCursor is before the first event and readSince(beginning) returns all events ascending', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    const c = log.beginningCursor();
    const batch = await log.readSince(c);
    expect(batch.events.map(e => e.type)).toEqual(['a', 'b']);
    expect(batch.events.map(e => e.seq)).toEqual([1, 2]);
    expect(log.cursorsEqual(batch.cursor, c)).toBe(false); // advanced
  });

  it('readSince(current) returns empty + an equivalent cursor (no new events)', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const first = await log.readSince(log.beginningCursor());
    const second = await log.readSince(first.cursor);
    expect(second.events).toEqual([]);
    expect(log.cursorsEqual(second.cursor, first.cursor)).toBe(true);
  });

  it('returned cursor is the highest seq included; re-reading the same range re-returns the same events (at-least-once)', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'c', payload: {} });
    const c = log.beginningCursor();
    const first = await log.readSince(c);
    expect(first.events.map(e => e.seq)).toEqual([1, 2, 3]);
    // Simulate "consumer failed after this read, retries from same cursor".
    const retry = await log.readSince(c);
    expect(retry.events.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('getCursor skips existing history when used as a start', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const head = log.getCursor();
    const batch = await log.readSince(head);
    expect(batch.events).toEqual([]);
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    const after = await log.readSince(head);
    expect(after.events.map(e => e.type)).toEqual(['b']);
  });

  it('readSince throws on a foreign cursor (owner mismatch); cursorsEqual returns false, never throws', async () => {
    const logA = await makeLog();
    const logB = await makeLog();
    await logA.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const foreign = logA.beginningCursor();
    // Same-shape object built without the owner token is rejected by cursorsEqual.
    expect(logB.cursorsEqual(foreign, foreign)).toBe(false);
    await expect(logB.readSince(foreign)).rejects.toThrow();
  });

  it('cursor object exposes NO readable internals (D1 opacity — WeakMap-backed)', async () => {
    const log = await makeLog();
    const cursor = log.getCursor() as unknown as Record<string, unknown>;
    expect('seq' in cursor).toBe(false);
    expect('owner' in cursor).toBe(false);
    expect(Object.keys(cursor)).toEqual([]);
  });
});
