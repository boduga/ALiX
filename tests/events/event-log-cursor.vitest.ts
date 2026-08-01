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

  it('serializeCursor/deserializeCursor round-trips a cursor owned by the same log', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const c = log.beginningCursor();
    const restored = log.deserializeCursor(log.serializeCursor(c));
    expect(log.cursorsEqual(restored, c)).toBe(true);
  });

  it('deserializeCursor re-creates the owner per instance — a cursor restored by another log is foreign to the serializing log', async () => {
    const logA = await makeLog();
    const logB = await makeLog();
    const serialized = logA.serializeCursor(logA.beginningCursor());
    // deserializeCursor cannot detect foreignness: no owner token is persisted
    // (D1), so the payload carries no identity across instances. It simply
    // re-creates THIS instance's owner via makeCursor.
    const restored = logB.deserializeCursor(serialized);
    // logB's restored cursor is foreign to logA — rejected by unwrap/readSince.
    expect(logA.cursorsEqual(restored, logA.beginningCursor())).toBe(false);
    await expect(logA.readSince(restored)).rejects.toThrow();
  });

  it('deserializeCursor rejects malformed JSON and unknown versions', async () => {
    const log = await makeLog();
    expect(() => log.deserializeCursor('not-json')).toThrow();
    expect(() => log.deserializeCursor(JSON.stringify({ version: 99, seq: 5 }))).toThrow();
  });

  it('serialized cursor is versioned and persists no owner token', async () => {
    const log = await makeLog();
    const serialized = log.serializeCursor(log.beginningCursor());
    expect(serialized).not.toContain('owner');       // no owner token persisted
    expect(serialized).toContain('version');         // versioned envelope
  });
});
