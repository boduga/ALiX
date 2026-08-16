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
import { makeEventLog, makeCheckpointStore, SESSION_ID } from './collector-harness.js';

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
