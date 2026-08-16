/**
 * Q-L1..L4 — evolution-tab rendering (pure). Render caps are PRESENTATION
 * limits, never projection truncation: collapsed stage "N artifacts",
 * expansion first 10 + "… +N more", flat indexes 50/page.
 *
 * Stage health is read from the projection's real `StageState.status`:
 * `unavailable` renders `(unavailable)` and NEVER `(empty)` (Q-L2/Q-C3b).
 * No I/O, no clocks — `generatedAt` comes from the snapshot.
 */
import type {
  CapabilitySpineEntry,
  DecisionRow,
  EvolutionNodeType,
  EvolutionProjectionSnapshot,
  StageState,
} from '../runtime/evolution/evolution-projection-snapshot.js';
import { truncate } from '../box.js';

export interface EvolutionRenderState {
  readonly evolutionSelectedCapabilityId?: string;
  readonly evolutionExpandedStage?: string | null;
  readonly evolutionInspector?: { type: EvolutionNodeType; id: string } | null;
  readonly evolutionFlatView?: string | null;
}
export interface EvolutionDimensions { readonly columns: number; readonly rows: number; }

const EXPANSION_CAP = 10;
const FLAT_PAGE = 50;

export function renderEvolution(
  snap: EvolutionProjectionSnapshot,
  state: EvolutionRenderState,
  dims: EvolutionDimensions,
): string[] {
  const rows: string[] = [];
  const header = `Evolution as of ${new Date(snap.generatedAt).toLocaleTimeString()}`;
  rows.push(header);
  rows.push('');

  if (snap.spine.length === 0) {
    rows.push('  no capabilities in the evolution loop');
    return rows;
  }

  const selected = state.evolutionSelectedCapabilityId ?? snap.spine[0]!.capabilityId;
  const spine = snap.spine.find((s) => s.capabilityId === selected) ?? snap.spine[0]!;

  if (state.evolutionFlatView) {
    return renderFlat(snap, state.evolutionFlatView, rows);
  }

  // Left capability list (CapabilitiesView convention) — compact risk markers.
  const listW = Math.floor(dims.columns / 2) - 1;
  for (let i = 0; i < snap.spine.length; i++) {
    const s = snap.spine[i]!;
    const marker = s.capabilityId === selected ? '▶ ' : '  ';
    rows.push(`${marker}${riskMarker(s)} ${truncate(s.capabilityId, listW - 3)}`);
  }
  rows.push('');

  // Right: selected capability's spine, stage-collapsed (Q-L2).
  rows.push(`capability ${spine.capabilityId}`);
  rows.push(stageLine('lifecycle', spine.lifecycle ? [spine.lifecycle.capabilityId] : [], spine.lifecycle ? 'available' : 'empty', 'lifecycle', state.evolutionExpandedStage));
  rows.push(stageLine('learning', spine.learning.items, spine.learning.status, 'learning', state.evolutionExpandedStage));
  rows.push(stageLine('forecasts', spine.forecasts.items, spine.forecasts.status, 'forecasts', state.evolutionExpandedStage));
  rows.push(stageLine('decisions', spine.decisions.items, spine.decisions.status, 'decisions', state.evolutionExpandedStage));
  rows.push(stageLine('measurements', spine.measurements.items, spine.measurements.status, 'measurements', state.evolutionExpandedStage));
  rows.push(stageLine('correlations', spine.correlations.items, spine.correlations.status, 'correlations', state.evolutionExpandedStage));

  if (state.evolutionExpandedStage) {
    rows.push('');
    rows.push(...expandStage(state.evolutionExpandedStage, stageItems(spine, state.evolutionExpandedStage)));
  }

  if (state.evolutionInspector) {
    rows.push('');
    rows.push(...renderInspector(snap, state.evolutionInspector));
  }

  return rows;
}

/** Q-L4c/Q-L4b — collapsed stage line: "N artifacts" + status; learning uses
 *  the live-pattern format (Q-L4b). available/empty/unavailable distinct —
 *  an unavailable stage NEVER renders as an empty section (Q-L2/Q-C3b). */
function stageLine(
  name: string,
  items: readonly unknown[],
  status: string,
  stage: string,
  expanded: string | null | undefined,
): string {
  const n = items.length;
  const label = name === 'learning'
    ? `LEARNING — ${n} pattern${n === 1 ? '' : 's'} (computed live)`
    : `${name} — ${n} artifact${n === 1 ? '' : 's'}`;
  const open = expanded === stage ? '▼' : '▶';
  const statusSuffix = status === 'unavailable' ? ' (unavailable)' : status === 'empty' ? ' (empty)' : '';
  return `  ${open} ${label}${statusSuffix}`;
}

function riskMarker(s: { forecasts: StageState<{ band: string }> }): string {
  const bands = s.forecasts.status === 'available' ? s.forecasts.items.map((f) => f.band) : [];
  if (bands.includes('critical')) return '!!';
  if (bands.includes('high')) return '!';
  return '·';
}

/** Resolve a spine stage to its artifact array (lifecycle is a nullable row,
 *  not a StageState — normalize it to a one-or-zero item array). */
function stageItems(spine: CapabilitySpineEntry, stage: string): readonly unknown[] {
  switch (stage) {
    case 'lifecycle': return spine.lifecycle ? [spine.lifecycle] : [];
    case 'learning': return spine.learning.items;
    case 'forecasts': return spine.forecasts.items;
    case 'decisions': return spine.decisions.items;
    case 'measurements': return spine.measurements.items;
    case 'correlations': return spine.correlations.items;
    default: return [];
  }
}

/** Q-L4a — expanded stage: first 10 artifacts + "… +N more". Decisions render
 *  the RECOMMENDATION / PROJECTED DECISION / TARGET STATE triple. */
function expandStage(stage: string, items: readonly unknown[]): string[] {
  const shown = items.slice(0, EXPANSION_CAP);
  const more = items.length - shown.length;
  const out: string[] = [];
  if (stage === 'decisions') {
    for (const it of shown) {
      const d = it as DecisionRow;
      out.push(`    RECOMMENDATION ${d.recommendationKind} (${d.recommendationId})`);
      out.push(`    PROJECTED DECISION ${d.projectedDecision ?? '—'}`);
      out.push(`    TARGET STATE ${d.targetState ?? '—'}`);
    }
  } else {
    for (const it of shown) out.push(`    ${displayId(it)}`);
  }
  if (more > 0) out.push(`    … +${more} more`);
  return out;
}

function displayId(it: unknown): string {
  if (it && typeof it === 'object') {
    const r = it as Record<string, unknown>;
    return (r.forecastId as string) ?? (r.recommendationId as string) ?? (r.measurementId as string) ?? (r.correlationId as string) ?? (r.findingId as string) ?? (r.capabilityId as string) ?? (r.id as string) ?? '?';
  }
  return '?';
}

/** Q-L2 — flat index mode: 50/page over a flat stage state. */
function renderFlat(snap: EvolutionProjectionSnapshot, stage: string, rows: string[]): string[] {
  const s = snap.stages[stage as keyof EvolutionProjectionSnapshot['stages']];
  const items = s?.items ?? [];
  const page = items.slice(0, FLAT_PAGE);
  rows.push(`flat — ${stage} (${page.length}/${items.length})`);
  for (const it of page) rows.push(`  ${displayId(it)}`);
  if (items.length > FLAT_PAGE) rows.push(`  … +${items.length - FLAT_PAGE} more`);
  return rows;
}

/** Q-L3 — reference-by-id read-only inspector: the artifact + its other
 *  relationships ('also correlated with: forecast-456'). Never ownership. */
function renderInspector(snap: EvolutionProjectionSnapshot, target: { type: EvolutionNodeType; id: string }): string[] {
  const related = snap.links.filter((l) =>
    (l.from === target.id && l.fromType === target.type) ||
    (l.to === target.id && l.toType === target.type));
  return [
    `inspector — ${target.type} ${target.id}`,
    ...related.map((l) => `  ${l.kind}: ${l.fromType} ${l.from} → ${l.toType} ${l.to}`),
    ...(related.length === 0 ? ['  no relationships'] : []),
  ];
}
