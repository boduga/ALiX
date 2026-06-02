# TUI Polish Design

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Source:** User-requested improvements from post-MVP backlog discussion

## Motivation

After shipping sub-project #3 (TUI differential rendering), the TUI was functionally correct but felt rough. Three specific improvements would meaningfully raise the polish bar:

1. **No layout constants** — magic numbers scattered across widgets
2. **Spinner has no phase awareness** — always shows "Thinking..." even when writing or verifying
3. **Budget bar uses no color cues** — users can't tell at a glance if they're close to limit

These are the "feels every session" issues users notice but rarely file tickets for.

## Goals

1. Extract a `LAYOUT` constants module for shared visual primitives
2. Add phase support to `SpinnerWidget` (thinking/writing/verifying/idle)
3. Add color-coded thresholds to `BudgetBarWidget` (safe/warn/danger)
4. Use LAYOUT constants consistently in `TuiRenderer`

## Non-Goals

- Adding new widgets
- Changing the TUI store or events
- Performance optimization (covered by performance work)
- Theme support (out of scope)

## Architecture

### New `src/tui/layout.ts` module

Single source of truth for visual constants:
- Indentation, box-drawing characters, color codes, budget thresholds

### Extended `SpinnerWidget`

Add a `SpinnerPhase` type and phase-aware rendering. Phases are set by the renderer based on agent state, not by the spinner itself.

### Extended `BudgetBarWidget`

Add a `getColor()` method that returns an ANSI color code based on usage ratio. Apply thresholds from LAYOUT constants.

### Updated `TuiRenderer`

Use `LAYOUT.sectionGap` instead of empty-string pushes for consistent spacing.

## Files Affected

| Action | File |
|--------|------|
| ➕ New | `src/tui/layout.ts` |
| ✏️ Modify | `src/tui/widgets/spinner.ts` |
| ✏️ Modify | `src/tui/widgets/budget-bar.ts` |
| ✏️ Modify | `src/tui/render.ts` |
| ➕ New | `tests/tui/widgets/spinner.test.ts` |
| ➕ New | `tests/tui/widgets/budget-bar.test.ts` |

## Success Criteria (Achieved)

- [x] `LAYOUT` constants module created
- [x] Spinner phase support added with TDD tests
- [x] Budget bar color thresholds added with TDD tests
- [x] All existing tests pass
- [x] 8 new widget tests, all pass
- [x] Merged to main
