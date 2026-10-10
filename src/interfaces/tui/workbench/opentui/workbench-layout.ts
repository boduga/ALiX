import { BoxRenderable, TextRenderable, type CliRenderer } from '@opentui/core';
import { type WorkbenchRegion, type WorkbenchSurfaceGeometry } from '../layout/responsive-layout.js';
import type { WorkbenchViewState } from '../view-state/types.js';
import { layoutWorkbenchSurface, type ComposerLayout } from '../views/composer-view.js';

type LayoutState = Pick<WorkbenchViewState, 'composer' | 'overlay'>;

export interface OpenTuiWorkbenchLayout {
  readonly shell: BoxRenderable;
  readonly regions: Readonly<Record<'header' | 'tabs' | 'roster' | 'transcript' | 'inspector' | 'composer' | 'footer' | 'overlay', BoxRenderable>>;
  readonly geometry: WorkbenchSurfaceGeometry;
  readonly composer: ComposerLayout;
  update(state: LayoutState): WorkbenchSurfaceGeometry;
  dispose(): void;
}

function place(box: BoxRenderable, region: WorkbenchRegion | null): void {
  box.visible = region !== null && region.width > 0 && region.height > 0;
  if (!region) return;
  box.left = region.x;
  box.top = region.y;
  box.width = Math.max(1, region.width);
  box.height = Math.max(1, region.height);
  box.border = box.visible && region.width >= 3 && region.height >= 2 && box.id !== 'opentui-header'
    && box.id !== 'opentui-tabs' && box.id !== 'opentui-footer';
}

/** Retained OpenTUI layout; callers own renderer creation, input, and teardown. */
export function mountOpenTuiWorkbenchLayout(renderer: CliRenderer, initial: LayoutState): OpenTuiWorkbenchLayout {
  const shell = new BoxRenderable(renderer, { id: 'opentui-workbench', width: '100%', height: '100%' });
  const panel = (id: string, title?: string): BoxRenderable => new BoxRenderable(renderer, {
    id: `opentui-${id}`,
    position: 'absolute',
    width: 1,
    height: 1,
    title,
    backgroundColor: '#101820',
  });
  const regions = {
    header: panel('header'),
    tabs: panel('tabs'),
    roster: panel('roster', 'Agents'),
    transcript: panel('transcript', 'Transcript'),
    inspector: panel('inspector', 'Inspector'),
    composer: panel('composer', 'Composer'),
    footer: panel('footer'),
    overlay: panel('overlay', 'Agents'),
  };
  regions.header.add(new TextRenderable(renderer, { content: 'ALiX WORKBENCH' }));
  regions.tabs.add(new TextRenderable(renderer, { content: 'AGENT' }));
  for (const box of Object.values(regions)) shell.add(box);
  renderer.root.add(shell);

  const compute = (state: LayoutState): { composer: ComposerLayout; geometry: WorkbenchSurfaceGeometry } => {
    const composerState = state.composer.composer;
    const { composer, geometry } = layoutWorkbenchSurface(
      composerState.text,
      { columns: renderer.width, rows: renderer.height },
      state.overlay.drawer,
      composerState.cursor,
    );
    const drawerTitle = {
      closed: 'Agents',
      agents: 'Agents',
      tasks: 'Tasks',
      artifacts: 'Artifacts',
    }[geometry.layout.drawer];
    regions.roster.title = drawerTitle;
    regions.overlay.title = drawerTitle;
    for (const name of Object.keys(regions) as (keyof typeof regions)[]) {
      place(regions[name], geometry.regions[name]);
    }
    return { composer, geometry };
  };
  let current = compute(initial);
  let disposed = false;

  return {
    shell,
    regions,
    get geometry() { return current.geometry; },
    get composer() { return current.composer; },
    update: (state) => { current = compute(state); return current.geometry; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderer.root.remove(shell);
      shell.destroy();
    },
  };
}
