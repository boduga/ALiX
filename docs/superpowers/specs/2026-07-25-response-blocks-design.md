# Structured Response Blocks — Phase 1 Design

**Date:** 2026-07-25
**Status:** Draft
**Author:** Claude (with boduga review)
**Scope:** Phase 1 only — types, parser, TUI render path

## Problem

The agent tab's response renderer treats every response as a flat string passed through `wrapText()`. Multi-line content (especially fenced code blocks) collapses to one line because `wrapText` was splitting on all whitespace.

Fix #1 (committed: `1b6bbed2`) preserved newlines, but the response is still rendered as plain text with no language awareness, no code-block borders, no list semantics. Every renderer (TUI today, Web/API tomorrow) would have to re-implement this Markdown parsing.

## Three Representations (The Key Insight)

```
LLM output (stream)
       │
       ▼
Markdown (canonical persisted artifact)
       │
       ▼
ResponseBlock[] (derived presentation model)
       │
       ▼
TUI / Web / CLI renderers
```

**Markdown is canonical. Blocks are derived.** Existing persistence, session resume, daemon protocol, and tests all keep working unchanged.

## Goals (Phase 1)

1. Fix code-block rendering in the TUI (the original bug)
2. Add structured `ResponseBlock` types so renderers stop parsing Markdown
3. Keep the parser as a pure function (`parseResponseBlocks(md: string)`)
4. Zero changes to `AgentTurnResult`, `PerTabState`, session persistence, or the daemon protocol
5. Compose with existing `wrapText` rather than replacing it

## Non-Goals (Phase 1)

- Block-aware streaming (`code.begin`, `text.delta` events)
- Persisting parsed blocks in UI state (memoization)
- Tables, headings-as-blocks, or other rich block types
- Syntax highlighting in the TUI
- Changing the Markdown producer (the LLM still emits Markdown)
- A canonical "plan" block type — plans stay on their dedicated path (`planContent` + `planTasks` + `.tasks.json`)

## Type Definitions

### `ResponseBlock` — discriminated union

```ts
export type ResponseBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] };
```

Three kinds, each a small literal object. No inheritance, no metadata envelope, no IDs.

### `parseResponseBlocks(md: string): readonly ResponseBlock[]`

A pure function. Same input → same output. No I/O, no logging, no side effects. Lives in `src/agent/response-blocks.ts`.

## Parser Rules (Intentionally Conservative)

### Code blocks

Recognize only fenced code blocks. The opening fence must be exactly three backticks at the start of a line, optionally followed by a language tag:

```
```python
def fib(n):
    return n if n < 2 else fib(n-1) + fib(n-2)
```
```

The closing fence is three backticks at the start of a line (no language tag, no content). Tilde fences (`~~~`) and longer fences are NOT supported in Phase 1.

Emits:
```ts
{ type: "code", language: "python", code: "def fib(n):\n..." }
```

### Lists

Recognize contiguous runs of bullet or numbered list items. A run ends at the first non-list line:

```
- Add router
- Update session
- Add tests
```

Becomes:
```ts
{ type: "list", ordered: false, items: ["Add router", "Update session", "Add tests"] }
```

Numbered lists (`1.`, `2.`) become `{ ordered: true, ... }`. Mixed lists in one run follow the first item's style.

### Text

Everything else is accumulated into `text` blocks, preserving line breaks. Headings remain text for now (`## Architecture` is a text block). Inline formatting (bold, italic, links) is preserved as-is — no parsing.

### Fallback

If the parser encounters any unexpected structure, it falls back to a single text block containing the entire input. The renderer can never crash on malformed Markdown:

```ts
export function parseResponseBlocks(md: string): readonly ResponseBlock[] {
  try {
    return parse(md);
  } catch {
    return [{ type: "text", text: md }];
  }
}
```

## Architecture

```
Agent response (markdown string from perTab.agentResponses[])
       │
       ▼
parseResponseBlocks()  ← src/agent/response-blocks.ts (pure)
       │
       ▼
renderBlocks()          ← src/tui/views/agent-view.ts (per-tab renderer)
       │
       ├── renderTextBlock()  ──→ wrapText() (existing, unchanged)
       │
       ├── renderCodeBlock()  ──→ preserve verbatim, indent 2 spaces
       │                          optional language header
       │                          no reflow, no wrap
       │
       └── renderListBlock()  ──→ wrap each item individually,
                                   preserve bullet/numbering style
```

The parser knows nothing about terminal width. The renderer knows nothing about Markdown syntax. Each piece does one job.

## Components

### 1. `src/agent/response-blocks.ts` (new, ~80 LOC)

```ts
export type ResponseBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function parseResponseBlocks(md: string): readonly ResponseBlock[];
```

Single exported function. State-machine line scanner. No regex heavy lifting beyond fence detection and bullet patterns.

### 2. `src/tui/views/agent-view.ts` (modified)

Replace the current flat `wrapText(t.text, textWidth)` loop with:

```ts
const blocks = parseResponseBlocks(t.text);
const rendered = renderBlocks(blocks, textWidth);
```

A small local `renderBlocks` helper (private to the file) handles block-type dispatch.

### 3. Tests (new)

- `tests/response-blocks-parser.vitest.ts` — unit tests for the parser
- `tests/agent-view-formatting.vitest.ts` — extend with block-rendering tests

## TUI Render Behavior

### Text block (delegates to wrapText)

```
Here's the code:
```

Wrapped via existing `wrapText(text, textWidth)`. Indented at column 2 for continuation lines.

### Code block (new)

```
  ```python
  def fib(n):
      return n if n < 2 else fib(n-1) + fib(n-2)
  ```
```

Indented 2 spaces. No wrapping. No word-splitting. Blank lines preserved. If the code exceeds canvas width, it gets hard-truncated (left edge stays, right edge clips) — no scrolling in Phase 1.

### List block (new)

```
  • Add router
  • Update session
  • Add tests
```

Each item individually wrapped via `wrapText`. Bullets (`•`) for unordered, digits+`.` for ordered. Continuation lines indent under the text (not under the bullet).

## Data Flow

### Existing (unchanged)

```
processTurn() → AgentTurnResult.summary → app.ts → perTab.agentResponses (string[])
```

### New (additive, parallel)

```
perTab.agentResponses[i] (string)
    │
    ▼
parseResponseBlocks(string)         [on every render, lazy, uncached]
    │
    ▼
renderBlocks(blocks, width)         [agent-view.ts, private helper]
    │
    ▼
canvas.write() cells
```

No persistence changes. No state shape changes. No streaming changes.

## Error Handling

- **Empty input** → returns `[]` (zero blocks). Caller decides whether to render nothing or a placeholder.
- **Malformed Markdown** (unclosed fence, etc.) → caught by try/catch, returns one `text` block with the entire input. Renderer renders it like plain text.
- **Unknown block type** in render dispatch → TypeScript exhaustiveness check at compile time. At runtime, the discriminated union makes this impossible.

## Testing Strategy

### Parser tests (`tests/response-blocks-parser.vitest.ts`)

Cover each block type in isolation:

| Test | Input | Expected |
|------|-------|----------|
| Empty input | `""` | `[]` |
| Plain prose | `"Hello world"` | `[{ type: "text", text: "Hello world" }]` |
| Single code block | `"```py\nx = 1\n```"` | `[{ type: "code", language: "py", code: "x = 1" }]` |
| Code without language | `"```\nx = 1\n```"` | `[{ type: "code", code: "x = 1" }]` |
| Mixed prose + code | text, code, text | 3 blocks in order |
| Bullet list | `"- a\n- b\n- c"` | `[{ type: "list", ordered: false, items: ["a", "b", "c"] }]` |
| Numbered list | `"1. a\n2. b"` | `[{ type: "list", ordered: true, items: ["a", "b"] }]` |
| List + code | bullet list followed by code | 2 blocks |
| Unclosed fence | `"```py\nx = 1"` (no closing) | falls back to single text block |
| Tilde fence (unsupported) | `"~~~py\nx = 1\n~~~"` | single text block |
| Multi-line code | `"```py\ndef f():\n    pass\n```"` | code block with embedded newlines |
| Lists with empty items | `"-\n- item"` | skipped empty item |

### Renderer tests (extend `tests/agent-view-formatting.vitest.ts`)

| Test | Expected |
|------|----------|
| Code block renders indented | First line indented at col 2 |
| Code block preserves newlines | 4-line code = 4 rows |
| List renders with bullets | Bullets at col 2, items indented |
| Numbered list | "1.", "2.", "3." prefixes |
| Text still uses wrapText | Long text wraps as before |
| Mixed blocks ordered correctly | text → code → text in input order |

## Success Criteria

1. The original screenshot bug (multi-line code collapsing to one line) is fixed with proper per-line rendering
2. `pnpm build` passes
3. All existing tests pass (3214+46)
4. New parser tests pass (~15 cases)
5. New renderer tests pass (~6 cases)
6. No change to `AgentTurnResult`, `PerTabState`, session files, or daemon protocol
7. No change to chat tab, approvals tab, or any non-agent view

## Migration Path (Future Phases)

### Phase 2 (deferred)
Block-aware streaming events: `code.begin(language)`, `code.delta(text)`, `code.end`, `text.begin`, `text.delta`. The TUI can render code blocks before the response completes.

### Phase 3 (only if profiling demands)
Memoize parsed blocks in UI state. Markdown stays the persisted source of truth; blocks become a cached derivation.

### Phase 4 (only if other renderers need it)
Expose `parseResponseBlocks` to the daemon protocol and Web UI. Same parser, different render targets.

None of these phases require changing the types or the parser API defined here.
