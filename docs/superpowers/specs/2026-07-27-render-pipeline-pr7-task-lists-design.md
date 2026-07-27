# PR 7 — Task Lists Rendering

**Date:** 2026-07-27
**Status:** Design approved
**Base:** Render pipeline PR 6 (strikethrough, OSC-8, callouts, pipe tables)

## Overview

Add support for GFM task list items (`- [ ]` / `- [x]`) to the alix TUI render pipeline. Task lists extend the existing `list` `ResponseBlock` — no new block type, no nesting model, no interactive toggling.

## Design

### No new `ResponseBlock` type

Task lists are list items with a checkbox prefix. The existing `list` block carries an additional parallel array to indicate checkbox state:

```ts
// Add to the 'list' ResponseBlock variant:
| { type: 'list'; marker: 'unordered' | 'ordered'; items: readonly string[]; checked?: readonly boolean[] }
```

When `checked` is present, `checked[i]` corresponds to `items[i]`. When absent, the list renders as a regular list — no change to existing behavior.

### Parser (`parser.ts`)

In the list collection loop in `parseBlocks()`, after extracting each item's text:

```ts
const taskMatch = itemText.match(/^\[( |x|X)\]\s*/);
if (taskMatch) {
  itemText = itemText.slice(taskMatch[0].length);
  // Store checked state in a parallel array on the block
}
```

The `matchListItem()` function stays unchanged — it detects list markers. The task-check logic runs during list-item text collection in `parseBlocks()`.

Detection order: task check runs after the item prefix is stripped, before pushing the text onto the items array.

**Nesting:** Not modelled. A line `  - [ ] sub` under `- [ ] parent` starts a new list block, same as regular nested lists work today. Proper indent-based nesting is deferred.

### Theme (`types.ts` + `theme.ts`)

Add to `Theme` interface:

```ts
taskChecked: string;   // styled checkbox for completed items
taskUnchecked: string; // styled checkbox for incomplete items
```

Default implementation:

```ts
taskChecked: `\x1b[32m✓\x1b[0m`,     // green checkmark
taskUnchecked: `\x1b[90m[ ]\x1b[0m`,  // gray box
```

These are raw ANSI-wrapped strings (like `codeBorder`, `quoteBar`) — they stamp directly onto the row prefix, not wrapped around text.

### Renderer (`render.ts`)

In `renderList()`, when block has `checked` array:

```
# For checked items:
[✓] Task description

# For unchecked items:
[ ] Task description

# Without checkbox (no checked array — unchanged behavior):
• Regular list item
```

Implementation sketch:

```ts
function renderList(block, theme, width, isFirst) {
  const rows: StyledRow[] = [];
  block.items.forEach((item, idx) => {
    const checked = block.checked?.[idx];
    const prefix = checked !== undefined
      ? (checked ? theme.taskChecked + ' ' : theme.taskUnchecked + ' ')
      : block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
    const indent = ' '.repeat(/* prefix visible width */);
    // ... wrap and emit same as today
  });
  return rows;
}
```

Indent calculation must account for ANSI codes in the prefix (the checkbox strings are pre-styled). Use the existing ANSI_REGEX to strip before measuring.

### Edge cases

- `[ ]` with whitespace-only content — treats as task with empty text
- `[  ]` (two spaces) — not a valid marker, treated as regular text
- `[-]` / `[o]` / `[~]` — not recognized, renders as regular text
- Mixed: list items both with and without task markers — each item independent

### Files touched

| File | Change |
|------|--------|
| `types.ts` | Add `checked` to list ResponseBlock; add `taskChecked`, `taskUnchecked` to Theme |
| `parser.ts` | Add task-marker detection in list collection |
| `theme.ts` | Add `taskChecked`/`taskUnchecked` to defaultTheme |
| `render.ts` | Update `renderList()` to use checkbox prefix when `checked` present |

### Tests

**parser.vitest.ts** (4 cases):

| Input | Expected |
|-------|----------|
| `- [x] done` | list block with `checked: [true]`, item text "done" |
| `- [ ] todo` | list block with `checked: [false]` |
| `- [X] caps` | list block with `checked: [true]` |
| `- plain` | list block with no `checked` property |

**render.vitest.ts** (3 cases):

| Input | Expected |
|-------|----------|
| `- [x] done` | row prefix contains green `✓` |
| `- [ ] todo` | row prefix contains gray `[ ]` |
| Mixed: `- [x] a\n- b\n- [ ] c` | mixed prefixes |

### Total diff

~80 new lines across 4 source files + 2 test files. 0 new types. 0 refactoring. All existing tests remain green.
