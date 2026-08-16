import { describe, expect, it } from 'vitest';
import { buildEvolutionLinks } from '../../../src/tui/runtime/evolution/evolution-link-builder.js';

const forecast = { forecastId: 'forecast-1', subject: 'proposal-1', subjectCapability: 'cap-a' } as any;
const forecast2 = { forecastId: 'forecast-2', subject: 'proposal-1', subjectCapability: 'cap-a' } as any;
const rec = (id: string, proposalId: string, kind = 'APPROVE') => ({
  recommendationId: id, evidenceId: 'e', proposalId, kind, confidence: 0.5, reasoning: '', supportingEvidence: [], risks: [], createdAt: '',
}) as any;
const measurement = { measurementId: 'measurement-1', eventId: '1', capabilityId: 'cap-a', recordedAt: '', status: 'pass', outcomeKind: 'effective', confidence: 0.9 } as any;
const correlation = { correlationId: 'corr-1', forecastId: 'forecast-1', measurementId: 'measurement-1' } as any;

describe('buildEvolutionLinks', () => {
  it('emits forecast→recommendation for shared proposalId, many-to-many', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast, forecast2],
      recommendations: [rec('rec-1', 'proposal-1'), rec('rec-2', 'proposal-1')],
      measurements: [], correlations: [], proposalTargets: { 'proposal-1': 'cap-a' },
    });
    const fr = links.filter((l) => l.kind === 'forecast→recommendation');
    expect(fr).toHaveLength(4); // 2 forecasts × 2 recommendations
    expect(fr.every((l) => l.fromType === 'forecast' && l.toType === 'recommendation')).toBe(true);
  });

  it('emits recommendation→decision (PROJECTED) only for mappable kinds', () => {
    const links = buildEvolutionLinks({
      forecasts: [], recommendations: [rec('rec-1', 'p', 'RISK_GATED_REVIEW'), rec('rec-2', 'p', 'ESCALATE')],
      measurements: [], correlations: [], proposalTargets: {},
    });
    const rd = links.filter((l) => l.kind === 'recommendation→decision');
    expect(rd.map((l) => l.from)).toEqual(['rec-1']);
  });

  it('emits decision→measurement via the proposal target capability', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast], recommendations: [rec('rec-1', 'proposal-1', 'APPROVE')],
      measurements: [measurement], correlations: [],
      proposalTargets: { 'proposal-1': 'cap-a' },
    });
    const dm = links.filter((l) => l.kind === 'decision→measurement');
    expect(dm).toHaveLength(1);
    expect(dm[0]).toMatchObject({ from: 'rec-1', fromType: 'decision', to: 'measurement-1', toType: 'measurement' });
  });

  it('emits forecast→correlation and measurement→correlation per correlation; NO direct forecast→measurement edge', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast], recommendations: [], measurements: [measurement], correlations: [correlation],
      proposalTargets: {},
    });
    expect(links.filter((l) => l.kind === 'forecast→correlation')).toHaveLength(1);
    expect(links.filter((l) => l.kind === 'measurement→correlation')).toHaveLength(1);
    expect(links.filter((l) => l.fromType === 'forecast' && l.toType === 'measurement')).toHaveLength(0);
  });

  it('never designates a primary or collapses many-to-many', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast, forecast2], recommendations: [], measurements: [measurement],
      correlations: [
        { ...correlation, correlationId: 'corr-1' },
        { ...correlation, correlationId: 'corr-2', forecastId: 'forecast-2' },
      ],
      proposalTargets: {},
    });
    // measurement-1 appears in two correlations — both edges present.
    const mc = links.filter((l) => l.kind === 'measurement→correlation');
    expect(mc.map((l) => l.to)).toEqual(['corr-1', 'corr-2']);
  });
});
