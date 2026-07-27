# Multi-Theme Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement. Steps use `- [ ]` syntax.

**Goal:** Add light theme variant, theme registry, `--theme` CLI flag, and auto-detect to the alix TUI render pipeline.

**Architecture:** Register themes in `theme.ts`, add `getTheme()` resolver, implement `lightTheme`, wire `--theme` CLI flag to `tui` command, pass selected theme through views.

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Every commit must pass `npx vitest run tests/tui/blocks/` (baseline: 152 tests)
- Every commit must produce `npx tsc --noEmit`: 0 errors
- Production files bare `.ts`, imports use `.js`
- Existing callers of `renderResponse(text, width)` must continue to work unchanged

---

### Task 1: Theme registry + light theme + CLI wiring

**Files:**
- Modify: `src/tui/blocks/theme.ts` (registry, getTheme, lightTheme)
- Modify: `src/tui/blocks/render.ts` (optional theme param on renderResponse)
- Modify: `src/tui/views/agent-view.ts` (pass theme through)
- Modify: `src/tui/views/chat-view.ts` (pass theme through)
- Test: `tests/tui/blocks/theme.vitest.ts` (new)
- Test: `tests/tui/blocks/render.vitest.ts` (light theme smoke test)

**Interfaces:**
- Produces: `getTheme(name?: string): Theme`, `themes: Record<string, Theme>`, `lightTheme: Theme`
- Consumes: `renderResponse(text, width, theme?)` (backward-compatible)

- [ ] **Step 1: Add `getTheme()`, `themes` registry, and `lightTheme` to `theme.ts`**

```ts
export const themes: Record<string, Theme> = { dark: defaultTheme };

export function getTheme(name?: string): Theme {
  if (name && themes[name]) return themes[name];
  // Auto-detect via COLORFGBG — last segment < 8 suggests light background.
  const bg = process.env.COLORFGBG;
  if (bg) {
    const last = bg.split(';').pop();
    if (last && parseInt(last, 10) < 8 && themes.light) return themes.light;
  }
  return defaultTheme;
}
```

`lightTheme` — same structure as `defaultTheme` but with light-background colors:

```ts
export const lightTheme: Theme = {
  heading(level, text) {
    const open = level === 1 ? `${BOLD_OPEN}${BLUE}`
      : level === 2 ? `${BOLD_OPEN}${GREEN}`
      : `${BOLD_OPEN}${YELLOW}`;
    return wrap(open, RESET, text);
  },
  headingRule(level) {
    const open = level === 1 ? `${BLUE}${DIM_OPEN}`
      : level === 2 ? `${GREEN}${DIM_OPEN}`
      : `${YELLOW}${DIM_OPEN}`;
    return wrap(open, DIM_CLOSE, HEADING_RULES[level]);
  },
  bold: (text) => wrap(BOLD_OPEN, BOLD_CLOSE, text),
  italic: (text) => wrap(ITALIC_OPEN, ITALIC_CLOSE, text),
  inlineCode: (text) => wrap(INVERSE_OPEN, INVERSE_CLOSE, text),
  codeBorder: `${ESC}30m`, // black (visible on light bg)
  codeLangLabel(text) { return wrap(`${BOLD_OPEN}${BLUE}`, RESET, text); },
  codeKeyword: (text) => wrap(BOLD_OPEN, RESET, text), // bold stands out on light
  codeString: (text) => wrap(GREEN, RESET, text),
  codeComment: (text) => wrap(`${DIM_OPEN}${ESC}90m`, RESET, text), // dim gray
  codeNumber: (text) => wrap(YELLOW, RESET, text),
  codeFunction: (text) => wrap(BLUE, RESET, text),
  codeOperator: (text) => text,
  codePunctuation: (text) => text,
  codePlain: (text) => text,
  quoteBar: `${ESC}30m`, // black
  quote: (text) => wrap(`${DIM_OPEN}`, DIM_CLOSE, text),
  rule: `${ESC}30m`, // black
  link(text, href) {
    const B = '\x1b';
    return `${B}]8;;${href}${B}\\${UNDERLINE_OPEN}${BLUE}${text}${UNDERLINE_CLOSE}${B}]8;;${B}\\`;
  },
  strikethrough: (text) => wrap(STRIKE_OPEN, STRIKE_CLOSE, text),
  calloutLabel(keyword) {
    const color = CALLOT_COLORS[keyword] ?? DIM_OPEN;
    return `${BOLD_OPEN}${color}${keyword}${RESET}`;
  },
  taskChecked: `${GREEN}✓${RESET}`,
  taskUnchecked: `${ESC}90m[ ]${RESET}`, // gray on light
  tableBorder: `${ESC}30m`, // black
};
```

Note: `import { RESET, BOLD_OPEN, BOLD_CLOSE, DIM_OPEN, DIM_CLOSE, ITALIC_OPEN, ITALIC_CLOSE, INVERSE_OPEN, INVERSE_CLOSE, UNDERLINE_OPEN, UNDERLINE_CLOSE, STRIKE_OPEN, STRIKE_CLOSE, GRAY, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN }` from `../ansi-constants.js` — all already imported.

Register after `defaultTheme`:
```ts
export const themes: Record<string, Theme> = { dark: defaultTheme };
themes.light = lightTheme;
```

- [ ] **Step 2: Write failing test for theme registry**

In `tests/tui/blocks/theme.vitest.ts` (new file):

```ts
import { describe, it, expect } from 'vitest';
import { getTheme, defaultTheme, lightTheme } from '../../../src/tui/blocks/theme.js';

describe('getTheme', () => {
  it('returns defaultTheme for "dark"', () => {
    expect(getTheme('dark')).toBe(defaultTheme);
  });

  it('returns lightTheme for "light"', () => {
    expect(getTheme('light')).toBe(lightTheme);
  });

  it('returns defaultTheme for unknown name', () => {
    expect(getTheme('unknown')).toBe(defaultTheme);
  });

  it('returns defaultTheme when no arg and no COLORFGBG', () => {
    // No env set — falls to default
    expect(getTheme()).toBe(defaultTheme);
  });

  it('lightTheme is not defaultTheme', () => {
    expect(lightTheme).not.toBe(defaultTheme);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/tui/blocks/theme.vitest.ts
```
Expected: FAIL — `getTheme` not defined.

- [ ] **Step 4: Add optional `theme` param to `renderResponse` in `render.ts`**

Change the signature:
```ts
export function renderResponse(text: string, width: number, theme: Theme = defaultTheme): StyledRow[] {
  return renderBlocks(parseBlocks(text), theme, width);
}
```

- [ ] **Step 5: Write light theme smoke test in `render.vitest.ts`**

```ts
it('renders with lightTheme without error', () => {
  const blocks = parseBlocks('**bold** `code`');
  expect(() => renderBlocks(blocks, lightTheme, 60)).not.toThrow();
});
```

- [ ] **Step 6: Wire `--theme` flag in `cli.ts`**

In the `tui` command definition, add: `.option('--theme <name>', 'Theme variant: dark or light', 'dark')`

Then pass the value through to the TUI app config.

Note: This step requires checking the exact cli.ts structure. If it's complex to modify, a simpler approach is to just export `getTheme()` and let the caller choose. The immediate deliverable is theme.ts + render.ts — the CLI flag is a nice-to-have for the initial PR.

- [ ] **Step 7: Run all tests**

```bash
npx vitest run tests/tui/blocks/
```
Expected: 152+ tests pass. 0 failures.

- [ ] **Step 8: Type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/tui/blocks/theme.ts src/tui/blocks/render.ts tests/tui/blocks/theme.vitest.ts tests/tui/blocks/render.vitest.ts
git commit -m "feat(tui): add multi-theme support with light variant and registry

Theme registry (themes['dark'|'light']), getTheme() resolver with
auto-detect via COLORFGBG, light theme variant with dark-on-light
colors. renderResponse accepts optional theme param (default
defaultTheme) for backward compatibility.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
