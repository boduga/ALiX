// tests/tui/runtime/collector-harness.ts
//
// Shared in-memory EventLog / ProjectionCheckpointStore / dummy-builder fakes
// for RuntimeCollector tests (runtime-collector-sessionless, evolution-
// composition-root, and siblings). `readSince` mirrors the real EventLog: a
// cursor whose seq lies past the current head throws EventLogCursorError (so
// the collector discriminates the beyond-head fallback); serialized cursors
// round-trip through the same versioned JSON envelope.
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import type { ProjectionBuilder } from '../../../src/tui/runtime/projection-builder.js';

/** Default session stamped by makeEventLog's append when no sessionId is
 *  passed (mirrors the single-session world of the existing collector tests). */
export const SESSION_ID = 's';

/** In-memory EventLog fake. */
export function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>, sessionId?: string) => Promise<void> } {
  let seq = 0;
  const events: AlixEvent[] = [];
  const owner = Symbol('test-owner');
  const makeCursor = (s: number) => ({ seq: s, owner }) as unknown as EventLogCursor;
  const beginning = makeCursor(0);
  const log = {
    beginningCursor: () => beginning,
    getCursor: () => makeCursor(seq),
    readSince: async (c: EventLogCursor) => {
      const internal = c as unknown as { seq: number; owner: symbol };
      if (internal.owner !== owner) throw new Error('foreign');
      if (internal.seq > seq) throw new EventLogCursorError('Cursor position beyond current EventLog head');
      const newer = events.filter(e => e.seq > internal.seq);
      const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
      return { events: newer, cursor: makeCursor(last) };
    },
    cursorsEqual: (a: EventLogCursor, b: EventLogCursor) =>
      (a as unknown as { seq: number }).seq === (b as unknown as { seq: number }).seq,
    serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
    deserializeCursor: (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new Error('unknown version');
      if (p.seq > seq) throw new EventLogCursorError('Serialized cursor position is beyond the current EventLog head');
      return makeCursor(p.seq);
    },
  } as unknown as EventLog;
  return {
    log,
    append: async (type, payload = {}, sessionId = SESSION_ID) => {
      seq++;
      events.push({ id: `e${seq}`, seq, version: 1, sessionId, timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload });
    },
  };
}

/** In-memory ProjectionCheckpointStore. `saved` records every successful
 *  save() so tests can assert write cadence / commit-marker behavior. */
export function makeCheckpointStore(): ProjectionCheckpointStore & { saved: Array<{ cursor: string; committedAt: number }> } {
  let stored: PersistedProjectionCheckpoint | null = null;
  const saved: Array<{ cursor: string; committedAt: number }> = [];
  return {
    saved,
    async load() { return stored; },
    async save(cp) { stored = cp; saved.push(cp); },
  };
}

/** A no-op projection builder — relay tests assert which events reach
 *  `updateAll` / the relay, not the projection outputs, so no real builder is
 *  needed (a real trace/timeline builder would also reject the synthetic
 *  `test.event` type). */
export function makeDummyBuilder(): ProjectionBuilder<unknown> {
  return { update: () => {}, snapshot: () => ({}), reset: () => {} };
}
