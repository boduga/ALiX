# TUI Markdown Blocks

## Overview
The shared markdown response renderer for the terminal interface. It parses markdown into transport-independent `ResponseBlock` values, then lays those blocks out as ANSI-styled `StyledRow` rows. Both the ANSI transcript and the native OpenTUI transcript consume this module, so it is the single markdown implementation for the TUI.

## Interface
- Block model: `ResponseBlock`, `InlineSpan`, `Token`, `Theme`, `StyledRow`, and `Tokenizer` define the parser/renderer boundary [types.ts:ResponseBlock] [types.ts:Theme]
- `parseBlocks(md)` parses headings, fenced code, rules, quotes, lists/tasks, pipe tables, and text fallback [parser.ts:parseBlocks]
- `parseInline(text)` parses bold, italic, strikethrough, inline code, links, angle autolinks, bare URLs, and backslash escapes [inline.ts:parseInline]
- `tokenize(code, language?)` dispatches to a registered language tokenizer and falls back to `plainTokenizer` for unknown languages [tokenize.ts:tokenize]
- `renderBlocks(blocks, theme, width)` renders parsed blocks into `StyledRow[]`; `renderResponse(text, width, theme?)` parses and renders in one call [render.ts:renderBlocks] [render.ts:renderResponse]
- `defaultTheme`, `lightTheme`, `themes`, and `getTheme(name?)` provide the ANSI theme registry and environment-aware selection [theme.ts:defaultTheme] [theme.ts:getTheme]
- Language tokenizers: [./langs/README.md](./langs/README.md)

## Invariants
- `renderBlocks` is pure: the same blocks, theme, and width produce the same rows, with no I/O or mutation of inputs [render.ts:renderBlocks]
- Every block carrying raw markdown text must pass through `parseInline` before layout, including list items and table cells [render.ts:renderList] [render.ts:renderTable]
- Table column widths and padding are measured on ANSI-stripped visible text via `stripAnsi`, not on raw styled strings [render.ts:renderTable]
- Headings support levels 1-3 only; `HeadingLevel` excludes H4-H6 [types.ts:HeadingLevel]
- `parseBlocks` returns an empty array for blank input and treats an unclosed fence as a text block that consumes the remaining input [parser.ts:parseBlocks]
- Lists group only consecutive items sharing the same marker; task items recognize `[ ]`, `[x]`, and `[X]` [parser.ts:parseBlocks]
- Tables require a valid delimiter row and at least one data row; escaped pipes are preserved in cells [parser.ts:tryParseTable] [parser.ts:splitPipeCells]
- `parseInline` leaves unclosed formatting delimiters as literal text [inline.ts:parseInline]
- `getTheme` falls back to `defaultTheme` (dark) when no known name is supplied; `COLORFGBG` selects the light theme when its last segment is at least 8 [theme.ts:getTheme]
- Unknown code languages fall back to plain tokenization, and empty code returns no tokens [tokenize.ts:tokenize]

## Side Effects
- None: parsing and rendering allocate strings and arrays only and perform no disk, network, or shared-state writes [render.ts:renderResponse] [parser.ts:parseBlocks]
- `getTheme` reads `process.env.COLORFGBG` for auto-detection [theme.ts:getTheme]

## Verification
- Run: `pnpm test`
