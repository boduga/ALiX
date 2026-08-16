/**
 * Q5/Q-L1 — the `evolution` tab: capability-spine overview with stage-collapsed
 * drill-down, reference-by-id inspector, flat indexes. Read-only.
 *
 * Reads `ctx.snap.runtime.evolution` (the Task 2 evolution projection
 * snapshot); renders via `renderEvolution` (pure) and dispatches keys via
 * `evolutionKeyAction` (pure). handleKey mutates only `ctx.perTab`.
 */
import type { PerTabState, TabId } from '../state.js';
import type { TuiView, ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult } from '../views/types.js';
import { renderEvolution } from './evolution-render.js';
import { evolutionKeyAction } from './evolution-keys.js';

export class EvolutionView implements TuiView {
  readonly id: TabId = 'evolution';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const snap = ctx.snap.runtime?.evolution ?? null;
    if (!snap) {
      return { rows: ['\x1b[90mevolution unavailable — projection not registered\x1b[0m'], hint: '' };
    }
    const rows = renderEvolution(snap, ctx.perTab as PerTabState, ctx.dimensions);
    return { rows, hint: '↑↓ select · Enter expand · ← Esc collapse · f flat · c spine · q quit' };
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    const perTab = ctx.perTab;
    const action = evolutionKeyAction(key, perTab);
    switch (action.action) {
      case 'expand': perTab.evolutionExpandedStage = perTab.evolutionExpandedStage ?? 'forecasts'; return { type: 'handled' };
      case 'collapse': perTab.evolutionInspector = null; perTab.evolutionExpandedStage = null; return { type: 'handled' };
      case 'navigate': perTab.evolutionSelectedCapabilityId = cycleCapability(ctx, action.direction); return { type: 'handled' };
      case 'flat': perTab.evolutionFlatView = perTab.evolutionFlatView ? null : 'forecasts'; return { type: 'handled' };
      case 'spine': perTab.evolutionFlatView = null; perTab.evolutionInspector = null; perTab.evolutionExpandedStage = null; return { type: 'handled' };
      default: return { type: 'handled' };
    }
  }
}

function cycleCapability(ctx: ViewInputContext, direction: -1 | 1): string {
  const spine = ctx.snap.runtime?.evolution?.spine ?? [];
  if (spine.length === 0) return ctx.perTab.evolutionSelectedCapabilityId ?? '';
  const idx = Math.max(0, spine.findIndex((s) => s.capabilityId === ctx.perTab.evolutionSelectedCapabilityId));
  return spine[(idx + direction + spine.length) % spine.length]!.capabilityId;
}
