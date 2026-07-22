/**
 * LegacyViewBridge — renders existing TuiView instances into a RenderSurface.
 *
 * This is a TEMPORARY compatibility layer for PR A. It sits above the
 * renderer in the call stack (in app.ts). The renderer never imports it.
 *
 * PR C (adopt Blessed) removes this file entirely.
 */

import type { RenderSurface } from '../renderer/surface.js';
import type { DashboardSnapshot } from '../snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type { TuiView } from '../views/types.js';
import { CanvasSurface } from '../renderers/canvas-surface.js';

export interface LegacyBridgeConfig {
  readonly snap: DashboardSnapshot;
  readonly perTab: PerTabState;
  readonly views: Readonly<Record<TabId, TuiView>>;
  readonly activeTab: TabId;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
}

/**
 * Render the active legacy view into a RenderSurface.
 *
 * Returns null if the active tab has no view registered.
 */
export function renderLegacyView(config: LegacyBridgeConfig): RenderSurface | null {
  const view = config.views[config.activeTab];
  if (!view) return null;

  const surface = new CanvasSurface(config.surfaceWidth, config.surfaceHeight);
  const canvas = (surface as any).canvas; // temporary — view.render() expects TerminalCanvas

  view.render({
    snap: config.snap,
    dimensions: { columns: config.surfaceWidth, rows: config.surfaceHeight },
    perTab: config.perTab,
    canvas, // TerminalCanvas passed directly — view writes into it
  });

  return surface;
}
