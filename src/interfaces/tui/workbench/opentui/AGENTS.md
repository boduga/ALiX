# OpenTUI Workbench renderer

## Purpose

Build the native OpenTUI renderer from renderer-neutral `WorkbenchViewState` while the ANSI canvas remains the default.

## Ownership

- `workbench-layout.ts` mounts retained native region nodes and maps shared Workbench surface geometry to their positions. Its caller owns renderer creation, input, and teardown.
- `workbench-content.ts` mounts retained operator-shell header/footer, agent-roster, transcript, inspector, composer, task/artifact drawer, and approval-card content in the layout regions; it consumes the assembled view state and owns no runtime projection. It owns the native preview palette, styled text, and bounded pane copy.
- `input.ts` normalizes native OpenTUI key and paste events into the shared Workbench vocabulary and routes them through `routeWorkbenchInput`; it maps to typed intents and owns no terminal I/O.
- `host.ts` mounts the retained layout and content on a native renderer, subscribes to the renderer's key/paste/resize stream, and forwards normalized keys/paste to caller-supplied `onKey`/`onPaste` callbacks (the controller owns routing). It exposes `update()` for the controller to push each frame and repaints on resize; it owns no store, runtime ports, or terminal lifecycle (raw mode, restore) beyond the renderer it is given.

## Local Contracts

- Consume `WorkbenchViewState` and shared `layoutWorkbenchSurface` geometry for presentation, including display-cell wrapping of composer text; derive no runtime facts or operator decisions inside native nodes.
- Keep region nodes stable across updates and resize. Hide zero-size or absent regions, and paint an overlay above the transcript when geometry calls for one.
- Native agent-roster content preserves unavailable snapshots, run identity, selected-agent visibility, and source task labels. Native transcript content uses existing category, selected-agent, and details-mode state. Arrow keys, PageUp/PageDown, and wheel events over the transcript scroll by presentation rows; End resumes follow. The content renderer reports its clamped row distance to the CLI host after each frame so extra Up presses at the top never delay Down. Paused follow retains the last conversation snapshot as its semantic anchor through append, filter, and resize. Native inspector content renders the shared bounded sections, and native composer content renders the wrapped draft with its placeholder and hidden-row indicator. All clip to the current region; content updates follow layout updates after resize. Drawer content routes by the active drawer — agents, tasks, or artifacts — through the shared selectors, and the same body paints in the wide side pane or the narrow overlay. Header and footer render the operator-shell snapshot; the header right-aligns workspace and live status when width allows, and the footer shows shortcuts and counters. Authoritative pending approvals stack as bounded cards above every region, appearing and clearing only with the supplied view state. Task-state glyphs, byte sizing, and coordination lines come from `../model/display-format.ts`, shared with the ANSI drawer.
- The native preview visual uses a near-black background, cyan pane borders and headings, muted supporting text, state colors, a selected-row fill, and interior headings rather than border titles. The transcript toolbar shares its heading row when width allows. Retain text labels with colors. Preserve workspace facts, timestamps, toolbar state, and tool metadata from `WorkbenchViewState`; never seed live panes from mockup strings.
- The header uses terminal bold for the cyan `ALiX WORKBENCH` brand and cyan for the workspace path; the preview badge and labels stay muted, and agent counts use green. Font family and cell size belong to the terminal emulator, so native content cannot enlarge only the brand.
- A selected OpenTUI CLI process owns the terminal through its native renderer (`createCliRenderer` in `lifecycle.ts`) and launches only on an interactive TTY; the launcher supplies `--experimental-ffi`. Native key events normalize to the exact `routeWorkbenchInput` vocabulary — `Ctrl+<letter>`, named navigation/edit keys, `Shift+Enter`/`Shift+Tab`, and printable graphemes taken from the key sequence; OS-owned modifier combos and key releases are dropped. Bracketed paste decodes bytes to text for the authoritative cursor. Native and ANSI renderers never own one terminal together.
- Keep `@opentui/core` and its `web-tree-sitter` peer pinned to the runtime-tested versions. Only the launcher supplies `--experimental-ffi` for selected OpenTUI CLI use.

## Work Guidance

- Extend the retained tree with roster, transcript, inspector, composer, and input slices without moving runtime projections into this folder.
- Reuse the existing layout breakpoint and short-terminal rules; native layout changes must preserve drawer and inspector visibility.

## Verification

- Run `pnpm build && pnpm test:opentui` on Node 26.4+.
- Native frame coverage lives in `tests/tui/workbench/opentui-layout.native.ts` and `tests/tui/workbench/opentui-host.native.ts`; `.github/workflows/opentui-spike.yml` runs them across the supported matrix.

## Child DOX Index

None.
