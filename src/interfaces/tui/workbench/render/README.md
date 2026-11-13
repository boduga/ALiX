# Workbench Render Primitives

## Overview
Low-level frame-diffing and terminal-text primitives used by the ANSI Workbench renderer. `frame-differ.ts` compares a previously painted frame with a newly rendered one and produces minimal per-row patches plus the ANSI escape string that repaints them; `terminal-text.ts` re-exports the shared terminal text measurement helpers. Neither module performs I/O or owns renderer state.

## Interface
- `FramePatch` is a readonly `{ row, text }` pair describing one repainted row `[frame-differ.ts:FramePatch]`.
- `diffFrameRows(previous, next)` returns the `FramePatch` list for rows that changed `[frame-differ.ts:diffFrameRows]`.
- `renderFramePatches(patches)` converts patches into cursor-positioned, line-cleared ANSI output `[frame-differ.ts:renderFramePatches]`.
- `terminal-text.ts` re-exports `../../terminal-text.js` wholesale, which supplies `graphemes`, `isPrintableGrapheme`, `graphemeWidth`, `displayWidth`, `truncateDisplayText`, and `wrapDisplayText` `[terminal-text.ts:export]` `[../../terminal-text.ts:graphemes]` `[../../terminal-text.ts:graphemeWidth]` `[../../terminal-text.ts:displayWidth]` `[../../terminal-text.ts:truncateDisplayText]` `[../../terminal-text.ts:wrapDisplayText]`.
- No child contract directories exist.

## Invariants
- `diffFrameRows` strips exactly one trailing newline before splitting, so a frame ending in `\n` does not produce a phantom final row `[frame-differ.ts:diffFrameRows]`.
- When `previous` is `null`, every row of `next` is returned as a patch `[frame-differ.ts:diffFrameRows]`.
- The row count compared is the larger of the previous and next row counts; a row present only in the previous frame yields `text: ''`, clearing it `[frame-differ.ts:diffFrameRows]`.
- Only rows whose text differs are emitted, so an unchanged frame yields zero patches `[frame-differ.ts:diffFrameRows]`.
- `renderFramePatches` positions the cursor at `row + 1` (1-based), clears the line, then writes the row text `[frame-differ.ts:renderFramePatches]`.
- Rendering is pure string construction: no writes, timers, or global state `[frame-differ.ts:renderFramePatches]`.

## Side Effects
- ["None"]

## Verification
- Run: `pnpm test`
