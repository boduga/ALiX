// tests/tui/runtime/evolution-composition-root.vitest.ts
//
// Task 8 — composition-root integration: a REAL RuntimeCollectorImpl sample
// loop drives the Q-C4 sessionless relay → EvolutionProjection.ingestSessionless
// → snapshot path end-to-end. Mirrors the wiring in src/cli/commands/tui.ts
// (register [ProjectionIds.evolution, projection] on the runtime, pass
// sessionlessEvents → projection.ingestSessionless), but with in-memory sources
// so no `.alix/governance` or real EventLog is touched.
import { describe, expect, it } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import { EvolutionProjection } from '../../../src/tui/runtime/evolution/evolution-projection.js';
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';

const SESSION_ID = 's';

// ---- In-memory EventLog fake (same harness as runtime-collector-sessionless
// and runtime-collector tests). `readSince` mirrors the real EventLog: a cursor
// whose seq lies past the head throws EventLogCursorError; serialized cursors
// round-trip through the same versioned JSON envelope.
function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>, sessionId?: string) => Promise<void> } {
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

/** In-memory ProjectionCheckpointStore. */
function makeCheckpointStore(): ProjectionCheckpointStore & { saved: Array<{ cursor: string; committedAt: number }> } {
  let stored: PersistedProjectionCheckpoint | null = null;
  const saved: Array<{ cursor: string; committedAt: number }> = [];
  return {
    saved,
    async load() { return stored; },
    async save(cp) { stored = cp; saved.push(cp); },
  };
}

/** The composition-root source wiring — in-memory stand-ins for the tui.ts
 *  platform/a9/governance reads (lifecycle/forecasts/correlations empty; A8
 *  learn returns null; the measurement stage is fed via the relay). */
function makeProjection() {
  return new EvolutionProjection({
    sources: {
      lifecycle: () => [],
      forecasts: () => Promise.resolve([]),
      correlations: () => Promise.resolve([]),
      recommendations: () => Promise.resolve([]),
      learning: { learn: async () => null },
    },
    clock: () => 1_700_000_000_000,
  });
}

describe('evolution composition root', () => {
  it('relays sessionless measurement events into the runtime snapshot evolution stage', async () => {
    const { log, append } = makeEventLog();
    await append('capability.governance.measurement.measured', {
      measurement: { capabilityId: 'cap-a', version: '1' },
      post: { status: 'pass', confidence: 0.9 },
      outcome: { kind: 'effective' },
    }, ''); // sessionId "" — the Q-C4 relay path

    const projection = makeProjection();
    const runtime = createProjectionRuntime([
      [ProjectionIds.evolution, projection],
    ]);
    const collector = new RuntimeCollectorImpl({
      eventLog: log,
      checkpointStore: makeCheckpointStore(),
      sessionId: SESSION_ID,
      projectionRuntime: runtime,
      sessionlessEvents: (events) => projection.ingestSessionless(events),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);

    const snap = await collector.snapshot();
    // 1. The evolution projection surfaces in the runtime snapshot.
    expect(snap?.evolution).toBeDefined();
    // 2. The measurement stage is 'available' (relayed sessionless event).
    expect(snap!.evolution!.stages.measurements.status).toBe('available');
    // 3. The measurement row carries the appended payload's capabilityId.
    expect(snap!.evolution!.stages.measurements.items[0]!.capabilityId).toBe('cap-a');
    // 4. Sessionless events NEVER reach the session-filtered projections
    //    (no timeline projection registered → empty array).
    expect(snap!.timeline).toHaveLength(0);
    // 5. The snapshot carries a single deterministic generatedAt.
    expect(snap!.evolution!.generatedAt).toBe(1_700_000_000_000);
    collector.stop();
  });

  it('the relay is per-cycle: a second sample forwards only newly-read sessionless events', async () => {
    const { log, append } = makeEventLog();
    const projection = makeProjection();
    const runtime = createProjectionRuntime([
      [ProjectionIds.evolution, projection],
    ]);
    const collector = new RuntimeCollectorImpl({
      eventLog: log,
      checkpointStore: makeCheckpointStore(),
      sessionId: SESSION_ID,
      projectionRuntime: runtime,
      sessionlessEvents: (events) => projection.ingestSessionless(events),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;

    await append('capability.governance.measurement.measured', {
      measurement: { capabilityId: 'cap-a', version: '1' },
      post: { status: 'pass', confidence: 0.9 },
      outcome: { kind: 'effective' },
    }, '');
    await sample.call(collector);
    let snap = await collector.snapshot();
    expect(snap!.evolution!.stages.measurements.items.map((m) => m.capabilityId)).toEqual(['cap-a']);

    await append('capability.governance.measurement.measured', {
      measurement: { capabilityId: 'cap-b', version: '1' },
      post: { status: 'fail', confidence: 0.6 },
      outcome: { kind: 'ineffective' },
    }, '');
    await sample.call(collector);
    snap = await collector.snapshot();
    expect(snap!.evolution!.stages.measurements.items.map((m) => m.capabilityId)).toEqual(['cap-a', 'cap-b']);
    collector.stop();
  });
});
