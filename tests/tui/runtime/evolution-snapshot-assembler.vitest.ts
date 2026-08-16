import { describe, expect, it } from 'vitest';
import { assembleEvolutionSnapshot } from '../../../src/tui/runtime/evolution/evolution-snapshot-assembler.js';

// Minimal canonical-artifact fixtures (A9/A2.5-shaped).
const forecast = {
  forecastId: 'forecast-1', forecastVersion: 1,
  subject: 'proposal-1', subjectCapability: 'cap-a',
  prediction: { kind: 'trust-velocity', band: 'high', internalScore: 70 },
  horizon: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' },
  confidence: 0.8,
  provenance: { generatedAt: '2026-08-15T00:00:00.000Z', generatorVersion: '1', evidenceRefs: [] },
} as const;
const recommendation = {
  recommendationId: 'rec-1', evidenceId: 'e1', proposalId: 'proposal-1',
  kind: 'RISK_GATED_REVIEW', confidence: 0.7, reasoning: 'r', supportingEvidence: [], risks: [],
  createdAt: '2026-08-15T00:00:00.000Z',
} as const;
const measurement = {
  measurementId: 'measurement-1', eventId: '1', capabilityId: 'cap-a',
  recordedAt: '2026-08-10T00:00:00.000Z', status: 'pass', outcomeKind: 'effective', confidence: 0.9,
} as const;
const correlation = {
  correlationId: 'corr-1', correlationVersion: 1, forecastId: 'forecast-1', measurementId: 'measurement-1',
  foreignProvenance: { proposalId: 'proposal-1' },
  resolution: { band: 'high', forecastBand: 'high', delta: 'match' },
} as const;

const inputs = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: 1_700_000_000_000,
  lifecycle: { records: [{ capabilityId: 'cap-a', state: 'active', eligible: true }], status: 'available' },
  learning: { result: null, unavailable: false },
  forecasts: { records: [forecast], status: 'available' },
  correlations: { records: [correlation], status: 'available' },
  recommendations: { records: [recommendation], status: 'available' },
  measurements: { records: [measurement], status: 'available' },
  proposalTargets: { 'proposal-1': 'cap-a' },
  ...overrides,
});

describe('assembleEvolutionSnapshot', () => {
  it('assembles the capability spine rooted at the measured capability', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    expect(snap.generatedAt).toBe(1_700_000_000_000);
    expect(snap.spine.map((s) => s.capabilityId)).toEqual(['cap-a']);
    expect(snap.spine[0]!.forecasts.items.map((f) => f.forecastId)).toEqual(['forecast-1']);
    expect(snap.spine[0]!.measurements.items.map((m) => m.measurementId)).toEqual(['measurement-1']);
    expect(snap.spine[0]!.decisions.items.map((d) => d.recommendationId)).toEqual(['rec-1']);
  });

  it('derives decision rows as recommendation/projectedDecision/targetState', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    const d = snap.stages.decisions.items[0]!;
    expect(d.recommendationId).toBe('rec-1');
    expect(d.recommendationKind).toBe('RISK_GATED_REVIEW');
    expect(d.projectedDecision).toBe('REQUEST_MORE_EVIDENCE');
    expect(d.targetState).toBe('UNDER_REVIEW');
  });

  it('maps an unmapped recommendation kind to a null projected decision', () => {
    const snap = assembleEvolutionSnapshot(inputs({
      recommendations: { records: [{ ...recommendation, kind: 'ESCALATE' }], status: 'available' },
    }));
    const d = snap.stages.decisions.items[0]!;
    expect(d.projectedDecision).toBeNull();
    expect(d.targetState).toBeNull();
  });

  it('treats empty != unavailable', () => {
    const empty = assembleEvolutionSnapshot(inputs({ forecasts: { records: [], status: 'empty' } }));
    expect(empty.stages.forecasts.status).toBe('empty');
    const unavailable = assembleEvolutionSnapshot(inputs({ forecasts: { records: [], status: 'unavailable' } }));
    expect(unavailable.stages.forecasts.status).toBe('unavailable');
    // Items are ALWAYS empty unless status is 'available'.
    expect(unavailable.stages.forecasts.items).toHaveLength(0);
  });

  it('shows learning as empty for a successful recompute with zero patterns', () => {
    const snap = assembleEvolutionSnapshot(inputs({ learning: { result: { proposalId: 'p', generatedAt: '', findings: [] }, unavailable: false } }));
    expect(snap.stages.learning.status).toBe('empty');
  });

  it('shows learning as unavailable when recompute failed', () => {
    const snap = assembleEvolutionSnapshot(inputs({ learning: { result: null, unavailable: true } }));
    expect(snap.stages.learning.status).toBe('unavailable');
    expect(snap.stages.learning.items).toHaveLength(0);
  });

  it('associates findings to capabilities (identityKey = capabilityId or fingerprint suffix)', () => {
    const snap = assembleEvolutionSnapshot(inputs({
      learning: {
        result: { proposalId: 'p', generatedAt: '', findings: [
          { findingId: 'f1', kind: 'underperformer', identityKey: 'cap-a', evidenceWindow: { from: '', to: '' }, occurrences: 2, evidenceRefs: [], summary: 's' },
        ] },
        unavailable: false,
      },
    }));
    expect(snap.spine[0]!.learning.items.map((f) => f.findingId)).toEqual(['f1']);
  });

  it('emits the link index (forecast→recommendation and correlation bridges)', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    expect(snap.links.filter((l) => l.kind === 'forecast→recommendation')).toHaveLength(1);
    expect(snap.links.filter((l) => l.kind === 'forecast→correlation')).toHaveLength(1);
    expect(snap.links.filter((l) => l.kind === 'measurement→correlation')).toHaveLength(1);
  });
});
