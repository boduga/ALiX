/**
 * Q-L1..L4 — evolution-tab rendering (pure). Render caps are PRESENTATION
 * limits, never projection truncation: collapsed stage "N artifacts",
 * expansion first 10 + "… +N more", flat indexes 50/page.
 *
 * Stage health is read from the projection's real `StageState.status`:
 * `unavailable` renders `(unavailable)` and NEVER `(empty)` (Q-L2/Q-C3b).
 * The stage cursor (Q-L2, right pane) and the artifact cursor (inside an
 * expanded stage) are rendered as `>` markers. No I/O, no clocks —
 * `generatedAt` comes from the snapshot.
 */
import type {
  CapabilitySpineEntry,
  DecisionRow,
  EvolutionNodeType,
  EvolutionProjectionSnapshot,
  EvolutionStageName,
  StageState,
  StageStatus,
} from '../runtime/evolution/evolution-projection-snapshot.js';
import { truncate } from '../box.js';

/** Q-L2 — the six spine stages, in display order (also the stage cursor cycle).
 *  The stage-name union itself is canonical in the snapshot contract. */
export const EVOLUTION_STAGE_ORDER: readonly EvolutionStageName[] = ['lifecycle', 'learning', 'forecasts', 'decisions', 'measurements', 'correlations'];
export type { EvolutionStageName };

export interface EvolutionRenderState {
  readonly evolutionSelectedCapabilityId?: string;
  readonly evolutionExpandedStage?: string | null;
  readonly evolutionInspector?: { type: EvolutionNodeType; id: string } | null;
  readonly evolutionFlatView?: string | null;
  readonly evolutionStageCursor?: string | null;
  readonly evolutionArtifactCursor?: number | null;
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

  // Right: selected capability's spine, stage-collapsed (Q-L2). The stage
  // cursor (evolutionStageCursor, default 'lifecycle') owns the right pane's
  // arrow keys and is rendered with a `>` marker.
  const cursorStage = state.evolutionStageCursor ?? 'lifecycle';
  rows.push(`capability ${spine.capabilityId}`);
  for (const stage of EVOLUTION_STAGE_ORDER) {
    const { items, status } = stageState(spine, stage);
    rows.push(stageLine(stage, items, status, state.evolutionExpandedStage, cursorStage));
  }

  if (state.evolutionExpandedStage) {
    rows.push('');
    rows.push(...expandStage(state.evolutionExpandedStage, evolutionStageItems(spine, state.evolutionExpandedStage), state.evolutionArtifactCursor ?? 0));
  }

  if (state.evolutionInspector) {
    rows.push('');
    rows.push(...renderInspector(snap, state.evolutionInspector));
  }

  return rows;
}

/** Q-L4c/Q-L4b — collapsed stage line: "N artifacts" + status. Learning uses
 *  the live-pattern format (Q-L4b): available ⇒ "N patterns (computed live)",
 *  empty ⇒ "0 patterns", failure ⇒ UNAVAILABLE (never a false "0 patterns").
 *  Status stays visually distinct — an unavailable stage never renders as an
 *  empty section (Q-L2/Q-C3b). */
function stageLine(
  stage: EvolutionStageName,
  items: readonly unknown[],
  status: StageStatus,
  expanded: string | null | undefined,
  cursorStage: string,
): string {
  const n = items.length;
  let label: string;
  if (stage === 'learning' && status === 'unavailable') {
    label = 'LEARNING — UNAVAILABLE';
  } else if (stage === 'learning') {
    label = `LEARNING — ${n} pattern${n === 1 ? '' : 's'} (computed live)`;
  } else {
    label = `${stage} — ${n} artifact${n === 1 ? '' : 's'}`;
  }
  const open = expanded === stage ? '▼' : '▶';
  // Learning's UNAVAILABLE / "0 patterns" labels already carry the status —
  // no redundant suffix. Other stages suffix unavailable/empty distinctly.
  const statusSuffix = status === 'unavailable' || status === 'empty'
    ? (stage === 'learning' ? '' : ` (${status})`)
    : '';
  const cursorMark = cursorStage === stage ? '>' : ' ';
  return `${cursorMark} ${open} ${label}${statusSuffix}`;
}

function riskMarker(s: { forecasts: StageState<{ band: string }> }): string {
  const bands = s.forecasts.status === 'available' ? s.forecasts.items.map((f) => f.band) : [];
  if (bands.includes('critical')) return '!!';
  if (bands.includes('high')) return '!';
  return '·';
}

/** Resolve a spine stage to its artifact array (lifecycle is a nullable row,
 *  not a StageState — normalize it to a one-or-zero item array). Exported so
 *  the view can resolve the artifact under the cursor (Q-L3 selection). */
/** Resolve a spine stage to its items + status — single source of truth for
 *  both the collapsed-stage lines and the Q-L3 artifact cursor. lifecycle is a
 *  nullable row, not a StageState — normalized to a one-or-zero item array. */
function stageState(spine: CapabilitySpineEntry, stage: EvolutionStageName): { items: readonly unknown[]; status: StageStatus } {
  switch (stage) {
    case 'lifecycle': return { items: spine.lifecycle ? [spine.lifecycle] : [], status: spine.lifecycle ? 'available' : 'empty' };
    case 'learning': return { items: spine.learning.items, status: spine.learning.status };
    case 'forecasts': return { items: spine.forecasts.items, status: spine.forecasts.status };
    case 'decisions': return { items: spine.decisions.items, status: spine.decisions.status };
    case 'measurements': return { items: spine.measurements.items, status: spine.measurements.status };
    case 'correlations': return { items: spine.correlations.items, status: spine.correlations.status };
    default: return { items: [], status: 'unavailable' };
  }
}

/** Items of a stage — exported so the view can resolve the artifact under the
 *  cursor (Q-L3 selection). */
export function evolutionStageItems(spine: CapabilitySpineEntry, stage: string): readonly unknown[] {
  return stageState(spine, stage as EvolutionStageName).items;
}

/** Q-L3 — which inspectable node type a stage's artifacts carry. lifecycle /
 *  learning have no node type in the projection and cannot be inspected. */
export function evolutionStageNodeType(stage: string): EvolutionNodeType | null {
  switch (stage) {
    case 'forecasts': return 'forecast';
    case 'decisions': return 'recommendation'; // DecisionRow is a canonical recommendation row (keyed by recommendationId)
    case 'measurements': return 'measurement';
    case 'correlations': return 'correlation';
    default: return null;
  }
}

/** Q-L4a — expanded stage: first 10 artifacts + "… +N more". Decisions render
 *  the RECOMMENDATION / PROJECTED DECISION / TARGET STATE triple. The artifact
 *  cursor (Q-L2) is rendered as a `>` marker. */
function expandStage(stage: string, items: readonly unknown[], cursor: number): string[] {
  const shown = items.slice(0, EXPANSION_CAP);
  const more = items.length - shown.length;
  const out: string[] = [];
  if (stage === 'decisions') {
    for (let i = 0; i < shown.length; i++) {
      const d = shown[i] as DecisionRow;
      const mark = i === cursor ? '>' : ' ';
      out.push(`  ${mark} RECOMMENDATION ${d.recommendationKind} (${d.recommendationId})`);
      out.push(`  ${mark} PROJECTED DECISION ${d.projectedDecision ?? '—'}`);
      out.push(`  ${mark} TARGET STATE ${d.targetState ?? '—'}`);
    }
  } else {
    for (let i = 0; i < shown.length; i++) {
      const mark = i === cursor ? '>' : ' ';
      out.push(`  ${mark} ${displayId(shown[i])}`);
    }
  }
  if (more > 0) out.push(`    … +${more} more`);
  return out;
}

/** Canonical artifact id for a stage row. Exported so the view can build the
 *  Q-L3 inspector target `{ type, id }` for the artifact under the cursor. */
export function displayId(it: unknown): string {
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
