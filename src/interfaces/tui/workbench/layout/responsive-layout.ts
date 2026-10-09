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
  readonly maxComposerRows: number;
  readonly composerPrefixWidth: number;
  readonly panelRow: number;
  readonly topBorderRow: number;
  readonly bottomBorderRow: number;
  readonly regions: {
    readonly header: WorkbenchRegion;
    readonly tabs: WorkbenchRegion;
    readonly body: WorkbenchRegion;
    readonly roster: WorkbenchRegion | null;
    readonly transcript: WorkbenchRegion;
    readonly transcriptToolbar: WorkbenchRegion;
    readonly transcriptBody: WorkbenchRegion;
    readonly inspector: WorkbenchRegion | null;
    readonly composer: WorkbenchRegion;
    readonly composerContent: WorkbenchRegion;
    readonly footer: WorkbenchRegion;
    readonly overlay: WorkbenchRegion | null;
  };
}

/** Screen-relative display-cell rectangle. Zero-height regions are not painted. */
export interface WorkbenchRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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
  composerRows = 1,
): WorkbenchSurfaceGeometry {
  const safeColumns = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1;
  const maxComposerRows = Math.max(1, Math.min(5, safeRows - 8));
  const textRows = Number.isFinite(composerRows)
    ? Math.max(1, Math.min(maxComposerRows, Math.floor(composerRows)))
    : 1;
  const resolvedLayout = resolveWorkbenchLayout(safeColumns, requested);
  // A persistent roster must not become an uncloseable automatic overlay on a short window.
  const baseLayout: WorkbenchResponsiveLayout = requested === 'closed' && safeRows < 12
    ? { ...resolvedLayout, drawer: 'closed', drawerMode: 'hidden', drawerWidth: 0, contentColumns: safeColumns }
    : resolvedLayout;
  const threePanes = safeColumns >= 160 && safeRows >= 36;
  const sideWidth = threePanes ? Math.min(44, Math.floor(safeColumns / 5)) : baseLayout.drawerWidth;
  const sideVisible = baseLayout.drawerMode === 'side' && safeRows >= 12;
  const transcriptX = sideVisible ? sideWidth + 1 : 0;
  const transcriptWidth = safeColumns - transcriptX - (threePanes ? sideWidth + 1 : 0);
  const layout: WorkbenchResponsiveLayout = {
    ...baseLayout,
    drawerMode: baseLayout.drawerMode === 'side' && !sideVisible ? 'overlay' : baseLayout.drawerMode,
    drawerWidth: sideVisible ? sideWidth : baseLayout.drawerMode === 'hidden' ? 0 : safeColumns,
    contentColumns: transcriptWidth,
  };
  // Tiny terminals prioritize an editable row. Borders/footer consume rows only when available.
  const footerHeight = safeRows >= 2 ? 1 : 0;
  const composerHeight = Math.min(safeRows - footerHeight, textRows + 2);
  const composerY = safeRows - footerHeight - composerHeight;
  const composerHasBorders = composerHeight >= 3;
  const composerContentHeight = Math.min(textRows, composerHeight - (composerHasBorders ? 2 : 0));
  const composerContentY = composerHasBorders ? composerY + 1 : composerY + composerHeight - composerContentHeight;
  const bodyY = Math.min(3, composerY);
  const bodyHeight = Math.max(0, composerY - bodyY);
  const toolbarHeight = Math.min(3, bodyHeight);
  const region = (x: number, y: number, width: number, height: number): WorkbenchRegion => ({ x, y, width, height });
  const transcript = region(transcriptX, bodyY, transcriptWidth, bodyHeight);
  return {
    layout,
    dimensions: {
      columns: transcriptWidth,
      rows: safeRows,
    },
    maxComposerRows,
    composerPrefixWidth: Math.min(3, safeColumns - 1),
    panelRow: composerContentY + composerContentHeight - 1,
    topBorderRow: composerY,
    bottomBorderRow: composerY + composerHeight - 1,
    regions: {
      header: region(0, 0, safeColumns, Math.min(2, composerY)),
      tabs: region(0, Math.min(2, composerY), safeColumns, composerY >= 3 ? 1 : 0),
      body: region(0, bodyY, safeColumns, bodyHeight),
      roster: sideVisible ? region(0, bodyY, sideWidth, bodyHeight) : null,
      transcript,
      transcriptToolbar: region(transcriptX, bodyY, transcriptWidth, toolbarHeight),
      transcriptBody: region(transcriptX, bodyY + toolbarHeight, transcriptWidth, Math.max(0, bodyHeight - toolbarHeight - 1)),
      inspector: threePanes ? region(safeColumns - sideWidth, bodyY, sideWidth, bodyHeight) : null,
      composer: region(0, composerY, safeColumns, composerHeight),
      composerContent: region(0, composerContentY, safeColumns, composerContentHeight),
      footer: region(0, safeRows - footerHeight, safeColumns, footerHeight),
      overlay: layout.drawerMode === 'overlay' ? region(0, bodyY, safeColumns, bodyHeight) : null,
    },
  };
}
