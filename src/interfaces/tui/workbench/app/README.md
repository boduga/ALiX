# Workbench App Store

## Overview
Feature-gated presentation state for the Workbench shell. `reduceWorkbenchUiState` is a pure reducer over `WorkbenchUiState` and `WorkbenchUiAction`; `WorkbenchStore` holds that state and exposes `snapshot`/`dispatch`. The store owns operator-facing UI state only — runtime truth stays in `AgentSession` and `EventLog` — and is the authoritative composer state while Workbench is feature-gated.

## Interface
- Pure state reducer: `reduceWorkbenchUiState(state, action)` in [workbench-store.ts:reduceWorkbenchUiState]
- Store class: `WorkbenchStore` with `snapshot()` and `dispatch(action)` in [workbench-store.ts:WorkbenchStore]
- Action and state types are imported from `../model/ui-action.js` and `../model/ui-state.js` ([workbench-store.ts:WorkbenchUiAction])

## Invariants
- Fixed-point reduction: cases that would not change state return the same object reference, e.g. `composer.move` when the cursor does not advance, `drawer.close` when already closed, and `selection.reconcile` when every selection is unchanged ([workbench-store.ts:reduceWorkbenchUiState]).
- Text editing is grapheme-aware: `composer.backspace`, `composer.delete`, and `composer.move` step over complete graphemes via `graphemes(...)`, so the cursor never lands mid-grapheme ([workbench-store.ts:reduceWorkbenchUiState]).
- `coordination.edit` is ignored while `state.coordination.phase === 'submitting'` ([workbench-store.ts:reduceWorkbenchUiState]).
- Selection is hierarchical and cleared downward: `run.select` clears agent/task/artifact, `agent.select` clears task/artifact, and `task.select` clears artifact ([workbench-store.ts:reduceWorkbenchUiState]).
- Scroll offsets are clamped non-negative with `Math.max(0, …)` for selection and drawer offsets, and to `0..10000` for overlay scrolling ([workbench-store.ts:reduceWorkbenchUiState]).
- The overlay stack holds at most one overlay; `overlay.toggle` of the current overlay empties the stack and returns focus to the composer ([workbench-store.ts:reduceWorkbenchUiState]).
- `dispatch` always returns the resulting state after replacing the internal snapshot ([workbench-store.ts:WorkbenchStore]).

## Side Effects
- ["None"] — the reducer and store are in-memory only; no I/O, persistence, timers, or events are emitted.

## Verification
- Run: `pnpm test`
- Workbench reducer coverage: `tests/tui/**` (see `src/interfaces/tui/AGENTS.md` verification guidance).
