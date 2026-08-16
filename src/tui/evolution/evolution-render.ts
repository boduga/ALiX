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

/** Subset of PerTabState the render reads — stage-carrying fields typed to
 *  the canonical `EvolutionStageName` union (never a `string` downgrade). */
export interface EvolutionRenderState {
  readonly evolutionSelectedCapabilityId?: string;
  readonly evolutionExpandedStage?: EvolutionStageName | null;
  readonly evolutionInspector?: { type: EvolutionNodeType; id: string } | null;
  readonly evolutionFlatView?: EvolutionStageName | null;
  readonly evolutionStageCursor?: EvolutionStageName | null;
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
  // Vertically scrollable (Q-L1): the window follows the selected capability
  // so a long spine never overflows the terminal; navigation clamps at the
  // ends rather than wrapping. Reserve 10 rows below the list for the blank,
  // the detail header, and the 6 collapsed stage lines.
  const listW = Math.floor(dims.columns / 2) - 1;
  const listMax = Math.max(1, dims.rows - 10);
  const selIdx = Math.max(0, snap.spine.findIndex((s) => s.capabilityId === spine.capabilityId));
  const listStart = Math.max(0, Math.min(selIdx - Math.floor(listMax / 2), Math.max(0, snap.spine.length - listMax)));
  const listEnd = Math.min(snap.spine.length, listStart + listMax);
  for (let i = listStart; i < listEnd; i++) {
    const s = snap.spine[i]!;
    const marker = s.capabilityId === spine.capabilityId ? '▶ ' : '  ';
    rows.push(`${marker}${riskMarker(s)} ${truncate(s.capabilityId, listW - 3)}`);
  }
  if (listEnd < snap.spine.length) {
    rows.push(`  … ${snap.spine.length - listEnd} more capabilities`);
  }
  rows.push('');

  // Right: selected capability's spine, stage-collapsed (Q-L2). The stage
  // cursor (evolutionStageCursor, default 'lifecycle') owns the right pane's
  // arrow keys and is rendered with a `>` marker.
  const cursorStage = state.evolutionStageCursor ?? 'lifecycle';
  rows.push(`capability ${spine.capabilityId}`);
  for (const stage of EVOLUTION_STAGE_ORDER) {
    const { items, status } = stageState(snap, spine, stage);
    rows.push(stageLine(stage, items, status, state.evolutionExpandedStage, cursorStage));
  }

  if (state.evolutionExpandedStage) {
    rows.push('');
    rows.push(...expandStage(state.evolutionExpandedStage, evolutionStageItems(snap, spine, state.evolutionExpandedStage), state.evolutionArtifactCursor ?? 0));
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

/** Resolve a spine stage to its items + status — single source of truth for
 *  both the collapsed-stage lines and the Q-L3 artifact cursor. lifecycle is a
 *  nullable row, not a StageState — normalized to a one-or-zero item array.
 *
 *  Q-C3b: a failed lifecycle source is a STAGE-level condition. The spine's
 *  nullable row conflates "no row for this capability" (per-capability empty)
 *  with "whole source failed" (unavailable), so the snapshot's authoritative
 *  `stages.lifecycle.status` resolves it — unavailable never renders empty.
 *  The other five stages carry their own StageState on the spine entry, so
 *  they resolve by indexed access (no per-stage cascade). */
function stageState(snap: EvolutionProjectionSnapshot, spine: CapabilitySpineEntry, stage: EvolutionStageName): { items: readonly unknown[]; status: StageStatus } {
  if (stage === 'lifecycle') {
    const stageStatus = snap.stages.lifecycle.status;
    if (stageStatus !== 'available') return { items: [], status: stageStatus };
    return spine.lifecycle ? { items: [spine.lifecycle], status: 'available' } : { items: [], status: 'empty' };
  }
  const s = spine[stage];
  return { items: s.items, status: s.status };
}

/** Items of a stage — exported so the view can resolve the artifact under the
 *  cursor (Q-L3 selection). */
export function evolutionStageItems(snap: EvolutionProjectionSnapshot, spine: CapabilitySpineEntry, stage: EvolutionStageName): readonly unknown[] {
  return stageState(snap, spine, stage).items;
}

/** Q-L3 — which inspectable node type a stage's artifacts carry. lifecycle /
 *  learning have no node type in the projection and cannot be inspected. */
const STAGE_NODE_TYPE: Readonly<Record<EvolutionStageName, EvolutionNodeType | null>> = {
  lifecycle: null,
  learning: null,
  forecasts: 'forecast',
  decisions: 'recommendation', // DecisionRow is a canonical recommendation row (keyed by recommendationId)
  measurements: 'measurement',
  correlations: 'correlation',
};
export function evolutionStageNodeType(stage: EvolutionStageName): EvolutionNodeType | null {
  return STAGE_NODE_TYPE[stage];
}

/** Q-L4a — expanded stage: first 10 artifacts + "… +N more". Decisions render
 *  the RECOMMENDATION / PROJECTED DECISION / TARGET STATE triple. The artifact
 *  cursor (Q-L2) is rendered as a `>` marker. */
function expandStage(stage: EvolutionStageName, items: readonly unknown[], cursor: number): string[] {
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
function renderFlat(snap: EvolutionProjectionSnapshot, stage: EvolutionStageName, rows: string[]): string[] {
  const s = snap.stages[stage];
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
