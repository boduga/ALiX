# OpenTUI Workbench renderer

## Purpose

Build the native OpenTUI renderer from renderer-neutral `WorkbenchViewState` while the ANSI canvas remains the default.

## Ownership

- `workbench-layout.ts` mounts retained native region nodes and maps shared Workbench surface geometry to their positions. Its caller owns renderer creation, input, and teardown.
- `workbench-content.ts` mounts retained operator-shell header/footer, agent-roster, transcript, inspector, composer, task/artifact drawer, and approval-card content in the layout regions; it consumes the assembled view state and owns no runtime projection.
- `input.ts` normalizes native OpenTUI key and paste events into the shared Workbench vocabulary and routes them through `routeWorkbenchInput`; it maps to typed intents and owns no terminal I/O.
- `key-handler.ts` is the host's input entry: it builds the shared context from a `WorkbenchStore` and live signals and applies key/paste intents through the shared `applyWorkbenchIntent`. It owns no terminal I/O.
- `host.ts` mounts the retained layout and content on a native renderer, subscribes to the renderer's key/paste stream, routes through `key-handler.ts`, and repaints on each handled intent. It implements the rendering side of `WorkbenchHostPorts` (repaint/composer mirror/follow anchors) over the host-supplied effectful ports; it does not own terminal lifecycle (raw mode, resize, restore), which is supplied by the renderer it is given.
- `lifecycle.ts` creates and tears down the production native renderer (`createCliRenderer` with terminal restore) and pairs it with the host via `startOpenTuiWorkbenchHost`. The CLI renderer selection does not use it yet; it still exits explicit-unavailable.

## Local Contracts

- Consume `WorkbenchViewState` and shared `layoutWorkbenchSurface` geometry for presentation, including display-cell wrapping of composer text; derive no runtime facts or operator decisions inside native nodes.
- Keep region nodes stable across updates and resize. Hide zero-size or absent regions, and paint an overlay above the transcript when geometry calls for one.
- Native agent-roster content preserves unavailable snapshots, run identity, selected-agent visibility, and source task labels. Native transcript content uses existing category, selected-agent, and details-mode state. Paused follow retains the last conversation snapshot as its semantic anchor through append, filter, and resize; scroll controls remain a later slice. Native inspector content renders the shared bounded sections, and native composer content renders the wrapped draft with its placeholder and hidden-row indicator. All clip to the current region; content updates follow layout updates after resize. Drawer content routes by the active drawer — agents, tasks, or artifacts — through the shared selectors, and the same body paints in the wide side pane or the narrow overlay. Header and footer render the operator-shell snapshot (the header folds workspace and counters into one facts line so two-row chrome keeps them), and authoritative pending approvals stack as bounded cards on a background node above every region, appearing and clearing only with the supplied view state. Task-state glyphs, byte sizing, and coordination lines come from `../model/display-format.ts`, shared with the ANSI drawer. Transcript scroll controls remain a later slice.
- A selected OpenTUI CLI process still exits explicitly until terminal lifecycle, view content, and input routing are complete. Native key events normalize to the exact `routeWorkbenchInput` vocabulary — `Ctrl+<letter>`, named navigation/edit keys, `Shift+Enter`/`Shift+Tab`, and printable graphemes taken from the key sequence; OS-owned modifier combos and key releases are dropped. Bracketed paste decodes bytes to text for the authoritative cursor. Native and ANSI renderers never own one terminal together.
- Keep `@opentui/core` and its `web-tree-sitter` peer pinned to the runtime-tested versions. Only the launcher supplies `--experimental-ffi` for selected OpenTUI CLI use.

## Work Guidance

- Extend the retained tree with roster, transcript, inspector, composer, and input slices without moving runtime projections into this folder.
- Reuse the existing layout breakpoint and short-terminal rules; native layout changes must preserve drawer and inspector visibility.

## Verification

- Run `pnpm build && pnpm test:opentui` on Node 26.4+.
- Native frame coverage lives in `tests/tui/workbench/opentui-layout.native.ts`; `.github/workflows/opentui-spike.yml` runs it across the supported matrix.

## Child DOX Index

None.
