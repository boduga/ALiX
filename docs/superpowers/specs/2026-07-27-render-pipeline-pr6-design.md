# PR 6 — Advanced Markdown Rendering

**Date:** 2026-07-27
**Status:** Approved design (pre-implementation)
**Phase 1 pipeline:** Fully operational — 333 tests pass, 0 tsc errors

## Overview

Four additive features for the alix TUI rich response rendering pipeline, building on the Phase 1 foundation (block parser v2, inline parser, 6-language syntax highlighting, code chrome). Each is independently testable and bisectable. All four land in one PR, committed in dependency order.

**Features (in commit order):**
1. Strikethrough (`~~text~~`)
2. OSC-8 hyperlinks + autolinks
3. Callouts/admonitions (`> [!NOTE]`)
4. Pipe tables

---

## 1. Strikethrough

### Type changes (`src/tui/blocks/types.ts`)

Add to the `InlineSpan` discriminated union:

```ts
| { kind: 'strikethrough'; text: string }
```

Add to the `Theme` interface:

```ts
strikethrough(text: string): string;
```

### Inline parser (`src/tui/blocks/inline.ts`)

Add detection of `~~text~~` in `parseInline()` using the same pattern as `**bold**`:
- Match opening `~~`
- Scan forward for closing `~~` via `text.indexOf('~~', i + 2)`
- Emit `{ kind: 'strikethrough', text }` when found
- Unclosed `~~` falls back to literal text (same as bold/italic behavior)

Insertion order: after `**bold**` and `*italic*` checks, before backtick and link checks. The `~` character is not otherwise meaningful in markdown, so there is no ambiguity.

### Theme (`src/tui/blocks/theme.ts`)

```ts
strikethrough: (text) => `\x1b[9m${text}\x1b[0m`,
```

ANSI code 9m is the strike-through attribute. Widely supported in modern terminals.

### Render (`src/tui/blocks/render.ts`)

Add `case 'strikethrough'` to `styleInlineSpan()`:

```ts
case 'strikethrough': return theme.strikethrough(span.text);
```

### Files touched

- `types.ts` — 2 lines (InlineSpan variant + Theme method)
- `inline.ts` — ~8 lines
- `theme.ts` — 1 line
- `render.ts` — 1 line

### Tests (inline.vitest.ts — 4 cases)

| Case | Input | Expected |
|------|-------|----------|
| Basic | `~~hello~~` | strikethrough span |
| Prose context | `foo ~~bar~~ baz` | text, strikethrough, text |
| Unclosed | `~~no close` | literal text |
| Adjacent formatting | `**bold** ~~strike~~` | bold + strikethrough |

---

## 2. OSC-8 Hyperlinks + Autolinks

### Current state

- `link` `InlineSpan` kind exists with `{ kind: 'link'; text: string; href: string }`
- `theme.link(text, href)` exists as stub: underlined blue text
- `parseInline()` already parses `[text](href)` syntax
- No autolink detection (bare URLs or `<url>` syntax)

### OSC-8 rendering (`src/tui/blocks/theme.ts`)

Replace the `link` implementation:

```ts
link(text, href) {
  // OSC-8: \x1b]8;;<href>\x1b\\<text>\x1b]8;;\x1b\\
  // Plus underline + blue for terminals that don't support OSC-8
  return `\x1b]8;;${href}\x1b\\${UNDERLINE_OPEN}${BLUE}${text}${UNDERLINE_CLOSE}\x1b]8;;\x1b\\`;
},
```

Strategy: wrap the styled text in OSC-8 sequences. Non-OSC-8 terminals see the underline+blue they already see. Terminals supporting OSC-8 make the text clickable. The `\x1b\\` is the standard string terminator (ST) for OSC sequences.

No Theme interface changes needed — `link()` already takes `(text, href)`.

### Autolink parsing (`src/tui/blocks/inline.ts`)

Add detection in `parseInline()`, after the existing `[text](href)` check:

1. **Angle-bracket autolinks:** `<https://example.com>` — if `c === '<'` and remaining text matches `/^<https?:\/\/[^>\s]+>/` (or `ftp://`, `mailto:`), emit a link span.

2. **Bare URL autolinks:** If the current buffer position starts with `https://` or `http://` and the URL boundary is followed by whitespace or end-of-input, emit a link span. Use a regex check rather than full URL parsing — GFM-style: the URL extends until whitespace or the characters `!?,.():;'"` at the end.

**URL detection regex (bare):**
```
/^https?:\/\/[^\s<>{}|\\^`[\]]+/
```

Trailing punctuation stripping: if the matched URL ends with `.`, `,`, `!`, `?`, `:`, `;`, `)`, `'`, or `"`, strip it from the link and leave it as literal text after the span.

**Insertion order:** autolink checks run AFTER the existing `[text](href)` check but BEFORE `**bold` / `*italic*` — so URLs surrounded by emphasis still resolve.

### Files touched

- `theme.ts` — ~5 lines (replace link implementation)
- `inline.ts` — ~30 lines (add two autolink parsers)

### Tests (inline.vitest.ts — 6 cases)

| Case | Input | Expected |
|------|-------|----------|
| Angle-bracket URL | `<https://example.com>` | link span |
| Bare URL | `see https://x.com/page` | text + link + text |
| Existing markdown link | `[click](https://x.com)` | link span (OSC-8 envelope) |
| Trailing punctuation | `https://x.com.` | link (no dot) + text (dot) |
| Non-link angle | `<notalink>` | literal text |
| mailto | `<mailto:user@host.com>` | link span |

---

## 3. Callouts / Admonitions

### Design principle

No new `ResponseBlock` type. Callouts ARE quotes — they parse as `{ type: 'quote' }` blocks. The difference is purely at render time: when the first word of a quote's content is `[NOTE]`, `[TIP]`, `[WARNING]`, or `[CAUTION]`, the renderer draws a colored label header instead of just a bar.

### Parser (`src/tui/blocks/parser.ts`)

**No changes.** The existing quote parser already collects lines after `>` prefix. A callout's first content line starts with e.g. `[NOTE]` — the parser stores it verbatim as part of the quote text, same as any other quote.

### Theme (`src/tui/blocks/types.ts` + `src/tui/blocks/theme.ts`)

Add to `Theme` interface:

```ts
calloutLabel(keyword: string): string;
```

Default implementation:

```ts
calloutLabel(keyword) {
  const color = CALLOT_COLORS[keyword.toUpperCase()] ?? DIM_OPEN;
  return `${BOLD_OPEN}${color}${keyword}${RESET}`;
},
```

Color map:

| Keyword | ANSI Color | Visual |
|---------|-----------|--------|
| NOTE | Blue | ℹ NOTE |
| TIP | Green | 💡 TIP |
| WARNING | Yellow | ⚠ WARNING |
| CAUTION / IMPORTANT | Red | 🔴 CAUTION |

Icons are ideal but terminal-dependent — include them as a comment in the code but prefix actual output with a simple character (`ℹ`, `💡`, `⚠`, `🔴`). The icon character MUST render in the terminal (all support Unicode in July 2026).

### Renderer (`src/tui/blocks/render.ts`)

Update `renderQuote()`:

1. Check if `block.text` (raw, unstyled) starts with a bracketed keyword on its first line: `/^\[(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*\n?/`. This operates on raw text, not styled spans — the keyword marker is never ANSI-styled.
2. If matched: strip the marker from `block.text`, render a **label row** (the keyword in its color via `theme.calloutLabel()`) followed by the remaining content lines with the standard quote bar.
3. The marker can be on its own line (`[NOTE]\ncontent`) or inline (`[NOTE] content`) — in both cases the marker is stripped and the remaining text is the callout body.
4. Edge case: if the ENTIRE quote text is just `[NOTE]` with no body content, treat it as a regular quote — the `[NOTE]` renders as plain text. The marker must be followed by non-empty content to qualify as a callout.
5. If not matched: render as a regular quote (unchanged behavior).

The label row is bar-free — it uses the full width:

```
┃ ⚠ WARNING
┃ This is a warning callout.
```

Edge case: if the entire quote content is just `[NOTE]` with no body, treat it as a regular quote with text `[NOTE]` — no label. The marker must be followed by content to qualify.

### Files touched

- `types.ts` — 1 line (Theme interface method)
- `theme.ts` — ~12 lines (callout color map + method)
- `render.ts` — ~15 lines (label check in renderQuote)

### Tests (render.vitest.ts — 6 cases)

| Case | Input | Expected |
|------|-------|----------|
| NOTE | `[NOTE]\ncontent` | blue label + bar lines |
| WARNING | `[WARNING]\ncontent` | yellow label + bar lines |
| Multi-line | `[TIP]\nline1\nline2` | label + bar lines |
| No marker | regular quote text | unchanged (no label) |
| Unknown marker | `[FOO]\ncontent` | regular quote (no label) |
| Empty body | `[NOTE]` only | regular quote with `[NOTE]` text |

---

## 4. Pipe Tables

### Type changes (`src/tui/blocks/types.ts`)

Add to `ResponseBlock`:

```ts
| {
    type: 'table';
    headers: readonly string[];
    rows: readonly (readonly string[])[];
    align?: readonly ('left' | 'center' | 'right')[];
  }
```

Add to `Theme` interface:

```ts
tableBorder: string;
```

Uses the same pattern as `codeBorder` — a raw ANSI prefix (GRAY) that gets stamped onto border cells.

### Parser (`src/tui/blocks/parser.ts`)

Add table detection before the text fallback, after list detection.

**Detection:**
1. A line matches a table candidate if it contains `|` and is not a code fence
2. The NEXT line (within the remaining lines) must be a delimiter row matching:
   ```
   /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/
   ```
3. If both conditions hold, the block is a table. Otherwise the first line is treated as text.

**Delimiter row alignment parsing:**
- `:---` → left (`align: 'left'`)
- `:--:` → center (`align: 'center'`)
- `---:` → right (`align: 'right'`)
- `----` → left (default)
- A delimiter column without content → treat as empty/missing (skip alignment entry)

**Row collection:**
After the delimiter row, collect subsequent lines that contain `|`. Stop at a blank line or a non-`|` line.

**Cell parsing:**
Split each row on `|`, trimming whitespace from each cell. Leading/trailing outer pipes are optional (GFM behavior). Handle escaped pipes (`\|`) inside cell content — the parser should NOT split on escaped pipe characters.

**Empty tables:**
A table must have at least one header cell and one data row. A delimiter-only table (no data rows) is not emitted as a table — the parser falls back to text.

### Renderer (`src/tui/blocks/render.ts`)

New `renderTable()` function called from the `renderBlocks` switch.

**Algorithm:**

1. **Compute column widths:**
   - For each column, max width of header + max width of any cell in that column, + 2 padding (1 on each side)
   - Minimum width per column: 3 (` ` + content + ` `)

2. **Build border characters through `theme.tableBorder`:**

   ```
   ┌─────┬─────┐   top border (┬-joined)
   │ h1  │ h2  │   header row
   ├─────┼─────┤   separator (┼-joined)
   │ c1  │ c2  │   data row
   ├─────┼─────┤   row separator (for multi-line cells)
   │ c3  │ c4  │   data row
   └─────┴─────┘   bottom border (┴-joined)
   ```

3. **Header styling:** header cell text goes through `theme.bold()`

4. **Cell wrapping:** each cell's content wraps independently via `wrapText()` at column width. When a cell has more lines than its row-neighbors, the shorter cells are padded with empty space so border integrity is maintained.

5. **Alignment:** padding is applied as:
   - Left: `<space>content<space>`
   - Center: `<space>content<space>` with extra spaces distributed left-first
   - Right: `<space>content<space>` with extra spaces on the left

**No multi-theme concern:** `tableBorder` uses the same GRAY as `codeBorder`, consistent with existing visual language.

### Files touched

- `types.ts` — ~6 lines (table ResponseBlock variant + Theme.tableBorder)
- `theme.ts` — 1 line (`tableBorder: GRAY`)
- `parser.ts` — ~70 lines (table detection + delimiter parsing + row collection)
- `render.ts` — ~100 lines (`renderTable()` function + switch case)

### Tests

**parser.vitest.ts (8 cases):**

| Case | Input | Expected |
|------|-------|----------|
| Basic | full GFM table with headers + rows | table block with correct arrays |
| Missing delimiter | `| a \| b \|` then text | no table (text fallback) |
| Alignment | `|:---|---:|:--:\|` | align: [left, right, center] |
| Empty cells | `| a \| \| c \|` | headers with empty middle |
| Varying columns | rows with different cell counts | column count = max, missing = empty |
| Escaped pipe | `\|` within cell | literal pipe in cell content |
| No data rows | delimiter only | text fallback |
| Leading/trailing pipes | `a \| b` (no outer `\|`) | same as `\| a \| b \|` |

**render.vitest.ts (6 cases):**

| Case | Expected |
|------|----------|
| Basic 2x2 table | bordered grid with header bold |
| Alignment rendering | left/right/center cell content |
| Multi-line cell content | expanded row height |
| Single column | rendered with borders |
| Header only | rendered as header + border |
| Empty table (0 rows) | no output |

---

## Commit Order

1. `feat(tui): add strikethrough inline span`
2. `feat(tui): add OSC-8 hyperlinks and autolinks`
3. `feat(tui): add callout/admonition rendering`
4. `feat(tui): add pipe table support`

Each commit is independently buildable and testable. No commit breaks existing tests.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Pipe table parser conflicts with existing text/fallback | Insert before text fallback, after list; delimiter row check is narrow |
| OSC-8 sequences in terminals that don't support them | Underline+blue is visible regardless; data not lost |
| Callout marker matched inside code/content | Detection only on first content line of quote — `> code [NOTE]` doesn't trigger |
| Table cell wrapping edge cases | wrapText is ANSI-aware and already validated; padding math is explicit |

## Files Touched (production)

| File | What changes |
|------|-------------|
| `src/tui/blocks/types.ts` | InlineSpan + ResponseBlock + Theme interface |
| `src/tui/blocks/inline.ts` | Autolink + strikethrough parsing |
| `src/tui/blocks/theme.ts` | Table border, callout label, strikethrough, OSC-8 link |
| `src/tui/blocks/parser.ts` | Pipe table block parsing |
| `src/tui/blocks/render.ts` | Table renderer, callout render, strikethrough pass-through |

## Test Coverage

- `tests/tui/blocks/inline.vitest.ts` — 10 new cases (strikethrough + autolinks)
- `tests/tui/blocks/parser.vitest.ts` — 8 new cases (table parsing)
- `tests/tui/blocks/render.vitest.ts` — 12 new cases (tables + callouts)
- **Total: ~30 new test cases**

## Post-RR Assessment

- All 333 existing tests must pass
- `npx tsc --noEmit` must produce 0 errors
- Each commit must independently pass these gates
