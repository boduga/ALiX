# TUI Tabs → Header Centerline (Claude-Code style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tab row from the top of the 5-row footer to the **middle of the 3-row header** as a third column on the existing content row. Footer remains otherwise unchanged.

**Architecture:** Single-source-of-truth header composition in `src/tui/frame-painter.ts`. The header (rows 0–2) becomes a single 3-zone row: `left metadata | center tabs | right metadata`. The tab-row code currently in the footer (lines 174-186) migrates to the header (row 1). Footer stays unchanged: top border (chat-view/agent-view at `vp.topBorderRow`), prompt row, bottom border (chat-view/agent-view at `vp.bottomBorderRow`), status row. The help-hints text (`↑/↓ navigate | tab next | ? help | q quit`) currently on the tab row stays where it is visually — but the tab row is moving, so the help-hints move with it. They become **right-aligned on the top border** (the dim grey line directly above the prompt), keeping their visual relationship to the input panel. Status row's pipeline fields (TOKENS, FILES, DAEMON, SOPS, RULES, EVENTS) shift to right-aligned — phase radios stay left of center if there's room, otherwise dropped.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, GitNexus MCP.

## Global Constraints

- **GitNexus impact gate (project CLAUDE.md):** BEFORE editing any symbol in `src/tui/`, run `mcp__gitnexus__impact({ target: "<symbol>", direction: "upstream" })` and report blast radius. Warn on HIGH/CRITICAL before proceeding. BEFORE every commit, run `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`.
- **`.js` import suffixes** on all relative imports (ESM).
- **Pre-existing CI failure (NOT a regression):** `pnpm test:node` fails on `renders ranked candidates with the selected marker` — verified pre-existing at `a425cd05` (main). This task touches `frame-painter.ts`; after each commit, diff the node-tests failure count against main. **Must remain 1.**
- **Visual smoke required:** the layout can't be verified from unit tests alone (lesson from PR #358). This plan includes a TUI visual-smoke step (Task 3) — Task 3's implementer runs the TUI in this environment if a TTY is available; otherwise the SDD workspace is deleted and the human partner runs the smoke during finishing-a-development-branch.
- **Behavior-preserving:** tab cycling, navigation, input, scrollback — all unchanged. Only render-position changes.
- **Branch policy:** single feature branch `tui/tabs-to-header` off `main` (currently `5749f2c4`). Close other branches before opening per project memory `branch-workflow-policy`.
- **Commit message trailer:** end each commit with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure (locked in before tasks)

- `src/tui/frame-painter.ts` — **Modify.** Header composition: add tab row to header row 1 (center column between left metadata + right metadata). Remove tab writes at lines 174-186 (footer row `dims.rows - FOOTER_H`). Help-hints text moves to the top border row. Status row: phase radios drop if they would collide; pipeline fields shift to right-aligned.
- `src/tui/views/scroll-math.ts` — **Verify only.** No constants change.
- Tests:
  - `tests/tui/views/chat-view-bottom-anchored.vitest.ts` — **Verify only.** No geometry change.
  - `tests/tui/views/agent-view-bottom-anchored.vitest.ts` — **Verify only.**
  - `tests/tui/views/scroll-math.vitest.ts` — **Verify only.**
  - `tests/agent-view-formatting.vitest.ts` — **Verify only.**
  - `tests/tui/plan-approval-card-render.vitest.ts` — **Verify only.**

---

## Task 1: Header composition — add centered tab row + relocate help-hints

**Files:** `src/tui/frame-painter.ts`

**Interface (current → target):**

```ts
// CURRENT (footer row dims.rows - FOOTER_H, lines 174-186):
let tabLine = '';
for (const id of TAB_ORDER) {
  const active = id === s.activeTab;
  tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
}
const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
const hintsLen = tabHintsVisible.length;
const tabRowBudget = Math.max(0, dims.columns - hintsLen - 1);
const tabText = tabLine.length <= tabRowBudget
  ? tabLine + ' '.repeat(tabRowBudget - tabLine.length)
  : tabLine.slice(0, tabRowBudget);
c.write(0, dims.rows - FOOTER_H, tabText);
c.write(dims.columns - hintsLen, dims.rows - FOOTER_H, `\x1b[90m${tabHintsVisible}\x1b[0m`);

// TARGET:
// 1. Compute the tab line (same loop, no hints suffix).
let tabLine = '';
for (const id of TAB_ORDER) {
  const active = id === s.activeTab;
  tabLine += active ? ` \x1b[7m ${id} \x1b[0m` : `  ${id}  `;
}
// 2. Center the tab line on the header content row (row 1).
const tabWidth = visibleWidth(tabLine); // strip ANSI escapes for length calc
const tabCol = Math.max(2, Math.floor((dims.columns - tabWidth) / 2));
c.write(tabCol, 1, tabLine);

// 3. Help-hints move to top border row (row 0 — the dim grey rule).
const tabHintsVisible = '↑/↓ navigate   |   tab next   |   ? help   |   q quit';
const hintsLen = tabHintsVisible.length;
// Write over the top border at the right edge, dim grey on grey — readable.
c.write(dims.columns - hintsLen, 0, `\x1b[90m${tabHintsVisible}\x1b[0m`);
// (Alternative: write hints on top border at the right edge.)
```

**Approach: extract a helper for visible-width** (stripping ANSI escapes), since the existing code on line 164 hand-counts `rightLen` by re-formatting `rightText` without color codes. Reuse the same trick.

- [ ] **Step 1: Impact gate.** `mcp__gitnexus__impact({ target: "FramePainter", direction: "upstream" })` — MEDIUM expected (real consumers: only `app.ts` via `framePainter.paintFullFrame()` and the TUI integration test). Proceed.
- [ ] **Step 2: Apply edits.** Three changes in `paintFullFrame()`:
   - (a) Compute `tabLine` once (move out of footer block).
   - (b) On row 1, write tabs centered between left + right metadata. Left metadata on row 1 already starts at col 2; right metadata already right-aligned via `dims.columns - rightLen`. Center is `Math.floor((dims.columns - tabWidth) / 2)` clamped to ≥ the rightmost column used by left metadata.
   - (c) Remove the footer tab-row writes (lines 174-186). Replace with `// tabs moved to header (row 1)`.
   - (d) Help-hints write at `dims.columns - hintsLen` on row 0 (top border).
- [ ] **Step 3: Tab-overflow fallback.** When the centered tab line would collide with the right metadata, truncate the tabs with `…` so right metadata stays intact (preferred over truncating right metadata).
- [ ] **Step 4: Typecheck.** `pnpm typecheck` — clean.
- [ ] **Step 5: Vitest subset.** `pnpm test:vitest -- tests/tui/app-pinned-bottom.vitest.ts tests/tui/views` — green. (No geometry tests for the header yet.)
- [ ] **Step 6: `detect_changes` + commit.**

```
refactor(tui): move tab row from footer to header row 1 (centered)

Header now reads as one row: left "ALiX TUI ..." | centered tabs
| right "ALiX v... │ Session ... │ Mode ...". Footer loses the tab
row at dims.rows - FOOTER_H. Help-hints text (↑/↓ navigate | ...)
moves to the top border row (right-aligned).

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Task 2: Right-align status-row pipeline fields; drop phase radios on overflow

**Files:** `src/tui/frame-painter.ts`

**Current** (lines 188-227): status row at `dims.rows - 1` writes `phaseLine + sep + fields` left-aligned starting at col 0. On the agent tab `phaseLine` adds 5 phase radios (UNDERSTANDING, PLANNING, EXECUTING, VERIFYING, SUMMARIZING) before the pipeline fields.

**Target:** Pipeline fields (TOKENS, FILES, DAEMON, SOPS, RULES, EVENTS) right-align to col `dims.columns - rightLen`. Phase radios drop from the status row entirely — they live on the agent tab, but the operator doesn't need them on the status row when they're already on the agent view's scrollback. If the user wants to keep them visible, that's a separate UX decision.

**If you choose to keep the phase radios** (TBD — see Step 1's question): they go on the left of the status row, but with the right-aligned fields, they'd compete for horizontal space. Plan A: write `phaseLine` left-aligned at col 0; write `fields` right-aligned at col `dims.columns - rightLen`. If `phaseLine.length + 1 + rightLen > dims.columns`, drop the phase radios entirely (same code path as non-agent tab today).

- [ ] **Step 1: Decision** — phase radios **stay** on the status row (per user confirmation). Pipeline fields right-align. Collision fallback: if `phaseLine.length + 1 + fieldsLen > dims.columns`, drop phase radios (degrade gracefully; rare on standard terminals).
- [ ] **Step 2: Apply edits.** Compute `fieldsText`, `fieldsLen`. Right-align: `c.write(Math.max(2, dims.columns - fieldsLen), dims.rows - 1, fieldsText)`. If keeping phase radios, write them at col 0 with the same overflow check.
- [ ] **Step 3: Typecheck.** Clean.
- [ ] **Step 4: Vitest subset.** Green.
- [ ] **Step 5: `detect_changes` + commit.**

```
refactor(tui): right-align status-row pipeline fields; drop phase radios

The status row was left-aligned and crowded. Phase radios are already
visible on the agent tab's scrollback, so the status row drops them
and right-aligns the pipeline fields (TOKENS, FILES, DAEMON, SOPS,
RULES, EVENTS) to free the left for agent view content.

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Task 3: Full verification + visual smoke

- [ ] **Step 1: Full vitest.** `pnpm test:vitest` — full suite green; expect 3819 passed / 7 skipped / 0 failed.
- [ ] **Step 2: Build + node-tests.** `pnpm build && pnpm test:node` — exactly **1** pre-existing failure (`renders ranked candidates with the selected marker`); no new failures.
- [ ] **Step 3: `detect_changes`.** `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — only `frame-painter.ts` (and possibly doc updates). LOW risk.
- [ ] **Step 4: `graphify update .`** per project CLAUDE.md.
- [ ] **Step 5: Visual smoke.** This task cannot be unit-tested — the new layout is a render change. Try `script -qc 'timeout 5 node /path/to/alix tui --theme light --mode bypass' /dev/null` (or equivalent) and capture the output. If the captured frame shows:
   - **Row 0**: top rule with `↑/↓ navigate | tab next | ? help | q quit` right-aligned
   - **Row 1**: `ALiX TUI - Interactive Session` left, tabs centered, `ALiX v... │ Session ... │ Mode ...` right
   - **Row 2**: bottom rule
   - **Footer (5 rows)**: top border above prompt, `alix>` / `alix-agent>` at `panelRow`, bottom border, status row right-aligned with TOKENS/FILES/DAEMON/SOPS/RULES/EVENTS
   then the change works. If a TTY isn't available, log a note in the report that visual smoke was deferred to the human partner's finishing-a-development-branch review.
- [ ] **Step 6: Stage + commit** any test/doc follow-ups if needed. (This task shouldn't add new commits beyond Tasks 1 + 2 unless the implementer finds a regression.)
- [ ] **Step 7: `gh pr create` against `main`** per `finishing-a-development-branch`.

---

## Verification (full pass before opening PR)

1. `pnpm typecheck` — clean.
2. `pnpm test:vitest` — full suite green.
3. `pnpm build && pnpm test:node` — exactly 1 pre-existing failure.
4. `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — only expected.
5. `graphify update .`
6. Visual smoke (Task 3 Step 5) — confirmed or deferred to human partner.
7. `gh pr create` against `main`, then request two-axis code review (Standards + Spec).

## Rollback

Two commits on the branch; each individually revertable via `git revert <commit>`.

## Critical files

- `src/tui/frame-painter.ts` — sole source of header + status row composition. Two edits: header row 1 (add tabs centered between metadata) and footer (remove tab row + help-hints); status row (right-align fields, drop or keep phase radios per Task 2 Step 1).

## Reuses

- **`TAB_ORDER`** in `src/tui/state.ts` (centralized per PR #356 standards-fix #1) — read directly, no new copy.
- **`computeViewport`** in `src/tui/views/scroll-math.ts` — unchanged. The header/footer rows are still `dims.rows - FOOTER_H` (top border), `dims.rows - FOOTER_H + 1` (prompt), etc. — frame-painter reads these for the tab row migration only via `dims.rows - FOOTER_H` (the old tab position, now empty).
- **Dim grey chrome** `\x1b[90m...\x1b[0m` pattern from `chat-view.ts` / `agent-view.ts` border rows — reuse for the help-hints on the top border.

## Known interactions / out of scope

- **Tab overflow on narrow terminals** — if `dims.columns < ~110`, tabs may exceed available center space. Truncate the tab list with `…` so right-aligned metadata stays intact. Defer 2-row wrap.
- **Phase radios on agent tab** — currently left-aligned in status row. After Task 2 (if radios dropped), they're only on the scrollback. If that's undesirable, Task 2's Step 1 question handles the decision.
- **Plan-approval card** — unchanged; still overlaps footer area by design.