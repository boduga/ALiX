import { describe, expect, it } from 'vitest';
import { EvolutionProjection } from '../../../src/tui/runtime/evolution/evolution-projection.js';

const now = 1_700_000_000_000;
function clock(): number { return now; }

// A sessionless `measured` event shape (payload has NO proposalId/forecastId/correlationId — sentinel).
function measuredEvent(seq: number, id: string, capabilityId: string) {
  return {
    seq, id, sessionId: '', version: 1 as const, actor: 'system' as const,
    type: 'capability.governance.measurement.measured',
    timestamp: new Date(now + seq * 1000).toISOString(),
    payload: {
      measurement: { capabilityId, version: '1' },
      post: { status: 'pass' as const, confidence: 0.9 },
      outcome: { kind: 'effective' as const },
    },
  };
}
function submittedEvent(seq: number, proposalId: string, capabilityId: string) {
  return {
    seq, id: `e${seq}`, sessionId: '', version: 1 as const, actor: 'system' as const,
    type: 'capability.governance.proposal.submitted',
    timestamp: new Date(now + seq * 1000).toISOString(),
    payload: { proposalId, candidate: { target: { id: capabilityId } } },
  };
}

function makeProjection(overrides: Record<string, unknown> = {}) {
  const sources = {
    lifecycle: () => [{ capabilityId: 'cap-a', state: 'active' as const, eligible: true }],
    forecasts: () => Promise.resolve([] as any[]),
    correlations: () => Promise.resolve([] as any[]),
    recommendations: () => Promise.resolve([] as any[]),
    learning: { learn: async () => null },
    ...overrides,
  };
  return new EvolutionProjection({ sources, clock });
}

describe('EvolutionProjection', () => {
  it('ingestSessionless dedupes by event.seq and persists via exportState', () => {
    const p = makeProjection();
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]);
    p.ingestSessionless([measuredEvent(2, 'm2', 'cap-a'), measuredEvent(3, 'm3', 'cap-a')]); // seq 2 re-delivered
    const state = p.exportState();
    expect(state.seenSeqs).toEqual({ '1': true, '2': true, '3': true });
    expect(state.measurements.map((m: any) => m.measurementId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('does not re-apply relayed events after importState (restart durability — Q-C4)', async () => {
    const p1 = makeProjection();
    p1.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]);
    await p1.snapshot();
    const state = p1.exportState();

    const p2 = makeProjection();
    p2.importState(state);
    p2.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]); // process 2 re-reads same batch
    const snap = await p2.snapshot();
    expect(snap.stages.measurements.items.map((m) => m.measurementId)).toEqual(['m1', 'm2']);
    expect(snap.stages.measurements.status).toBe('available');
  });

  it('gates A8 recompute on newly observed relevant events (not any event)', async () => {
    let learns = 0;
    const p = makeProjection({ learning: { learn: async () => { learns++; return null; } } });
    await p.snapshot(); // no relevant events yet → no learn
    expect(learns).toBe(0);
    p.ingestSessionless([submittedEvent(1, 'proposal-1', 'cap-a')]); // relevant
    await p.snapshot();
    expect(learns).toBe(1);
    await p.snapshot(); // no new relevant events → retained, no re-learn
    expect(learns).toBe(1);
  });

  it('relevant change + failure ⇒ learning unavailable; later success restores (Q-C2)', async () => {
    let fail = true;
    const p = makeProjection({
      learning: {
        learn: async () => { if (fail) throw new Error('boom'); return { proposalId: 'p', generatedAt: '', findings: [] }; },
      },
    });
    p.ingestSessionless([submittedEvent(1, 'proposal-1', 'cap-a')]);
    await p.snapshot();
    expect((await p.snapshot()).stages.learning.status).toBe('unavailable');
    fail = false;
    p.ingestSessionless([submittedEvent(2, 'proposal-2', 'cap-a')]);
    const restored = await p.snapshot();
    expect(restored.stages.learning.status).toBe('empty'); // success, 0 patterns
  });

  it('measurement stage is unavailable before any relay, then available/empty (empty ≠ unavailable)', async () => {
    const p = makeProjection();
    expect((await p.snapshot()).stages.measurements.status).toBe('unavailable');
    p.ingestSessionless([]); // relay observed (empty batch)
    expect((await p.snapshot()).stages.measurements.status).toBe('empty');
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a')]);
    expect((await p.snapshot()).stages.measurements.status).toBe('available');
  });

  it('snapshot never throws — a failed JSONL read becomes an unavailable stage', async () => {
    const p = makeProjection({ forecasts: async () => { throw new Error('disk'); } });
    const snap = await p.snapshot();
    expect(snap.stages.forecasts.status).toBe('unavailable');
    expect(snap.stages.forecasts.items).toHaveLength(0);
  });

  it('generatedAt is the injected collector-cycle clock, single observation point', async () => {
    const p = makeProjection();
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a')]);
    const snap = await p.snapshot();
    expect(snap.generatedAt).toBe(now);
  });
});
