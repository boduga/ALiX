# ALiX TUI: Claude-Code-style Bottom-Anchored Input Panel on the Agent Tab — Design Spec

**Date:** 2026-08-05
**Status:** Approved design
**Feature branch (to create):** `tui-bottom-anchored-panel` off `main`

## Context

ALiX's TUI (`alix tui`) is a hand-rolled, immediate-mode ANSI app (`src/tui/`). Today, on the agent and chat tabs, the **input prompt** is drawn at row 4 — just below the 3-row header — and the **slash-completion strip** overlays rows 6–12, anchored to the top of the scrollback. As soon as the user scrolls back through history, the prompt stays glued to the top of the scrollback area while the transcript scrolls behind it. The slash strip overlays content from the top, eating rows from the most-recent turns.

This is the opposite of how Claude Code behaves. In Claude Code:

1. The input panel sits pinned at the **bottom** of the viewport, above the footer.
2. The slash strip renders directly **below** the panel, within a single bottom-anchored unit. When slash mode opens, the unit grows by the strip's height and slides up to stay above the footer; the scrollback shrinks from the bottom while the strip is open.
3. **Auto-follow is on** while the user is at the bottom; scrolling up disengages auto-follow; pressing `End` (or scrolling all the way back to the bottom) re-engages.

This spec mirrors that model on ALiX's agent tab. The chat tab also gets the bottom-anchored input panel (no slash strip — slash commands are agent-tab only by PR #341's contract). The two new helpers extracted for this work — `renderBottomAnchoredSlice` and `renderSlashOverlay` — are designed so any future tab can opt into the same model without re-deriving the math.

## Goals

- The agent tab's input prompt renders pinned at the bottom of the viewport, above the 3-row footer.
- The agent tab's slash strip renders directly below the panel as a single bottom-anchored unit; the unit slides up to accommodate the strip and never overlaps the footer.
- Auto-follow: new responses snap to the bottom only when the user is already following (pinned); scrolling up disengages; `End` re-engages.
- The chat tab also gets the bottom-anchored input panel.
- The math is extracted into reusable, pure helpers so the next tab needing this UX adopts it cheaply.

## Non-goals

- **Input cursor position** (left/right arrows inside the buffer, home/end, word-delete, kill-line, selection) — deferred. `inputBuffer` stays a flat `string`.
- **History recall** (ArrowUp from the input box recalls previous prompts) — deferred.
- **Applying the model to tabs other than chat + agent** — helpers are reusable; explicit per-tab opt-in happens later.
- **Numeric magic-number cap on the strip for small terminals** — helpers degrade gracefully; no fixed threshold (verified at smoke-test time on a real narrow terminal).

---

## Architecture

### Single-rule panel placement

**The panel renders immediately below the last visible line of transcript. The slash strip renders immediately below the panel. Everything else is computing what "visible" means.** Under the branched `pinnedBottom` semantics (see Data flow), this single rule produces both bottom-anchoring (when `pinnedBottom === true`: the window is recomputed at the tail each frame) and mid-viewport parking (when `pinnedBottom === false`: the captured `scrollOffset` keeps the window locked to the same absolute lines).

```
┌──────────────────────────────────────┐
│  3-row header                        │
│  row 3                              │
│  row 4: status line + intent badge   │  ← always visible (chrome, not scrollback)
│──────────────────────────────────────│  ← scrollbackTop
│                                      │
│  scrollback rows (sliced to fit)     │
│                                      │
│──────────────────────────────────────│  ← panelRow - 1 = scrollbackBottom
│  input panel row                    │  ← panelRow
│  slash strip row 1  (when open)      │  ← panelRow + 1
│  slash strip row 2                  │
│  ...                                 │
│  slash strip row N (≤6)             │  ← panelRow + N
│──────────────────────────────────────│  ← footerTop (rows - 3)
│  3-row footer                        │
└──────────────────────────────────────┘
```

When slash mode is closed, the strip region collapses to 0 rows; `scrollbackBottom === panelRow - 1`. When slash mode is open, the strip claims `min(entries.length, 6)` rows starting at `panelRow + 1`; `scrollbackBottom === panelRow - 1` (the strip extends downward into the footer area, not into the scrollback). The unit "panel + strip" is bottom-anchored to the footer top.

**Important correction during brainstorming:** the slash strip sits *below* the panel (not above), matching Claude Code's layout. The strip renders after the panel row in row-number order, growing downward toward the footer. The unit slides up together when slash mode opens so it never overlaps the 3-row footer.

### `scrollOffset` semantics — branched by `pinnedBottom`

The pinned case and the unpinned case use different rules for what `scrollOffset` means. They share one helper, which receives a single precomputed `offset` value.

- **When `pinnedBottom === true`:** `scrollOffset` is **ignored** for rendering. The caller computes `windowStart = max(0, allLines.length - scrollbackRows)` fresh each frame. Drift-free by construction — no caching, no stale length. The default initial state is `pinnedBottom = true`, so a fresh session renders its most recent lines.
- **When `pinnedBottom === false`:** `scrollOffset` is the **absolute `windowStart`** — the index into `allLines` where the visible window begins. It is captured once when the user scrolls away from bottom and only changes via explicit `ArrowUp` / `ArrowDown` / `End` / `/clear` / tab-switch. This is the absolute-from-top anchor; new content arriving does not change the numeric value, so the window stays locked to the same absolute lines (no drift).

The helper `renderBottomAnchoredSlice` takes a single `offset` parameter. The caller branches on `pinnedBottom` before passing it in:

```ts
const scrollbackRows = max(0, panelRow - 1 - scrollbackTop + 1);
const offset = perTab.pinnedBottom
  ? max(0, allLines.length - scrollbackRows)   // fresh each frame, drift-free
  : perTab.scrollOffset;                       // absolute windowStart, captured once
renderBottomAnchoredSlice({ canvas, allLines, top: scrollbackTop, bottomRow: panelRow - 1, offset, columns, kindStyles });
```

**Why this matters:** a single "top-anchored" rule for both cases is wrong — it inverts the default behavior (`scrollOffset = 0` would render the oldest messages, not the newest) and inverts the scroll direction (ArrowUp would move toward newer content instead of older history). The pinned case never needed `scrollOffset` to mean anything; the unpinned case is the only one that benefits from an absolute anchor.

Today's slice math at `agent-view.ts:200-205` is bottom-relative. **It will be replaced with the branched formula above as part of this spec.**

---

## Components

### 1. `src/tui/views/bottom-anchored-viewport.ts` (new — pure helper)

- `renderBottomAnchoredSlice(opts: { canvas: TerminalCanvas; allLines: ScrollbackLine[]; top: number; bottomRow: number; offset: number; columns: number; kindStyles: Record<ScrollbackLineKind, (line: ScrollbackLine, rowY: number) => void> }): { firstRow: number; lastRow: number }`
  - Computes the visible window as `[offset, offset + scrollbackRows]` clamped to `[0, allLines.length]`, where `scrollbackRows = bottomRow - top + 1`.
  - For each visible line at index `i`, calls `kindStyles[line.kind](line, top + i)` to let the caller own per-kind rendering (preserving the existing rich styling in `agent-view.ts:209-238` and `chat-view.ts:100-109`).
  - Returns `{ firstRow: top, lastRow: top + visibleCount - 1 }`. If `allLines.length === 0` or `scrollbackRows <= 0`, returns `{ firstRow: 0, lastRow: -1 }` and writes nothing.
  - **Pure function.** No state, no I/O, no mutation of inputs.
  - ~80 lines including tests.

### 2. `src/tui/views/slash-overlay.ts` (new — pure helper)

- `renderSlashOverlay(opts: { canvas: TerminalCanvas; slash: SlashStrip; panelRow: number; columns: number; maxRows?: number }): { rowsRendered: number; lastRow: number; selectionVisible: boolean }`
  - If `slash.entries.length === 0` and `slash.hint !== null`: renders 1 hint row at `panelRow + 1`. Returns `{ rowsRendered: 1, lastRow: panelRow + 1, selectionVisible: false }`.
  - If `slash.entries.length > 0`: computes the visible window into `slash.entries` so `slash.selected` stays visible. The windowing rule:
    - `start = max(0, min(slash.selected - floor(maxRows/2), slash.entries.length - maxRows))`
    - Renders `min(slash.entries.length, maxRows)` rows starting at `panelRow + 1`. Each row: ` marker \x1b[36m${label}\x1b[0m ${description}`. `marker = '>'` for the selected entry, `' '` otherwise.
    - Returns `{ rowsRendered, lastRow: panelRow + rowsRendered, selectionVisible: start <= slash.selected && slash.selected < start + rowsRendered }`.
  - If `panelRow + 1 + requestedRows > canvas.rows` (would overlap footer): renders `max(0, canvas.rows - panelRow - 1)` rows. If that rounds to 0, returns `{ rowsRendered: 0, lastRow: panelRow, selectionVisible: false }`.
  - Default `maxRows = 6`. **No magic-number terminal-size cap** — the helper degrades by clamping to available rows.
  - **Pure function.** No state, no I/O, no mutation of inputs.
  - ~50 lines including tests.

### 3. `src/tui/views/agent-view.ts` (modified)

- `render(ctx)`:
  - Move the status line + intent badge to **row 4** (currently rows 4–5), pinned under the 3-row header. Always visible regardless of scroll position. Status badge `(events: N | step N/M)` left-aligned; intent badge `[E]`/`[V]` indented at column 2.
  - Row 3 (between the 3-row header and the status line at row 4) is reserved blank chrome — a separator that visually distinguishes the header band from the body. **This row is load-bearing spacing; do not collapse it without checking the design.**
  - Row 5 is blank by design; it gives the status line breathing room and prevents the scrollback top from crowding the badge.
  - Compute `panelRow = ctx.dimensions.rows - FOOTER_H(3) - 1` (the bottom row above the footer).
  - Compute `slashRows = ctx.slash ? min(ctx.slash.entries.length || 1, 6) : 0`. (Hint-mode renders 1 row; entry-mode renders `min(entries.length, 6)`.)
  - **No scrollback adjustment for the strip** — the strip extends downward below the panel, not upward into the scrollback. The scrollback area is `[scrollbackTop, panelRow - 1]` regardless of slash mode.
  - Compute `scrollbackTop = 6`, `scrollbackBottom = panelRow - 1`, `scrollbackRows = max(0, scrollbackBottom - scrollbackTop + 1)`. (Row 6 is the first row after the status line's blank separator at row 5.)
  - Build `allLines` exactly as today (plan tasks, plan content, turns, pending approvals, pending tool calls, progress ledger).
  - **Branch on `pinnedBottom` before calling the helper** (per the "Branched by `pinnedBottom`" section above):
    ```ts
    const effectiveOffset = ctx.perTab.pinnedBottom
      ? Math.max(0, allLines.length - scrollbackRows)
      : ctx.perTab.scrollOffset;
    ```
  - Call `renderBottomAnchoredSlice({ canvas, allLines, top: scrollbackTop, bottomRow: scrollbackBottom, offset: effectiveOffset, columns, kindStyles })`. The `kindStyles` map captures the per-kind rendering currently inlined at `agent-view.ts:209-238` (plan / approval / toolCall / first-line user+agent / continuation).
  - Render the input panel at `panelRow`: `c.write(0, panelRow, '\x1b[33m alix-agent>${RESET} '); c.write(13, panelRow, buf); c.write(13 + buf.length, panelRow, '\x1b[7m ${RESET}')`. Reverse-video block cursor at the end of the typed text.
  - If `ctx.slash`: call `renderSlashOverlay({ canvas, slash: ctx.slash, panelRow, columns })`. The strip renders below the panel.
  - Cursor positioning: update `app.ts:1476-1486` (`paintCursor`) to position the cursor at `\x1b[${panelRow + 1};13H` instead of `\x1b[5;13H` for the agent tab. (Same shape for chat tab, column 7 instead of 13.)
  - `handleKey`: unchanged. ArrowUp/Down still scroll the scrollback; the `pinnedBottom` side-effect happens in `app.ts` when handling the `ViewAction.scroll` action.

### 4. `src/tui/views/chat-view.ts` (modified)

- `render(ctx)`:
  - Compute `panelRow = ctx.dimensions.rows - FOOTER_H(3) - 1`.
  - Compute `scrollbackTop = 5` (chat tab has no status-line / intent-badge rows above the scrollback; row 4 is reserved for the panel's old position and is now blank chrome, leaving row 5 as the scrollback top).
  - Compute `scrollbackBottom = panelRow - 1`, `scrollbackRows = max(0, scrollbackBottom - scrollbackTop + 1)`.
  - Build `allLines` exactly as today (timeline → wrapped lines, blank separators).
  - **Branch on `pinnedBottom` before calling the helper** (same pattern as the agent view).
  - Call `renderBottomAnchoredSlice({ canvas, allLines, top: scrollbackTop, bottomRow: scrollbackBottom, offset: effectiveOffset, columns, kindStyles })` with `kindStyles` capturing the per-kind rendering at `chat-view.ts:100-109`.
  - Render the input panel at `panelRow`: `c.write(0, panelRow, '\x1b[33m alix>\x1b[0m '); c.write(7, panelRow, buf); c.write(7 + buf.length, panelRow, '\x1b[7m \x1b[0m')`.
  - **No slash overlay** — `ctx.slash` is never present for chat (`views/types.ts:34-41` defines it as optional and the agent tab is the only producer).
  - `handleKey`: unchanged. Cursor positioning in `app.ts` updated to match.

### 5. `src/tui/app.ts` (modified — auto-follow wiring)

- **State field already exists:** `PerTabState.pinnedBottom: boolean` (`state.ts:54-59`), initialized to `true` (`state.ts:153`). Currently only honored by the runtime tab. **Wired up for chat + agent in this spec.**

- **`dispatchToSession` (`app.ts:827`):** when a response event arrives, do nothing to `scrollOffset` / `pinnedBottom` directly. The view's `render` reads the current `allLines.length` fresh each frame when `pinnedBottom === true`, so auto-follow falls out of the branched rendering logic without any explicit clamp here. New content just shows up at the bottom because `effectiveOffset = bottomAnchor = max(0, allLines.length - scrollbackRows)` recomputed.

- **`handleRaw` agent/chat tab key handling (`app.ts:559-658`):** apply the named transitions from the Data flow table:
  - `scroll-up` (pinned → unpinned): set `pinnedBottom = false` and capture `scrollOffset = max(0, allLines.length - scrollbackRows) - step` (read `allLines.length` from the most recent `RuntimeSnapshot`).
  - `scroll-up` (already unpinned): `scrollOffset = max(0, scrollOffset - step)`.
  - `scroll-down`: `scrollOffset = min(scrollOffset + step, max(0, allLines.length - scrollbackRows))`. If the clamp hit the bottom anchor, also set `pinnedBottom = true` (`scroll-down-floor`).
  - `scroll-down-floor` is the sub-case where the clamp fires.

- **New key handler:** `End` (and `G` as a synonym) on chat + agent tabs → sets `perTab.pinnedBottom = true`. `scrollOffset` is ignored while pinned, but set it to `bottomAnchor` for consistency so the next `scroll-up` transition captures a sensible value. Plumbed through `handleRaw` so it doesn't conflict with future history-recall (history recall will use ArrowUp from the input box, not `End`).

- **`/clear` invocation:** when the clear command resolves (existing `submitSlashCommand` path at `app.ts:703`), set `perTab.pinnedBottom = true` for the active tab. `scrollOffset` is set to the new `bottomAnchor` (which is 0 if the cleared timeline is empty) for consistency.

- **`onActivate` for chat + agent:** set `perTab.pinnedBottom = true`. `scrollOffset` set to the new `bottomAnchor` (which is 0 for an empty timeline). **Documented tradeoff:** scroll position is not preserved across tab switches. The runtime tab already does this; this spec propagates the same behavior to chat + agent.

### 6. `src/tui/state.ts` (no changes)

- `PerTabState` already has `scrollOffset`, `pinnedBottom`, `inputBuffer`. No new fields, no new types.

---

## Data flow

### Offset math (branched on `pinnedBottom`)

Given `allLines`, `scrollbackRows`, `perTab.pinnedBottom`, `perTab.scrollOffset`:

```
bottomAnchor = max(0, allLines.length - scrollbackRows)
effectiveOffset = perTab.pinnedBottom ? bottomAnchor : perTab.scrollOffset
windowStart = effectiveOffset
windowEnd   = min(allLines.length, windowStart + scrollbackRows)
visible     = allLines.slice(windowStart, windowEnd)
firstRow    = scrollbackTop
lastRow     = scrollbackTop + visible.length - 1   // (or -1 if visible.length === 0)
```

- **Pinned (`pinnedBottom === true`):** `effectiveOffset = bottomAnchor` recomputed each frame from the current `allLines.length`. A short scrollback (`allLines.length < scrollbackRows`) renders all lines with blank rows below the slice. A long scrollback fills the slice up to `scrollbackRows` and pins the panel directly below it.
- **Unpinned (`pinnedBottom === false`):** `effectiveOffset = perTab.scrollOffset`. The window starts at the captured absolute index and stays locked there as new content arrives.

### State transitions (named, no numbering)

`scrollOffset` semantics in this table: when `pinnedBottom === true`, the field is *ignored* for rendering; the table describes what the field is **set to** so it's correct the moment pinnedBottom flips off (or when the table applies while already unpinned).

| Name | Trigger | Effect on `scrollOffset` | Effect on `pinnedBottom` |
|---|---|---|---|
| `scroll-up` (pinned → unpinned) | First ArrowUp while `pinnedBottom === true` | `= max(0, allLines.length - scrollbackRows) - step` (captures current bottom anchor, then moves the window up by `step`) | `false` |
| `scroll-up` (unpinned) | ArrowUp while `pinnedBottom === false` | `-= step` (smaller `windowStart` = further back in history), clamped to `>= 0` | unchanged (`false`) |
| `scroll-down` (unpinned) | ArrowDown while `pinnedBottom === false` | `+= step`, clamped to `max(0, allLines.length - scrollbackRows)` | unchanged unless clamped (see `scroll-down-floor`) |
| `scroll-down-floor` | `scroll-down` clamped the offset to the bottom anchor | (now equals bottom anchor) | `true` (re-engage) |
| `reanchor` | `End` or `G` key | (no-op; field is ignored while pinned) | `true` |
| `clear` | `/clear` slash command | (no-op; field is ignored while pinned) | `true` |
| `tab-switch` | `onActivate` for chat + agent | (no-op; field is ignored while pinned) | `true` |
| `new-content-pinned` | Response event arrives while `pinnedBottom === true` | (no-op; ignored) | unchanged (`true`) |
| `new-content-unpinned` | Response event arrives while `pinnedBottom === false` | unchanged (absolute anchor; window stays locked) | unchanged (`false`) |

**`scroll-up` (pinned → unpinned) is the transition that captures the current bottom anchor into `scrollOffset`.** If we just did `pinnedBottom = false` without setting `scrollOffset`, the user's first ArrowUp would not move the visible window (because `effectiveOffset` was already `bottomAnchor` while pinned and is now read from the unset field, which could be 0 — landing the user at the top of scrollback). Capturing `bottomAnchor - step` makes the first ArrowUp move the window up by exactly one step from where it was.

`scroll-down-floor` is a sub-case of `scroll-down` but worth naming because it's the only path that *re-engages* `pinnedBottom` automatically (without an explicit reanchor key). When `scroll-down` clamps `scrollOffset` upward because the user reached the bottom anchor, pinnedBottom flips to `true` — the user has arrived back at the tail.

### Component data flow

```
input key event
        │
        ▼
TuiApp.handleRaw (app.ts)
        │  dispatches per active tab
        ▼
view.handleKey (agent-view.ts / chat-view.ts)
        │  returns ViewAction.scroll
        ▼
TuiApp applies the action
        │  updates perTab.scrollOffset + perTab.pinnedBottom (transitions above)
        ▼
paintFullFrame
        │  builds allLines from runtime snapshot
        ▼
renderBottomAnchoredSlice (helper)        renderSlashOverlay (helper, agent only)
        │                                       │
        ▼                                       ▼
canvas.write() rows [scrollbackTop..lastRow]  canvas.write() rows [panelRow+1..]
        │
        ▼
canvas.write() row panelRow  (input prompt + buffer + cursor)
        │
        ▼
paintCursor in app.ts moves terminal cursor to (panelRow+1, 13|7)
```

---

## Error handling & edge cases

| Situation | Behavior |
|---|---|
| Empty scrollback | `allLines = []`. `renderBottomAnchoredSlice` returns `{ firstRow: 0, lastRow: -1 }`. Panel sits at `panelRow` directly above footer. No blank rows. |
| Slash strip while no scrollback | Strip renders below panel; scrollback area shows blank rows above the panel. Acceptable. |
| Strip exceeds available rows (huge entries, small terminal) | `renderSlashOverlay` renders `max(0, canvas.rows - panelRow - 1)` rows. If that rounds to 0, nothing renders and `selectionVisible: false`. Caller (`app.ts`) checks the return value and, if `selectionVisible === false`, adjusts `slashSelection` to the nearest visible entry on the next render tick. **No magic-number cap**; verified at smoke-test time on a real narrow terminal. |
| Resize during slash mode | Frame is recomputed every paint; helpers read `ctx.dimensions` fresh each call. No transient state to leak. The windowing math in `renderSlashOverlay` re-centers on `slash.selected` each call. |
| New response while scrolled up (`pinnedBottom === false`) | `scrollOffset` is the absolute `windowStart` (Section "Data flow"), so an unchanged value keeps the visible window locked to the same absolute lines. The new content sits below the window; the user keeps reading history; `End` re-anchors. No drift. |
| `/clear` while scrolled up | `clear` transition: `pinnedBottom = true`, `scrollOffset = max(0, allLines.length - scrollbackRows)` (which is 0 for a freshly-cleared empty timeline). Snap to bottom. |
| Tab switch while scrolled up | `tab-switch` transition: `pinnedBottom = true`, `scrollOffset = max(0, allLines.length - scrollbackRows)` (the bottom anchor of the freshly-activated tab's timeline). Accepted tradeoff (Section "Documented tradeoffs" below). |
| Bracket paste during slash mode | Paste appends to `inputBuffer`. `rankSkillMatches` re-runs on each keystroke (current behavior, preserved). Existing `handlePaste` (`app.ts:1131`) handles this; no change. |
| Concurrent updates (event arrives during paint) | Render is single-threaded on the JS event loop; the 1-second refresh tick samples collectors synchronously. No race surface introduced. |
| Terminal doesn't support alt-buffer | Existing `terminal-control.ts` handles this — TUI runs in primary buffer with full repaints. No change. |

---

## Documented tradeoffs

1. **Scroll position is not preserved across tab switches.** `onActivate` snaps to bottom for chat + agent. The runtime tab already does this. This is an explicit decision documented here so it doesn't get "fixed" later by reintroducing the offset-drift problem.

2. **Slash strip has no fixed minimum terminal size.** Tested at smoke time on a real narrow terminal; floor is "some visible transcript + the panel + at least one strip row if any." If the terminal is *so* narrow that even one strip row + panel + footer can't fit, the strip is silently dropped (returns `rowsRendered: 0`) and the input panel takes precedence. This is graceful degradation, not a mode switch.

3. **`inputBuffer` stays a flat `string`.** Cursor-position refactor and history recall are deferred. The result: ArrowUp/Down always scroll the scrollback; there is no in-buffer cursor navigation; selecting text in the input box requires a terminal-level selection (e.g. mouse). Future PR.

---

## Testing

### Unit — `src/tui/views/__tests__/bottom-anchored-viewport.test.ts` (new)

Table-driven on a `MockCanvas`:

- Empty `allLines` → returns `{ firstRow: 0, lastRow: -1 }`, writes nothing.
- `allLines.length < scrollbackRows`, `offset = 0` → window is `[0, length]`; `lastRow = top + length - 1`.
- `allLines.length >= scrollbackRows`, `offset = 0` → window is `[0, scrollbackRows]`; `lastRow = top + scrollbackRows - 1`.
- `offset = N`, any N → window is `[N, N + scrollbackRows]` clamped to `[0, allLines.length]`.
- `offset + scrollbackRows > allLines.length` → clamped; `lastRow` reflects the actual end.
- `scrollbackRows === 0` → returns `{ firstRow: 0, lastRow: -1 }`, writes nothing.
- `kindStyles` is invoked once per visible line with the correct `(line, rowY)` pair.

The helper is a pure function of `offset` and `allLines`; `pinnedBottom` branching lives in the caller (verified in app tests below).

### Unit — `src/tui/views/__tests__/slash-overlay.test.ts` (new)

Table-driven:

- `slash === undefined` → returns `{ rowsRendered: 0, lastRow: panelRow, selectionVisible: true }`.
- `slash.hint !== null`, entries empty → 1 hint row at `panelRow + 1`; `selectionVisible: false`.
- `slash.entries.length <= maxRows` → renders that many rows; `selectionVisible: true` if `slash.selected` in range.
- `slash.entries.length > maxRows` → renders `maxRows` rows windowed around `slash.selected`; `selectionVisible: true` if window contains `slash.selected`.
- `panelRow + 1 + maxRows > canvas.rows` → renders `max(0, canvas.rows - panelRow - 1)` rows. If 0, `selectionVisible: false`.
- Selected row gets `>` marker; other rows get ` `.

### Unit — `src/tui/__tests__/app.test.ts` (extended)

The view-level branching (`pinnedBottom` → `effectiveOffset`) lives in `agent-view.ts` / `chat-view.ts`, but the state transitions that mutate `scrollOffset` / `pinnedBottom` live in `app.ts`. The view tests cover the rendering branch; these tests cover the state mutations.

- **Initial state on a fresh session:** `pinnedBottom === true`, `scrollOffset === 0` (set by `createInitialPerTabState`). Caller renders the bottom-anchored slice from `bottomAnchor = max(0, allLines.length - scrollbackRows)` — i.e. shows the most recent lines. Regression guard for the default behavior.
- **`scroll-up` (pinned → unpinned):** ArrowUp while `pinnedBottom === true`. After: `scrollOffset = max(0, allLines.length - scrollbackRows) - step`, `pinnedBottom = false`. The visible window must have moved up by exactly one step (not jumped to the top of scrollback).
- **`scroll-up` (already unpinned):** ArrowUp while `pinnedBottom === false`. After: `scrollOffset -= step`, clamped to `>= 0`. `pinnedBottom` unchanged.
- **`scroll-down` (unpinned):** ArrowDown while `pinnedBottom === false`. After: `scrollOffset += step`, clamped to `max(0, allLines.length - scrollbackRows)`. `pinnedBottom` unchanged unless the clamp hit (see next test).
- **`scroll-down-floor` (re-engage):** ArrowDown when `scrollOffset + step > bottomAnchor`. After: `scrollOffset === bottomAnchor`, `pinnedBottom === true`. Visible window now matches the pinned rendering path.
- **`new-content-pinned`:** response event arrives while `pinnedBottom === true`. After: `scrollOffset` (still ignored for rendering), `pinnedBottom` unchanged. Next render shows the new content at the bottom.
- **`new-content-unpinned`:** response event arrives while `pinnedBottom === false`. After: `scrollOffset` unchanged, `pinnedBottom` unchanged. Visible window stays locked to the same absolute lines (no drift). Add a regression test that grows `allLines` by 5 lines mid-session and asserts the rendered slice indices do not change.
- **`reanchor`:** `End` or `G` key. After: `pinnedBottom === true`. `scrollOffset` is irrelevant while pinned but should be left in a consistent state (e.g. set to `bottomAnchor` so the next `scroll-up` transition captures it cleanly).
- **`clear`:** `/clear` slash command. After: `pinnedBottom === true`, `scrollOffset` set to `bottomAnchor`.
- **`tab-switch`:** `onActivate` for chat + agent. After: `pinnedBottom === true`, `scrollOffset` set to `bottomAnchor`. Accepted tradeoff: scroll position is not preserved across tab switches.
- **Chat tab never receives `ctx.slash`** (regression guard on the agent-tab-only scoping).
- **Direction regression:** ArrowUp must reveal *older* lines (smaller `windowStart`); ArrowDown must reveal *newer* lines (larger `windowStart`). Pin this in a test that asserts the rendered slice shifts in the correct direction for each key.

### Snapshot tests (intentional updates)

Existing canvas snapshots in `src/tui/__tests__/` will fail on the first run because the panel + status line relocated. Update them as part of this PR:

- The implementer runs the test suite, generates new snapshots, and diffs them against the old.
- The reviewer audits the diff before approving the snapshot update.
- Both chat and agent snapshots are affected.

### Verification checklist

1. `pnpm tsc --noEmit` clean.
2. `pnpm test:node` (or whatever the project's test script is — confirm in `package.json` before merge) all green including updated snapshots.
3. `pnpm tui` — verify bottom-anchoring, slash strip, scroll-up parking, `End` re-anchor, `/clear`, tab switch, narrow-terminal graceful shrink.
4. `mcp__gitnexus__impact({target: "AgentView", direction: "upstream"})` before opening the PR — surface blast radius in the PR body (mandatory per `CLAUDE.md`).
5. `mcp__gitnexus__detect_changes()` before committing (mandatory per `CLAUDE.md`).
6. Branch workflow: close all open PRs / branches before opening the new one (per `branch-workflow-policy.md` in memory).
