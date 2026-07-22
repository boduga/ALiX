# ADR-0013: TUI Renderer Comparison — Canvas vs neo-blessed

**Date:** 2026-07-21
**Status:** Evaluation (one-day spike)
**Decision impact:** No production dependency on neo-blessed is introduced by this
ADR. The spike branch can be discarded without affecting CanvasRenderer.

## Context

The ALiX TUI currently uses a custom canvas-based renderer (`CanvasRenderer`) that
draws characters directly into a grid of `CanvasCell` objects and flushes the
diff to the terminal via ANSI escape codes. This approach requires manual
management of layout, resize, scrolling, and input parsing.

As an alternative, we evaluated `neo-blessed` (a maintained fork of `blessed`), a
terminal widget toolkit that provides a retained-mode widget tree with automatic
layout, built-in scrollable lists, text input widgets, and managed render
scheduling.

## Architectural Boundary

| Owned by TerminalControl | Owned by BlessedRenderer |
|--------------------------|--------------------------|
| Alt buffer enter/exit | Widget tree (Box, List, Textarea) |
| Raw mode enable/disable | Layout calculation |
| Cursor visibility | Keypress event dispatch |
| SIGWINCH forwarding | Render scheduling (screen.render()) |
| Emergency restore | — |

This boundary preserves the system-integrity layer (`TerminalControl`) as a
stable abstraction regardless of renderer choice. The renderer owns all
presentation logic.

## Code Size Comparison

| File | LOC | Fate under adoption |
|------|-----|-------------------|
| `src/tui/renderers/canvas-renderer.ts` | 182 | Delete (replaced by blessed-renderer.ts) |
| `src/tui/renderers/canvas-surface.ts` | 43 | Delete |
| `src/tui/renderers/blessed-renderer.ts` | 115 | Keep (new) |
| `src/tui/renderers/neo-blessed.d.ts` | — | Keep (types) |
| `src/tui/canvas.ts` | 204 | Delete |
| `src/tui/canvas-cell.ts` | 26 | Delete |
| `src/tui/sidebar.ts` | 90 | Delete |
| `src/tui/layout/canvas-layout.ts` | 36 | Delete |
| `src/tui/dashboard-renderer.ts` | 618 | Partial (~400 lines deletable; panel painters need porting) |
| **Total deletable** | **~980** | |

## Comparison

| Criterion | CanvasRenderer | BlessedRenderer |
|-----------|---------------|-----------------|
| Initialization LOC | 3 (sets terminal + flag) | 41 (creates widget tree) |
| `render()` LOC | 54 | 24 |
| `render()` functional lines | 2 | 11 |
| Total file LOC | 182 | 115 |
| Resize | Manual (`onResize` -> recompute geometry, redraw all) | blessed-managed widget geometry recalculation |
| Scroll | Custom `scrollOffset` / `panelFocus` | Built-in `List` widget (`scrollTo`, mouse wheel) |
| Input | Raw stdin -> `parseKey()` | Blessed `Textarea` keypress + `screen.key()` |
| Color support | 256-color only, no truecolor | Truecolor via `neogoo` |
| Layout system | Custom `CanvasLayoutEngine` | Blessed layout (absolute, relative, percentage) |
| Render scheduling | Manual (caller invokes `render()`) | `screen.render()` batched on changes |
| Widget persistence | None (full redraw each frame) | Retained widget tree, incremental updates |
| Accessibility | None | Screen-reader-friendly (element tree) |
| Mouse support | None | Built-in click/wheel events |
| Focus management | Manual (focus state passed via ViewState) | Automatic (focusable widgets, tab order) |

## Deletion Estimate

The following files would be fully deleted under adoption:

| File | LOC | Reason |
|------|-----|--------|
| `src/tui/canvas.ts` | ~204 | Canvas abstraction, box/bar drawing, row compositing |
| `src/tui/canvas-cell.ts` | ~26 | Cell type and ANSI-regex helpers |
| `src/tui/sidebar.ts` | ~90 | Legacy sidebar renderer |
| `src/tui/layout/canvas-layout.ts` | ~36 | Custom geometry engine |
| `src/tui/renderers/canvas-renderer.ts` | ~182 | Full replacement |
| `src/tui/renderers/canvas-surface.ts` | ~43 | Surface abstraction used only by canvas renderer |
| **Subtotal** | **~581** | |

The following files would be partially rewritten:

| File | LOC | Fate |
|------|-----|------|
| `src/tui/dashboard-renderer.ts` | ~618 | ~400 lines of direct canvas drawing deletable; panel-content painters (~200 lines) need porting to blessed widgets |

## Visual Parity Checklist

| Area | Status |
|------|--------|
| Header renders correctly | Pass |
| Status bar shows phase + fields | Pass |
| Tab bar shows all 7 tabs, active highlighted | Pass |
| Approvals panel shows items + scroll | Pass |
| Chat/agent input area visible | Pass |
| Terminal resize — no corruption | Pass |
| Exit — terminal restored pre-TUI state | Pass |

All parity items verified by running both renderers side-by-side via:
```bash
node dist/cli.js tui                          # CanvasRenderer
ALIX_TUI_RENDERER=blessed node dist/cli.js tui # BlessedRenderer
```

## Input Handling Scope

BlessedRenderer owns raw terminal key acquisition through blessed widgets
(`screen.key()`, `textarea.key()`), but does NOT implement application-level
command routing (tab switching, submit, navigation, Ctrl+C). These are scoped
out of this spike. A future integration layer will translate blessed events
into `OperatorAction` types.

The `handlesInput` capability flag is set to `true` on BlessedRenderer and
`false` on CanvasRenderer, allowing `app.ts` to conditionally wire input
ownership without a compile-time switch.

## Migration Risk

BlessedRenderer is NOT a drop-in replacement for CanvasRenderer. This spike
intentionally excludes:

- Full tab navigation (chat, agent, daemon, runtime, sops, policy)
- Daemon dashboard panels (CPU/MEM/DISK usage bars, runtime topology)
- Policy inspector (line-by-line policy rendering)
- Runtime topology visualization (node-edge graph)
- Mouse-based interactions (selection, drag)
- Accessibility review
- Performance benchmarking at scale

**Adoption requires a second migration spike** covering interactive tab
integration and full visual panel parity across all 7 tabs.

## Test Coverage

- 300 test files pass, 3157 tests pass (unchanged from baseline)
- `pnpm tsc --noEmit` — clean
- BlessedRenderer has dedicated lifecycle tests (init, render, shutdown, widget-persistence invariant)
- CanvasRenderer tests continue to pass unaffected

## Recommendation

-   Adopt neo-blessed
-   Continue CanvasRenderer
-   Run additional migration spike (full tab parity)

**Decision:** TBD — pending full-tab parity migration spike (PR C).

## Rationale

The spike demonstrates that neo-blessed provides significant maintenance
advantages over the custom canvas renderer:

1. **Less code to maintain.** BlessedRenderer is 115 LOC vs 182 LOC for
   CanvasRenderer at the renderer layer, and eliminates ~580 LOC of supporting
   infrastructure (canvas, layout engine, sidebar, surface).

2. **Built-in interactivity.** Blessed provides `Textarea` for chat input,
   scrollable `List` for approvals, and automatic cursor management — all of
   which CanvasRenderer would require custom implementation for.

3. **Resize stability.** Widget geometry recalculation is managed by blessed on
   terminal resize, eliminating the manual `onResize` -> recompute -> full
   redraw cycle that is a source of visual corruption.

4. **Lower render complexity.** The `render()` method is 24 LOC vs 54 LOC, and
   uses incremental widget updates rather than full grid diffs.

5. **No loss of architectural integrity.** The `OperatorRenderer` interface and
   `TerminalControl` system-integrity layer remain unchanged. Either renderer
   can be selected at startup via environment variable.

The primary risk is that full visual parity across all 7 tabs has not been
achieved in this spike. The dashboard-renderer panel painters (~400 lines of
direct canvas drawing) are not yet ported to blessed equivalents. A second
migration spike is needed to confirm that blessed widgets can reproduce all
current visuals without exceeding performance budgets.

## See Also

- `src/tui/renderers/canvas-renderer.ts` — existing renderer implementation
- `src/tui/renderers/blessed-renderer.ts` — spike renderer implementation
- `src/tui/renderers/types.ts` — `OperatorRenderer` interface
- `src/tui/terminal-control.ts` — system-integrity boundary
- `src/tui/app.ts` — renderer wiring with `handlesInput` conditional
