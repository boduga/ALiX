import type { WorkbenchDrawer } from '../model/ui-state.js';

export interface WorkbenchResponsiveLayout {
  readonly breakpoint: 'narrow' | 'medium' | 'wide' | 'ultrawide';
  readonly contentColumns: number;
  readonly drawer: WorkbenchDrawer;
  readonly drawerMode: 'hidden' | 'overlay' | 'side';
  readonly drawerWidth: number;
}

export interface WorkbenchSurfaceGeometry {
  readonly layout: WorkbenchResponsiveLayout;
  readonly dimensions: { readonly columns: number; readonly rows: number };
}

export function resolveWorkbenchLayout(columns: number, requested: WorkbenchDrawer): WorkbenchResponsiveLayout {
  const safeColumns = Math.max(1, columns);
  const breakpoint = safeColumns < 80 ? 'narrow' : safeColumns < 120 ? 'medium' : safeColumns < 160 ? 'wide' : 'ultrawide';
  const drawer = breakpoint === 'ultrawide' && requested === 'closed' ? 'agents' : requested;
  if (drawer === 'closed') {
    return { breakpoint, contentColumns: safeColumns, drawer, drawerMode: 'hidden', drawerWidth: 0 };
  }
  if (breakpoint === 'narrow' || breakpoint === 'medium') {
    return { breakpoint, contentColumns: safeColumns, drawer, drawerMode: 'overlay', drawerWidth: safeColumns };
  }
  const drawerWidth = breakpoint === 'ultrawide' ? 44 : 36;
  return {
    breakpoint,
    contentColumns: Math.max(40, safeColumns - drawerWidth - 1),
    drawer,
    drawerMode: 'side',
    drawerWidth,
  };
}

/** One geometry source for transcript wrapping, composer layout, scrolling, and cursor placement. */
export function resolveWorkbenchSurfaceGeometry(
  columns: number,
  rows: number,
  requested: WorkbenchDrawer,
): WorkbenchSurfaceGeometry {
  const layout = resolveWorkbenchLayout(columns, requested);
  return {
    layout,
    dimensions: {
      columns: layout.drawerMode === 'side' ? layout.contentColumns : Math.max(1, columns),
      rows: Math.max(1, rows),
    },
  };
}
