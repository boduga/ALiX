import { describe, expect, it } from 'vitest';
import { TAB_ORDER, createInitialPerTabState } from '../../../src/tui/state.js';
import { getView } from '../../../src/tui/views/index.js';
import { renderEvolution } from '../../../src/tui/evolution/evolution-render.js';
import { evolutionKeyAction } from '../../../src/tui/evolution/evolution-keys.js';
import { EvolutionView } from '../../../src/tui/evolution/evolution-view.js';

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

  it('renders learning as UNAVAILABLE (never "0 patterns") when the live recompute failed (Q-L4b)', () => {
    const rows = renderEvolution({
      ...snap,
      spine: [{ ...snap.spine[0], learning: { status: 'unavailable', items: [] } }],
      stages: { ...snap.stages, learning: { status: 'unavailable', items: [] } },
    } as any, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('LEARNING') && r.includes('UNAVAILABLE'))).toBe(true);
    expect(rows.some((r) => r.includes('LEARNING') && r.includes('0 patterns'))).toBe(false);
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
  it('maps the Q-L2 table: enter/→ expand, ←/esc collapse, j/k navigate, f flat, c spine', () => {
    const perTab = { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: null } as any;
    expect(evolutionKeyAction('enter', perTab).action).toBe('expand');
    expect(evolutionKeyAction('→', perTab).action).toBe('expand');
    expect(evolutionKeyAction('escape', { ...perTab, evolutionExpandedStage: 'decisions' }).action).toBe('collapse');
    expect(evolutionKeyAction('k', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('j', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('f', perTab).action).toBe('flat');
    expect(evolutionKeyAction('c', perTab).action).toBe('spine');
    // Enter while a stage is expanded selects the artifact (Q-L3 inspector).
    expect(evolutionKeyAction('enter', { ...perTab, evolutionExpandedStage: 'forecasts' }).action).toBe('select');
    // Raw ESC byte (what the TUI's parseKey yields for a lone Escape) collapses.
    expect(evolutionKeyAction('\x1b', perTab).action).toBe('collapse');
  });
});

describe('evolution stage cursor drill-down (Q-L2/Q-L3 reachable)', () => {
  // Two forecasts so the artifact cursor can actually move; one link so the
  // Q-L3 inspector has a related-id to render.
  const forecasts2 = [
    { forecastId: 'forecast-1', kind: 'trust-velocity', band: 'high', confidence: 0.8, subject: 'p1', subjectCapability: 'cap-a' },
    { forecastId: 'forecast-2', kind: 'risk', band: 'critical', confidence: 0.6, subject: 'p2', subjectCapability: 'cap-a' },
  ];
  const snap2 = {
    ...snap,
    stages: { ...snap.stages, forecasts: { status: 'available', items: forecasts2 } },
    spine: [{ ...snap.spine[0], forecasts: { status: 'available', items: forecasts2 } }],
    links: [
      { from: 'forecast-2', fromType: 'forecast', to: 'rec-1', toType: 'recommendation', kind: 'forecast→recommendation' },
    ],
  } as any;

  it('drives the FULL drill-down path through handleKey (no injected evolutionExpandedStage)', () => {
    const perTab = createInitialPerTabState();
    // 1. Select a capability.
    perTab.evolutionSelectedCapabilityId = 'cap-a';
    // handleKey reads ctx.snap.runtime.evolution (DashboardSnapshot shape);
    // renderEvolution takes the projection snapshot directly.
    const ctx = { snap: { runtime: { evolution: snap2 } }, dimensions: { columns: 120, rows: 40 }, perTab } as any;
    const view = new EvolutionView();

    // 2. Enter descends to the right-pane stage cursor, then j moves
    //    lifecycle → learning → forecasts.
    view.handleKey('Enter', ctx);
    expect(perTab.evolutionFocus).toBe('stage');
    view.handleKey('j', ctx);
    expect(perTab.evolutionStageCursor).toBe('learning');
    view.handleKey('j', ctx);
    expect(perTab.evolutionStageCursor).toBe('forecasts');

    // 3. Enter on forecasts → EXPAND the currently selected stage.
    view.handleKey('Enter', ctx);
    expect(perTab.evolutionExpandedStage).toBe('forecasts');
    const rows = renderEvolution(snap2, perTab, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('forecast-1'))).toBe(true);

    // 4. Move the artifact cursor within the expanded forecasts stage.
    expect(perTab.evolutionArtifactCursor).toBe(0);
    view.handleKey('j', ctx);
    expect(perTab.evolutionArtifactCursor).toBe(1);

    // 5. Select a forecast → inspector becomes populated.
    view.handleKey('Enter', ctx);
    expect(perTab.evolutionInspector).toEqual({ type: 'forecast', id: 'forecast-2' });

    // 6. Inspector renders the canonical id + related ids (from snap.links).
    const rows2 = renderEvolution(snap2, perTab, { columns: 120, rows: 40 });
    expect(rows2.some((r) => r.includes('inspector') && r.includes('forecast-2'))).toBe(true);
    expect(rows2.some((r) => r.includes('rec-1'))).toBe(true);

    // 7. Esc returns through the hierarchy WITHOUT changing the capability anchor.
    const anchor = perTab.evolutionSelectedCapabilityId;
    view.handleKey('escape', ctx); // inspector → artifact cursor
    expect(perTab.evolutionInspector).toBeNull();
    expect(perTab.evolutionExpandedStage).toBe('forecasts');
    view.handleKey('escape', ctx); // collapse → stage cursor
    expect(perTab.evolutionExpandedStage).toBeNull();
    expect(perTab.evolutionSelectedCapabilityId).toBe(anchor);
  });

  it('renders the stage-cursor marker on the focused stage row (Q-L2)', () => {
    const perTab = { evolutionSelectedCapabilityId: 'cap-a', evolutionStageCursor: 'forecasts' } as any;
    const rows = renderEvolution(snap2, perTab, { columns: 120, rows: 40 });
    const forecastsLine = rows.find((r) => r.includes('forecasts') && r.includes('artifact'));
    expect(forecastsLine).toBeDefined();
    expect(forecastsLine!.trimStart().startsWith('>')).toBe(true);
  });
});
