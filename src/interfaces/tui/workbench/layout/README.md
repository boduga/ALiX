# Workbench Layout

## Overview
Computes the single screen-relative geometry for the ALiX TUI workbench. The package resolves a responsive layout from terminal columns and requested drawer state, then derives every paint region (header, tabs, transcript, composer, inspector, footer, overlay) plus the maximum composer height. A companion helper keeps the visible scrollback item stable across a width change whose wrapping changed the row count.

## Interface
- `WorkbenchResponsiveLayout` — breakpoint, content columns, drawer id, drawer mode (`hidden`/`overlay`/`side`), and drawer width `[responsive-layout.ts:WorkbenchResponsiveLayout]`.
- `WorkbenchSurfaceGeometry` — resolved layout plus dimensions, composer rows, border rows, and the full `regions` map `[responsive-layout.ts:WorkbenchSurfaceGeometry]`.
- `WorkbenchRegion` — screen-relative display-cell rectangle; zero-height regions are not painted `[responsive-layout.ts:WorkbenchRegion]`.
- `resolveWorkbenchLayout(columns, requested)` — breakpoint and drawer-mode resolution `[responsive-layout.ts:resolveWorkbenchLayout]`.
- `resolveWorkbenchSurfaceGeometry(columns, rows, requested, composerRows)` — one geometry source for transcript wrapping, composer layout, scrolling, and cursor placement `[responsive-layout.ts:resolveWorkbenchSurfaceGeometry]`.
- `reconcileWorkbenchScrollAnchor(previousLines, previousIndex, nextLines)` — re-finds the same `itemId`/`wrappedOffset` after re-wrap `[scroll-anchor.ts:reconcileWorkbenchScrollAnchor]`.

## Invariants
- Columns are clamped to at least 1; breakpoints are `narrow` < 80, `medium` < 120, `wide` < 160, `ultrawide` >= 160 `[responsive-layout.ts:resolveWorkbenchLayout]`.
- On `ultrawide`, a `closed` drawer request resolves to `agents`; a `closed` drawer otherwise yields mode `hidden` and width 0 `[responsive-layout.ts:resolveWorkbenchLayout]`.
- `narrow`/`medium` drawers are overlays spanning all columns; side drawers reserve 36 columns (`wide`) or 44 (`ultrawide`), and `contentColumns` never drops below 40 `[responsive-layout.ts:resolveWorkbenchLayout]`.
- Geometry floors non-finite/negative column, row, and composer values before layout math `[responsive-layout.ts:resolveWorkbenchSurfaceGeometry]`.
- `maxComposerRows` is `clamp(rows - 8, 1, 5)`; a short window with a `closed` drawer never synthesizes an uncloseable overlay `[responsive-layout.ts:resolveWorkbenchSurfaceGeometry]`.
- Three panes (roster + transcript + inspector) require `columns >= 160` and `rows >= 36`; a side drawer collapses to overlay when `rows < 12` `[responsive-layout.ts:resolveWorkbenchSurfaceGeometry]`.
- Scroll-anchor reconciliation returns the clamped previous index when the previous line has no `itemId`, and otherwise the nearest matching `itemId` line by absolute `wrappedOffset` distance `[scroll-anchor.ts:reconcileWorkbenchScrollAnchor]`.

## Side Effects
- ["None"] — pure computation; the functions return new layout objects and perform no I/O.

## Verification
- Run: `pnpm test`
