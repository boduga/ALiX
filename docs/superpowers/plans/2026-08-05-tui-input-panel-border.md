# TUI Input Panel Border Frame (Claude-Code style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a horizontal border line above AND below the TUI input panel prompt (chat + agent tabs), full terminal width, matching Claude Code's framing.

**Architecture:** Single feature change on one branch. The footer grows from 3 rows to 5 rows: `[tab row, ─ top border ─, prompt, ─ bottom border ─, status row]`. Scrollback dimensions unchanged. The prompt's row position is decoupled from `FOOTER_H` via a new `BELOW_PROMPT_ROWS` constant so future footer additions don't drift the prompt outside the footer. Border rows are drawn by the two prompt-bearing views (chat + agent) using dim grey `\x1b[90m…\x1b[0m` chrome, reusing the same styling as `agent-view.ts:44`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, GitNexus MCP for impact gates.

## Global Constraints

- **GitNexus impact gate (project CLAUDE.md):** BEFORE editing any symbol in `src/tui/`, run `mcp__gitnexus__impact({ target: "<symbol>", direction: "upstream" })` and report blast radius. Warn on HIGH/CRITICAL before proceeding. BEFORE every commit, run `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` and confirm only expected symbols/flows affected.
- **Preserve behavior exactly except where the layout change requires test recomputation.** The test suites `tests/tui/*.vitest.ts` and `tests/tui/views/*.vitest.ts` must pass after the change; tests that hardcode `rows-3`/`rows-4` literals for the prompt or scrollback bottom are updated to the new geometry (this is documented per-file below).
- **`.js` import suffixes** on all relative imports (ESM).
- **Pre-existing CI failures (NOT regressions):** `pnpm test:node` currently fails on `AgentView slash strip` → `renders ranked candidates with the selected marker` — verified pre-existing at `a425cd05` (main). This task touches `agent-view.ts`; after each commit, diff the node-tests failure count against main. If the count changes, you introduced a regression.
- **Run `graphify update .`** after implementation (project CLAUDE.md).
- **Branch policy:** single feature branch `tui/input-panel-border` off `main`; close other branches before opening per project memory `branch-workflow-policy`. Base = `main` after PR #356 merged (`88264b79`).
- **Commit message trailer:** end each commit with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure (locked in before tasks)

- `src/tui/views/scroll-math.ts` — **Modify.** `FOOTER_H: 3 → 5`; add `BELOW_PROMPT_ROWS = 2`; extend `Viewport` interface with `topBorderRow` + `bottomBorderRow`; rewrite `computeViewport` formula.
- `src/tui/views/chat-view.ts` — **Modify.** Add horizontal border overwrites at `vp.topBorderRow` and `vp.bottomBorderRow`.
- `src/tui/views/agent-view.ts` — **Modify.** Same border overwrites; slash overlay continues to render below `panelRow` unchanged.
- `src/tui/frame-painter.ts` — **Verify only.** Tab row already uses `dims.rows - FOOTER_H`; status row at `dims.rows - 1`; cursor placement follows `vp.panelRow`/`vp.promptCol`. No code change expected.
- `tests/tui/views/chat-view-bottom-anchored.vitest.ts` — **Modify.** `panelRow(height)` helper shifts formula; comment literals updated.
- `tests/tui/views/agent-view-bottom-anchored.vitest.ts` — **Modify.** Hardcoded row filter shifts.
- `tests/tui/views/scroll-math.vitest.ts` — **Modify.** `bottomAnchor` expectation recomputed against new `scrollbackRows`.
- `tests/tui/plan-approval-card-render.vitest.ts` — **Modify.** Local `FOOTER_H = 3` shifts to 5; row literals shift.
- `tests/tui/dashboard-renderer.vitest.ts` — **Verify only.** Any `rows-3`/`rows-4` assertions shift by -2 if they exist.

---

## Task 1: Layout constants + `computeViewport` rewrite

**Files:**
- Modify: `src/tui/views/scroll-math.ts`

**Interface:**

```ts
export const HEADER_H = 3;
export const FOOTER_H = 5;                    // was 3
export const BELOW_PROMPT_ROWS = 2;           // NEW: bottom-border + status row
export const PANEL_H = 0;
export const SCROLLBACK_TOP_AGENT = 6;
export const SCROLLBACK_TOP_CHAT = 5;

export interface Viewport {
  headerRows: number;
  footerRows: number;        // = FOOTER_H (= 5)
  panelRows: number;
  panelRow: number;          // = dims.rows - BELOW_PROMPT_ROWS (= rows - 3)
  topBorderRow: number;      // NEW = dims.rows - FOOTER_H + 1 (= rows - 4)
  bottomBorderRow: number;   // NEW = dims.rows - BELOW_PROMPT_ROWS + 1 (= rows - 2)
  scrollbackTop: number;
  scrollbackBottom: number;  // = topBorderRow - 1 (= rows - 5)
  scrollbackRows: number;
  textWidth: number;
  promptCol: number;
}

export function computeViewport(
  dims: { columns: number; rows: number },
  kind: 'agent' | 'chat',
): Viewport {
  const topBorderRow = dims.rows - FOOTER_H + 1;
  const bottomBorderRow = dims.rows - BELOW_PROMPT_ROWS + 1;
  const panelRow = dims.rows - BELOW_PROMPT_ROWS;
  const scrollbackTop = kind === 'agent' ? SCROLLBACK_TOP_AGENT : SCROLLBACK_TOP_CHAT;
  const scrollbackBottom = topBorderRow - 1;
  return {
    headerRows: HEADER_H,
    footerRows: FOOTER_H,
    panelRows: PANEL_H,
    panelRow,
    topBorderRow,
    bottomBorderRow,
    scrollbackTop,
    scrollbackBottom,
    scrollbackRows: Math.max(0, scrollbackBottom - scrollbackTop + 1),
    textWidth: Math.max(0, dims.columns - 4),
    promptCol: kind === 'agent' ? 13 : 7,
  };
}
```

`computeBottomAnchor` is unchanged — it already consumes `vp.scrollbackRows`.

- [ ] **Step 1: Impact gate.** Run `mcp__gitnexus__impact({ target: "computeViewport", direction: "upstream" })`. Report blast radius; warn on HIGH/CRITICAL before proceeding.
- [ ] **Step 2: Apply edits.** Edit `src/tui/views/scroll-math.ts`: change `FOOTER_H = 3` to `FOOTER_H = 5`; add `BELOW_PROMPT_ROWS = 2`; add `topBorderRow` + `bottomBorderRow` to `Viewport` interface; rewrite `computeViewport` body per above.
- [ ] **Step 3: Typecheck.** Run `pnpm typecheck`. Expected: FAIL with errors at every site that reads `vp.scrollbackBottom` or writes to old rows — that's expected; we'll fix downstream in Task 2 + Task 3. If errors are only in `src/tui/views/scroll-math.ts` itself, fix them before continuing.
- [ ] **Step 4: Viewport consumers update.** Run `grep -n "vp\.scrollbackBottom\|vp\.panelRow\|vp\.promptCol" src/tui/ -r` to confirm the views/frame-painter are the only consumers; Task 2 fixes the views, Task 3 verifies frame-painter.
- [ ] **Step 5: Commit.**

```bash
git add src/tui/views/scroll-math.ts
git commit -m "refactor(tui): extend footer to 5 rows, decouple prompt row via BELOW_PROMPT_ROWS

Adds topBorderRow + bottomBorderRow to Viewport so chat/agent views
can render the input-panel frame. computeBottomAnchor unchanged —
it reads vp.scrollbackRows which propagates correctly.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add border renders to chat + agent views

**Files:**
- Modify: `src/tui/views/chat-view.ts`
- Modify: `src/tui/views/agent-view.ts`

**Render rule:** at `vp.topBorderRow` and `vp.bottomBorderRow`, write a full-width dim grey horizontal rule using `\x1b[90m` and `\x1b[0m` (matching the existing pattern at `agent-view.ts:44`). Rule character is `─` (U+2500).

**Chat-view** — after the existing prompt writes at `vp.panelRow` (lines 52–54), add:

```ts
// Frame the input panel: horizontal rules above and below the prompt
// (Claude-Code style — `─` chars full width in dim grey).
const BORDER = `\x1b[90m${'─'.repeat(ctx.dimensions.columns)}\x1b[0m`;
c.write(0, vp.topBorderRow, BORDER);
c.write(0, vp.bottomBorderRow, BORDER);
```

**Agent-view** — same two writes, placed just before the slash overlay block at lines 86–89. Same `BORDER` definition.

- [ ] **Step 1: Impact gate.** `mcp__gitnexus__impact({ target: "ChatView", direction: "upstream" })` and same for `AgentView`. MEDIUM expected (just the views' consumers — frame-painter + a few tests).
- [ ] **Step 2: Apply chat-view edit.** Add the two border writes after the existing prompt block.
- [ ] **Step 3: Apply agent-view edit.** Add the same two border writes immediately before the slash overlay block.
- [ ] **Step 4: Typecheck.** Run `pnpm typecheck`. Expected: clean now (or only test-side errors remain).
- [ ] **Step 5: Run views tests.** Run `pnpm test:vitest -- tests/tui/views`. Expected: `bottom-anchored` tests for chat + agent will FAIL (hardcoded row numbers) — that's expected; fix in Task 3.
- [ ] **Step 6: Verify frame-painter.** Run `git diff main -- src/tui/frame-painter.ts` — should be empty (no edit needed). If not, fix the geometry per the plan's note (`dims.rows - FOOTER_H` for tabs and `dims.rows - 1` for status still work).
- [ ] **Step 7: `detect_changes` + commit.**

```bash
mcp__gitnexus__detect_changes({scope: "compare", base_ref: "main"})
git add src/tui/views/chat-view.ts src/tui/views/agent-view.ts
git commit -m "feat(tui): frame chat + agent input panels with top/bottom border (Claude-Code style)

Dim grey full-width horizontal rules at vp.topBorderRow and
vp.bottomBorderRow around the prompt. Scrollback unchanged; footer
extends from 3 to 5 rows.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Update tests for new geometry + run full verification

**Files:**
- Modify: `tests/tui/views/chat-view-bottom-anchored.vitest.ts`
- Modify: `tests/tui/views/agent-view-bottom-anchored.vitest.ts`
- Modify: `tests/tui/views/scroll-math.vitest.ts`
- Modify: `tests/tui/plan-approval-card-render.vitest.ts`
- Verify: `tests/tui/dashboard-renderer.vitest.ts`

- [ ] **Step 1: chat-view helper update.** In `tests/tui/views/chat-view-bottom-anchored.vitest.ts:17-19`, change the local `panelRow(height)` helper from `Math.max(0, h - 3 - 0 - 1)` to either import `BELOW_PROMPT_ROWS` from `../../src/tui/views/scroll-math.js` and write `Math.max(0, h - BELOW_PROMPT_ROWS)`, or inline `Math.max(0, h - 2)`. Update comment lines 55-56, 92-93 that say "panelRow=26 for rows=30" → "panelRow=27 for rows=30".
- [ ] **Step 2: agent-view filter update.** In `tests/tui/views/agent-view-bottom-anchored.vitest.ts:53`, change `writes.filter((w) => w.y === 27)` to the new panel row. With `rows=30`, `BELOW_PROMPT_ROWS=2`, the new `panelRow = 28`. If the test uses a different `rows`, recompute.
- [ ] **Step 3: scroll-math recompute.** In `tests/tui/views/scroll-math.vitest.ts`, find the agent `bottomAnchor` expectation (~line 61-63). With `rows=30`, `FOOTER_H=5`, `BELOW_PROMPT_ROWS=2`, `SCROLLBACK_TOP_AGENT=6`: `topBorderRow = 26`, `scrollbackBottom = 25`, `scrollbackRows = 20`. If the prior expectation was 179 (= `allLines.length - 20` with `allLines.length=199`), the new expectation is also 179. If a different `rows` value is used, recompute as `max(0, allLines.length - scrollbackRows)` where `scrollbackRows = scrollbackBottom - scrollbackTop + 1`. Update the comment.
- [ ] **Step 4: plan-approval card.** In `tests/tui/plan-approval-card-render.vitest.ts:16-17,33`, change local `const FOOTER_H = 3` to `5`; update comment `24-3-4=17` → `24-5-4=15` (card top stays the same — it's still anchored `rows - FOOTER_H - 4`, just `FOOTER_H` is now 5 → card top = 15 instead of 17). Update any `rows[20]` literals that referred to card-row content.
- [ ] **Step 5: dashboard renderer audit.** `grep -n "rows-3\|rows-4\|FOOTER_H" tests/tui/dashboard-renderer.vitest.ts`. If any `rows-3`/`rows-4` literals exist for body height or panel positioning, shift by -2. The body's top stays `HEADER_H`; the bottom shifts from `rows - FOOTER_H - 1` (now `rows - 6` instead of `rows - 4`).
- [ ] **Step 6: Full verification.**
  1. `pnpm typecheck` — clean.
  2. `pnpm test:vitest` — full suite green; expect 3819+ pass / 7 skip.
  3. `pnpm build && pnpm test:node` — exactly 1 pre-existing `AgentView slash strip` failure; no new failures.
  4. `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — only `scroll-math.ts`, `chat-view.ts`, `agent-view.ts`, `computeViewport` consumers, and the affected test files. MEDIUM risk expected.
  5. `graphify update .`
- [ ] **Step 7: Visual smoke.** Open `node /path/to/alix tui --theme light --mode bypass` in a terminal ≥ 30 rows. Confirm:
  - Chat tab: 5-row footer with two thin grey rules sandwiching the prompt.
  - Agent tab: same frame; slash strip renders below the prompt on a tall terminal.
  - Cursor sits at the prompt position; typing shows buffer at correct column.
- [ ] **Step 8: `gh pr create` + request code review** (two-axis Standards + Spec per project convention).

---

## Verification (full pass before opening PR)

Run in order:
1. `pnpm typecheck` — clean.
2. `pnpm test:vitest` — full suite green.
3. `pnpm build && pnpm test:node` — confirm exactly **1** pre-existing failure (`AgentView slash strip`), no new failures.
4. `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — only expected symbols/flows.
5. `graphify update .`
6. Visual smoke (Task 3 Step 7).
7. `gh pr create` against `main` per `finishing-a-development-branch`, then request two-axis code review.

## Rollback

Single feature branch; each commit individually revertable:
- `git revert <commit>` for the layout constants, the view edits, or the test updates.