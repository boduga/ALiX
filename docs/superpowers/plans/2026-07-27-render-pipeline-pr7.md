# PR 7 — Task Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GFM task list rendering (`- [x]` / `- [ ]`) to the alix TUI render pipeline by extending the existing `list` `ResponseBlock` with an optional `checked[]` array.

**Architecture:** Additive change to the existing `list` block type — no new block types, no nesting model. Parser detects `[x]`/`[ ]` prefix during list collection and sets `checked[]` on the block. Renderer uses the array to emit styled checkbox characters instead of bullet markers.

**Tech Stack:** TypeScript, vitest, ANSI SGR.

## Global Constraints

- Every commit must independently pass `npx vitest run tests/tui/blocks/` (baseline: 113 tests)
- Every commit must produce `npx tsc --noEmit`: 0 errors
- Production files bare `.ts`, imports use `.js`
- Test files import from `../../../src/tui/blocks/` with `.js`
- Use `describe` / `it` / `expect` vitest pattern
- All ANSI codes use shared constants from `src/tui/ansi-constants.ts` or the existing theme pattern (`taskChecked`/`taskUnchecked` are raw strings, not wrapped text — same as `codeBorder`/`quoteBar`)

---

### Task 1: Task list items

**Files:**
- Modify: `src/tui/blocks/types.ts` (add `checked` to list ResponseBlock, add `taskChecked`/`taskUnchecked` to Theme)
- Modify: `src/tui/blocks/parser.ts` (task marker detection in list collection)
- Modify: `src/tui/blocks/theme.ts` (default checkbox styling)
- Modify: `src/tui/blocks/render.ts` (checkbox prefix in renderList)
- Test: `tests/tui/blocks/parser.vitest.ts`
- Test: `tests/tui/blocks/render.vitest.ts`

**Interfaces:**
- Consumes: `ResponseBlock` kind `'list'` (existing, extended), `parseBlocks()` (existing, extended)
- Produces: list ResponseBlock with optional `checked: readonly boolean[]`

- [ ] **Step 1: Add `checked` to list ResponseBlock and `taskChecked`/`taskUnchecked` to Theme in `types.ts`**

Add to the existing `'list'` variant in `ResponseBlock`:
```ts
| { type: 'list'; marker: 'unordered' | 'ordered'; items: readonly string[]; checked?: readonly boolean[] }
```

Add to the `Theme` interface:
```ts
taskChecked: string;
taskUnchecked: string;
```

- [ ] **Step 2: Write failing parser tests**

In `tests/tui/blocks/parser.vitest.ts`, add:

```ts
describe('task lists', () => {
  it('parses - [x] as a checked task item', () => {
    expect(parseBlocks('- [x] done')).toEqual([
      { type: 'list', marker: 'unordered', items: ['done'], checked: [true] },
    ]);
  });

  it('parses - [ ] as an unchecked task item', () => {
    expect(parseBlocks('- [ ] todo')).toEqual([
      { type: 'list', marker: 'unordered', items: ['todo'], checked: [false] },
    ]);
  });

  it('parses - [X] (uppercase) as checked', () => {
    expect(parseBlocks('- [X] done')).toEqual([
      { type: 'list', marker: 'unordered', items: ['done'], checked: [true] },
    ]);
  });

  it('parses a plain list item without task marker (no checked property)', () => {
    const result = parseBlocks('- plain');
    expect(result[0]).not.toHaveProperty('checked');
  });
});
```

- [ ] **Step 3: Run parser tests to verify they fail**

```bash
npx vitest run tests/tui/blocks/parser.vitest.ts -t 'task lists'
```

Expected: FAIL — TypeScript compile errors or test failures because the parser doesn't detect task markers yet.

- [ ] **Step 4: Add task-marker detection to `parser.ts`**

In `parseBlocks()`, in the list block construction section, after the list items are collected, add task detection. After the `matchListItem` call and text extraction, insert:

In the list-handling block (around where `items` array is built), after the item text is extracted:

```ts
// In the items collection loop, after extracting itemText from matchListItem:
const taskMatch = itemText.match(/^\[( |x|X)\]\s*/);
let checked: boolean | undefined;
if (taskMatch) {
  checked = taskMatch[1] === 'x' || taskMatch[1] === 'X';
  itemText = itemText.slice(taskMatch[0].length);
}
// Store checked state; when building the block, track the parallel array
```

Collect the `checked` values into a `checkedItems: boolean[]` array. When pushing the block:

```ts
const listBlock: ResponseBlock = { type: 'list', marker, items };
if (checkedItems.length > 0) {
  (listBlock as any).checked = checkedItems;
}
blocks.push(listBlock);
```

- [ ] **Step 5: Add default checkbox styling to `theme.ts`**

In `defaultTheme`:
```ts
taskChecked: `${GREEN}✓${RESET}`,
taskUnchecked: `${GRAY}[ ]${RESET}`,
```

Import `RESET, GRAY, GREEN` from `../ansi-constants.js` (all three are already imported).

- [ ] **Step 6: Write failing render tests**

In `tests/tui/blocks/render.vitest.ts`, add:

```ts
describe('task lists', () => {
  it('renders checked task with green checkmark', () => {
    const blocks = parseBlocks('- [x] done');
    const rows = renderBlocks(blocks, defaultTheme, 60);
    expect(rows[0]!.text).toContain('\x1b[32m'); // green
    expect(rows[0]!.text).toContain('✓');
    expect(rows[0]!.text).toContain('done');
  });

  it('renders unchecked task with gray box', () => {
    const blocks = parseBlocks('- [ ] todo');
    const rows = renderBlocks(blocks, defaultTheme, 60);
    expect(rows[0]!.text).toContain('\x1b[90m'); // gray
    expect(rows[0]!.text).toContain('[ ]');
    expect(rows[0]!.text).toContain('todo');
  });

  it('renders mixed list with checkbox and plain items', () => {
    const blocks = parseBlocks('- [x] a\n- b\n- [ ] c');
    const rows = renderBlocks(blocks, defaultTheme, 60);
    expect(rows[0]!.text).toContain('✓');
    expect(rows[0]!.text).toContain('a');
    expect(rows[1]!.text).toContain('•');
    expect(rows[1]!.text).toContain('b');
    expect(rows[2]!.text).toContain('[ ]');
    expect(rows[2]!.text).toContain('c');
  });
});
```

- [ ] **Step 7: Run render tests to verify they fail**

```bash
npx vitest run tests/tui/blocks/render.vitest.ts -t 'task lists'
```

Expected: FAIL — renderList doesn't handle `checked` yet.

- [ ] **Step 8: Update `renderList()` in `render.ts`**

Replace the body of `renderList` to handle checkbox prefix:

```ts
function renderList(
  block: Extract<ResponseBlock, { type: 'list' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const rows: StyledRow[] = [];
  block.items.forEach((item, idx) => {
    const checked = block.checked?.[idx];
    let prefix: string;
    let prefixVisibleLen: number;
    if (checked !== undefined) {
      prefix = checked ? theme.taskChecked + ' ' : theme.taskUnchecked + ' ';
      prefixVisibleLen = 3; // visible width of checkbox marker
    } else {
      prefix = block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
      prefixVisibleLen = prefix.length;
    }
    const indent = ' '.repeat(prefixVisibleLen);
    const innerWidth = Math.max(1, width - prefixVisibleLen);
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
```

Note: `prefixVisibleLen` is a constant `3` for checkboxes because the ANSI codes are stripped by the canvas — the visible width is always `[ ] ` (3 chars). This is consistent with how the existing `'• '` (2 chars) and `'1. '` (variable) work.

- [ ] **Step 9: Run all tests**

```bash
npx vitest run tests/tui/blocks/
```

Expected: 113+ tests pass (existing + ~7 new). 0 failures.

- [ ] **Step 10: Type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
git add src/tui/blocks/types.ts src/tui/blocks/parser.ts src/tui/blocks/theme.ts src/tui/blocks/render.ts tests/tui/blocks/parser.vitest.ts tests/tui/blocks/render.vitest.ts
git commit -m "feat(tui): add GFM task list rendering

Extends the list ResponseBlock with an optional checked[] array.
Parser detects - [x] / - [ ] markers. Renderer emits green ✓
for checked, gray [ ] for unchecked. Regular lists unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] `checked` added to list ResponseBlock → Step 1
   - [x] `taskChecked`/`taskUnchecked` added to Theme → Step 1
   - [x] Parser detects `[x]`/`[X]`/`[ ]` → Step 4
   - [x] Renderer emits styled prefix → Step 8
   - [x] Default checkbox styling (green/gray) → Step 5
   - [x] Edge cases: no marker → no `checked` property → Step 4 guard
   - [x] Parser tests: checked, unchecked, uppercase, plain → Step 2
   - [x] Render tests: checked, unchecked, mixed → Step 6

2. **Placeholder scan:** Clean — no TBD, TODO, or incomplete steps.

3. **Type consistency:** `checked?: readonly boolean[]` used consistently in types.ts (Step 1) and consumed as `block.checked?.[idx]` in render.ts (Step 8). Method names match exactly.
