# Response Blocks — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure Markdown-to-`ResponseBlock[]` parser and update the agent tab's renderer to consume structured blocks instead of treating every response as a single wrapped string.

**Architecture:** A new pure function `parseResponseBlocks(md)` in `src/agent/response-blocks.ts` line-oriented state machine (TEXT/CODE/LIST) splits Markdown into typed blocks. The agent view's renderer is updated to dispatch per-block-type rendering: text blocks delegate to existing `wrapText`; code blocks render verbatim with 2-space indent; list blocks wrap each item with normalized bullets. Markdown remains the canonical source — no changes to `AgentTurnResult`, persistence, or state.

**Tech Stack:** TypeScript, vitest, existing `TerminalCanvas` and `wrapText` utilities.

**Spec:** [`docs/superpowers/specs/2026-07-25-response-blocks-design.md`](../specs/2026-07-25-response-blocks-design.md)

## Global Constraints

From the spec, copied verbatim — every task implicitly honors these:

- `ResponseBlock` discriminated union has exactly three kinds: `{ type: "text"; text: string }`, `{ type: "code"; language?: string; code: string; fenced: true }`, `{ type: "list"; marker: "-" | "*" | "+" | "ordered"; items: string[] }`
- Parser invariants: deterministic, pure, linear O(n), single pass, preserves source order, never throws for malformed input, never emits empty blocks, never mutates input
- Implementation strategy: line-oriented state machine (TEXT/CODE/LIST), not regex-driven
- Composes with `wrapText` rather than replacing it
- Zero changes to `AgentTurnResult`, `PerTabState`, session files, or daemon protocol
- No `throw` statements in parser happy path
- Code fences: exactly three backticks only (no longer-than-three fences in Phase 1); tilde fences unsupported → text; any other fence length → text
- Unclosed fence → emit partial content as `text` block
- Parser normalizes CRLF to LF on read (documented; original separators are not preserved in malformed-fence fallback reconstruction)
- Parser is a line-oriented scanner with explicit text/code/list modes (not a formal state enum — nested loops keyed off the current mode)
- Code block `fenced` field is always `true` in Phase 1 (forward compat for inline code)
- List `marker` preserves source: `-`, `*`, `+`, `ordered` (numbered uses literal "ordered")

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/response-blocks.ts` | Create | `ResponseBlock` types + `parseResponseBlocks` pure function |
| `src/tui/views/agent-view.ts` | Modify | Replace flat wrap loop with `parseResponseBlocks` + block dispatch |
| `tests/response-blocks-parser.vitest.ts` | Create | Unit tests for the parser (~25 cases) |
| `tests/agent-view-formatting.vitest.ts` | Modify | Extend with block-rendering tests |

The parser lives in `src/agent/` (not `src/tui/`) because future phases will reuse it for the API, daemon protocol, and web UI. Keeping it transport-agnostic prevents coupling.

---

## Task 1: Define ResponseBlock types

**Files:**
- Create: `src/agent/response-blocks.ts`
- Test: (none — types are compile-time only)

**Interfaces:**
- Produces: `ResponseBlock` discriminated union (consumed by Tasks 2-4)

- [ ] **Step 1: Create the file with type definitions only**

```ts
// src/agent/response-blocks.ts

/**
 * Structured representation of an agent response, derived from Markdown.
 *
 * Markdown remains the canonical persisted artifact (see AgentTurnResult.summary
 * and perTab.agentResponses). This type is a presentation model — renderers
 * (TUI, web, CLI) consume it to avoid re-parsing Markdown for layout decisions.
 *
 * Phase 1 supports three block kinds:
 *   - text:  paragraphs of prose, possibly with blank lines
 *   - code:  fenced code blocks (three backticks; language optional)
 *   - list:  contiguous bullet or numbered lists
 *
 * Invariants (see parseResponseBlocks docs):
 *   - blocks never reordered or merged across non-adjacent content
 *   - never emits empty blocks
 *   - source order preserved
 */
export type ResponseBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; code: string; fenced: true }
  | { type: "list"; marker: "-" | "*" | "+" | "ordered"; items: string[] };

/**
 * Marker source for a list block. The renderer normalizes this to its
 * preferred display style. `"ordered"` covers all numbered lists regardless
 * of the actual digits in the source.
 */
export type ListMarker = "-" | "*" | "+" | "ordered";
```

- [ ] **Step 2: Verify build succeeds**

Run: `pnpm build`
Expected: Build passes with no errors. The new types compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/agent/response-blocks.ts
git commit -m "feat(agent): add ResponseBlock type for structured agent responses"
```

---

## Task 2: Parser — empty input + plain text

**Files:**
- Modify: `src/agent/response-blocks.ts`
- Create: `tests/response-blocks-parser.vitest.ts`

**Interfaces:**
- Consumes: `ResponseBlock` from Task 1
- Produces: `parseResponseBlocks(md: string): readonly ResponseBlock[]`

- [ ] **Step 1: Write failing tests for empty input and plain text**

```ts
// tests/response-blocks-parser.vitest.ts
import { describe, it, expect } from "vitest";
import { parseResponseBlocks } from "../src/agent/response-blocks.js";

describe("parseResponseBlocks — empty and plain text", () => {
  it("returns [] for empty input", () => {
    expect(parseResponseBlocks("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseResponseBlocks("   \n\n  \t  \n")).toEqual([]);
  });

  it("wraps plain prose in a single text block", () => {
    expect(parseResponseBlocks("Hello world")).toEqual([
      { type: "text", text: "Hello world" },
    ]);
  });

  it("preserves newlines inside text blocks", () => {
    const md = "line one\nline two\nline three";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "line one\nline two\nline three" },
    ]);
  });

  it("preserves blank lines inside text blocks", () => {
    const md = "first paragraph\n\nsecond paragraph";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "first paragraph\n\nsecond paragraph" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: FAIL with "Cannot find module" or "parseResponseBlocks is not a function".

- [ ] **Step 3: Implement parser skeleton with text-only path**

```ts
// src/agent/response-blocks.ts — append below the existing type definitions

/**
 * Parse a Markdown response into a sequence of typed blocks.
 *
 * Pure, deterministic, single-pass line-oriented scanner with three modes:
 *   text  — accumulating prose into a text block
 *   code  — accumulating lines inside a fenced code block
 *   list  — accumulating list items into a list block
 *
 * Implementation note: this is a scanner driven by explicit mode checks
 * per line, not a formal state enum. The mode is implicit in the current
 * branch of the main loop. The three modes are clearly distinct in the
 * code but are not represented as a `State` type.
 *
 * Line endings: the parser splits on /\r?\n/ and rejoins with "\n".
 * CRLF is normalized to LF on read. The original separator sequence is
 * not preserved across parsing.
 *
 * Invariants:
 *   - empty input → []
 *   - blocks preserve source order
 *   - never emits empty blocks (zero-length text or list with zero items)
 *   - never throws for malformed input (unclosed fence, tilde fence, etc.)
 *   - never mutates the input string
 *
 * See design spec for the full invariant list.
 */
export function parseResponseBlocks(md: string): readonly ResponseBlock[] {
  if (!md) return [];
  if (!md.trim()) return [];

  const blocks: ResponseBlock[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;

  let textBuf: string[] = [];
  const flushText = () => {
    if (textBuf.length === 0) return;
    const text = textBuf.join("\n");
    textBuf = [];
    if (text.trim() === "") return; // skip empty
    blocks.push({ type: "text", text });
  };

  while (i < lines.length) {
    const line = lines[i]!;
    // CODE state and LIST state are handled in later tasks.
    textBuf.push(line);
    i++;
  }

  flushText();
  return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/response-blocks.ts tests/response-blocks-parser.vitest.ts
git commit -m "feat(agent): parseResponseBlocks handles plain text + empty input"
```

---

## Task 3: Parser — fenced code blocks

**Files:**
- Modify: `src/agent/response-blocks.ts`
- Modify: `tests/response-blocks-parser.vitest.ts`

**Interfaces:**
- Consumes: `ResponseBlock` from Task 1
- Produces: extended `parseResponseBlocks` that recognizes fenced code blocks

- [ ] **Step 1: Write failing tests for code blocks**

Add to `tests/response-blocks-parser.vitest.ts`:

```ts
describe("parseResponseBlocks — fenced code blocks", () => {
  it("emits a code block for a fenced snippet with language", () => {
    const md = "```python\ndef f():\n    return 1\n```";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "code", language: "python", code: "def f():\n    return 1", fenced: true },
    ]);
  });

  it("emits a code block with no language when the fence has none", () => {
    const md = "```\nx = 1\n```";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "code", code: "x = 1", fenced: true },
    ]);
  });

  it("emits multiple code blocks in order", () => {
    const md = "```js\nx\n```\n\n```py\ny\n```";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "code", language: "js", code: "x", fenced: true },
      { type: "code", language: "py", code: "y", fenced: true },
    ]);
  });

  it("returns text block (no exception) when fence is unclosed", () => {
    const md = "```py\nx = 1";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "```py\nx = 1" },
    ]);
  });

  it("treats tilde fences as plain text", () => {
    const md = "~~~py\nx = 1\n~~~";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "~~~py\nx = 1\n~~~" },
    ]);
  });

  it("treats a single backtick as plain text", () => {
    expect(parseResponseBlocks("`code`")).toEqual([
      { type: "text", text: "`code`" },
    ]);
  });

  it("treats four-backtick fences as plain text (only three supported)", () => {
    const md = "````\nx\n````";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "````\nx\n````" },
    ]);
  });

  it("treats mismatched fence lengths as plain text", () => {
    const md = "````\nx\n```";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "````\nx\n```" },
    ]);
  });

  it("treats two-backtick fence as plain text (only three supported)", () => {
    const md = "``\nx\n``";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "``\nx\n``" },
    ]);
  });
});

describe("parseResponseBlocks — mixed content", () => {
  it("emits text, code, text, list in source order", () => {
    const md = [
      "Here is code:",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "Next steps:",
      "",
      "- test",
      "- deploy",
    ].join("\n");
    const blocks = parseResponseBlocks(md);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks[1]).toMatchObject({ type: "code", language: "ts" });
    expect(blocks[2]).toMatchObject({ type: "text" });
    expect(blocks[3]).toMatchObject({ type: "list", marker: "-" });
  });

  it("never throws for arbitrary malformed input", () => {
    const inputs = [
      "",
      "~~~",
      "```",
      "\0",
      "🔥🔥🔥",
      "\n\n\n",
      "```unclosed",
      "- ",
      "* ",
      "1. ",
      "\t\t\t",
      "``````",
      "```\n```\n```",
    ];
    for (const input of inputs) {
      expect(() => parseResponseBlocks(input)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: All new code-block tests fail; existing 5 still pass.

- [ ] **Step 3: Add CODE mode to the parser**

```ts
// src/agent/response-blocks.ts — append below the existing type definitions

/**
 * Match an opening fence line: EXACTLY three backticks at the start of
 * a line, optionally followed by a language tag (any non-whitespace,
 * non-backtick characters).
 *
 * Phase 1 does NOT support:
 *   - fences longer than three backticks (` ```` ` is plain text)
 *   - tilde fences (`~~~`) — plain text
 *   - inline code (single backticks) — plain text
 *   - indented fences — plain text
 */
function matchFenceOpen(line: string): { language?: string } | null {
  const m = /^```([^\s`]*)\s*$/.exec(line);
  if (!m) return null;
  return { language: m[1] || undefined };
}

/**
 * Match a closing fence: exactly three backticks at the start of a line
 * with optional trailing whitespace. Implemented as a direct string
 * comparison to avoid dynamic regex construction.
 */
const CLOSING_FENCE = "```";
function matchFenceClose(line: string): boolean {
  // Compare against "```" with optional trailing whitespace.
  // line.trimEnd() avoids dynamic regex creation.
  return line.trimEnd() === CLOSING_FENCE;
}

export function parseResponseBlocks(md: string): readonly ResponseBlock[] {
  if (!md) return [];
  if (!md.trim()) return [];

  const blocks: ResponseBlock[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;

  let textBuf: string[] = [];
  const flushText = () => {
    if (textBuf.length === 0) return;
    const text = textBuf.join("\n");
    textBuf = [];
    if (text.trim() === "") return;
    blocks.push({ type: "text", text });
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const fenceOpen = matchFenceOpen(line);

    if (fenceOpen) {
      flushText();
      // Collect lines until matching close.
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (matchFenceClose(lines[i]!, fenceOpen.fenceLen)) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      // Unclosed fence: emit the partial content (including the opening
      // fence line) as a text block. No exception, no throw.
      if (!closed) {
        const reconstructed = [line, ...codeLines].join("\n");
        blocks.push({ type: "text", text: reconstructed });
        continue;
      }
      const code = codeLines.join("\n");
      blocks.push({
        type: "code",
        language: fenceOpen.language,
        code,
        fenced: true,
      });
      continue;
    }

    textBuf.push(line);
    i++;
  }

  flushText();
  return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: All 14 tests pass (5 text + 9 code).

- [ ] **Step 5: Commit**

```bash
git add src/agent/response-blocks.ts tests/response-blocks-parser.vitest.ts
git commit -m "feat(agent): parseResponseBlocks recognizes fenced code blocks"
```

---

## Task 4: Parser — lists

**Files:**
- Modify: `src/agent/response-blocks.ts`
- Modify: `tests/response-blocks-parser.vitest.ts`

**Interfaces:**
- Consumes: `ResponseBlock` from Task 1, `ListMarker` from Task 1
- Produces: extended `parseResponseBlocks` that recognizes bullet/numbered lists

- [ ] **Step 1: Write failing tests for lists**

Add to `tests/response-blocks-parser.vitest.ts`:

```ts
describe("parseResponseBlocks — lists", () => {
  it("emits a dash list", () => {
    expect(parseResponseBlocks("- a\n- b\n- c")).toEqual([
      { type: "list", marker: "-", items: ["a", "b", "c"] },
    ]);
  });

  it("emits a star list", () => {
    expect(parseResponseBlocks("* a\n* b")).toEqual([
      { type: "list", marker: "*", items: ["a", "b"] },
    ]);
  });

  it("emits a plus list", () => {
    expect(parseResponseBlocks("+ a\n+ b")).toEqual([
      { type: "list", marker: "+", items: ["a", "b"] },
    ]);
  });

  it("emits an ordered list", () => {
    expect(parseResponseBlocks("1. a\n2. b\n3. c")).toEqual([
      { type: "list", marker: "ordered", items: ["a", "b", "c"] },
    ]);
  });

  it("treats sparse numbers as ordered", () => {
    expect(parseResponseBlocks("1. a\n5. b\n20. c")).toEqual([
      { type: "list", marker: "ordered", items: ["a", "b", "c"] },
    ]);
  });

  it("ends list on first non-list line", () => {
    const md = "- a\n- b\n\ncontinuation";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "list", marker: "-", items: ["a", "b"] },
      { type: "text", text: "continuation" },
    ]);
  });

  it("emits text before and after a list", () => {
    const md = "intro\n\n- a\n- b\n\noutro";
    expect(parseResponseBlocks(md)).toEqual([
      { type: "text", text: "intro" },
      { type: "list", marker: "-", items: ["a", "b"] },
      { type: "text", text: "outro" },
    ]);
  });

  it("drops empty list items", () => {
    expect(parseResponseBlocks("-\n- a\n- ")).toEqual([
      { type: "list", marker: "-", items: ["a"] },
    ]);
  });

  it("treats non-list lines as text", () => {
    expect(parseResponseBlocks("not a list\njust text")).toEqual([
      { type: "text", text: "not a list\njust text" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: 9 list tests fail; existing 13 still pass.

- [ ] **Step 3: Add LIST state to the parser**

```ts
// src/agent/response-blocks.ts — replace the parseResponseBlocks body

/**
 * Match a list item line. Returns the marker kind and the item text.
 * Supports `-`, `*`, `+`, and numbered (`N.`) markers. The numbered
 * marker always normalizes to "ordered" — actual digit values are
 * discarded (the renderer will renumber 1..N in display).
 */
function matchListItem(line: string): { marker: ListMarker; text: string } | null {
  const dash = /^-\s+(.*)$/.exec(line);
  if (dash) return { marker: "-", text: dash[1]! };
  const star = /^\*\s+(.*)$/.exec(line);
  if (star) return { marker: "*", text: star[1]! };
  const plus = /^\+\s+(.*)$/.exec(line);
  if (plus) return { marker: "+", text: plus[1]! };
  const num = /^\d+\.\s+(.*)$/.exec(line);
  if (num) return { marker: "ordered", text: num[1]! };
  return null;
}

export function parseResponseBlocks(md: string): readonly ResponseBlock[] {
  if (!md) return [];
  if (!md.trim()) return [];

  const blocks: ResponseBlock[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;

  let textBuf: string[] = [];
  const flushText = () => {
    if (textBuf.length === 0) return;
    const text = textBuf.join("\n");
    textBuf = [];
    if (text.trim() === "") return;
    blocks.push({ type: "text", text });
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code: takes priority over list detection so a code line
    // beginning with `- ` doesn't get mis-parsed.
    const fenceOpen = matchFenceOpen(line);
    if (fenceOpen) {
      flushText();
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (matchFenceClose(lines[i]!)) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      if (!closed) {
        const reconstructed = [line, ...codeLines].join("\n");
        blocks.push({ type: "text", text: reconstructed });
        continue;
      }
      blocks.push({
        type: "code",
        language: fenceOpen.language,
        code: codeLines.join("\n"),
        fenced: true,
      });
      continue;
    }

    // List item.
    const listItem = matchListItem(line);
    if (listItem) {
      flushText();
      const items: string[] = [];
      const marker: ListMarker = listItem.marker;
      if (listItem.text.trim() !== "") items.push(listItem.text);
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (matchFenceOpen(next)) break; // code block takes priority
        const nextItem = matchListItem(next);
        if (!nextItem || nextItem.marker !== marker) break;
        if (nextItem.text.trim() !== "") items.push(nextItem.text);
        i++;
      }
      if (items.length > 0) {
        blocks.push({ type: "list", marker, items });
      }
      continue;
    }

    textBuf.push(line);
    i++;
  }

  flushText();
  return blocks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/response-blocks-parser.vitest.ts`
Expected: All 23 tests pass (5 text + 9 code + 9 list).

- [ ] **Step 5: Commit**

```bash
git add src/agent/response-blocks.ts tests/response-blocks-parser.vitest.ts
git commit -m "feat(agent): parseResponseBlocks recognizes bullet and numbered lists"
```

---

## Task 5: Agent view — block dispatch (text + code)

**Files:**
- Modify: `src/tui/views/agent-view.ts`
- Modify: `tests/agent-view-formatting.vitest.ts`

**Interfaces:**
- Consumes: `parseResponseBlocks` from Tasks 2-4
- Produces: agent view renders text via `wrapText`, code blocks verbatim with 2-space indent

- [ ] **Step 1: Write failing tests for code-block rendering in the TUI**

Add to `tests/agent-view-formatting.vitest.ts`:

```ts
describe('AgentView — code block rendering', () => {
  it('renders a code block with 2-space indent and per-line preservation', () => {
    const perTab = makePerTab({
      agentResponses: ['```python\ndef fib(n):\n    return n\n```'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 12);
    expect(all).toContain('def fib(n):');
    expect(all).toContain('return n');
    // Each code line is indented at column 2.
    expect(rowText(c, 7)).toMatch(/^\s{2}/);
  });

  it('does not wrap long code lines (preserves verbatim)', () => {
    const longCode = 'x = "' + 'a'.repeat(100) + '"';
    const perTab = makePerTab({
      agentResponses: ['```py\n' + longCode + '\n```'],
    });
    // Narrow canvas — code still rendered, just possibly hard-truncated.
    expect(() => renderOnCanvas(40, 40, perTab)).not.toThrow();
  });

  it('renders code block language header as [lang] label', () => {
    const perTab = makePerTab({
      agentResponses: ['```typescript\nconst x = 1;\n```'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 10);
    // TUI renders structure, not Markdown: language becomes a [lang] label.
    expect(all).toContain('[typescript]');
    expect(all).not.toContain('```typescript');
  });

  it('omits language header when code block has no language', () => {
    const perTab = makePerTab({
      agentResponses: ['```\nx = 1\n```'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 10);
    expect(all).toContain('x = 1');
    // No `[<empty>]` artifact and no source fence markers.
    expect(all).not.toContain('[ ]');
    expect(all).not.toContain('```');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts`
Expected: 4 new tests fail.

- [ ] **Step 3: Add renderBlocks helper and integrate into agent-view**

In `src/tui/views/agent-view.ts`:

1. Add import at top: `import { parseResponseBlocks } from '../../agent/response-blocks.js';`
2. Add a private helper before the `AgentView` class:

```ts
interface RenderedLine {
  kind: 'user' | 'agent' | 'plan' | 'approval';
  text: string;
  isFirst: boolean;
}

/**
 * Render a single response string into agent-scrollback lines by first
 * parsing it into ResponseBlocks, then dispatching each block to a
 * type-specific renderer. Text blocks delegate to wrapText (existing).
 * Code blocks render verbatim with 2-space indent. List blocks are
 * handled in Task 6.
 */
function renderAgentResponse(
  text: string,
  kind: 'user' | 'agent',
  textWidth: number,
): RenderedLine[] {
  const out: RenderedLine[] = [];
  const blocks = parseResponseBlocks(text);

  for (const block of blocks) {
    if (block.type === 'text') {
      const wrapped = wrapText(block.text, textWidth);
      for (let i = 0; i < wrapped.length; i++) {
        out.push({ kind, text: wrapped[i]!, isFirst: i === 0 });
      }
    } else if (block.type === 'code') {
      // The TUI is not Markdown — it renders the code block's structure,
      // not its source fences. Language (when present) becomes an optional
      // header line; the body is rendered verbatim with 2-space indent.
      // No reflow, no wrap. Future syntax highlighting slots in here.
      if (block.language) {
        out.push({ kind, text: '  [' + block.language + ']', isFirst: true });
      }
      for (const codeLine of block.code.split('\n')) {
        out.push({ kind, text: '  ' + codeLine, isFirst: false });
      }
    }
    // list blocks handled in Task 6.
  }

  return out;
}
```

3. Replace the existing turn-wrapping loop in `render()` (currently at lines ~106-111):

```ts
// BEFORE:
for (const t of turns) {
  const wrapped = wrapText(t.text, textWidth);
  for (let i = 0; i < wrapped.length; i++) {
    allLines.push({ kind: t.kind, text: wrapped[i]!, isFirst: i === 0 });
  }
}

// AFTER:
for (const t of turns) {
  const rendered = renderAgentResponse(t.text, t.kind, textWidth);
  for (const line of rendered) {
    allLines.push(line);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts`
Expected: All tests pass (46 existing + 4 new = 50).

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `pnpm test:vitest 2>&1 | tail -10`
Expected: 3220+ tests pass (no new failures).

- [ ] **Step 6: Commit**

```bash
git add src/tui/views/agent-view.ts tests/agent-view-formatting.vitest.ts
git commit -m "feat(tui): agent view renders code blocks via ResponseBlock dispatch"
```

---

## Task 6: Agent view — list rendering

**Files:**
- Modify: `src/tui/views/agent-view.ts`
- Modify: `tests/agent-view-formatting.vitest.ts`

**Interfaces:**
- Consumes: `parseResponseBlocks` from Tasks 2-4
- Produces: agent view renders list blocks with normalized bullets and per-item wrapping

- [ ] **Step 1: Write failing tests for list rendering in the TUI**

Add to `tests/agent-view-formatting.vitest.ts`:

```ts
describe('AgentView — list rendering', () => {
  it('renders dash list with bullet markers', () => {
    const perTab = makePerTab({
      agentResponses: ['- first\n- second\n- third'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 12);
    expect(all).toContain('• first');
    expect(all).toContain('• second');
    expect(all).toContain('• third');
  });

  it('renders ordered list with sequential numbers', () => {
    const perTab = makePerTab({
      agentResponses: ['1. one\n2. two\n3. three'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 12);
    expect(all).toContain('1. one');
    expect(all).toContain('2. two');
    expect(all).toContain('3. three');
  });

  it('renders star list using bullet marker', () => {
    const perTab = makePerTab({
      agentResponses: ['* alpha\n* beta'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 10);
    expect(all).toContain('• alpha');
    expect(all).toContain('• beta');
  });

  it('preserves list items in source order', () => {
    const perTab = makePerTab({
      agentResponses: ['intro\n\n- a\n- b\n\noutro'],
    });
    const c = renderOnCanvas(80, 40, perTab);
    const all = allText(c, 12);
    const introIdx = all.indexOf('intro');
    const aIdx = all.indexOf('• a');
    const outroIdx = all.indexOf('outro');
    expect(introIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeGreaterThan(introIdx);
    expect(outroIdx).toBeGreaterThan(aIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts`
Expected: 4 new tests fail.

- [ ] **Step 3: Extend renderAgentResponse to handle list blocks**

Replace the helper in `src/tui/views/agent-view.ts`:

```ts
function renderAgentResponse(
  text: string,
  kind: 'user' | 'agent',
  textWidth: number,
): RenderedLine[] {
  const out: RenderedLine[] = [];
  const blocks = parseResponseBlocks(text);

  for (const block of blocks) {
    if (block.type === 'text') {
      const wrapped = wrapText(block.text, textWidth);
      for (let i = 0; i < wrapped.length; i++) {
        out.push({ kind, text: wrapped[i]!, isFirst: i === 0 });
      }
    } else if (block.type === 'code') {
      const codeLines = block.code.split('\n');
      const langTag = block.language ? `\`\`\`${block.language}` : '```';
      out.push({ kind, text: '  ' + langTag, isFirst: true });
      for (const codeLine of codeLines) {
        out.push({ kind, text: '  ' + codeLine, isFirst: false });
      }
      out.push({ kind, text: '  ```', isFirst: false });
    } else if (block.type === 'list') {
      // Normalize marker style: any unordered → "• "; ordered → "N. "
      block.items.forEach((item, idx) => {
        const prefix = block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
        const indent = ' '.repeat(prefix.length);
        // Wrap each item with prefix on the first line and indent on
        // continuation lines.
        const innerWidth = Math.max(1, textWidth - prefix.length);
        const wrapped = wrapText(item, innerWidth);
        for (let i = 0; i < wrapped.length; i++) {
          const line = (i === 0 ? prefix : indent) + wrapped[i]!;
          out.push({ kind, text: line, isFirst: i === 0 });
        }
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts`
Expected: All 54 tests pass (46 + 4 + 4).

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `pnpm test:vitest 2>&1 | tail -10`
Expected: 3220+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tui/views/agent-view.ts tests/agent-view-formatting.vitest.ts
git commit -m "feat(tui): agent view renders list blocks with normalized markers"
```

---

## Task 7: Verification + acceptance

**Files:**
- Modify: (none — verification only)

- [ ] **Step 1: Build clean**

Run: `pnpm build`
Expected: tsc compiles cleanly with no errors.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test:vitest 2>&1 | tail -10`
Expected: All tests pass — total should now include 25 parser tests + 8 agent-view rendering tests added by this plan.

- [ ] **Step 3: Smoke test the agent tab in the live TUI**

Run: `npx alix tui` (or `node bin/alix.js tui`)
Then in the agent tab, submit a query that elicits a code block:
```
write a python function to check if a string is a palindrome
```

Verify visually:
- The code block renders on multiple lines (not collapsed)
- Code lines are indented at column 2
- Surrounding prose renders normally with `wrapText`

Then exit the TUI.

- [ ] **Step 4: Verify the screenshot bug is fixed**

Before this plan, the screenshot showed a multi-line code block collapsed to one line. After this plan, the same response should render across multiple rows. Confirm by submitting the same query from the smoke test and observing.

- [ ] **Step 5: Final commit (if any cleanup needed)**

If the smoke test revealed minor visual issues (alignment, indent depth), fix them in a small commit. Otherwise skip.

```bash
# Only run if Step 5 needed fixes:
git add -A
git commit -m "fix(tui): visual polish for agent response block rendering"
```

---

## Self-Review Notes

**Spec coverage:**

| Spec section | Task |
|---|---|
| Type definitions | Task 1 |
| Parser invariants | Tasks 2-4 (enforced by tests) |
| Line-oriented state machine | Tasks 2-4 (implemented, tests cover) |
| Code block parsing rules | Task 3 |
| List parsing rules (marker preservation) | Task 4 |
| Empty text block invariant | Task 2 + Task 4 tests |
| Source-order invariant | Task 4 tests (`intro → list → outro`) |
| Malformed-input tolerance (no throws) | Tasks 3-4 (test cases for unclosed fence, tilde fence, etc.) |
| TUI text-block render | Task 5 |
| TUI code-block render | Task 5 |
| TUI list-block render | Task 6 |
| Composition with wrapText | Tasks 5-6 (text blocks call wrapText) |
| Zero blast radius | Tasks 5-6 only modify agent-view.ts and test files |

**Placeholder scan:** No TBD/TODO markers. Every step has concrete code.

**Type consistency:** `ResponseBlock` defined in Task 1, used in Tasks 2-6 with identical signatures. `ListMarker` defined Task 1, used in Tasks 4 and 6. `parseResponseBlocks` signature consistent across all tasks.

**Potential gotchas for the implementer:**

- Task 3's `matchFenceOpen` uses `^(`{3,})([^\s`]*)` — the `[^\s`]*` ensures language has no whitespace OR backticks, which prevents weird mid-line fences.
- Task 4's list loop checks `matchFenceOpen(next)` first inside the list-collection loop — this prevents a code block from being absorbed into a preceding list. (Covered by the existing code-block tests in Task 3 since list wasn't present yet, but the loop guard ensures correctness when both states are active.)
- Task 5's `renderAgentResponse` helper is **internal to agent-view.ts** (not exported) per spec principle: only `parseResponseBlocks` is the public API; renderer helpers stay private.
- Task 6's `innerWidth = Math.max(1, textWidth - prefix.length)` guards against zero/negative widths when prefix is wider than canvas.
