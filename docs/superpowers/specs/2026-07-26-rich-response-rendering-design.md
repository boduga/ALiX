# Rich Response Rendering — Phase 1 Design

## Context

The alix TUI renders agent and chat responses as essentially plain text. From the user's screenshot of an agent response:

- A code block becomes `def fibonacci(n):` with a `[python]` header line — visually identical to the prose around it.
- Markdown `**bold**` survives into the scrollback as literal `**` markers.
- Headings, blockquotes, horizontal rules, inline code, italic — none are recognized. They all flow through as raw text.

The user wants a proper rendering pipeline that separates parsing from presentation, so:

- Future frontends (web UI, API previews, logs) reuse the same parsers and theme.
- Adding more languages, more block types, and more themes is additive, not a redesign.
- The current TUI looks like a document viewer instead of a Markdown file viewer.

This spec implements **PRs 1-5** of the user's revised roadmap (block parser v2 → inline parser → theme → tokenizers → rich renderer). **PR 6 (tables, task lists, callouts, hyperlinks, OSC-8)** is explicitly out of scope; deferred to a follow-up.

---

## Architecture

The pipeline:

```
Markdown source
      │
      ▼
ResponseBlock[]      (PR 1 — block parser v2)
      │
      ▼
ResponseBlock[]      (PR 2 — inline parser populates each block with InlineSpan[])
   with InlineSpan[]
      │
      ▼
ResponseBlock[]      (PR 4 — code blocks get tokens for their language)
   with Tokens
      │
      ▼
ANSI-styled rows     (PR 5 — rich renderer walks blocks, asks theme for each style)
      │
      ▼
TerminalCanvas.write()       (already ANSI-aware — no changes needed)
```

Each layer is pure and transport-independent. The renderer is the only consumer of the theme. Parsers never know about ANSI.

---

## Components

### New modules

| File | Responsibility |
|---|---|
| `src/tui/blocks/types.ts` | `ResponseBlock` v2 type union + `InlineSpan` type + `Token` type + `Theme` interface. Pure types — no logic. |
| `src/tui/blocks/parser.ts` | Block parser v2: detects headings, quotes, rules in addition to existing text/code/list. Pure function `parseBlocks(md)`. |
| `src/tui/blocks/inline.ts` | Inline parser: walks text, produces `InlineSpan[]` (text/bold/italic/code/link). Pure function `parseInline(text)`. |
| `src/tui/blocks/tokenize.ts` | Code tokenizer dispatcher: maps `language` → tokenizer; produces `Token[]` (keyword/string/comment/number/identifier/operator/punctuation). Pure function `tokenize(code, lang)`. |
| `src/tui/blocks/langs/python.ts` | Python tokenizer. |
| `src/tui/blocks/langs/typescript.ts` | TypeScript / JavaScript tokenizer (single file, both share syntax). |
| `src/tui/blocks/langs/json.ts` | JSON tokenizer. |
| `src/tui/blocks/langs/bash.ts` | Bash tokenizer. |
| `src/tui/blocks/langs/plain.ts` | Fallback tokenizer (every char is `plain` token). |
| `src/tui/blocks/theme.ts` | Default dark theme — semantic colors for: `heading`, `bold`, `italic`, `inlineCode`, `codeBorder`, `codeLangLabel`, `keyword`, `string`, `comment`, `number`, `function`, `operator`, `punctuation`, `quote`, `quoteBorder`, `rule`, `link`. Single concrete instance exported. |
| `src/tui/blocks/render.ts` | Rich renderer. `renderBlocks(blocks, theme, width) → StyledRow[]`. Each `StyledRow` is `{ text: string; isFirst: boolean }` where `text` is the ANSI-styled line ready to write to canvas. |
| `tests/tui/blocks/*.vitest.ts` | One test file per module. |

### Modified modules

| File | Change |
|---|---|
| `src/agent/response-blocks.ts` | **Re-export** the new parser from `src/tui/blocks/parser.ts` so existing call sites keep working. No behavior change for current consumers — the new parser is a strict superset of the old one. |
| `src/tui/views/agent-view.ts` | Replace `renderAgentResponse` body with a call to `renderBlocks`. Keep `RenderedLine` shape unchanged so the surrounding render loop doesn't change. |
| `src/tui/views/chat-view.ts` | **Wire up** `parseBlocks` + `renderBlocks` for the first time (currently bypasses the parser). This brings chat-view to parity with agent-view — fenced code, lists, bold, etc. now render properly in chat too. |

### Untouched

- `src/tui/canvas.ts` — already ANSI-aware.
- `src/tui/ansi.ts` — kept as-is. Theme uses raw ANSI escapes (matching the pattern in `box.ts`) rather than `styleText` so canvas cell-style accumulation works correctly.
- `src/tui/wrap-text.ts` — already ANSI-aware, used by the new renderer.

---

## Data Flow

Concrete example: the user's `**The Last Echo**` line.

1. **`parseBlocks("**The Last Echo**")`** returns:
   ```ts
   [{ type: 'text', text: '**The Last Echo**', inlineSpans: undefined }]
   ```
2. **`parseInline("**The Last Echo**")`** produces:
   ```ts
   [{ kind: 'bold', text: 'The Last Echo' }]
   ```
   The block becomes `{ type: 'text', spans: [{kind:'bold', text:'The Last Echo'}] }`.
3. **`renderBlocks([block], theme, width)`** asks `theme.bold('The Last Echo')` → `\x1b[1mThe Last Echo\x1b[22m`, then wraps via `wrapText` (which is ANSI-aware), producing one or more `StyledRow` entries.
4. **`AgentView.render()`** writes each `StyledRow.text` to the canvas via `c.write(x, y, ...)`. Canvas preserves the embedded `\x1b[1m...\x1b[22m` and stamps it onto each cell.

For a fenced code block:

1. `parseBlocks` returns `{ type: 'code', language: 'python', code: 'def fib(n):...', spans: undefined }`.
2. **Code blocks skip the inline parser** — code content is not prose; bold/italic inside code is literal characters.
3. `tokenize('def fib(n):...', 'python')` returns `[{kind:'keyword', text:'def'}, {kind:'plain', text:' '}, {kind:'function', text:'fib'}, ...]`.
4. `renderBlocks` walks the tokens, asks `theme` for each, joins them, wraps with `wrapText`, and frames the whole block in `codeBorder` chrome (see below).

---

## Block chrome (PR 5 — the "looks like VS Code" part)

The user's screenshot showed code blocks rendered as just `def fibonacci(n):` with a `[python]` header. Phase 1 replaces this with bordered code blocks:

```
┌─ python ────────────────────────────────────────────┐
│ def fibonacci(n):                                   │
│     a, b = 0, 1                                     │
│     for _ in range(n):                              │
│         a, b = b, a + b                             │
│     return a                                        │
└──────────────────────────────────────────────────────┘
```

- Top row: `┌─ <lang> ─<filler>─┐`
- Each code row: `│ <indented code> │`
- Bottom row: `└─<filler>─┘`
- Border characters: `─ │ ┌ ┐ └ ┘` in `theme.codeBorder` color (dim gray).
- Language label in `theme.codeLangLabel` color (cyan, bold).

Headings:

```
## Installation

renders as:

INSTALLATION
═════════════
```

(Inspired by VS Code Markdown preview — heading text bold + underline using `═` characters in the theme's `heading` color.)

Blockquotes:

```
> Important quote

renders as:

│ Important quote
│ continuation
```

(Left bar in `theme.quoteBorder` color; text in `theme.quote` color.)

Horizontal rules:

```
---

renders as a full-width line in `theme.rule` color.
```

Lists:

```
- First item
- Second item

renders as bullet items with hanging indent (already works in current code, keep it).
```

Inline code:

```
Use the `processTurn` method to run a task.

renders as:

Use the ▓processTurn▓ method...
```

(`▓` is just my mnemonic — actual rendering is inverse video `\x1b[7m...\x1b[27m` in `theme.inlineCode`.)

Bold:

```
**Important**

renders as: Important in theme.bold (SGR 1).
```

Italic (terminals that support SGR 3):

```
*emphasis*

renders as: emphasis in theme.italic (SGR 3).
```

For terminals that don't render italic (most), italic still distinguishes from bold via fallback to dim — but `theme.italic` decides that.

---

## Theme design

`src/tui/blocks/theme.ts` exports a single concrete `defaultTheme` of type `Theme`:

```ts
export interface Theme {
  heading(level: 1 | 2 | 3): string;     // bold + colored heading text
  headingRule(level: 1 | 2 | 3): string; // characters used for the underline
  bold(text: string): string;
  italic(text: string): string;
  inlineCode(text: string): string;
  codeBorder: string;                    // raw ANSI prefix for borders
  codeLangLabel(text: string): string;
  codeKeyword(text: string): string;
  codeString(text: string): string;
  codeComment(text: string): string;
  codeNumber(text: string): string;
  codeFunction(text: string): string;
  codeOperator(text: string): string;
  codePunctuation(text: string): string;
  codePlain(text: string): string;       // unstyled fallback inside code
  quoteBar: string;                      // raw ANSI prefix for quote left bar
  quote(text: string): string;
  rule: string;                          // raw ANSI prefix for horizontal rules
  link(text: string, href: string): string; // Phase 6; stub for now
}
```

The default theme uses raw `\x1b[...m` codes (matching `box.ts` pattern), so the canvas's per-cell `ansiPrefix` accumulation works correctly. `styleText` from `node:util` (used in `ansi.ts`) is avoided here because it can confuse the canvas's escape-detection logic depending on how it formats multi-segment output.

Multiple-theme support is deferred (interface is in place; only `defaultTheme` is exported).

---

## Tokenizer design

Each language tokenizer implements:

```ts
interface Tokenizer {
  readonly language: string;
  tokenize(code: string): Token[];
}

type Token =
  | { kind: 'keyword'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'function'; text: string }     // identifier immediately after `def` / `function` / `fn` / `class`
  | { kind: 'identifier'; text: string }    // generic identifier
  | { kind: 'operator'; text: string }
  | { kind: 'punctuation'; text: string }
  | { kind: 'plain'; text: string };       // whitespace + everything else
```

`tokenize.ts` is a dispatcher:

```ts
const TOKENIZERS: Record<string, Tokenizer> = {
  python: pythonTokenizer,
  py: pythonTokenizer,
  typescript: typescriptTokenizer,
  ts: typescriptTokenizer,
  tsx: typescriptTokenizer,
  javascript: typescriptTokenizer,
  js: typescriptTokenizer,
  jsx: typescriptTokenizer,
  json: jsonTokenizer,
  bash: bashTokenizer,
  sh: bashTokenizer,
  shell: bashTokenizer,
};

export function tokenize(code: string, language?: string): Token[] {
  const t = TOKENIZERS[(language ?? '').toLowerCase()];
  return t ? t.tokenize(code) : plainTokenizer.tokenize(code);
}
```

The plain fallback is a no-op: every char becomes `{kind:'plain'}`. Renderer treats plain identically to passing the original string.

Each language tokenizer is a single-pass state machine. ~200-300 LOC per language. Examples:

- **Python**: keywords (`def`, `return`, `if`, `for`, `while`, `class`, `import`, `from`, `in`, `is`, `not`, `and`, `or`, `try`, `except`, `with`, `as`, `yield`, `lambda`, `pass`, `None`, `True`, `False`, `self`, `async`, `await`), triple-quoted strings, line comments (`#`).
- **TypeScript / JS**: keywords (`function`, `return`, `const`, `let`, `var`, `if`, `for`, `while`, `class`, `import`, `export`, `from`, `default`, `switch`, `case`, `break`, `continue`, `this`, `new`, `async`, `await`, `type`, `interface`, `enum`, `public`, `private`, `protected`, `static`, `readonly`), template literals, regex literals, line + block comments.
- **JSON**: strings, numbers, `true`/`false`/`null` as keywords, structural punctuation.
- **Bash**: comments (`#`), strings (`'...'`, `"..."`), variables (`$VAR`, `${VAR}`), keywords (`if`, `then`, `fi`, `for`, `while`, `do`, `done`, `function`, `case`, `esac`, `in`, `else`, `elif`).

None of these need to be complete grammars — just enough to color keywords, strings, comments, and numbers correctly. This is ~250 lines per language, not thousands.

---

## Renderer design

`renderBlocks(blocks: ResponseBlock[], theme: Theme, width: number): StyledRow[]`

Walks each block:

- **`text` block** → for each `InlineSpan` (or the whole text if no spans), ask the theme for the styled version. Concatenate, then `wrapText` to the canvas width. Emit `StyledRow` per wrapped line.
- **`code` block** →
  - Open border: `┌─ <langLabel> ─<filler>─┐`
  - For each code line: tokenize once at block level, render each token with theme, hard-truncate to `width - 4` (2 for borders + 2 padding), wrap with `│ ... │`.
  - Close border: `└─<filler>─┘`
- **`heading` block** (new) → emit the heading text in `theme.heading(level)` + a rule line below in `theme.headingRule(level)`.
- **`quote` block** (new) → emit each line with a `│ ` prefix in `theme.quoteBar` color + text in `theme.quote` color.
- **`rule` block** (new) → emit a full-width line in `theme.rule` color.
- **`list` block** → unchanged from current behavior; the existing prefix logic + `wrapText` works fine.

The first row of the entire response gets `isFirst: true` (same convention as current code).

---

## Testing strategy

One test file per new module, plus updated views tests:

| Module | Test file | Coverage |
|---|---|---|
| `blocks/parser.ts` | `tests/tui/blocks/parser.vitest.ts` | Headings, rules, quotes, code with lang, lists, text, unclosed fences, mixed content. ~15 tests. |
| `blocks/inline.ts` | `tests/tui/blocks/inline.vitest.ts` | `**bold**`, `*italic*`, `` `inline code` ``, escaped `\*`, mixed, links (stub). ~10 tests. |
| `blocks/tokenize.ts` | `tests/tui/blocks/tokenize.vitest.ts` | Dispatcher routes correctly. Plain fallback. Unknown lang. ~5 tests. |
| `blocks/langs/python.ts` | `tests/tui/blocks/langs/python.vitest.ts` | Keywords, strings, comments, numbers, function defs. ~8 tests. |
| `blocks/langs/typescript.ts` | `tests/tui/blocks/langs/typescript.vitest.ts` | Same shape. ~8 tests. |
| `blocks/langs/json.ts` | `tests/tui/blocks/langs/json.vitest.ts` | Strings, numbers, literals, structural. ~5 tests. |
| `blocks/langs/bash.ts` | `tests/tui/blocks/langs/bash.vitest.ts` | Comments, strings, vars. ~5 tests. |
| `blocks/theme.ts` | `tests/tui/blocks/theme.vitest.ts` | All `Theme` methods return strings; raw ANSI codes present; no throw on empty input. ~3 tests. |
| `blocks/render.ts` | `tests/tui/blocks/render.vitest.ts` | Bold/italic rendered; code block has borders; heading has rule; quote has bar; rule is full-width; tokens colored. ~10 tests. |
| `views/agent-view.ts` | extend `tests/agent-view-formatting.vitest.ts` | End-to-end: a sample response with bold, code, heading renders with appropriate styles. ~3 new tests. |
| `views/chat-view.ts` | extend `tests/tui/views/chat-view.vitest.ts` | ChatView now parses blocks (currently it doesn't). ~3 new tests. |

Total: ~75 new test cases.

Existing assertion idioms (`rowHasStyle(y, '36m')`, `(c as any).buffer` introspection, `renderFrame().replace(/\x1b\[[0-9;]*m/g, '')` for plain-text checks) carry over unchanged.

---

## Rollout

Single PR (this work session). Branch from current `main`. Implementation order within the PR:

1. **Types + theme + inline parser** (`blocks/types.ts`, `blocks/theme.ts`, `blocks/inline.ts`) — pure foundation, no view changes yet.
2. **Block parser v2** (`blocks/parser.ts`) — extends the existing `parseResponseBlocks` to also detect headings/quotes/rules. Wire existing consumers via re-export.
3. **Tokenizers** (`blocks/langs/*.ts`, `blocks/tokenize.ts`) — pure, independent of everything else.
4. **Renderer** (`blocks/render.ts`) — composes the above into styled rows.
5. **Wire views** — replace `renderAgentResponse` body in `agent-view.ts` with a call to `renderBlocks`; add `parseBlocks` + `renderBlocks` to `chat-view.ts`.
6. **Tests** — new module tests + extend view tests.
7. **Commit + verify** — `tsc`, full vitest suite, manual screenshot.

Each step compiles independently of the next; if a step is partial, the build still passes (the renderer is the only thing that depends on all of types+theme+tokenize+parser).

---

## What's NOT in Phase 1

- **Tables, task lists, footnotes, callouts, mermaid** — PR 6.
- **OSC-8 hyperlinks** — PR 6. `theme.link()` is stubbed to just bold + underline the visible text.
- **Multiple themes / theme switching** — interface is in place, only `defaultTheme` exported.
- **HTML in markdown** — not supported. Pass through as text.
- **Full CommonMark compliance** — only the subset listed above. Anything weird falls through as plain text.
- **Editing/wysiwyg** — read-only renderer.
- **Per-tab theme overrides** — single theme for now.

---

## Critical files modified

| File | Lines changed (estimate) |
|---|---|
| `src/tui/blocks/types.ts` | new, ~40 |
| `src/tui/blocks/parser.ts` | new, ~150 |
| `src/tui/blocks/inline.ts` | new, ~120 |
| `src/tui/blocks/tokenize.ts` | new, ~30 |
| `src/tui/blocks/langs/python.ts` | new, ~250 |
| `src/tui/blocks/langs/typescript.ts` | new, ~280 |
| `src/tui/blocks/langs/json.ts` | new, ~80 |
| `src/tui/blocks/langs/bash.ts` | new, ~120 |
| `src/tui/blocks/langs/plain.ts` | new, ~10 |
| `src/tui/blocks/theme.ts` | new, ~80 |
| `src/tui/blocks/render.ts` | new, ~250 |
| `src/agent/response-blocks.ts` | ~5 (re-export) |
| `src/tui/views/agent-view.ts` | ~-30, +5 (replace renderAgentResponse body) |
| `src/tui/views/chat-view.ts` | ~+10 (parse + render) |
| `tests/tui/blocks/*.vitest.ts` (10 files) | new, ~750 total |

Net: ~+1500 LOC, ~-30 LOC. No deletions from existing files.

---

## Verification

After implementation:

1. **Type check:** `npx tsc --noEmit` — must report 0 errors.
2. **Full test suite:** `npx vitest run` — must pass 100% including ~75 new tests.
3. **gitnexus detect_changes:** run, confirm only expected symbols touched, no HIGH-risk surprises.
4. **Manual smoke:** launch `alix tui`, ask the model for a response with code + bold + heading, visually confirm:
   - Code block has a bordered box with language label.
   - `**bold**` is rendered as bold, not literal asterisks.
   - `# Heading` is rendered with bold + underline rule.
   - `> quote` has a left bar.
   - `---` renders as a horizontal line.
   - Python keywords (`def`, `return`, `class`) are colored.
   - JS keywords (`function`, `const`, `return`) are colored.
5. **Visual regression check (informal):** existing views tests must still pass — the new renderer must be a strict superset in capability, with the same row layout where no markdown features are present.

---

## Open questions for the user (asked before this doc)

- **Phase 1 scope:** Option 2 (PRs 1-5) — confirmed by user's architectural reply.
- **Theme strategy:** Single default theme (dark) with a `Theme` interface ready for future variants — implied by user's "Dark/light themes later become trivial" comment.

No outstanding questions. Ready for review.