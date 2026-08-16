import { describe, expect, it } from 'vitest';
import { TAB_ORDER, createInitialPerTabState } from '../../../src/tui/state.js';
import { getView } from '../../../src/tui/views/index.js';
import { renderEvolution } from '../../../src/tui/evolution/evolution-render.js';
import { evolutionKeyAction } from '../../../src/tui/evolution/evolution-keys.js';

describe('evolution tab plumbing', () => {
  it('TAB_ORDER contains evolution exactly once, after capabilities', () => {
    expect(TAB_ORDER.filter((t) => t === 'evolution')).toHaveLength(1);
    expect(TAB_ORDER[TAB_ORDER.length - 1]).toBe('evolution');
  });

  it('createInitialPerTabState seeds evolution fields and round-trips JSON', () => {
    const s = createInitialPerTabState();
    const roundTripped = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(roundTripped).toEqual(s);
  });

  it('registers an evolution view in the view registry', () => {
    const v = getView('evolution');
    expect(v).toBeDefined();
    expect(v!.id).toBe('evolution');
  });
});

// A minimal snapshot: one capability, one forecast, one decision, one measurement.
const snap = {
  generatedAt: 1_700_000_000_000,
  stages: {
    lifecycle: { status: 'available', items: [{ capabilityId: 'cap-a', state: 'active', eligible: true }] },
    learning: { status: 'empty', items: [] },
    forecasts: { status: 'available', items: [{ forecastId: 'forecast-1', kind: 'trust-velocity', band: 'high', confidence: 0.8, subject: 'p1', subjectCapability: 'cap-a' }] },
    decisions: { status: 'available', items: [{ recommendationId: 'rec-1', recommendationKind: 'RISK_GATED_REVIEW', proposalId: 'p1', confidence: 0.7, projectedDecision: 'REQUEST_MORE_EVIDENCE', targetState: 'UNDER_REVIEW' }] },
    measurements: { status: 'available', items: [{ measurementId: 'measurement-1', capabilityId: 'cap-a', recordedAt: '2026-08-10', status: 'pass', outcomeKind: 'effective', confidence: 0.9 }] },
    correlations: { status: 'empty', items: [] },
  },
  spine: [{
    capabilityId: 'cap-a',
    lifecycle: { capabilityId: 'cap-a', state: 'active', eligible: true },
    learning: { status: 'empty', items: [] },
    forecasts: { status: 'available', items: [{ forecastId: 'forecast-1', kind: 'trust-velocity', band: 'high', confidence: 0.8, subject: 'p1', subjectCapability: 'cap-a' }] },
    decisions: { status: 'available', items: [{ recommendationId: 'rec-1', recommendationKind: 'RISK_GATED_REVIEW', proposalId: 'p1', confidence: 0.7, projectedDecision: 'REQUEST_MORE_EVIDENCE', targetState: 'UNDER_REVIEW' }] },
    measurements: { status: 'available', items: [{ measurementId: 'measurement-1', capabilityId: 'cap-a', recordedAt: '2026-08-10', status: 'pass', outcomeKind: 'effective', confidence: 0.9 }] },
    correlations: { status: 'empty', items: [] },
  }],
  links: [],
} as any;

describe('renderEvolution', () => {
  it('renders the capability list on the left (Q-L1)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('cap-a'))).toBe(true);
  });

  it('renders collapsed stages as "N artifacts" (Q-L4c)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('forecasts') && r.includes('1 artifact'))).toBe(true);
  });

  it('renders a decision as RECOMMENDATION / PROJECTED DECISION / TARGET STATE (Q-L4a)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: 'decisions' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('RECOMMENDATION') && r.includes('RISK_GATED_REVIEW'))).toBe(true);
    expect(rows.some((r) => r.includes('PROJECTED DECISION') && r.includes('REQUEST_MORE_EVIDENCE'))).toBe(true);
    expect(rows.some((r) => r.includes('TARGET STATE') && r.includes('UNDER_REVIEW'))).toBe(true);
  });

  it('renders learning as "LEARNING — N patterns (computed live)" (Q-L4b)', () => {
    const rows = renderEvolution({
      ...snap,
      spine: [{ ...snap.spine[0], learning: { status: 'available', items: [{ findingId: 'f1', kind: 'underperformer', occurrences: 2, summary: 's' }] } }],
      stages: { ...snap.stages, learning: { status: 'available', items: [{ findingId: 'f1', kind: 'underperformer', occurrences: 2, summary: 's' }] } },
    } as any, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('LEARNING') && r.includes('1 pattern'))).toBe(true);
  });

  it('caps expanded stage at 10 with "+N more" (Q-L4c — presentation limit)', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ findingId: `f${i}`, kind: 'underperformer', occurrences: 1, summary: `s${i}` }));
    const rows = renderEvolution({
      ...snap,
      spine: [{ ...snap.spine[0], learning: { status: 'available', items: many } }],
      stages: { ...snap.stages, learning: { status: 'available', items: many } },
    } as any, { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: 'learning' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('+3 more'))).toBe(true);
  });

  it('renders "Evolution as of" with the generatedAt, never a stage age (Q-C3b)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('Evolution as of'))).toBe(true);
    expect(rows.some((r) => /ago|seconds|old/.test(r))).toBe(false);
  });
});

describe('evolutionKeyAction', () => {
  it('maps the Q-L2 table: enter/→ expand, ←/esc collapse, j/k scroll, f flat, c spine', () => {
    const perTab = { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: null } as any;
    expect(evolutionKeyAction('enter', perTab).action).toBe('expand');
    expect(evolutionKeyAction('→', perTab).action).toBe('expand');
    expect(evolutionKeyAction('escape', { ...perTab, evolutionExpandedStage: 'decisions' }).action).toBe('collapse');
    expect(evolutionKeyAction('k', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('j', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('f', perTab).action).toBe('flat');
    expect(evolutionKeyAction('c', perTab).action).toBe('spine');
  });
});
