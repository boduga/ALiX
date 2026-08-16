// src/tui/evolution/evolution-view.ts  (stub — Task 7 replaces it)
import type { TabId } from '../state.js';
import type { TuiView, ViewRenderContext, ViewRenderResult } from '../views/types.js';

export class EvolutionView implements TuiView {
  readonly id: TabId = 'evolution';
  render(_ctx: ViewRenderContext): ViewRenderResult {
    return { rows: [] };
  }
}
