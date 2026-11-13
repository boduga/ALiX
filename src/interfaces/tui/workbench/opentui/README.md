# OpenTUI Workbench Renderer

## Overview

The native OpenTUI renderer for the Workbench, built from the renderer-neutral `WorkbenchViewState` while the ANSI canvas remains the default. Four pieces compose it: a retained layout that places region nodes, retained content that paints every pane, a key/paste normalizer that speaks the shared input vocabulary, and a host that wires renderer events to controller callbacks.

Everything here is presentation. The folder consumes already-assembled view state and shared layout geometry; it derives no runtime facts, owns no store or runtime ports, and never runs a second domain projection. Selection, filtering, follow state, and the operator-shell snapshot all arrive as data.

## Interface

- `mountOpenTuiWorkbenchHost(renderer, deps)` — mounts layout and content on a `CliRenderer`, wires key/paste/resize/mouse events, returns `update()`/`dispose()` [host.ts:mountOpenTuiWorkbenchHost]
- `OpenTuiHostDeps` — `layoutState`, `contentState`, `onKey`, `onPaste`, `onClick` callbacks [host.ts:OpenTuiHostDeps]
- `OpenTuiWorkbenchHost` — exposed `layout`, `content`, `update`, `dispose` [host.ts:OpenTuiWorkbenchHost]
- `mountOpenTuiWorkbenchLayout(renderer, initial)` — retained region boxes plus `update(state)` and `dispose()` [workbench-layout.ts:mountOpenTuiWorkbenchLayout]
- `OpenTuiWorkbenchLayout` — `shell`, `regions` (header/tabs/roster/transcript/inspector/composer/footer/overlay), `geometry`, `composer`, `update`, `dispose` [workbench-layout.ts:OpenTuiWorkbenchLayout]
- `mountOpenTuiWorkbenchContent(renderer, layout, initial)` — paints all panes and exposes hit-test methods [workbench-content.ts:mountOpenTuiWorkbenchContent]
- `OpenTuiWorkbenchContent` — renderables, `resolvedScrollRows`, `rosterClickTarget`, `transcriptClickTarget`, `inspectorClickTarget`, `footerClickTarget`, `approvalClickTarget`, `hasPendingApproval`, `update`, `dispose` [workbench-content.ts:OpenTuiWorkbenchContent]
- `ContentState` — the `WorkbenchViewState` slice the content renderer consumes [workbench-content.ts:ContentState]
- `OpenTuiClickAction` — typed click intents (`focus.set`, `agent.select`, `task.select`, `artifact.select`/`artifact.open`, `drawer.toggle`, `inspector.open`, `tab.next`, `turn.cancel`, `overlay.close`, `approval.resolve`, `agentRoster.toggle`, `coordination.inspect`, `transcript.filter`, `transcript.follow.toggle`) [workbench-content.ts:OpenTuiClickAction]
- `ansiRowToNativeParts(row)` — converts ANSI SGR runs (including truecolor) into native styled parts [workbench-content.ts:ansiRowToNativeParts]
- `translateKeyEvent(event)` — maps a native key event to the shared `routeWorkbenchInput` vocabulary or `null` [input.ts:translateKeyEvent]
- `pasteText(event)` — decodes paste bytes, strips ANSI sequences, normalizes CRLF [input.ts:pasteText]
- `OpenTuiKey` — the key-event shape the normalizer accepts [input.ts:OpenTuiKey]
- `createOpenTuiLifecycle(config)` — creates the renderer with `exitOnCtrlC: false` and awaits `closed` on dispose [lifecycle.ts:createOpenTuiLifecycle]

## Invariants

- Region nodes are created once and reused; `update()` only repositions and repaints them, so a resize never rebuilds the retained tree [workbench-layout.ts:mountOpenTuiWorkbenchLayout]
- A region with no geometry, or zero width/height, is hidden rather than painted at a fallback position; borders are only drawn for regions at least 3×2 and never for the header, tabs, or footer [workbench-layout.ts:place]
- Layout geometry comes exclusively from `layoutWorkbenchSurface` over `renderer.width`/`renderer.height`; the native path invents no breakpoints [workbench-layout.ts:mountOpenTuiWorkbenchLayout]
- Assistant and user prose goes through the shared `renderResponse` markdown renderer and is mapped to the native palette by `ansiRowToNativeParts`; there is no second markdown implementation, and a markdown failure degrades to wrapped plain text instead of blanking the row [workbench-content.ts:proseRows]
- Transcript row labels use local wall-clock `HH:MM:SS` via `getHours`/`getMinutes`/`getSeconds`, never `toISOString()`; an invalid timestamp renders `--:--:--` [workbench-content.ts:localTimeLabel]
- The actor gutter is applied once per row, not per styled run, so embedded spaces never break column math [workbench-content.ts:itemLines]
- Pending approvals paint inline in the transcript beside their tool call; the floating `approval` box stays hidden with empty click targets [workbench-content.ts:mountOpenTuiWorkbenchContent]
- `hasPendingApproval()` is captured during `update`, so the host can keep inline decision rows actionable without re-reading content state [workbench-content.ts:OpenTuiWorkbenchContent]
- `resolvedScrollRows` is the clamped row distance reported to the host each frame, so extra Up presses at the top never delay Down [workbench-content.ts:mountOpenTuiWorkbenchContent]
- Paused follow retains the last conversation snapshot as its semantic anchor; clearing follow drops that anchor [workbench-content.ts:mountOpenTuiWorkbenchContent]
- Hit targets are produced by the same builders that paint the rows (`BoundedLines` carries one action per row; footer targets derive from its own hint list), so a click never re-derives identity from painted text [workbench-content.ts:BoundedLines]
- The host routes every clickable region through one `wire` path, and a click requires left button, no drag, and identical press/release coordinates [host.ts:mountOpenTuiWorkbenchHost]
- Transcript clicks are gated while an approval is pending: only `approval.resolve` targets pass, everything else falls through [host.ts:mountOpenTuiWorkbenchHost]
- Frames become no-ops after disposal, and disposal removes listeners, content, and layout so a late frame cannot mutate destroyed renderables [host.ts:mountOpenTuiWorkbenchHost]
- `translateKeyEvent` drops key releases and meta/option combos, encodes Ctrl+C as `\u0003`, and only emits printable sequences that contain no control characters [input.ts:translateKeyEvent]
- `pasteText` strips OSC and CSI sequences and normalizes `\r\n`/`\r` to `\n` before the text reaches the authoritative cursor [input.ts:pasteText]
- Lifecycle dispose is idempotent and awaits the renderer's `closed` promise after `destroy()` [lifecycle.ts:createOpenTuiLifecycle]

## Side Effects

- Retained renderer mutation: the layout adds/removes region boxes under `renderer.root`, and the content renderer adds/removes text nodes and repaints their `content` each frame [workbench-layout.ts:mountOpenTuiWorkbenchLayout] [workbench-content.ts:mountOpenTuiWorkbenchContent]
- Renderer event subscription: `keypress`, `paste`, and `resize` listeners are attached on mount and removed on dispose [host.ts:mountOpenTuiWorkbenchHost]
- `renderer.requestRender()` is called after each host `update()` [host.ts:mountOpenTuiWorkbenchHost]
- Wall-clock read for the header timestamp on every content update [workbench-content.ts:mountOpenTuiWorkbenchContent]
- No store access, no runtime ports, no network, and no file I/O in this folder; it consumes supplied view state only [host.ts:OpenTuiHostDeps]

## Verification

- Run: `pnpm test`
- Native frame coverage: `pnpm build && pnpm test:opentui` runs `tests/tui/workbench/opentui-layout.native.ts` and `tests/tui/workbench/opentui-host.native.ts`
