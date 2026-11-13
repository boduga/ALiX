# Workbench Input

## Overview
Pure key-to-intent routing for the Workbench surface. This package turns a single key press plus a presentation context into a `WorkbenchInputIntent`; it performs no dispatch, no rendering, and no runtime work. The controller layer consumes the resulting intent.

## Interface
- `routeWorkbenchInput(key, context)` is the pure context-sensitive key router [input-router.ts:routeWorkbenchInput]
- `WorkbenchInputContext` carries `turnActive`, `composerText`, `slashActive`, approval/overlay/inspector/coordination flags, transcript mode, drawer, and focus [input-router.ts:WorkbenchInputContext]
- `WorkbenchInputIntent` is the discriminated intent union (composer edits, submit/queue, slash, cancel, approval, permission, overlay/drawer, transcript, selection, coordination) [input-router.ts:WorkbenchInputIntent]
- `WorkbenchInputSignals` and `buildWorkbenchInputContext(state, signals)` derive the router context from `WorkbenchUiState` [input-context.ts:buildWorkbenchInputContext]
- `WorkbenchBuiltinCommand` and `parseWorkbenchBuiltinCommand(text)` recognize exact presentation-only commands [builtin-command.ts:parseWorkbenchBuiltinCommand]

## Invariants
- Routing is a fixed priority chain: pending-approval decision keys (`a`/`d`), then inspector shortcut, coordination overlay, generic overlay, drawer, then composer/transcript focus [input-router.ts:routeWorkbenchInput]
- A coordination overlay that is busy returns `unhandled` except for `Escape` and `Ctrl+o` [input-router.ts:routeWorkbenchInput]
- `turn.cancel` is emitted from `Escape` only when `turnActive` is true; otherwise transcript focus returns to the composer [input-router.ts:routeWorkbenchInput]
- `Enter` maps to `slash.submit` while slash is active, `turn.queue` while a turn is active, and `turn.submit` otherwise [input-router.ts:routeWorkbenchInput]
- Empty-trimmed composer input maps `Enter` to `unhandled` [input-router.ts:routeWorkbenchInput]
- Printable input is admitted through `isPrintableGrapheme`, preserving grapheme boundaries [input-router.ts:routeWorkbenchInput]
- `coordinationBusy` is derived from `coordination.phase === 'submitting'` [input-context.ts:buildWorkbenchInputContext]
- Built-in commands require an exact (trimmed, lowercased) match and never dispatch runtime work or skills [builtin-command.ts:parseWorkbenchBuiltinCommand]

## Side Effects
- `["None"]` — routing and command parsing are pure string/state reads and return values only [input-router.ts:routeWorkbenchInput] [builtin-command.ts:parseWorkbenchBuiltinCommand]

## Verification
- Run: `pnpm test`
