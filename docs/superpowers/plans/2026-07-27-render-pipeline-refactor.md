# Rendering Pipeline Refactor

**Context:** The rendering pipeline (blocks parser → inline parser → tokenizers → theme → renderer → views) was built over 13 tasks in parallel. This produced duplicated code across tokenizers, two competing implementations of the block parser, ANSI constants scattered across 3 files, and inline boilerplate in both view consumers.

**Goal:** Eliminate ~550 lines of duplication, centralize ANSI/box-drawing constants, and clean up architectural violations (blocks/ importing from views/, dead fields in type definitions).

**Strategy:** 4 priorities, sequential. Each priority is independent and testable. No behavior changes — pure refactoring.

---

### P1: Delete the old parser

Old `src/agent/response-blocks.ts` already re-exports `parseBlocks` from the new parser (line 341). The entire file is dead code — two `parseResponseBlocks` implementations, duplicated `matchFence*`/`matchListItem`/`flushText` — never imported by anything except tests.

**Remove:** `src/agent/response-blocks.ts` (delete the file).  
**Replace with:** a one-liner `export { parseBlocks } from '../tui/blocks/parser.js';` at the same path.  
**Verify:** all test imports still resolve; remove the duplicate `ListMarker`/`ResponseBlock` types from tests that imported from the old path.

**Impact:** -340 lines, eliminated 2 competing implementations of the same concept.

---

### P2: Extract shared tokenizer utilities

Create `src/tui/blocks/langs/shared.ts` with:

- `consumeWhitespace(code, i, tokens): number` — skip `[ \t\r\n]`, push plain, return new `i`
- `consumeHashComment(code, i, tokens): number` — `#` to EOL, push comment, return new `i`
- `consumeString(code, i, delimiter, tokens): number` — string literal with backslash-escape support
- `consumeNumber(code, i, pattern, tokens): number` — number literal with custom continue-regex
- `consumeIdentifier(code, i, keywords, tokens, opts?): number` — keyword vs identifier, optional function-name detection
- `lastNonPlainToken(tokens): Token | undefined` — lookback helper

Refactor all 4 language tokenizers to call these. Each tokenizer's `tokenize()` body becomes: if whitespace → shared, if `#` → shared, if `'`/`"` → shared, if `0-9` → shared, etc. Only language-specific special cases (Python f-strings, TS template literals/regex, Bash `$VAR`) stay in the tokenizer file.

**Also fix:** remove the unused `registerTokenizer` export from `tokenize.ts`.

**Impact:** -150 lines across 5 files, centralizes 4 copies of whitespace/string/number/comment detection.

---

### P3: Create `renderResponse` shared convenience

Add to `src/tui/blocks/render.ts`:

```ts
export function renderResponse(text: string, width: number): StyledRow[] {
  return renderBlocks(parseBlocks(text), defaultTheme, width);
}
```

Then in `src/tui/views/agent-view.ts`: delete `renderAgentResponse` and `RenderedLine` interface. The one caller replaces:
```ts
const rendered = renderAgentResponse(t.text, t.kind, textWidth);
```
with:
```ts
const rendered = renderResponse(t.text, textWidth)
  .map(r => ({ kind: t.kind, text: r.text, isFirst: r.isFirst }));
```

In `src/tui/views/chat-view.ts`: delete `ScrollbackLine` interface. Replace the inline parse+render loop with the same pattern. The two views converge on identical response-rendering code.

**Also remove** the dead `truncateVisible` function from `agent-view.ts` (unreferenced, `hardTruncate` in `wrap-text.ts` is the active path).

**Impact:** -40 lines, eliminates duplicated inline pipeline composition. `RenderedLine`/`ScrollbackLine` converge to `StyledRow`.

---

### P4: Centralize ANSI constants

Create `src/tui/ansi-constants.ts`. Move in:

- `RESET = '\x1b[0m'` (currently in `theme.ts`, hardcoded 12+ other places)
- `BOLD_OPEN`/`BOLD_CLOSE`, `ITALIC_OPEN`/`ITALIC_CLOSE`, `INVERSE_OPEN`/`INVERSE_CLOSE`, `DIM_OPEN`/`DIM_CLOSE`
- All semantic color strings: `CYAN`, `GREEN`, `YELLOW`, `MAGENTA`, `BLUE`, `GRAY`, `RED`
- The `ANSI_REGEX` from `canvas-cell.ts` (single source of truth for ANSI matching)

Replace `'\x1b[0m'` literals in `render.ts`, `agent-view.ts`, `canvas.ts`, `box.ts` with `import { RESET } from '../ansi-constants.js'`.
Update `theme.ts` to import from the shared constants file.
Update `wrap-text.ts` to use the shared `ANSI_REGEX` instead of its inlined variant.
Remove the dead `truncateVisible` from `agent-view.ts` (already unused).

**Impact:** -20 lines of hardcoded literals removed, single source of truth for all ANSI codes.

---

### P5 (bonus, if time permits): Fix `headingRule` width

`Theme.headingRule(level)` currently returns `'═'.repeat(40)` — hardcoded 40 chars. The renderer passes `width` to `renderRule` but not to `renderHeading`. Fix:

1. Add `width: number` parameter to `Theme.headingRule` in `types.ts`.
2. Update `theme.ts:headingRule(level, width)` to use `width`.
3. Update `render.ts:renderHeading` to pass `width`.

**Impact:** 3 lines changed. Heading rule lines now span the full terminal width instead of capping at 40.

---

## Verification

After each priority:
- `npx tsc --noEmit` — 0 errors
- `npx vitest run tests/tui/ tests/agent-view-formatting.vitest.ts tests/response-blocks-parser.vitest.ts tests/response-blocks-smoke.vitest.ts` — all 333 pass
- commit

After all priorities:
- `npx vitest run` (full suite) — no regressions
- rebuild: `pnpm build`
