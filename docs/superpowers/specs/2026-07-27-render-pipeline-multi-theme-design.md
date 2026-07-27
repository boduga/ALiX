# Multi-Theme Support

**Date:** 2026-07-27
**Status:** Design approved
**Base:** Render pipeline PR 6–8

## Overview

Add a second theme (light) and a theme selection mechanism to the alix TUI render pipeline. The `Theme` interface was designed for this — `defaultTheme`'s documentation reads "Single instance — the interface exists for future variants."

## Theme Registry (`src/tui/blocks/theme.ts`)

Export a registry and a resolver:

```ts
const themes: Record<string, Theme> = { dark: defaultTheme };

export function getTheme(name?: string): Theme {
  if (name && themes[name]) return themes[name];
  // Auto-detect: COLORFGBG=15;0 → light, anything else → dark
  const bg = process.env.COLORFGBG;
  if (bg) {
    const last = bg.split(';').pop();
    if (last && parseInt(last, 10) < 8) return themes.light ?? defaultTheme;
  }
  return defaultTheme;
}
```

CLI flag `--theme dark|light` sets the name; auto-detect is fallback.

## Light Theme

Key differences from `defaultTheme`:

| Property | dark (default) | light |
|----------|---------------|-------|
| `codeBorder` | GRAY | BLACK |
| `codeLangLabel` | bold+cyan | bold+cyan |
| `codeKeyword` | bold+magenta | bold (no color — stands out on light) |
| `codeString` | green | green |
| `codeComment` | dim | dim+gray |
| `codeFunction` | blue | blue |
| `quoteBar` | GRAY | BLACK |
| `quote` | dim | dim |
| `rule` | GRAY | BLACK |
| `link` | underline+blue | underline+blue |
| `heading(1)` | bold+cyan | bold+cyan |
| `heading(2)` | bold+green | bold+green |
| `heading(3)` | bold+yellow | bold+yellow |
| `taskChecked` | green✓ | green✓ |
| `taskUnchecked` | gray[ ] | gray[ ] |
| `tableBorder` | GRAY | BLACK |
| `calloutLabel(NOTE)` | bold+blue | bold+blue |

Light theme uses ANSI color codes 0–7 (standard) instead of 90–97 (bright) where possible, so they show on white backgrounds without being invisible. Accent colors (CYAN, YELLOW, BLUE, MAGENTA) remain the same across both themes — only border/gutter colors shift to BLACK for visibility on light backgrounds.

## CLI Wiring (`src/cli.ts`)

Add `--theme <name>` to `alix tui`:

```
alix tui --theme light
```

The parsed value is stored in the TUI config and passed to the render pipeline when creating views.

## View Wiring

All view renderers already accept `Theme` via `renderResponse(text, width, theme?)` — wait, let me check. `renderResponse` is:

```ts
export function renderResponse(text: string, width: number): StyledRow[] {
  return renderBlocks(parseBlocks(text), defaultTheme, width);
}
```

Change to:

```ts
export function renderResponse(text: string, width: number, theme: Theme = defaultTheme): StyledRow[] {
  return renderBlocks(parseBlocks(text), theme, width);
}
```

Views that call `renderResponse` without a theme argument continue to get `defaultTheme` — no existing code changes needed. Views that want theme support pass `ctx.config.theme`.

## Files Touched

| File | Change |
|------|--------|
| `theme.ts` | Add `lightTheme` object, `getTheme()` function, `themes` registry |
| `render.ts` | Add `theme` parameter to `renderResponse` (optional, default=`defaultTheme`) |
| `cli.ts` | Add `--theme` flag to `tui` command |
| TUI config/state | Store selected theme name |
| Views (agent, chat) | Pass `theme` from config to renderResponse when available |

## Tests

- `theme.vitest.ts`: `getTheme('dark')` returns defaultTheme, `getTheme('light')` returns lightTheme, `getTheme('unknown')` falls back to auto-detect, `getTheme()` with COLORFGBG=15;0 returns light
- `render.vitest.ts`: `renderResponse(text, width, lightTheme)` renders correctly (visual diff — smoke test)

## Total

~150 lines across 5 files. No refactoring. 100% backward compatible.
