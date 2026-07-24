# Task 3 Report — Keyboard integration

## Implemented
- Registered screen shortcuts, retaining exit and tab switching behavior.
- Changed Escape to emit `homeTab` per the task specification.
- Added textarea `keypress` buffer mirroring via `inputChanged`.
- Added textarea submit handling via `submitInput`, followed by a cleared-buffer mirror event.
- Added approval `a`/`d` handlers that emit `resolveApproval` only while the approval hint is visible.
- Connected the handler to `promptTextarea` and `approvalHint`.
- Added the missing textarea `key` typing declaration.

## Verification
- `pnpm tsc --noEmit`: passed.
- `pnpm vitest run tests/tui/blessed-renderer.vitest.ts`: 18/19 passed.
- The sole failure is the focused test expecting Escape to emit `blurInput`; the task explicitly requires replacing that behavior with `homeTab`.
- GitNexus change detection reported low risk.

## Files changed
- `/home/babasola/Projects/Monolith/src/tui/renderers/blessed/keyboard-handler.ts`
- `/home/babasola/Projects/Monolith/src/tui/renderers/blessed-renderer.ts`
- `/home/babasola/Projects/Monolith/src/tui/renderers/neo-blessed.d.ts`

## Self-review
The implementation is scoped to keyboard registration and does not alter render-time visibility synchronization or application state. Approval handlers are optional at runtime to remain compatible with existing test doubles that do not implement `key`; real neo-blessed textareas use the registered handlers.

## Commit
`a7280a43 feat(tui): integrate textarea keyboard events`

## Fix Pass 1 (test mocks)
- **What changed:**
  - Added `key: vi.fn()` to the `mkEl()` factory in `tests/tui/blessed-renderer.vitest.ts` so textarea-level `key` registration (`textarea.key(['a'], ...)` / `textarea.key(['d'], ...)`) does not raise `TypeError: ...is not a function` on real-blessed paths and the mock faithfully mirrors the widget surface for future tests.
  - Updated the existing `emits blurInput on Escape` test to assert `{ type: 'homeTab' }` instead of `{ type: 'blurInput' }`, matching the spec requirement that Escape maps to `homeTab`.
- **Test result:** `pnpm vitest run tests/tui/blessed-renderer.vitest.ts` → `Test Files  1 passed (1)` / `Tests  19 passed (19)` (pristine output, no failures).
- **Typecheck result:** `pnpm tsc --noEmit` → no output, exit 0 (no type regressions).
- **Note:** The production-side `textarea.key` call site is optional-chained (`textareaKey?.call(textarea, ...)`), so the `key` mock addition is defensive — it makes the mock faithful but did not need to unblock any specific failing test. The only test that was actively failing on entry was the Escape assertion; everything else (18/19) was already green.

## Fix Pass 2 (integration)
- **Production changes:** `src/tui/renderers/blessed/keyboard-handler.ts` now registers quit on `C-c` only. `src/tui/renderers/blessed-renderer.ts` uses the integrated `setupKeyboardHandler`, exposes `leftPane`, `rightPane`, `promptBar`, `promptTextarea`, and `approvalHint`, and removes the duplicate legacy input widget so rendering and keyboard input share `promptTextarea`.
- **Widget test updates:** `tests/tui/blessed-renderer.vitest.ts` now checks the new widget reference names, verifies prompt widgets and approval hint persist across renders, and asserts the exit binding contains only `C-c`.
- **Test result:** `pnpm vitest run tests/tui/blessed-renderer.vitest.ts` → `Test Files  1 passed (1)` / `Tests  19 passed (19)`; zero failures and zero warnings.
- **Typecheck result:** `pnpm tsc --noEmit` → no output, exit 0.

## Fix Pass 3 (textarea behavior)
- **Production changes:** Removed the out-of-spec screen-level `i` shortcut. Deferred ordinary `keypress` mirroring with `setImmediate` so `inputChanged` reads neo-blessed's post-edit buffer, while excluding Enter's `enter`/`return` aliases. Bound textarea Enter explicitly, removed neo-blessed's synthetic trailing newline, and emitted `submit` through the retained submit listener so submission clears the buffer without ending the textarea's editing lifecycle. Native neo-blessed 0.2.0 `textarea.submit()` was not used because runtime probing confirmed it emits `cancel(null)` rather than `submit`.
- **Test mock changes:** Made the textarea mock maintain an editable value, clear it, register/emit widget events, and expose key handlers, so tests exercise the real submit pipeline rather than returning `undefined` from `getValue()`.
- **New behavior tests:** Added direct submit-listener coverage, Enter submit/newline removal/clear coverage, deferred post-edit `inputChanged` coverage, approval `a`/`d` visibility gating, and a negative assertion that no `i` screen shortcut is registered.
- **Test result:** `pnpm vitest run tests/tui/blessed-renderer.vitest.ts` → `Test Files  1 passed (1)` / `Tests  24 passed (24)`; zero failures and zero warnings.
- **Typecheck result:** `pnpm tsc --noEmit` → no output, exit 0.
- **Runtime probe:** Real neo-blessed input bytes produced `inputChanged("a")`, `submitInput("a")`, a cleared mirror, then `inputChanged("b")`; the textarea remained in reading mode and accepted input after submission.

## Fix Pass 4 (final polish)
- `src/tui/renderers/blessed/keyboard-handler.ts`: documented the neo-blessed `textarea.submit()` workaround and now calls the typed `textarea.emit('submit')` directly.
- `src/tui/renderers/neo-blessed.d.ts`: declared `emit(event: string, ...args: unknown[]): boolean` on `Element`.
- `tests/tui/blessed-renderer.vitest.ts`: renamed the stale Escape test to `emits homeTab on Escape`.
- Test result: 24/24 passing.
- Typecheck: clean.

## Runtime Import Fix
- **Import change:** before `import * as blessed from 'neo-blessed';`; after `import blessed from 'neo-blessed';`.
- **Test mock change:** before the factory exposed `screen`, `box`, `list`, and `textarea` as named exports (plus a hybrid `default`); after it exposes the existing factories only under `default: { screen, box, list, textarea }`.
- **Test result:** `pnpm vitest run tests/tui/blessed-renderer.vitest.ts` passed 33/33; `pnpm vitest run tests/tui/` passed 200/200; `pnpm tsc --noEmit` passed cleanly.
- **Build result:** `pnpm build` passed, and `dist/src/tui/renderers/blessed-renderer.js` emits `import blessed from 'neo-blessed';`.
- **Runtime smoke test:** `node bin/alix.js tui` rendered the production TUI through real `neo-blessed` without `TypeError: blessed.screen is not a function`; SIGINT restored the shell cleanly.
