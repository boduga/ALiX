/**
 * Q5/Q-L1 — the `evolution` tab: capability-spine overview with a two-level
 * selection hierarchy (Q-L2), stage-collapsed drill-down, a reference-by-id
 * Q-L3 inspector, and flat indexes. Read-only.
 *
 * Hierarchy (shallow → deep): LEFT capability cursor → RIGHT stage cursor →
 * expanded-stage artifact cursor → inspector. Enter descends one level,
 * Esc/← ascends one level WITHOUT changing the capability anchor; arrow keys
 * navigate whichever cursor owns the current focus level. The stage cursor
 * makes every stage reachable from the keyboard — Enter expands the CURRENTLY
 * SELECTED stage, never a hardcoded default.
 *
 * Reads `ctx.snap.runtime.evolution` (the Task 2 evolution projection
 * snapshot); renders via `renderEvolution` (pure) and dispatches keys via
 * `evolutionKeyAction` (pure). handleKey mutates only `ctx.perTab`.
 */
import type { CapabilitySpineEntry } from '../runtime/evolution/evolution-projection-snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type { TuiView, ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult } from '../views/types.js';
import { renderEvolution, EVOLUTION_STAGE_ORDER, type EvolutionStageName, evolutionStageItems, evolutionStageNodeType, displayId } from './evolution-render.js';
import { evolutionKeyAction } from './evolution-keys.js';

export class EvolutionView implements TuiView {
  readonly id: TabId = 'evolution';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const snap = ctx.snap.runtime?.evolution ?? null;
    if (!snap) {
      return { rows: ['\x1b[90mevolution unavailable — projection not registered\x1b[0m'], hint: '' };
    }
    const rows = renderEvolution(snap, ctx.perTab as PerTabState, ctx.dimensions);
    return { rows, hint: '↑↓ move · Enter expand/select · Esc up · f flat · c spine' };
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    const perTab = ctx.perTab;
    const action = evolutionKeyAction(key, perTab);
    switch (action.action) {
      case 'navigate': this.navigate(ctx, action.direction); return { type: 'handled' };
      case 'expand': this.descend(ctx); return { type: 'handled' };
      case 'select': this.openInspector(ctx); return { type: 'handled' };
      case 'collapse': this.ascend(ctx); return { type: 'handled' };
      case 'flat':
        perTab.evolutionFlatView = perTab.evolutionFlatView ? null : (perTab.evolutionFlatView ?? 'forecasts');
        return { type: 'handled' };
      case 'spine':
        perTab.evolutionFlatView = null;
        perTab.evolutionInspector = null;
        perTab.evolutionExpandedStage = null;
        perTab.evolutionArtifactCursor = 0;
        perTab.evolutionStageCursor = 'lifecycle';
        perTab.evolutionFocus = 'capability';
        return { type: 'handled' };
      default: return { type: 'handled' };
    }
  }

  /** Arrow keys: move the cursor at the current focus level. */
  private navigate(ctx: ViewInputContext, direction: -1 | 1): void {
    const perTab = ctx.perTab;
    if (perTab.evolutionFlatView || perTab.evolutionInspector) return; // flat scroll / read-only inspector
    const focus = perTab.evolutionFocus ?? 'capability';
    if (perTab.evolutionExpandedStage) {
      // Artifact cursor within the expanded stage (clamped to its items).
      const spine = this.spineOf(ctx);
      if (!spine) return;
      const items = evolutionStageItems(spine, perTab.evolutionExpandedStage);
      const max = Math.max(0, items.length - 1);
      perTab.evolutionArtifactCursor = clamp((perTab.evolutionArtifactCursor ?? 0) + direction, 0, max);
      return;
    }
    if (focus === 'capability') {
      perTab.evolutionSelectedCapabilityId = cycleCapability(ctx, direction);
    } else {
      perTab.evolutionStageCursor = cycleStage(perTab.evolutionStageCursor ?? 'lifecycle', direction);
    }
  }

  /** Enter: descend one level — capability cursor → stage cursor → expand. */
  private descend(ctx: ViewInputContext): void {
    const perTab = ctx.perTab;
    const focus = perTab.evolutionFocus ?? 'capability';
    if (focus === 'capability') {
      // The capability under the cursor is already `evolutionSelectedCapabilityId`;
      // descending just moves the arrow keys into the right pane's stage cursor.
      perTab.evolutionFocus = 'stage';
      return;
    }
    // Stage focus → expand the CURRENTLY SELECTED stage (never a hardcoded default).
    perTab.evolutionExpandedStage = perTab.evolutionStageCursor ?? 'lifecycle';
    perTab.evolutionArtifactCursor = 0;
    perTab.evolutionFocus = 'artifact';
  }

  /** Enter while a stage is expanded: open the Q-L3 inspector for the artifact under the cursor. */
  private openInspector(ctx: ViewInputContext): void {
    const perTab = ctx.perTab;
    const stage = perTab.evolutionExpandedStage;
    if (!stage) return;
    const nodeType = evolutionStageNodeType(stage);
    if (!nodeType) return; // lifecycle / learning have no inspectable node type
    const spine = this.spineOf(ctx);
    if (!spine) return;
    const items = evolutionStageItems(spine, stage);
    if (items.length === 0) return;
    const idx = clamp(perTab.evolutionArtifactCursor ?? 0, 0, items.length - 1);
    perTab.evolutionInspector = { type: nodeType, id: displayId(items[idx]) };
  }

  /** Esc/←: ascend one level — inspector → artifact cursor → stage cursor → capability cursor. */
  private ascend(ctx: ViewInputContext): void {
    const perTab = ctx.perTab;
    if (perTab.evolutionInspector) {
      perTab.evolutionInspector = null;
      perTab.evolutionFocus = 'artifact';
      return;
    }
    if (perTab.evolutionExpandedStage) {
      perTab.evolutionExpandedStage = null;
      perTab.evolutionArtifactCursor = 0;
      perTab.evolutionFocus = 'stage';
      return;
    }
    if ((perTab.evolutionFocus ?? 'capability') === 'stage') {
      // Return to the left capability list — capability anchor unchanged.
      perTab.evolutionFocus = 'capability';
      return;
    }
    // Already at the root — no-op.
  }

  private spineOf(ctx: ViewInputContext): CapabilitySpineEntry | undefined {
    const spine = ctx.snap.runtime?.evolution?.spine ?? [];
    return spine.find((s) => s.capabilityId === ctx.perTab.evolutionSelectedCapabilityId) ?? spine[0];
  }
}

function cycleCapability(ctx: ViewInputContext, direction: -1 | 1): string {
  const spine = ctx.snap.runtime?.evolution?.spine ?? [];
  if (spine.length === 0) return ctx.perTab.evolutionSelectedCapabilityId ?? '';
  const current = ctx.perTab.evolutionSelectedCapabilityId;
  if (current === undefined || current === '') return spine[0]!.capabilityId;
  const idx = Math.max(0, spine.findIndex((s) => s.capabilityId === current));
  return spine[(idx + direction + spine.length) % spine.length]!.capabilityId;
}

function cycleStage(current: string, direction: -1 | 1): EvolutionStageName {
  const order = EVOLUTION_STAGE_ORDER;
  const idx = Math.max(0, order.indexOf(current as (typeof order)[number]));
  return order[(idx + direction + order.length) % order.length]!;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
