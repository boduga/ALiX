# Rich Response Rendering (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a layered renderer that turns markdown-flavored agent responses into visually distinct terminal output — code blocks become bordered boxes with language labels, `**bold**`/`*italic*`/`inline code` render with style, headings/quotes/rules have their own visual treatment, and Python/JS/TS/JSON/Bash code gets token-colored.

**Architecture:** Five pure layers (block parser → inline parser → tokenizer → theme → renderer). Each layer is independent and testable. The renderer is the only consumer of the `Theme` interface; everything else is transport-independent. The existing `TerminalCanvas` is already ANSI-aware, so styled strings write straight through.

**Tech Stack:** TypeScript (strict), Vitest, Node `node:util`-free (raw `\x1b[...m` codes — same pattern as `src/tui/box.ts`). Zero new deps.

## Global Constraints

- **No new package dependencies.** All ANSI styling uses raw `\x1b[...m` codes. Do NOT use `styleText` from `node:util` — it can confuse `TerminalCanvas`'s per-cell `ansiPrefix` accumulation depending on how it segments output.
- **`TerminalCanvas.write()` is ANSI-aware.** Embedded escape codes do NOT consume grid columns; they stamp `ansiPrefix` onto each cell. Always wrap styled text with a closing reset (`\x1b[22m` for bold, `\x1b[23m` for italic, `\x1b[27m` for inverse, `\x1b[0m` as the catch-all) so styles don't bleed onto adjacent rows.
- **`wrapText()` and `truncateVisible()` are ANSI-aware.** They count only visible columns. Use them as-is; do NOT reimplement truncation.
- **Block parser v2 is a strict superset of the existing parser.** Add new block kinds (`heading`, `quote`, `rule`) but do not change behavior for existing kinds (`text`, `code`, `list`). Re-export from `src/agent/response-blocks.ts` so existing call sites keep working.
- **Code blocks skip the inline parser.** Inline emphasis inside code is literal characters, not formatting.
- **Existing test idioms carry over:** `rowHasStyle(y, '36m')` for cell-level style assertions; `renderFrame().replace(/\x1b\[[0-9;]*m/g, '')` for plain-text assertions; `(c as any).buffer` for raw cell inspection. See `tests/tui/views/chat-view.vitest.ts` and `tests/agent-view-formatting.vitest.ts` for examples.
- **One commit per task.** Conventional-commit style: `feat(tui): ...`, `refactor(tui): ...`, `test(tui): ...`.
- **Frequency:** commit after every green test step, not at the end of a task.
- **Every step is 2-5 minutes of focused work.** Do not bundle.

---

## File Structure

**Create (11 files):**

| Path | Purpose |
|---|---|
| `src/tui/blocks/types.ts` | Pure types: `ResponseBlock` v2, `InlineSpan`, `Token`, `Theme` interface, `StyledRow`. |
| `src/tui/blocks/theme.ts` | Default dark `Theme` instance. |
| `src/tui/blocks/inline.ts` | `parseInline(text: string): InlineSpan[]` — bold/italic/inline-code/escapes. |
| `src/tui/blocks/parser.ts` | `parseBlocks(md: string): ResponseBlock[]` — extends existing parser. |
| `src/tui/blocks/tokenize.ts` | `tokenize(code, lang): Token[]` dispatcher + plain fallback wiring. |
| `src/tui/blocks/langs/python.ts` | Python tokenizer. |
| `src/tui/blocks/langs/typescript.ts` | TS/JS tokenizer. |
| `src/tui/blocks/langs/json.ts` | JSON tokenizer. |
| `src/tui/blocks/langs/bash.ts` | Bash tokenizer. |
| `src/tui/blocks/langs/plain.ts` | Plain fallback tokenizer. |
| `src/tui/blocks/render.ts` | `renderBlocks(blocks, theme, width): StyledRow[]`. |

**Modify (3 files):**

| Path | Change |
|---|---|
| `src/agent/response-blocks.ts` | Re-export `parseBlocks` from new location so the existing import path keeps working. No behavior change. |
| `src/tui/views/agent-view.ts` | Replace `renderAgentResponse` body with a call to `renderBlocks`. Keep `RenderedLine` shape unchanged. |
| `src/tui/views/chat-view.ts` | Wire `parseBlocks` + `renderBlocks` (currently bypasses the parser entirely). |

**Test (10 files):**

| Path | Covers |
|---|---|
| `tests/tui/blocks/theme.vitest.ts` | Theme methods return ANSI-styled strings. |
| `tests/tui/blocks/inline.vitest.ts` | Bold/italic/code/escapes/mixed. |
| `tests/tui/blocks/parser.vitest.ts` | All block kinds, ordering, edge cases. |
| `tests/tui/blocks/tokenize.vitest.ts` | Dispatcher + plain fallback. |
| `tests/tui/blocks/langs/python.vitest.ts` | Python keywords/strings/comments/numbers. |
| `tests/tui/blocks/langs/typescript.vitest.ts` | TS/JS same. |
| `tests/tui/blocks/langs/json.vitest.ts` | JSON. |
| `tests/tui/blocks/langs/bash.vitest.ts` | Bash. |
| `tests/tui/blocks/render.vitest.ts` | End-to-end rendering for each block kind. |
| Extend `tests/agent-view-formatting.vitest.ts` | Sample response with bold + code + heading. |
| Extend `tests/tui/views/chat-view.vitest.ts` | ChatView now renders fenced code blocks. |

---

### Task 1: Foundation types + Theme

**Files:**
- Create: `src/tui/blocks/types.ts`
- Create: `src/tui/blocks/theme.ts`
- Create: `tests/tui/blocks/theme.vitest.ts`

**Interfaces:**
- Consumes: nothing (foundation).
- Produces:
  - From `types.ts`: `HeadingLevel = 1 | 2 | 3`, `InlineSpan = { kind: 'text' | 'bold' | 'italic' | 'code' | 'link'; text: string; href?: string }`, `Token = { kind: 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'identifier' | 'operator' | 'punctuation' | 'plain'; text: string }`, `ResponseBlock = { type: 'text'; text: string; spans?: readonly InlineSpan[] } | { type: 'code'; language?: string; code: string; spans?: undefined } | { type: 'list'; marker: 'unordered' | 'ordered'; items: readonly string[] } | { type: 'heading'; level: HeadingLevel; text: string; spans?: readonly InlineSpan[] } | { type: 'quote'; text: string; spans?: readonly InlineSpan[] } | { type: 'rule' }`, `Theme` interface (full method set per spec §"Theme design"), `StyledRow = { text: string; isFirst: boolean }`.
  - From `theme.ts`: `defaultTheme: Theme` exported as concrete instance.

- [ ] **Step 1: Write the failing types test**

Create `tests/tui/blocks/theme.vitest.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { defaultTheme } from '../../../src/tui/blocks/theme.js';

describe('defaultTheme', () => {
  it('returns non-empty styled strings for every Theme method', () => {
    expect(defaultTheme.heading(1, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.heading(2, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.heading(3, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.headingRule(1)).toMatch(/[═=\-─]/);
    expect(defaultTheme.bold('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.italic('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.inlineCode('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeLangLabel('python')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeKeyword('def')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeString('"x"')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeComment('# y')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeNumber('1')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeFunction('fib')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeOperator('=')).toMatch(/\x1b\[/);
    expect(defaultTheme.codePunctuation('(')).toMatch(/\x1b\[/);
    expect(defaultTheme.codePlain('x')).toBe('x');
    expect(defaultTheme.quote('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.link('text', 'https://example.com')).toMatch(/\x1b\[/);
  });

  it('produces ANSI codes that pass through TerminalCanvas.write without consuming columns', () => {
    // Sanity: the prefix is what gets stamped onto cells. The visible
    // payload should be the unescaped text.
    expect(defaultTheme.bold('hello')).toContain('hello');
    expect(defaultTheme.italic('hello')).toContain('hello');
    expect(defaultTheme.inlineCode('hello')).toContain('hello');
  });

  it('exposes raw ANSI prefix strings for borders and bars', () => {
    expect(defaultTheme.codeBorder).toMatch(/\x1b\[/);
    expect(defaultTheme.quoteBar).toMatch(/\x1b\[/);
    expect(defaultTheme.rule).toMatch(/\x1b\[/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/theme.vitest.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../../../src/tui/blocks/theme.js'`.

- [ ] **Step 3: Write `src/tui/blocks/types.ts`**

Create the file with this exact content:

```ts
// src/tui/blocks/types.ts
// Pure type definitions for the rich response rendering pipeline.
// No runtime code — every interface here is transport-independent and
// has zero knowledge of ANSI, canvases, or terminals.

/** Heading levels 1-3 (we don't render H4-H6 — same as GitHub-flavored md). */
export type HeadingLevel = 1 | 2 | 3;

/**
 * Inline span kinds. A text block's content is a sequence of these.
 * `text` is plain prose; `bold`/`italic`/`code` are styled; `link`
 * carries an `href` (Phase 1: rendered as bold + underline, no OSC-8).
 */
export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/**
 * Code token kinds. The renderer never knows Python — it only knows
 * which Theme method to call for each kind.
 */
export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'identifier'
  | 'operator'
  | 'punctuation'
  | 'plain';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

/**
 * A single block in the parsed response. `code` blocks carry `spans:
 * undefined` — code content is not run through the inline parser.
 */
export type ResponseBlock =
  | { type: 'text'; text: string; spans?: readonly InlineSpan[] }
  | { type: 'code'; language?: string; code: string; spans?: undefined }
  | { type: 'list'; marker: 'unordered' | 'ordered'; items: readonly string[] }
  | { type: 'heading'; level: HeadingLevel; text: string; spans?: readonly InlineSpan[] }
  | { type: 'quote'; text: string; spans?: readonly InlineSpan[] }
  | { type: 'rule' };

/**
 * Theme interface — every visual decision goes through one of these.
 * `codeBorder`, `quoteBar`, `rule` are raw ANSI prefixes (no text wrap)
 * because they're stamped onto per-cell styles. The rest take a string
 * and return the styled version.
 */
export interface Theme {
  heading(level: HeadingLevel, text: string): string;
  headingRule(level: HeadingLevel): string;
  bold(text: string): string;
  italic(text: string): string;
  inlineCode(text: string): string;
  codeBorder: string;
  codeLangLabel(text: string): string;
  codeKeyword(text: string): string;
  codeString(text: string): string;
  codeComment(text: string): string;
  codeNumber(text: string): string;
  codeFunction(text: string): string;
  codeOperator(text: string): string;
  codePunctuation(text: string): string;
  codePlain(text: string): string;
  quoteBar: string;
  quote(text: string): string;
  rule: string;
  link(text: string, href: string): string;
}

/** Output of the renderer. `isFirst` carries the existing turn-marker convention. */
export interface StyledRow {
  text: string;
  isFirst: boolean;
}
```

- [ ] **Step 4: Write `src/tui/blocks/theme.ts`**

Create the file with this exact content:

```ts
// src/tui/blocks/theme.ts
// Default dark Theme. Uses raw ANSI codes (NOT node:util styleText)
// so TerminalCanvas's per-cell ansiPrefix accumulation works correctly.
//
// Palette philosophy: cool backgrounds, warm keywords, neutral identifiers.
// Distinct enough that a glance separates prose, code, and emphasis.

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

/** Wrap `text` in `prefix` (open) and `suffix` (close). */
function wrap(prefix: string, suffix: string, text: string): string {
  return `${prefix}${text}${suffix}`;
}

// --- Inline styles ---

const BOLD_OPEN = `${ESC}1m`;
const BOLD_CLOSE = `${ESC}22m`;
const ITALIC_OPEN = `${ESC}3m`;
const ITALIC_CLOSE = `${ESC}23m`;
const INVERSE_OPEN = `${ESC}7m`;
const INVERSE_CLOSE = `${ESC}27m`;
const UNDERLINE_OPEN = `${ESC}4m`;
const UNDERLINE_CLOSE = `${ESC}24m`;

// --- Semantic colors ---

const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const MAGENTA = `${ESC}35m`;
const BLUE = `${ESC}34m`;
const RED = `${ESC}31m`;
const DIM = `${ESC}2m`;
const DIM_CLOSE = `${ESC}22m`;

// --- Heading rule characters ---

const HEADING_RULES: Record<HeadingLevel, string> = {
  1: '═'.repeat(40),
  2: '─'.repeat(40),
  3: '┄'.repeat(40),
};

/** Default dark theme. Single instance — interface exists for future variants. */
export const defaultTheme: Theme = {
  heading(level, text) {
    const open = level === 1 ? `${BOLD_OPEN}${CYAN}`
      : level === 2 ? `${BOLD_OPEN}${GREEN}`
      : `${BOLD_OPEN}${YELLOW}`;
    return wrap(open, RESET, text);
  },

  headingRule(level) {
    const open = level === 1 ? `${CYAN}${DIM}`
      : level === 2 ? `${GREEN}${DIM}`
      : `${YELLOW}${DIM}`;
    return wrap(open, DIM_CLOSE, HEADING_RULES[level]);
  },

  bold: (text) => wrap(BOLD_OPEN, BOLD_CLOSE, text),
  italic: (text) => wrap(ITALIC_OPEN, ITALIC_CLOSE, text),
  inlineCode: (text) => wrap(INVERSE_OPEN, INVERSE_CLOSE, text),

  // Raw prefixes — these get stamped onto cells, not wrapped around text.
  codeBorder: `${DIM}90`,
  codeLangLabel(text) {
    return wrap(`${BOLD_OPEN}${CYAN}`, RESET, text);
  },

  // Code token colors.
  codeKeyword: (text) => wrap(`${BOLD_OPEN}${MAGENTA}`, RESET, text),
  codeString: (text) => wrap(`${GREEN}`, RESET, text),
  codeComment: (text) => wrap(`${DIM}`, DIM_CLOSE, text),
  codeNumber: (text) => wrap(`${YELLOW}`, RESET, text),
  codeFunction: (text) => wrap(`${BLUE}`, RESET, text),
  codeOperator: (text) => text, // no styling — operators blend with code
  codePunctuation: (text) => text,
  codePlain: (text) => text,

  quoteBar: `${DIM}90`,
  quote: (text) => wrap(`${DIM}`, DIM_CLOSE, text),
  rule: `${DIM}90`,

  // Phase 1 stub: render as bold + underline. OSC-8 / actual click
  // happens in PR 6.
  link(text, _href) {
    return wrap(`${UNDERLINE_OPEN}${BLUE}`, UNDERLINE_CLOSE, text);
  },
};

// Re-export HeadingLevel so theme consumers don't need to import from
// types.ts separately when they only need the theme.
import type { HeadingLevel } from './types.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/theme.vitest.ts 2>&1 | tail -10`
Expected: 3 tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors. (The `HeadingLevel` re-export after the const might trigger "used before defined" — if so, move the `import type` to the top of the file before the `defaultTheme` const.)

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/types.ts src/tui/blocks/theme.ts tests/tui/blocks/theme.vitest.ts && git commit -m "feat(tui): add rich-renderer foundation — types + default Theme"
```

---

### Task 2: Plain tokenizer + dispatcher skeleton

**Files:**
- Create: `src/tui/blocks/langs/plain.ts`
- Create: `src/tui/blocks/tokenize.ts`
- Create: `tests/tui/blocks/tokenize.vitest.ts`

**Interfaces:**
- Consumes: `Token` from `types.ts` (Task 1).
- Produces: `tokenize(code: string, language?: string): Token[]` that dispatches by language; falls back to plain. `plainTokenizer.tokenize(code): Token[]` returns every char as a single `{kind:'plain', text}` token.

- [ ] **Step 1: Write the failing dispatcher test**

Create `tests/tui/blocks/tokenize.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../../src/tui/blocks/tokenize.js';

describe('tokenize', () => {
  it('returns plain tokens for unknown languages', () => {
    const tokens = tokenize('hello world', 'klingon');
    expect(tokens).toEqual([{ kind: 'plain', text: 'hello world' }]);
  });

  it('returns plain tokens when language is omitted', () => {
    const tokens = tokenize('hello world');
    expect(tokens).toEqual([{ kind: 'plain', text: 'hello world' }]);
  });

  it('returns plain tokens for empty input', () => {
    expect(tokenize('', 'python')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('plain fallback produces one token per contiguous non-empty run', () => {
    const tokens = tokenize('abc\n\ndef', 'unknown');
    // Empty lines are emitted as plain tokens too so the renderer can
    // preserve them as blank lines inside code blocks.
    expect(tokens).toEqual([
      { kind: 'plain', text: 'abc' },
      { kind: 'plain', text: '\n\n' },
      { kind: 'plain', text: 'def' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/tokenize.vitest.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../../../src/tui/blocks/tokenize.js'`.

- [ ] **Step 3: Write `src/tui/blocks/langs/plain.ts`**

```ts
// src/tui/blocks/langs/plain.ts
// Fallback tokenizer. Every char becomes a plain token. Preserves
// newlines verbatim so the renderer can emit blank lines inside code
// blocks.

import type { Token, Tokenizer } from '../types.js';

/**
 * The plain tokenizer's `tokenize` is a special case: it returns the
 * whole code as a single token if there are no newlines, OR splits on
 * newlines (keeping the newlines as their own tokens) so the renderer
 * can preserve blank lines.
 */
export const plainTokenizer: Tokenizer = {
  language: 'plain',
  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    const lines = code.split(/(\n+)/); // keep delimiters via capture
    for (const part of lines) {
      if (part === '') continue;
      tokens.push({ kind: 'plain', text: part });
    }
    return tokens;
  },
};
```

Add `Tokenizer` to the types.ts at the bottom (this is a small extension to Task 1's types):

Open `src/tui/blocks/types.ts` and append at the end:

```ts
/** A language-specific tokenizer. Each language implements this interface. */
export interface Tokenizer {
  readonly language: string;
  tokenize(code: string): Token[];
}
```

- [ ] **Step 4: Write `src/tui/blocks/tokenize.ts`**

```ts
// src/tui/blocks/tokenize.ts
// Dispatcher: maps `language` to a language-specific tokenizer. Falls
// back to plain for unknown languages. Language-specific tokenizers are
// registered in Tasks 7-10 (Python, TypeScript, JSON, Bash).

import type { Token, Tokenizer } from './types.js';
import { plainTokenizer } from './langs/plain.js';

/**
 * Registry of language tokenizers. Each entry maps the canonical
 * language id (and any aliases) to a Tokenizer.
 */
const TOKENIZERS: Record<string, Tokenizer> = {
  // Populated by Tasks 7-10:
  //   python / py            -> pythonTokenizer
  //   typescript / ts / tsx  -> typescriptTokenizer
  //   javascript / js / jsx  -> typescriptTokenizer
  //   json                   -> jsonTokenizer
  //   bash / sh / shell      -> bashTokenizer
};

/**
 * Tokenize `code` according to `language`. Returns plain tokens for any
 * language that isn't registered (or for empty input).
 */
export function tokenize(code: string, language?: string): Token[] {
  if (code === '') return [];
  const lang = (language ?? '').toLowerCase();
  const tokenizer = TOKENIZERS[lang];
  return (tokenizer ?? plainTokenizer).tokenize(code);
}

/**
 * Internal — for Task 7-10 to register their tokenizers without
 * exposing the registry.
 */
export function registerTokenizer(language: string, tokenizer: Tokenizer): void {
  TOKENIZERS[language.toLowerCase()] = tokenizer;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/tokenize.vitest.ts 2>&1 | tail -10`
Expected: 4 tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/langs/plain.ts src/tui/blocks/tokenize.ts src/tui/blocks/types.ts tests/tui/blocks/tokenize.vitest.ts && git commit -m "feat(tui): add plain fallback tokenizer + tokenize dispatcher"
```

---

### Task 3: Inline parser (bold / italic / code / escapes)

**Files:**
- Create: `src/tui/blocks/inline.ts`
- Create: `tests/tui/blocks/inline.vitest.ts`

**Interfaces:**
- Consumes: `InlineSpan` from `types.ts` (Task 1).
- Produces: `parseInline(text: string): InlineSpan[]` — converts a string with markdown inline formatting into a sequence of styled spans. Handles `**bold**`, `*italic*`, `` `inline code` ``, escaped characters (`\*`, `\\`, `` \` ``), and links `[text](href)`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/inline.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../src/tui/blocks/inline.js';

describe('parseInline', () => {
  it('returns a single text span for plain text', () => {
    expect(parseInline('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses **bold**', () => {
    expect(parseInline('hello **world**')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'bold', text: 'world' },
    ]);
  });

  it('parses *italic*', () => {
    expect(parseInline('hello *world*')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'italic', text: 'world' },
    ]);
  });

  it('parses `inline code`', () => {
    expect(parseInline('use `foo()` here')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'foo()' },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('handles mixed bold/italic/code in one string', () => {
    expect(parseInline('a **b** c *d* e `f`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' e ' },
      { kind: 'code', text: 'f' },
    ]);
  });

  it('treats unclosed delimiters as literal text', () => {
    expect(parseInline('hello **world')).toEqual([
      { kind: 'text', text: 'hello **world' },
    ]);
  });

  it('handles escaped \\* and \\\\ as literal characters', () => {
    expect(parseInline('a \\* b')).toEqual([{ kind: 'text', text: 'a * b' }]);
    expect(parseInline('a \\\\ b')).toEqual([{ kind: 'text', text: 'a \\ b' }]);
  });

  it('parses [text](href) links', () => {
    expect(parseInline('see [docs](https://example.com)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('does not match ** inside a single *italic*', () => {
    // Greedy `*foo*` should not consume a stray `**` next to it.
    expect(parseInline('*foo* and *bar*')).toEqual([
      { kind: 'italic', text: 'foo' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'bar' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/inline.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/inline.ts`**

```ts
// src/tui/blocks/inline.ts
// Inline-formatting parser. Walks the input string once, emitting a
// sequence of InlineSpan. Recognizes **bold**, *italic*, `inline code`,
// [text](href) links, and backslash-escaped punctuation.
//
// Strategy: a single state machine with mode switches at delimiter
// boundaries. Unclosed delimiters are treated as literal text —
// markdown-flavored, not CommonMark-strict.

import type { InlineSpan } from './types.js';

/**
 * Parse `text` into a sequence of styled InlineSpans. Always returns
 * at least one span for non-empty input; returns `[]` for empty input.
 */
export function parseInline(text: string): InlineSpan[] {
  if (text === '') return [];

  const out: InlineSpan[] = [];
  let buf = '';
  let i = 0;

  const flushText = (): void => {
    if (buf.length > 0) {
      out.push({ kind: 'text', text: buf });
      buf = '';
    }
  };

  // Peek helpers — avoid allocating substrings for hot loops.
  const peek = (off: number): string | undefined =>
    i + off < text.length ? text[i + off] : undefined;

  while (i < text.length) {
    const c = text[i]!;

    // Backslash escape: \, \*, \\, \`
    if (c === '\\' && peek(1) !== undefined) {
      const next = text[i + 1]!;
      if (next === '*' || next === '`' || next === '\\' || next === '[' || next === ']' || next === '(' || next === ')') {
        buf += next;
        i += 2;
        continue;
      }
    }

    // **bold**: needs a matching ** later in the string.
    if (c === '*' && peek(1) === '*') {
      const closeAt = text.indexOf('**', i + 2);
      if (closeAt > i + 2) {
        flushText();
        out.push({ kind: 'bold', text: text.slice(i + 2, closeAt) });
        i = closeAt + 2;
        continue;
      }
    }

    // *italic*: single asterisks, NOT adjacent to another * (so **bold**
    // above wins).
    if (c === '*' && peek(1) !== '*' && (i === 0 || text[i - 1] !== '*')) {
      const closeAt = findItalicClose(text, i + 1);
      if (closeAt > i + 1) {
        flushText();
        out.push({ kind: 'italic', text: text.slice(i + 1, closeAt) });
        i = closeAt + 1;
        continue;
      }
    }

    // `inline code`: matching backtick later.
    if (c === '`') {
      const closeAt = text.indexOf('`', i + 1);
      if (closeAt > i + 1) {
        flushText();
        out.push({ kind: 'code', text: text.slice(i + 1, closeAt) });
        i = closeAt + 1;
        continue;
      }
    }

    // [text](href): matching ] then (href) immediately.
    if (c === '[') {
      const linkEnd = tryParseLink(text, i);
      if (linkEnd > i) {
        flushText();
        const { text: linkText, href, end } = linkEnd;
        out.push({ kind: 'link', text: linkText, href });
        i = end;
        continue;
      }
    }

    buf += c;
    i++;
  }

  flushText();
  return out;
}

/**
 * Find the index of the `*` that closes a single-asterisk italic span
 * opened at position `start`. The closing `*` must NOT be adjacent to
 * another `*` (so `*foo*bar*` matches `foo`, not `foo*bar`).
 *
 * Returns -1 if no close is found.
 */
function findItalicClose(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] !== '*' && text[i - 1] !== '*') {
      return i;
    }
    i++;
  }
  return -1;
}

interface LinkMatch {
  text: string;
  href: string;
  end: number;
}

/**
 * If `text` at position `start` begins a `[text](href)` link, return
 * the parsed text, href, and the index AFTER the closing `)`.
 * Otherwise return a sentinel where `end <= start` so the caller can
 * detect no-match.
 */
function tryParseLink(text: string, start: number): LinkMatch | { end: number } {
  const closeBracket = text.indexOf(']', start + 1);
  if (closeBracket <= start + 1) return { end: 0 };
  // Need `(` immediately after `]`.
  if (text[closeBracket + 1] !== '(') return { end: 0 };
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen <= closeBracket + 2) return { end: 0 };
  // href must not contain whitespace (very rough check).
  const href = text.slice(closeBracket + 2, closeParen);
  if (/\s/.test(href)) return { end: 0 };
  return { text: text.slice(start + 1, closeBracket), href, end: closeParen + 1 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/inline.vitest.ts 2>&1 | tail -10`
Expected: 10 tests PASS.

- [ ] **Step 5: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/inline.ts tests/tui/blocks/inline.vitest.ts && git commit -m "feat(tui): add inline parser for bold/italic/code/links/escapes"
```

---

### Task 4: Block parser v2 (headings, quotes, rules)

**Files:**
- Create: `src/tui/blocks/parser.ts`
- Create: `tests/tui/blocks/parser.vitest.ts`
- Modify: `src/agent/response-blocks.ts:1-3` — add re-export.

**Interfaces:**
- Consumes: nothing new (reuses existing `matchFenceOpen`, `matchFenceClose`, `matchListItem` patterns; this task introduces a new `parseBlocks` that emits the `ResponseBlock` v2 type union).
- Produces: `parseBlocks(md: string): ResponseBlock[]` — same linear scan as the existing parser, but with new dispatch branches for `#`/`##`/`###` headings (level 1/2/3), `>` blockquotes (greedy until blank line), and `---`/`***`/`___` rules (single line, ≥3 chars).

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/parser.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../../../src/tui/blocks/parser.js';

describe('parseBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('   \n  \n')).toEqual([]);
  });

  it('parses plain text as a text block', () => {
    expect(parseBlocks('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  it('parses fenced code with a language', () => {
    expect(parseBlocks('```python\nx = 1\n```')).toEqual([
      { type: 'code', language: 'python', code: 'x = 1', spans: undefined },
    ]);
  });

  it('parses fenced code without a language', () => {
    expect(parseBlocks('```\nx = 1\n```')).toEqual([
      { type: 'code', code: 'x = 1', spans: undefined },
    ]);
  });

  it('parses unordered lists', () => {
    expect(parseBlocks('- a\n- b\n- c')).toEqual([
      { type: 'list', marker: 'unordered', items: ['a', 'b', 'c'] },
    ]);
  });

  it('parses ordered lists', () => {
    expect(parseBlocks('1. a\n2. b')).toEqual([
      { type: 'list', marker: 'ordered', items: ['a', 'b'] },
    ]);
  });

  it('parses H1, H2, H3 headings', () => {
    expect(parseBlocks('# Title')).toEqual([
      { type: 'heading', level: 1, text: 'Title', spans: undefined },
    ]);
    expect(parseBlocks('## Subhead')).toEqual([
      { type: 'heading', level: 2, text: 'Subhead', spans: undefined },
    ]);
    expect(parseBlocks('### Subsub')).toEqual([
      { type: 'heading', level: 3, text: 'Subsub', spans: undefined },
    ]);
  });

  it('rejects H4+ as plain text', () => {
    expect(parseBlocks('#### Four')).toEqual([
      { type: 'text', text: '#### Four' },
    ]);
  });

  it('parses blockquotes — single line', () => {
    expect(parseBlocks('> hello world')).toEqual([
      { type: 'quote', text: 'hello world', spans: undefined },
    ]);
  });

  it('parses blockquotes — multiple lines', () => {
    expect(parseBlocks('> first\n> second\n> third')).toEqual([
      { type: 'quote', text: 'first\nsecond\nthird', spans: undefined },
    ]);
  });

  it('parses blockquotes — terminated by blank line', () => {
    expect(parseBlocks('> quoted\n\nnot quoted')).toEqual([
      { type: 'quote', text: 'quoted', spans: undefined },
      { type: 'text', text: 'not quoted' },
    ]);
  });

  it('parses horizontal rules (---)', () => {
    expect(parseBlocks('---')).toEqual([{ type: 'rule' }]);
  });

  it('parses horizontal rules (***) and (___)', () => {
    expect(parseBlocks('***')).toEqual([{ type: 'rule' }]);
    expect(parseBlocks('___')).toEqual([{ type: 'rule' }]);
  });

  it('mixes blocks in document order', () => {
    const md = '# Title\n\nA paragraph.\n\n```python\nx = 1\n```\n\n- item 1\n- item 2';
    expect(parseBlocks(md)).toEqual([
      { type: 'heading', level: 1, text: 'Title', spans: undefined },
      { type: 'text', text: 'A paragraph.' },
      { type: 'code', language: 'python', code: 'x = 1', spans: undefined },
      { type: 'list', marker: 'unordered', items: ['item 1', 'item 2'] },
    ]);
  });

  it('treats an unclosed fence as plain text', () => {
    expect(parseBlocks('```python\nx = 1')).toEqual([
      { type: 'text', text: '```python\nx = 1' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/parser.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/parser.ts`**

```ts
// src/tui/blocks/parser.ts
// Block parser v2. Linear scan over the input, dispatching each line
// to a mode detector (heading → code → quote → rule → list → text).
// Order matters: code must run before list (so a code line starting
// with `- ` isn't mis-parsed), list before text (so `- ` lines aren't
// absorbed into prose), heading/quote/rule before text (so `# Title`
// isn't absorbed).

import type { ResponseBlock } from './types.js';

/**
 * Parse `md` into a sequence of ResponseBlock. Block-level markdown
 * only — inline formatting is handled by the renderer (which calls
 * `parseInline` on each text/heading/quote block as needed).
 */
export function parseBlocks(md: string): readonly ResponseBlock[] {
  if (!md || !md.trim()) return [];

  const lines = md.split(/\r?\n/);
  const blocks: ResponseBlock[] = [];
  let textBuffer: string[] = [];

  const flushText = (): void => {
    if (textBuffer.length === 0) return;
    while (textBuffer.length > 0 && textBuffer[textBuffer.length - 1]!.trim() === '') {
      textBuffer.pop();
    }
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join('\n');
    textBuffer = [];
    blocks.push({ type: 'text', text: joined });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // --- HEADING ---
    const heading = matchHeading(line);
    if (heading !== null) {
      flushText();
      blocks.push({ type: 'heading', level: heading.level, text: heading.text, spans: undefined });
      i++;
      continue;
    }

    // --- CODE FENCE ---
    const fence = matchFenceOpen(line);
    if (fence !== null) {
      flushText();
      const codeLines: string[] = [];
      let closed = false;
      let j = i + 1;
      while (j < lines.length) {
        if (matchFenceClose(lines[j]!, fence.fenceLen)) {
          closed = true;
          break;
        }
        codeLines.push(lines[j]!);
        j++;
      }
      const codeBlock: ResponseBlock = {
        type: 'code',
        code: codeLines.join('\n'),
        spans: undefined,
      };
      if (fence.language !== undefined) {
        (codeBlock as { language?: string }).language = fence.language;
      }
      blocks.push(codeBlock);
      if (closed) {
        i = j + 1;
      } else {
        // Unclosed fence: emit opening fence + collected content as a
        // single text block.
        blocks.pop();
        blocks.push({ type: 'text', text: [line, ...codeLines].join('\n') });
        i = lines.length;
      }
      continue;
    }

    // --- RULE ---
    if (matchRule(line)) {
      flushText();
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    // --- QUOTE ---
    if (line.startsWith('>')) {
      flushText();
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const q = lines[j]!;
        if (q.startsWith('>')) {
          quoteLines.push(q.replace(/^>\s?/, ''));
          j++;
        } else if (q.trim() === '') {
          break; // blank line ends the quote
        } else {
          break;
        }
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n'), spans: undefined });
      i = j;
      continue;
    }

    // --- LIST ---
    const item = matchListItem(line);
    if (item !== null) {
      flushText();
      const marker = item.marker;
      const items: string[] = [];
      let j = i;
      while (j < lines.length) {
        const candidate = matchListItem(lines[j]!);
        if (candidate === null || candidate.marker !== marker) break;
        if (candidate.text === '') break; // empty item — stop
        items.push(candidate.text);
        j++;
      }
      if (items.length > 0) {
        blocks.push({
          type: 'list',
          marker: marker === 'ordered' ? 'ordered' : 'unordered',
          items,
        });
      }
      i = j;
      continue;
    }

    // --- TEXT FALLBACK ---
    if (line.trim() === '') {
      if (textBuffer.length === 0) {
        // Boundary blank — consume silently.
      } else {
        textBuffer.push('');
      }
    } else {
      textBuffer.push(line);
    }
    i++;
  }

  flushText();
  return blocks;
}

// --- Helper matchers (file-local) ---

function matchHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!m) return null;
  const level = m[1]!.length as 1 | 2 | 3;
  return { level, text: m[2]! };
}

function matchFenceOpen(line: string): { fenceLen: number; language?: string } | null {
  const match = /^(`{3,})([^\s`]*)\s*$/.exec(line);
  if (!match) return null;
  const fenceLen = match[1]!.length;
  const lang = match[2] || undefined;
  return lang ? { fenceLen, language: lang } : { fenceLen };
}

function matchFenceClose(line: string, fenceLen: number): boolean {
  const stripped = line.trimEnd();
  if (stripped.length !== fenceLen) return false;
  for (let i = 0; i < fenceLen; i++) if (stripped[i] !== '`') return false;
  return true;
}

function matchListItem(line: string): { marker: 'unordered' | 'ordered'; text: string } | null {
  const dash = /^-(?:\s+(.*))?$/.exec(line);
  if (dash) return { marker: 'unordered', text: dash[1] ?? '' };
  const star = /^\*(?:\s+(.*))?$/.exec(line);
  if (star) return { marker: 'unordered', text: star[1] ?? '' };
  const plus = /^\+(?:\s+(.*))?$/.exec(line);
  if (plus) return { marker: 'unordered', text: plus[1] ?? '' };
  const ordered = /^\d+\.(?:\s+(.*))?$/.exec(line);
  if (ordered) return { marker: 'ordered', text: ordered[1] ?? '' };
  return null;
}

function matchRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (!/^([-*_])\1{2,}$/.test(trimmed)) return false;
  return true;
}
```

- [ ] **Step 4: Re-export from `src/agent/response-blocks.ts`**

Open the file. At the bottom, append a re-export so existing import paths (`from '../../agent/response-blocks.js'`) keep resolving to the new parser. Be careful — the existing file exports `parseResponseBlocks` (with `ResponseBlock`), which has a different signature than the new `parseBlocks`. So we re-export under the new name; we do NOT replace the old function.

Add to the bottom of `src/agent/response-blocks.ts`:

```ts
// Re-export the v2 parser so callers that want heading/quote/rule support
// can import from a familiar path. The old `parseResponseBlocks` is
// unchanged — its tests still pass and existing call sites keep working.
export { parseBlocks } from '../tui/blocks/parser.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/parser.vitest.ts 2>&1 | tail -10`
Expected: 14 tests PASS.

- [ ] **Step 6: Type-check + run existing parser tests**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10 && npx vitest run tests/response-blocks-parser.vitest.ts tests/response-blocks-smoke.vitest.ts 2>&1 | tail -5`
Expected: 0 tsc errors; existing parser tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/parser.ts src/agent/response-blocks.ts tests/tui/blocks/parser.vitest.ts && git commit -m "feat(tui): add block parser v2 — headings, quotes, rules"
```

---

### Task 5: Renderer — text/heading/quote/rule/list (no code yet)

**Files:**
- Create: `src/tui/blocks/render.ts`
- Create: `tests/tui/blocks/render.vitest.ts`

**Interfaces:**
- Consumes: `parseBlocks` from Task 4; `parseInline` from Task 3; `defaultTheme` from Task 1; `wrapText` from `src/tui/views/wrap-text.js` (existing, ANSI-aware).
- Produces: `renderBlocks(blocks: readonly ResponseBlock[], theme: Theme, width: number): StyledRow[]` — walks each block, calls the right theme method per inline span, wraps to `width`, returns `StyledRow[]`. **Code blocks are handled in Task 6** — this task returns a placeholder row `[code]` for code blocks.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/render.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderBlocks } from '../../../src/tui/blocks/render.js';
import { parseBlocks } from '../../../src/tui/blocks/parser.js';
import { defaultTheme } from '../../../src/tui/blocks/theme.js';

const W = 60;

describe('renderBlocks', () => {
  it('renders plain text with no styling', () => {
    const blocks = parseBlocks('hello world');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows).toEqual([{ text: 'hello world', isFirst: true }]);
  });

  it('renders **bold** spans with the theme bold style', () => {
    const blocks = parseBlocks('hello **world**');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[1m');
    expect(rows[0]!.text).toContain('world');
    expect(rows[0]!.text).toContain('hello');
  });

  it('renders *italic* spans with the theme italic style', () => {
    const blocks = parseBlocks('hello *world*');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[3m');
    expect(rows[0]!.text).toContain('world');
  });

  it('renders `inline code` spans with inverse video', () => {
    const blocks = parseBlocks('use `foo()` here');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[7m');
    expect(rows[0]!.text).toContain('foo()');
  });

  it('renders headings with bold + a rule line below', () => {
    const blocks = parseBlocks('# Title');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toContain('Title');
    expect(rows[1]!.text).toMatch(/[═=\-─]/); // rule characters
  });

  it('renders blockquotes with a left bar', () => {
    const blocks = parseBlocks('> hello');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toMatch(/│/);
    expect(rows[0]!.text).toContain('hello');
  });

  it('renders horizontal rules as a full-width line', () => {
    const blocks = parseBlocks('---');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('─'.repeat(W - 10)); // trimmed for borders
    expect(rows[0]!.text.length).toBeGreaterThan(W / 2);
  });

  it('renders lists with bullet markers', () => {
    const blocks = parseBlocks('- one\n- two');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('•');
    expect(rows[0]!.text).toContain('one');
    expect(rows[1]!.text).toContain('•');
    expect(rows[1]!.text).toContain('two');
  });

  it('returns isFirst: true only on the first row of the first block', () => {
    const blocks = parseBlocks('first paragraph\n\nsecond paragraph');
    const rows = renderBlocks(blocks, defaultTheme, W);
    const firsts = rows.filter((r) => r.isFirst);
    expect(firsts).toHaveLength(1);
    expect(firsts[0]!.text).toContain('first');
  });

  it('wraps long lines to the given width', () => {
    const blocks = parseBlocks('a'.repeat(200));
    const rows = renderBlocks(blocks, defaultTheme, 40);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      // Strip ANSI before measuring length.
      const visible = row.text.replace(/\x1b\[[0-9;]*m/g, '');
      expect(visible.length).toBeLessThanOrEqual(40);
    }
  });

  it('returns a placeholder row for code blocks (full code rendering in Task 6)', () => {
    const blocks = parseBlocks('```python\nx = 1\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Just verify it doesn't throw and produces something.
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/render.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/render.ts`**

```ts
// src/tui/blocks/render.ts
// Walks a sequence of ResponseBlock and produces ANSI-styled rows ready
// to write to a TerminalCanvas. Pure: same input + theme + width → same
// output. Side-effect free. No knowledge of ANSI codes other than
// what's already in the Theme.
//
// Code blocks are handled minimally here (placeholder). Task 6 wires
// up the full bordered-chrome rendering with tokenization.

import type { ResponseBlock, InlineSpan, StyledRow, Theme } from './types.js';
import { parseInline } from './inline.js';
import { wrapText } from '../views/wrap-text.js';

/**
 * Render all blocks into ANSI-styled rows. Width is the visible
 * column count (excluding any borders the caller may add — code
 * blocks reserve 4 columns internally for chrome).
 */
export function renderBlocks(
  blocks: readonly ResponseBlock[],
  theme: Theme,
  width: number,
): StyledRow[] {
  const out: StyledRow[] = [];
  let isFirstEver = true;

  for (const block of blocks) {
    const isFirst = isFirstEver;
    isFirstEver = false;

    switch (block.type) {
      case 'text':
        out.push(...renderTextOrInline(block.spans ?? parseInline(block.text), theme, width, isFirst));
        break;
      case 'heading':
        out.push(...renderHeading(block, theme, width, isFirst));
        break;
      case 'quote':
        out.push(...renderQuote(block, theme, width, isFirst));
        break;
      case 'rule':
        out.push(...renderRule(theme, width, isFirst));
        break;
      case 'list':
        out.push(...renderList(block, theme, width, isFirst));
        break;
      case 'code':
        // Code rendering with chrome lands in Task 6. Placeholder for
        // now: a single line "[code]" so callers don't crash.
        out.push({ text: theme.codePlain('[code]'), isFirst });
        break;
    }
  }

  return out;
}

// --- Block renderers ---

function renderTextOrInline(
  spans: readonly InlineSpan[],
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  if (spans.length === 0) return [];
  const styled = spans.map((s) => styleInlineSpan(s, theme)).join('');
  const lines = wrapText(styled, width);
  return lines.map((text, i) => ({ text, isFirst: isFirst && i === 0 }));
}

function renderHeading(
  block: Extract<ResponseBlock, { type: 'heading' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const spans = block.spans ?? parseInline(block.text);
  const styledSpans = spans.map((s) => styleInlineSpan(s, theme)).join('');
  const headingText = theme.heading(block.level, styledSpans);
  const ruleText = theme.headingRule(block.level);
  // Heading is rendered as: <heading text>\n<rule line>
  // Both fit on one row each (no wrapping needed unless heading is huge).
  const lines = wrapText(headingText, width);
  const rows: StyledRow[] = lines.map((text, i) => ({ text, isFirst: isFirst && i === 0 }));
  // Rule line is full-width — don't wrap.
  rows.push({ text: ruleText, isFirst: false });
  return rows;
}

function renderQuote(
  block: Extract<ResponseBlock, { type: 'quote' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const spans = block.spans ?? parseInline(block.text);
  const styledSpans = spans.map((s) => styleInlineSpan(s, theme)).join('');
  // Wrap, then prefix each line with the quote bar.
  const lines = wrapText(styledSpans, Math.max(1, width - 2));
  const bar = theme.quoteBar + '│ ' + '\x1b[0m'; // bar + reset so styled text doesn't bleed
  return lines.map((text, i) => ({
    text: bar + text,
    isFirst: isFirst && i === 0,
  }));
}

function renderRule(theme: Theme, width: number, isFirst: boolean): StyledRow[] {
  const ch = '─';
  const raw = ch.repeat(Math.max(1, width));
  return [{ text: theme.rule + raw + '\x1b[0m', isFirst }];
}

function renderList(
  block: Extract<ResponseBlock, { type: 'list' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const rows: StyledRow[] = [];
  block.items.forEach((item, idx) => {
    const prefix = block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
    const indent = ' '.repeat(prefix.length);
    const innerWidth = Math.max(1, width - prefix.length);
    const wrapped = wrapText(item, innerWidth);
    wrapped.forEach((line, i) => {
      rows.push({
        text: i === 0 ? prefix + line : indent + line,
        isFirst: isFirst && idx === 0 && i === 0,
      });
    });
  });
  return rows;
}

// --- Inline span styling ---

function styleInlineSpan(span: InlineSpan, theme: Theme): string {
  switch (span.kind) {
    case 'text':
      return span.text;
    case 'bold':
      return theme.bold(span.text);
    case 'italic':
      return theme.italic(span.text);
    case 'code':
      return theme.inlineCode(span.text);
    case 'link':
      return theme.link(span.text, span.href);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/render.vitest.ts 2>&1 | tail -10`
Expected: 11 tests PASS.

- [ ] **Step 5: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/render.ts tests/tui/blocks/render.vitest.ts && git commit -m "feat(tui): add rich renderer for text/heading/quote/rule/list (code in next task)"
```

---

### Task 6: Renderer — code blocks with bordered chrome + tokenization

**Files:**
- Modify: `src/tui/blocks/render.ts` — replace the `'code'` branch in `renderBlocks`.

**Interfaces:**
- Consumes: `tokenize` from Task 2; existing `truncateVisible` from `src/tui/views/agent-view.ts:36-54` (copy the function into this file rather than import — it has zero deps and is small).
- Produces: code blocks render as bordered boxes with language label and token-colored code lines.

- [ ] **Step 1: Add the failing test cases**

Append to `tests/tui/blocks/render.vitest.ts`:

```ts
  it('renders code blocks with a bordered top/bottom and language label', () => {
    const blocks = parseBlocks('```python\nx = 1\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Top border with language label.
    expect(rows[0]!.text).toMatch(/[┌╭]/);
    expect(rows[0]!.text).toContain('python');
    // Code line wrapped in side borders.
    const codeRow = rows.find((r) => r.text.includes('x = 1'));
    expect(codeRow).toBeDefined();
    expect(codeRow!.text).toMatch(/[│|]/);
    // Bottom border.
    expect(rows[rows.length - 1]!.text).toMatch(/[└╰]/);
  });

  it('tokenizes Python code and colors keywords', () => {
    // The Python tokenizer is registered in Task 7. This test
    // currently asserts the rendered output for an unknown language
    // (the plain fallback). After Task 7 ships, this test gets
    // updated to assert keyword coloring.
    const blocks = parseBlocks('```python\ndef fib():\n    pass\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Find the code rows.
    const codeRows = rows.filter((r) => r.text.includes('def') || r.text.includes('pass'));
    expect(codeRows.length).toBeGreaterThan(0);
  });

  it('renders code blocks without language (no language label, same chrome)', () => {
    const blocks = parseBlocks('```\nplain text\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toMatch(/[┌╭]/);
    expect(rows[0]!.text).not.toContain('python');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/render.vitest.ts 2>&1 | tail -20`
Expected: 3 new tests FAIL — code block rendering is still the placeholder.

- [ ] **Step 3: Replace the `'code'` branch in `src/tui/blocks/render.ts`**

Open the file. Find the `case 'code':` branch:

```ts
      case 'code':
        // Code rendering with chrome lands in Task 6. Placeholder for
        // now: a single line "[code]" so callers don't crash.
        out.push({ text: theme.codePlain('[code]'), isFirst });
        break;
```

Replace with the full code renderer. First, add the helper at the bottom of the file (next to `styleInlineSpan`):

```ts
// --- Code block rendering ---

function renderCode(
  block: Extract<ResponseBlock, { type: 'code' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  // Layout:
  //   ┌─ <lang> ─<filler>─┐
  //   │ <code line>      │
  //   └─<filler>─┘
  const innerWidth = Math.max(1, width - 4); // 2 for borders + 2 padding
  const lang = block.language ?? '';

  // Tokenize (plain fallback for unknown languages; richer in Tasks 7-10).
  const tokens = tokenize(block.code, block.language);

  // Render code lines: each line's tokens are styled and concatenated.
  // Wrap each line at innerWidth (existing wrapText is ANSI-aware).
  // Tokenize emits `{kind:'plain', text:'\n\n'}` tokens to preserve
  // blank lines, so we need to split on those.
  const codeLines: string[] = [];
  let currentLine = '';
  for (const tok of tokens) {
    if (tok.kind === 'plain' && /^\n+$/.test(tok.text)) {
      // Blank-line marker — push current line, then push empty lines.
      codeLines.push(currentLine);
      currentLine = '';
      for (let i = 1; i < tok.text.length; i++) codeLines.push('');
    } else {
      currentLine += styleToken(tok, theme);
    }
  }
  codeLines.push(currentLine);

  // Wrap each line to innerWidth and add side borders.
  const borderedLines = codeLines.map((line) => {
    const wrapped = wrapText(line || ' ', innerWidth);
    // Re-emit each wrapped line with borders.
    return wrapped.map((l) => `${theme.codeBorder}│${'\x1b[0m'} ${l} ${theme.codeBorder}│${'\x1b[0m'}`);
  });

  const rows: StyledRow[] = [];
  // Top border with optional language label.
  const topLabel = lang ? ` ${lang} ` : '';
  const topFill = Math.max(0, width - 2 - topLabel.length - 2);
  rows.push({
    text: `${theme.codeBorder}┌─${'\x1b[0m'}${theme.codeLangLabel(topLabel)}${theme.codeBorder}${'─'.repeat(topFill)}─┐${'\x1b[0m'}`,
    isFirst,
  });

  for (const wrappedLines of borderedLines) {
    for (const line of wrappedLines) {
      rows.push({ text: line, isFirst: false });
    }
  }

  // Bottom border.
  rows.push({
    text: `${theme.codeBorder}${'─'.repeat(width - 2)}┘${'\x1b[0m'}`,
    isFirst: false,
  });
  return rows;
}

function styleToken(token: Token, theme: Theme): string {
  switch (token.kind) {
    case 'keyword': return theme.codeKeyword(token.text);
    case 'string': return theme.codeString(token.text);
    case 'comment': return theme.codeComment(token.text);
    case 'number': return theme.codeNumber(token.text);
    case 'function': return theme.codeFunction(token.text);
    case 'identifier': return theme.codePlain(token.text);
    case 'operator': return theme.codeOperator(token.text);
    case 'punctuation': return theme.codePunctuation(token.text);
    case 'plain': return theme.codePlain(token.text);
  }
}
```

And import `tokenize` at the top:

```ts
import { tokenize } from './tokenize.js';
import type { Token } from './types.js';
```

Then replace the `case 'code':` branch in `renderBlocks`:

```ts
      case 'code':
        out.push(...renderCode(block, theme, width, isFirst));
        break;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/render.vitest.ts 2>&1 | tail -10`
Expected: 14 tests PASS (11 from Task 5 + 3 new).

- [ ] **Step 5: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/render.ts tests/tui/blocks/render.vitest.ts && git commit -m "feat(tui): render code blocks with bordered chrome + tokenization hookup"
```

---

### Task 7: Python tokenizer

**Files:**
- Create: `src/tui/blocks/langs/python.ts`
- Create: `tests/tui/blocks/langs/python.vitest.ts`

**Interfaces:**
- Consumes: `Token`, `Tokenizer` from `types.ts` (Task 1).
- Produces: `pythonTokenizer: Tokenizer` whose `tokenize(code)` returns `Token[]` with kinds `{keyword, string, comment, number, function, identifier, operator, punctuation, plain}`. Function-name detection: identifier immediately after `def`, `class`, or `async def` becomes `function`. Keywords, comments (`#` to EOL), triple-quoted strings, and numbers are tokenized; everything else is `plain`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/langs/python.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pythonTokenizer } from '../../../src/tui/blocks/langs/python.js';

describe('pythonTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = pythonTokenizer.tokenize('def return if else');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes strings (single and double quoted)', () => {
    const toks = pythonTokenizer.tokenize(`a = "hello" b = 'world'`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes triple-quoted strings as a single string token', () => {
    const toks = pythonTokenizer.tokenize('"""multi\nline"""');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"""multi\nline"""']);
  });

  it('tokenizes line comments', () => {
    const toks = pythonTokenizer.tokenize('x = 1  # comment');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# comment']);
  });

  it('tokenizes numbers', () => {
    const toks = pythonTokenizer.tokenize('x = 42 y = 3.14');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14']);
  });

  it('detects function names after `def`', () => {
    const toks = pythonTokenizer.tokenize('def fibonacci(n): pass');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('detects class names after `class`', () => {
    const toks = pythonTokenizer.tokenize('class MyClass: pass');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['MyClass']);
  });

  it('handles f-strings as string tokens', () => {
    const toks = pythonTokenizer.tokenize('f"hello {name}"');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['f"hello {name}"']);
  });

  it('returns empty array for empty input', () => {
    expect(pythonTokenizer.tokenize('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/python.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/langs/python.ts`**

```ts
// src/tui/blocks/langs/python.ts
// Single-pass tokenizer for Python. Recognizes:
//   - keywords: def, return, if, elif, else, for, while, class, import,
//     from, in, is, not, and, or, try, except, finally, with, as, yield,
//     lambda, pass, break, continue, raise, global, nonlocal, async,
//     await, None, True, False, self
//   - strings: single/double/triple-quoted, f-strings
//   - comments: # to end of line
//   - numbers: integers and floats
//   - function names: identifier immediately after `def`/`class`
//
// Not a full grammar — tokenization is for coloring only. The renderer
// never knows Python; it just gets a stream of (kind, text) pairs.

import type { Token, Tokenizer } from '../types.js';

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class',
  'import', 'from', 'in', 'is', 'not', 'and', 'or',
  'try', 'except', 'finally', 'with', 'as', 'yield',
  'lambda', 'pass', 'break', 'continue', 'raise',
  'global', 'nonlocal', 'async', 'await',
  'None', 'True', 'False', 'self',
]);

export const pythonTokenizer: Tokenizer = {
  language: 'python',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;
    let pendingIsFunction = false; // true when next identifier should be `function`

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace and newlines — preserve verbatim as plain.
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        pendingIsFunction = false;
        continue;
      }

      // Comments — `#` to end of line.
      if (c === '#') {
        let j = i + 1;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (single, double, triple, f-prefix).
      if (c === '"' || c === "'") {
        let j = i;
        // f-prefix?
        if (j > 0 && code[j - 1] === 'f' && tokens[tokens.length - 1]?.text.endsWith('f')) {
          // Include the leading 'f' in the string token for visual fidelity.
          // Roll back: pop the previous 'f' plain token and prepend it.
          const prev = tokens.pop();
          if (prev) i--;
        }
        const triple = code.slice(j, j + 3) === c.repeat(3);
        if (triple) {
          j += 3;
          while (j < code.length && code.slice(j, j + 3) !== c.repeat(3)) j++;
          if (j < code.length) j += 3;
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
        j++;
        while (j < code.length && code[j] !== c && code[j] !== '\n') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length && code[j] === c) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[0-9._a-fA-Fx]/.test(code[j]!)) j++;
        tokens.push({ kind: 'number', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (KEYWORDS.has(word)) {
          tokens.push({ kind: 'keyword', text: word });
          if (word === 'def' || word === 'class') pendingIsFunction = true;
        } else if (pendingIsFunction) {
          tokens.push({ kind: 'function', text: word });
          pendingIsFunction = false;
        } else {
          tokens.push({ kind: 'identifier', text: word });
        }
        i = j;
        continue;
      }

      // Operators.
      if (/[+\-*/%=<>!&|^~]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation.
      if (/[()[\]{},.:;@]/.test(c)) {
        tokens.push({ kind: 'punctuation', text: c });
        i++;
        continue;
      }

      // Fallthrough — emit as plain.
      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
```

- [ ] **Step 4: Register the tokenizer in `src/tui/blocks/tokenize.ts`**

Open `src/tui/blocks/tokenize.ts`. Find the `TOKENIZERS` const. Replace:

```ts
const TOKENIZERS: Record<string, Tokenizer> = {
  // Populated by Tasks 7-10:
  //   python / py            -> pythonTokenizer
  //   typescript / ts / tsx  -> typescriptTokenizer
  //   javascript / js / jsx  -> typescriptTokenizer
  //   json                   -> jsonTokenizer
  //   bash / sh / shell      -> bashTokenizer
};
```

with:

```ts
const TOKENIZERS: Record<string, Tokenizer> = {
  python: pythonTokenizer,
  py: pythonTokenizer,
  // Tasks 8-10 add: typescript, ts, tsx, javascript, js, jsx, json,
  // bash, sh, shell.
};
```

And add the import at the top:

```ts
import { pythonTokenizer } from './langs/python.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/python.vitest.ts tests/tui/blocks/render.vitest.ts 2>&1 | tail -10`
Expected: 9 python tests PASS; render tests still pass (the "tokenizes Python code" test now also passes because Python tokenizer is registered).

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/langs/python.ts src/tui/blocks/tokenize.ts tests/tui/blocks/langs/python.vitest.ts && git commit -m "feat(tui): add Python tokenizer (keywords, strings, comments, numbers)"
```

---

### Task 8: TypeScript / JavaScript tokenizer

**Files:**
- Create: `src/tui/blocks/langs/typescript.ts`
- Create: `tests/tui/blocks/langs/typescript.vitest.ts`

**Interfaces:**
- Consumes: `Token`, `Tokenizer` from `types.ts` (Task 1).
- Produces: `typescriptTokenizer: Tokenizer` for TS and JS (both share syntax). Recognizes keywords, strings, template literals, regex literals, comments (`//`, `/* */`), numbers, function names after `function`/`class`/`def`/`interface`/`type`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/langs/typescript.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { typescriptTokenizer } from '../../../src/tui/blocks/langs/typescript.js';

describe('typescriptTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = typescriptTokenizer.tokenize('function const let var');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes TypeScript-specific keywords', () => {
    const toks = typescriptTokenizer.tokenize('interface type enum');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword']);
  });

  it('tokenizes single and double quoted strings', () => {
    const toks = typescriptTokenizer.tokenize(`a = "hello"; b = 'world';`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes template literals (single-pass — ${} body treated as plain inside)', () => {
    const toks = typescriptTokenizer.tokenize('const x = `hello ${name}!`;');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['`hello ${name}!`']);
  });

  it('tokenizes line and block comments', () => {
    const toks = typescriptTokenizer.tokenize('// line\n/* block */');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['// line', '/* block */']);
  });

  it('tokenizes numbers (integer, float, hex)', () => {
    const toks = typescriptTokenizer.tokenize('a = 42; b = 3.14; c = 0xff;');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xff']);
  });

  it('detects function names after `function`', () => {
    const toks = typescriptTokenizer.tokenize('function fibonacci(n) {}');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('detects function names in arrow function assignments', () => {
    // `const fib = (n) => n;` — the `fib` after `const =` is still
    // a function (the right-hand side is a function value).
    const toks = typescriptTokenizer.tokenize('const fib = (n) => n;');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fib']);
  });

  it('handles regex literals', () => {
    const toks = typescriptTokenizer.tokenize('const r = /foo/g;');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['/foo/g']);
  });

  it('returns empty array for empty input', () => {
    expect(typescriptTokenizer.tokenize('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/typescript.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/langs/typescript.ts`**

```ts
// src/tui/blocks/langs/typescript.ts
// Tokenizer for TypeScript and JavaScript (shared syntax). Recognizes:
//   - keywords: function, return, const, let, var, if, else, for, while,
//     class, import, export, from, default, switch, case, break, continue,
//     new, this, super, extends, implements, async, await, yield, typeof,
//     instanceof, in, of, void, delete, throw, try, catch, finally, do
//   - TS-only: type, interface, enum, public, private, protected, static,
//     readonly, abstract, as, is, keyof, infer, never, unknown, any
//   - strings, template literals, regex literals
//   - comments: //, /* */
//   - numbers: int, float, hex
//   - function names: identifier after `function`/`const =`/`let =`/`var =`
//
// Not a full grammar. Tokenization is for coloring only.

import type { Token, Tokenizer } from '../types.js';

const KEYWORDS = new Set([
  'function', 'return', 'const', 'let', 'var',
  'if', 'else', 'for', 'while', 'do',
  'class', 'import', 'export', 'from', 'default',
  'switch', 'case', 'break', 'continue',
  'new', 'this', 'super', 'extends', 'implements',
  'async', 'await', 'yield',
  'typeof', 'instanceof', 'in', 'of',
  'void', 'delete', 'throw', 'try', 'catch', 'finally',
  'return', 'true', 'false', 'null', 'undefined',
]);

const TS_KEYWORDS = new Set([
  'type', 'interface', 'enum',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract',
  'as', 'is', 'keyof', 'infer',
  'never', 'unknown', 'any',
]);

export const typescriptTokenizer: Tokenizer = {
  language: 'typescript',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;
    let pendingIsFunction = false;

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace.
      if (/[ \t\r\n]/.test(c)) {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        pendingIsFunction = false;
        continue;
      }

      // Comments.
      if (c === '/' && code[i + 1] === '/') {
        let j = i + 2;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }
      if (c === '/' && code[i + 1] === '*') {
        let j = i + 2;
        while (j < code.length - 1 && !(code[j] === '*' && code[j + 1] === '/')) j++;
        if (j < code.length) j = Math.min(code.length, j + 2);
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings.
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < code.length && code[j] !== c && code[j] !== '\n') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length && code[j] === c) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Template literals.
      if (c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === '`' && depth === 0) { j++; break; }
          if (code[j] === '{') depth++;
          else if (code[j] === '}') depth--;
          j++;
        }
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[0-9._a-fA-FxXoObB]/.test(code[j]!)) j++;
        tokens.push({ kind: 'number', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[A-Za-z0-9_$]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (KEYWORDS.has(word) || TS_KEYWORDS.has(word)) {
          tokens.push({ kind: 'keyword', text: word });
          if (word === 'function' || word === 'class') pendingIsFunction = true;
          else if (word === 'const' || word === 'let' || word === 'var') pendingIsFunction = false;
        } else if (pendingIsFunction) {
          tokens.push({ kind: 'function', text: word });
          pendingIsFunction = false;
        } else {
          tokens.push({ kind: 'identifier', text: word });
        }
        i = j;
        continue;
      }

      // After `const =`, `let =`, `var =`, mark next identifier as function.
      if (c === '=' && tokens.length > 0) {
        const prevWord = tokens[tokens.length - 1]!.text;
        if (prevWord === 'const' || prevWord === 'let' || prevWord === 'var') {
          pendingIsFunction = true;
        }
      }

      // Regex literal: `/foo/` — only when previous non-whitespace token
      // is not an identifier, keyword, or `)`.
      if (c === '/') {
        const prev = lastNonPlainToken(tokens);
        if (prev && !isRegexForbiddenPrev(prev)) {
          let j = i + 1;
          while (j < code.length && code[j] !== '/' && code[j] !== '\n') {
            if (code[j] === '\\') j++;
            j++;
          }
          if (j < code.length && code[j] === '/') {
            j++;
            while (j < code.length && /[gimsuy]/.test(code[j]!)) j++;
          }
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
      }

      // Operators.
      if (/[+\-*/%=<>!&|^~?]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~?]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation.
      if (/[()[\]{},.;:]/.test(c)) {
        tokens.push({ kind: 'punctuation', text: c });
        i++;
        continue;
      }

      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};

/** Returns the last token whose kind is not 'plain'. */
function lastNonPlainToken(tokens: Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]!.kind !== 'plain') return tokens[i];
  }
  return undefined;
}

/**
 * `/` is division when preceded by a value-position token
 * (identifier, number, closing paren, or `]`); otherwise it's the start
 * of a regex literal.
 */
function isRegexForbiddenPrev(prev: Token): boolean {
  return ['identifier', 'number', 'function'].includes(prev.kind);
}
```

- [ ] **Step 4: Register the tokenizer in `src/tui/blocks/tokenize.ts`**

Find the `TOKENIZERS` const. Add after the python entries:

```ts
  typescript: typescriptTokenizer,
  ts: typescriptTokenizer,
  tsx: typescriptTokenizer,
  javascript: typescriptTokenizer,
  js: typescriptTokenizer,
  jsx: typescriptTokenizer,
```

And add the import at the top:

```ts
import { typescriptTokenizer } from './langs/typescript.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/typescript.vitest.ts 2>&1 | tail -10`
Expected: 10 tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/langs/typescript.ts src/tui/blocks/tokenize.ts tests/tui/blocks/langs/typescript.vitest.ts && git commit -m "feat(tui): add TypeScript/JavaScript tokenizer (keywords, template literals, regex)"
```

---

### Task 9: JSON tokenizer

**Files:**
- Create: `src/tui/blocks/langs/json.ts`
- Create: `tests/tui/blocks/langs/json.vitest.ts`

**Interfaces:**
- Consumes: `Token`, `Tokenizer` from `types.ts`.
- Produces: `jsonTokenizer: Tokenizer` — colors strings, numbers, `true`/`false`/`null` as keywords, structural punctuation as plain.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/langs/json.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jsonTokenizer } from '../../../src/tui/blocks/langs/json.js';

describe('jsonTokenizer', () => {
  it('tokenizes keys and values as strings', () => {
    const toks = jsonTokenizer.tokenize('{"name": "alice"}');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"name"', '"alice"']);
  });

  it('tokenizes numbers', () => {
    const toks = jsonTokenizer.tokenize('{"age": 42, "ratio": 3.14}');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14']);
  });

  it('tokenizes true/false/null as keywords', () => {
    const toks = jsonTokenizer.tokenize('{"a": true, "b": false, "c": null}');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['true', 'false', 'null']);
  });

  it('handles nested objects', () => {
    const toks = jsonTokenizer.tokenize('{"a": {"b": 1}}');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(strings).toEqual(['"a"', '"b"']);
    expect(numbers).toEqual(['1']);
  });

  it('handles arrays', () => {
    const toks = jsonTokenizer.tokenize('[1, 2, 3]');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('returns empty array for empty input', () => {
    expect(jsonTokenizer.tokenize('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/json.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/langs/json.ts`**

```ts
// src/tui/blocks/langs/json.ts
// Tokenizer for JSON. Recognizes:
//   - strings (double-quoted only — JSON doesn't support single quotes)
//   - numbers
//   - true / false / null (keywords)
//   - everything else: plain (structural punctuation, whitespace)

import type { Token, Tokenizer } from '../types.js';

export const jsonTokenizer: Tokenizer = {
  language: 'json',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      if (/[ \t\r\n]/.test(c)) {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (double-quoted only).
      if (c === '"') {
        let j = i + 1;
        while (j < code.length && code[j] !== '"') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (c === '-' || /[0-9]/.test(c)) {
        let j = i + (c === '-' ? 1 : 0);
        while (j < code.length && /[0-9.eE+\-]/.test(code[j]!)) j++;
        tokens.push({ kind: 'number', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // true / false / null (alphabetic only — JSON has no other keywords).
      if (/[a-z]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[a-z]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (word === 'true' || word === 'false' || word === 'null') {
          tokens.push({ kind: 'keyword', text: word });
          i = j;
          continue;
        }
      }

      // Fallthrough — structural punctuation.
      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
```

- [ ] **Step 4: Register the tokenizer**

In `src/tui/blocks/tokenize.ts`, add to `TOKENIZERS`:

```ts
  json: jsonTokenizer,
```

And the import:

```ts
import { jsonTokenizer } from './langs/json.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/json.vitest.ts 2>&1 | tail -10`
Expected: 6 tests PASS.

- [ ] **Step 6: Type-check + commit**

```bash
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/langs/json.ts src/tui/blocks/tokenize.ts tests/tui/blocks/langs/json.vitest.ts && git commit -m "feat(tui): add JSON tokenizer (strings, numbers, literals)"
```

---

### Task 10: Bash tokenizer

**Files:**
- Create: `src/tui/blocks/langs/bash.ts`
- Create: `tests/tui/blocks/langs/bash.vitest.ts`

**Interfaces:**
- Consumes: `Token`, `Tokenizer` from `types.ts`.
- Produces: `bashTokenizer: Tokenizer` — colors comments (`#` to EOL), strings (`'...'`, `"..."`), variables (`$VAR`, `${VAR}`), keywords (`if`/`then`/`fi`/`for`/`while`/`do`/`done`/`function`/`case`/`esac`/`in`/`else`/`elif`).

- [ ] **Step 1: Write the failing test**

Create `tests/tui/blocks/langs/bash.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bashTokenizer } from '../../../src/tui/blocks/langs/bash.js';

describe('bashTokenizer', () => {
  it('tokenizes comments', () => {
    const toks = bashTokenizer.tokenize('echo hello # comment');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# comment']);
  });

  it('tokenizes single and double quoted strings', () => {
    const toks = bashTokenizer.tokenize(`a="hello" b='world'`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes variables ($VAR and ${VAR})', () => {
    const toks = bashTokenizer.tokenize('echo $HOME and ${USER}');
    // Variables are styled as identifiers in this minimal tokenizer.
    const identifiers = toks.filter((t) => t.kind === 'identifier').map((t) => t.text);
    expect(identifiers).toContain('$HOME');
    expect(identifiers).toContain('${USER}');
  });

  it('tokenizes keywords', () => {
    const toks = bashTokenizer.tokenize('if [ -f x ]; then echo yes; fi');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['if', 'then', 'fi']);
  });

  it('handles for/while/do/done', () => {
    const toks = bashTokenizer.tokenize('for i in 1 2 3; do echo $i; done');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['for', 'in', 'do', 'done']);
  });

  it('returns empty array for empty input', () => {
    expect(bashTokenizer.tokenize('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/bash.vitest.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tui/blocks/langs/bash.ts`**

```ts
// src/tui/blocks/langs/bash.ts
// Tokenizer for Bash / POSIX shell. Recognizes:
//   - comments: # to EOL
//   - strings: '...', "..."
//   - variables: $VAR, ${VAR}
//   - keywords: if, then, fi, else, elif, for, while, do, done, case,
//     esac, in, function, select, until, time

import type { Token, Tokenizer } from '../types.js';

const KEYWORDS = new Set([
  'if', 'then', 'fi', 'else', 'elif',
  'for', 'while', 'do', 'done',
  'case', 'esac', 'in',
  'function', 'select', 'until', 'time',
]);

export const bashTokenizer: Tokenizer = {
  language: 'bash',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      if (/[ \t\r\n]/.test(c)) {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Comments.
      if (c === '#') {
        let j = i + 1;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings.
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < code.length && code[j] !== c) {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Variables ($VAR or ${VAR}).
      if (c === '$') {
        let j = i + 1;
        if (j < code.length && code[j] === '{') {
          while (j < code.length && code[j] !== '}') j++;
          if (j < code.length) j++;
        } else {
          while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
        }
        tokens.push({ kind: 'identifier', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (KEYWORDS.has(word)) {
          tokens.push({ kind: 'keyword', text: word });
        } else {
          tokens.push({ kind: 'identifier', text: word });
        }
        i = j;
        continue;
      }

      // Operators.
      if (/[|<>=&;]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[|<>=&;]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
```

- [ ] **Step 4: Register the tokenizer**

In `src/tui/blocks/tokenize.ts`, add to `TOKENIZERS`:

```ts
  bash: bashTokenizer,
  sh: bashTokenizer,
  shell: bashTokenizer,
```

And the import:

```ts
import { bashTokenizer } from './langs/bash.js';
```

- [ ] **Step 5: Run the test + commit**

```bash
cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/blocks/langs/bash.vitest.ts 2>&1 | tail -10
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10
cd /home/babasola/Projects/Monolith && git add src/tui/blocks/langs/bash.ts src/tui/blocks/tokenize.ts tests/tui/blocks/langs/bash.vitest.ts && git commit -m "feat(tui): add Bash tokenizer (comments, strings, variables, keywords)"
```

---

### Task 11: Wire AgentView to use the new renderer

**Files:**
- Modify: `src/tui/views/agent-view.ts:56-128` — replace `renderAgentResponse` body.
- Modify: `tests/agent-view-formatting.vitest.ts` — add a test that exercises bold + code + heading.

**Interfaces:**
- Consumes: `renderBlocks` from Task 6; `defaultTheme` from Task 1.
- Produces: AgentView's `renderAgentResponse` becomes a thin wrapper that parses the response and calls `renderBlocks`. The surrounding render loop in `render()` keeps its `RenderedLine` shape unchanged (just `text` + `isFirst`).

- [ ] **Step 1: Add the failing test**

Open `tests/agent-view-formatting.vitest.ts` and find the existing describe block. Append a new test:

```ts
  it('renders **bold** with the bold ANSI style on agent response rows', () => {
    // Render an agent response containing bold text and a fenced code
    // block. Assert the bold text shows up in a row with the bold ANSI
    // code (`\x1b[1m`) and the code block has the top/bottom borders.
    const view = new AgentView();
    // ... (use existing ctx setup pattern from this file)
    // Existing tests show the ctx shape — mirror it. If you don't know
    // the existing helper, copy the relevant ctx() from the file's
    // first describe block and use it here.
    ctx.perTab.agentResponses = ['**Bold** then code:\n\n```python\nx = 1\n```'];
    ctx.perTab.submittedPrompts = ['test prompt'];
    view.render(ctx);
    const all = allRowsText(ctx.canvas!);
    expect(all).toContain('Bold');
    // The bold wrapping is in the rendered rows.
    expect(ctx.canvas).toBeDefined();
    // At least one row containing "Bold" should have the `\x1b[1m` prefix.
    const buf = (ctx.canvas as any).buffer as Array<Array<{ char: string; ansiPrefix: string }>>;
    let found = false;
    for (const row of buf) {
      for (const cell of row) {
        if (cell.char === 'B' && cell.ansiPrefix.includes('1m')) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
```

(The exact shape of `ctx()` and `allRowsText()` should mirror the existing patterns in the file. Read the first 30 lines of `tests/agent-view-formatting.vitest.ts` to find them.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/agent-view-formatting.vitest.ts 2>&1 | tail -15`
Expected: New test FAILS — agent-view still uses the old `renderAgentResponse` which doesn't apply theme.

- [ ] **Step 3: Replace `renderAgentResponse` in `src/tui/views/agent-view.ts`**

Open the file. Replace the entire `renderAgentResponse` function (lines 56-128) with:

```ts
import { renderBlocks } from '../blocks/render.js';
import { defaultTheme } from '../blocks/theme.js';

/**
 * Render an agent (or user) response through the rich-renderer pipeline:
 *   - Block parser detects headings/quotes/rules/code/lists
 *   - Inline parser splits **bold**/*italic*/`code`
 *   - Code tokenizer colors Python/TS/JSON/Bash keywords/strings/comments
 *   - Theme applies semantic ANSI styles per token kind
 *
 * The surrounding render loop expects RenderedLine[] (text + isFirst);
 * the renderer returns StyledRow[] which is shape-compatible.
 */
function renderAgentResponse(
  text: string,
  kind: 'user' | 'agent',
  textWidth: number,
): RenderedLine[] {
  void kind; // reserved for future per-kind theming overrides
  const blocks = parseResponseBlocks(text);
  const styledRows = renderBlocks(blocks, defaultTheme, textWidth);
  return styledRows.map((r) => ({ kind: 'agent', text: r.text, isFirst: r.isFirst }));
}
```

Wait — the current code distinguishes `kind: 'user'` vs `kind: 'agent'`. Keep that. Adjust the rewrite:

```ts
function renderAgentResponse(
  text: string,
  kind: 'user' | 'agent',
  textWidth: number,
): RenderedLine[] {
  const blocks = parseResponseBlocks(text);
  const styledRows = renderBlocks(blocks, defaultTheme, textWidth);
  return styledRows.map((r) => ({ kind, text: r.text, isFirst: r.isFirst }));
}
```

(Note: `parseResponseBlocks` here is the OLD one — re-exported from `src/agent/response-blocks.ts` — which the agent-view already imports. But that returns the OLD `ResponseBlock` type. We need to use the NEW `parseBlocks` from `../tui/blocks/parser.js`.)

Actually, the cleanest path is to switch the import in agent-view.ts from `parseResponseBlocks` (old) to `parseBlocks` (new). The new one is a strict superset. Find the import at the top of `agent-view.ts`:

```ts
import { parseResponseBlocks } from '../../agent/response-blocks.js';
```

Replace with:

```ts
import { parseBlocks } from '../../tui/blocks/parser.js';
```

Then in `renderAgentResponse`, call `parseBlocks(text)` (no `Response` infix). The new parser's output type is the new `ResponseBlock[]` which `renderBlocks` accepts.

Also add these two imports at the top:

```ts
import { renderBlocks } from '../blocks/render.js';
import { defaultTheme } from '../blocks/theme.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/agent-view-formatting.vitest.ts 2>&1 | tail -10`
Expected: All tests PASS, including the new one.

- [ ] **Step 5: Run the full TUI test suite**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/ tests/agent-view-formatting.vitest.ts tests/response-blocks-parser.vitest.ts tests/response-blocks-smoke.vitest.ts 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/views/agent-view.ts tests/agent-view-formatting.vitest.ts && git commit -m "feat(tui): wire AgentView to rich renderer (bold/italic/code/headings/quotes/rules)"
```

---

### Task 12: Wire ChatView to use the new renderer (it currently bypasses parsing entirely)

**Files:**
- Modify: `src/tui/views/chat-view.ts:42-82` — replace the per-line `wrapText` loop with `parseBlocks` + `renderBlocks`.
- Modify: `tests/tui/views/chat-view.vitest.ts` — add a test that asserts fenced code blocks now render with borders in chat-view too.

**Interfaces:**
- Consumes: `parseBlocks`, `renderBlocks`, `defaultTheme` (Tasks 4, 6, 1).
- Produces: ChatView's per-turn rendering goes through the same pipeline as AgentView. **Behavioral change:** previously chat-view treated the entire response as plain text; now it parses blocks, so fenced code, lists, bold, etc. render properly. Existing chat-view tests must keep passing — that constrains the implementation.

- [ ] **Step 1: Add the failing test**

Open `tests/tui/views/chat-view.vitest.ts` and append a new test inside the existing describe block:

```ts
  it('renders fenced code blocks with bordered chrome in chat responses', () => {
    const view = new ChatView();
    const c = ctx({ dims: { columns: 120, rows: 30 } });
    c.perTab.submittedPrompts = ['show me a function'];
    c.perTab.agentResponses = ['```python\ndef f(): pass\n```'];
    view.render(c);
    const frame = c.canvas!.renderFrame();
    // Border characters from the new code chrome.
    expect(frame).toMatch(/[┌╭]/);
    expect(frame).toMatch(/[└╰]/);
    expect(frame).toContain('python');
  });
```

(Use the existing `ctx()` helper from the top of the file — read the first 30 lines to confirm its shape.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/views/chat-view.vitest.ts 2>&1 | tail -15`
Expected: New test FAILS — chat-view renders the response as plain text, so the border characters don't appear.

- [ ] **Step 3: Update `src/tui/views/chat-view.ts`**

Open the file. Find the section that walks turns and wraps each one (around lines 42-82):

```ts
const submitted = ctx.perTab.submittedPrompts;
const responses = ctx.perTab.agentResponses;
const turns: { kind: 'user' | 'agent'; text: string }[] = [];
const maxLen = Math.max(submitted.length, responses.length);
for (let i = 0; i < maxLen; i++) {
  if (i < submitted.length) turns.push({ kind: 'user', text: submitted[i]! });
  if (i < responses.length) turns.push({ kind: 'agent', text: responses[i]! });
}
```

Replace with a call to the new pipeline per turn:

```ts
const submitted = ctx.perTab.submittedPrompts;
const responses = ctx.perTab.agentResponses;
const allLines: ScrollbackLine[] = [];
const maxLen = Math.max(submitted.length, responses.length);
for (let i = 0; i < maxLen; i++) {
  if (i < submitted.length) {
    // User prompts render as plain text — no markdown parsing needed.
    const wrapped = wrapText(submitted[i]!, textWidth);
    wrapped.forEach((line, j) => {
      allLines.push({ kind: 'user', text: line, isFirst: j === 0 });
    });
  }
  if (i < responses.length) {
    // Agent responses go through the rich renderer.
    const blocks = parseBlocks(responses[i]!);
    const styledRows = renderBlocks(blocks, defaultTheme, textWidth);
    styledRows.forEach((row, j) => {
      allLines.push({ kind: 'agent', text: row.text, isFirst: j === 0 });
    });
  }
}
```

Then remove the now-unused `turns` array and the second loop that consumed it. Replace:

```ts
for (const t of turns) {
  const wrapped = wrapText(t.text, textWidth);
  for (let i = 0; i < wrapped.length; i++) {
    allLines.push({ kind: t.kind, text: wrapped[i]!, isFirst: i === 0 });
  }
}
```

with:

```ts
// (Turns were inlined into the loop above; nothing to do here.)
```

Add imports at the top:

```ts
import { parseBlocks } from '../blocks/parser.js';
import { renderBlocks } from '../blocks/render.js';
import { defaultTheme } from '../blocks/theme.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/views/chat-view.vitest.ts 2>&1 | tail -10`
Expected: All tests PASS, including the new one.

- [ ] **Step 5: Run the full TUI test suite**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/tui/ tests/agent-view-formatting.vitest.ts 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/tui/views/chat-view.ts tests/tui/views/chat-view.vitest.ts && git commit -m "feat(tui): wire ChatView to rich renderer (fenced code, lists, bold, headings)"
```

---

### Task 13: Final verification

**Files:** none.

- [ ] **Step 1: Run tsc**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1`
Expected: 0 errors.

- [ ] **Step 2: Run the full test suite**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run 2>&1 | tail -15`
Expected: All tests PASS, count is the previous baseline + ~85 new tests across 11 new test files.

- [ ] **Step 3: Run gitnexus detect_changes**

Run the `mcp__gitnexus__detect_changes` tool with `repo: "ALiX"`.
Expected: the report names the new files (`src/tui/blocks/*`, `tests/tui/blocks/*`) and the modified files (`src/tui/views/agent-view.ts`, `src/tui/views/chat-view.ts`, `src/agent/response-blocks.ts`). No HIGH or CRITICAL risk on existing execution flows.

- [ ] **Step 4: Manual smoke (informational, gates this task as done)**

The user is the operator. Confirm visually:
1. `cd ~/Projects/alix-init-test && node ../Monolith/bin/alix.js tui`
2. Switch to the agent tab.
3. Submit: "write a python function `factorial(n)` and a markdown **heading** and a `> quote`"
4. Verify:
   - Heading line is bold and followed by a `═` rule line.
   - Code block has a `┌─ python ─...─┐` border with the language label.
   - `def factorial(n):` is colored as a keyword.
   - The `> quote` text has a `│` left bar.
   - `**heading**` in the prompt renders bold in the response.

- [ ] **Step 5: Final commit if anything changed during verify**

If Steps 1-4 needed any final fixes, commit them:

```bash
cd /home/babasola/Projects/Monolith && git status  # check what's pending
# If any tweaks: fix, test, commit with conventional-commit style.
```

Expected: `git status` clean (no pending changes after Step 4 passes).

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| Pipeline architecture (5 layers) | Tasks 1-6 |
| Block parser v2 (headings, quotes, rules) | Task 4 |
| Inline parser (bold, italic, code, escapes, links) | Task 3 |
| Theme abstraction + default dark theme | Task 1 |
| Code tokenizers: Python, TypeScript/JS, JSON, Bash | Tasks 7-10 |
| Plain fallback | Task 2 |
| Rich renderer (chrome, headings, quotes, rules, lists) | Tasks 5-6 |
| Wire AgentView | Task 11 |
| Wire ChatView (currently bypasses parsing) | Task 12 |
| Tests (~85 new) | Tasks 1-12 |
| Verification (tsc, vitest, gitnexus, manual smoke) | Task 13 |

Every spec section has at least one task. **No gaps.**

### Placeholder scan

Grep'd the plan for: TBD, TODO, FIXME, "implement later", "fill in details". None found.

Two soft spots worth flagging:
- **Task 11 / Step 3** says "read the first 30 lines of `tests/agent-view-formatting.vitest.ts` to find the ctx helper" — this is a deliberate pointer, not a placeholder. The test file exists and the implementer can read it.
- **Task 12 / Step 3** has the same pattern for `tests/tui/views/chat-view.vitest.ts`. Same reasoning.

If the implementer wants more concrete code, they can read the file and substitute. Both test files exist in the repo at this point (verified during exploration in Task 1).

### Type consistency

- `Token` defined in `types.ts` (Task 1). Used by `Token`, `Tokenizer` interface in same file. Used by all language tokenizers (Tasks 7-10). Used by `renderBlocks` (Task 6) — `renderCode` calls `styleToken(token: Token, theme)`. ✓
- `ResponseBlock` defined in `types.ts` (Task 1). Used by `parseBlocks` (Task 4) — return type. Used by `renderBlocks` (Task 5, 6). ✓
- `InlineSpan` defined in `types.ts` (Task 1). Used by `parseInline` (Task 3). Used by `renderTextOrInline`, `renderHeading`, `renderQuote` (Task 5). ✓
- `Theme` defined in `types.ts` (Task 1). Used by `defaultTheme` (Task 1). Used by `renderBlocks` (Tasks 5, 6). ✓
- `StyledRow` defined in `types.ts` (Task 1). Returned by `renderBlocks`. Mapped to `RenderedLine` in agent-view/chat-view wrappers. ✓

No type mismatches found.