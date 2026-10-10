# OpenTUI Workbench renderer

## Purpose

Build the native OpenTUI renderer from renderer-neutral `WorkbenchViewState` while the ANSI canvas remains the default.

## Ownership

- `workbench-layout.ts` mounts retained native region nodes and maps shared Workbench surface geometry to their positions. Its caller owns renderer creation, input, and teardown.
- `workbench-content.ts` mounts retained agent-roster and transcript text in the layout regions; it consumes the assembled view state and owns no runtime projection.

## Local Contracts

- Consume `WorkbenchViewState` and shared `layoutWorkbenchSurface` geometry for presentation, including display-cell wrapping of composer text; derive no runtime facts or operator decisions inside native nodes.
- Keep region nodes stable across updates and resize. Hide zero-size or absent regions, and paint an overlay above the transcript when geometry calls for one.
- Native agent-roster content preserves unavailable snapshots, run identity, selected-agent visibility, and source task labels. Native transcript content uses existing category, selected-agent, and details-mode state. Paused follow retains the last conversation snapshot as its semantic anchor through append, filter, and resize; scroll controls remain a later slice. Both clip to the current region; content updates follow layout updates after resize. Task/artifact drawer content remains a later slice.
- A selected OpenTUI CLI process still exits explicitly until terminal lifecycle, view content, and input routing are complete. Native and ANSI renderers never own one terminal together.
- Keep `@opentui/core` and its `web-tree-sitter` peer pinned to the runtime-tested versions. Only the launcher supplies `--experimental-ffi` for selected OpenTUI CLI use.

## Work Guidance

- Extend the retained tree with roster, transcript, inspector, composer, and input slices without moving runtime projections into this folder.
- Reuse the existing layout breakpoint and short-terminal rules; native layout changes must preserve drawer and inspector visibility.

## Verification

- Run `pnpm build && pnpm test:opentui` on Node 26.4+.
- Native frame coverage lives in `tests/tui/workbench/opentui-layout.native.ts`; `.github/workflows/opentui-spike.yml` runs it across the supported matrix.

## Child DOX Index

None.
