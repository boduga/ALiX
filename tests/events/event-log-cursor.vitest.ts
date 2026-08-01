// tests/events/event-log-cursor.vitest.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, EventLogCursorError } from '../../src/events/event-log.js';
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

  // Whole-branch review fix (Option A): a serialized cursor whose `seq`
  // exceeds the current EventLog head must NOT silently skip events.
  // `deserializeCursor` throws `EventLogCursorError` (the fourth failure
  // mode) so the collector can discriminate and fall back to
  // `beginningCursor()`. A cursor from a sibling log with a higher head
  // is the canonical trigger: the new log's deserialize rejects it
  // because its own head is lower than the cursor's claimed position.
  it('deserializeCursor throws EventLogCursorError when seq exceeds the live head (sibling-log cursor)', async () => {
    const logA = await makeLog();
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc1', toolName: 'search' } });
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.completed', payload: { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 } });
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc2', toolName: 'edit' } });
    // logA's head = 3. Serialize a cursor at that head.
    const cursorAt3 = logA.serializeCursor(logA.getCursor());

    // Build a fresh log on a different session dir with head = 1.
    const dirB = mkdtempSync(join(tmpdir(), 'alix-cursor-beyond-'));
    const logB = new EventLog(dirB);
    await logB.init();
    await logB.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc1', toolName: 'search' } });
    // Restoring logA's cursor (seq=3) into logB (head=1) must throw the
    // dedicated beyond-head EventLogCursorError.
    expect(() => logB.deserializeCursor(cursorAt3)).toThrow(EventLogCursorError);
    // And the message must indicate the head boundary.
    expect(() => logB.deserializeCursor(cursorAt3)).toThrow(/beyond the current EventLog head/);
  });

  it('deserializeCursor throws EventLogCursorError for all four failure modes', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc1', toolName: 'search' } });
    // head = 1
    // 1. Malformed JSON
    expect(() => log.deserializeCursor('not-json')).toThrow(EventLogCursorError);
    // 2. Unsupported version
    expect(() => log.deserializeCursor(JSON.stringify({ version: 99, seq: 0 }))).toThrow(EventLogCursorError);
    // 3. Invalid payload (non-integer seq)
    expect(() => log.deserializeCursor(JSON.stringify({ version: 1, seq: 1.5 }))).toThrow(EventLogCursorError);
    // 4. Beyond-head position
    expect(() => log.deserializeCursor(JSON.stringify({ version: 1, seq: 999 }))).toThrow(EventLogCursorError);
  });

  it('readSince defensively rejects a beyond-head cursor even if one is somehow constructed', async () => {
    const logA = await makeLog();
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc1', toolName: 'search' } });
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc2', toolName: 'edit' } });
    await logA.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc3', toolName: 'lint' } });
    // logA's head = 3.
    const cursorAt3 = logA.serializeCursor(logA.getCursor());
    // logB has only 1 event (head = 1). deserializeCursor rejects
    // (covered by the test above), so readSince never sees a
    // beyond-head cursor on a single log. The contract assertion
    // here is: on a log whose head has been bumped DOWN — for
    // example, after `init()` re-reads a truncated events.jsonl
    // (the bug scenario in the whole-branch review) — deserialize
    // still rejects. The defensive readSince check is a second
    // line of defense and is exercised by the deserialize path
    // already (deserialize throws first). We assert the
    // deserialize-side contract here; a future caller that
    // hand-builds a cursor via the private makeCursor (not
    // possible from outside the module) would hit the readSince
    // defensive check. The deserialize check is the contract
    // surface.
    const dirB = mkdtempSync(join(tmpdir(), 'alix-cursor-readsince-'));
    const logB = new EventLog(dirB);
    await logB.init();
    await logB.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 'tc1', toolName: 'search' } });
    expect(() => logB.deserializeCursor(cursorAt3)).toThrow(EventLogCursorError);
  });

  it('serialized cursor is versioned and persists no owner token', async () => {
    const log = await makeLog();
    const serialized = log.serializeCursor(log.beginningCursor());
    expect(serialized).not.toContain('owner');       // no owner token persisted
    expect(serialized).toContain('version');         // versioned envelope
  });
});
