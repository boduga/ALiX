# OpenTUI Workbench mouse-clicks handoff — Codex

Point-in-time handoff. Not a live contract. Supersedes nothing; the earlier
`docs/2026-10-11-opentui-workbench-mockup-handoff.md` is a sibling record for the
mockup-parity slice.

## Request chain

1. TUI should look like the preview image (`ALiX Workbench Terminal Preview.png`).
2. Scrolling live transcript broken.
3. "check target header font formatting".
4. "can i use mouse clicks" -> "add click support".
5. `/code-review` against `main`; then "fix all findings".
6. "i need a hand-off" — **the request that failed: model hit a usage limit
   before producing any handoff output.**

## Verified start point

- Branch: `feat/opentui-mouse-clicks` (checked out; not pushed status unknown).
- Committed ancestors: `008933b3 feat(tui): add native mouse clicks`,
  `8c0f3521 fix(tui): match preview header emphasis`, base merge `22bfbeb8`.
- HEAD = `008933b3`; the fixes below are **uncommitted**, in the working tree.
- `git diff main` = 9 files, +603/-59 (2 commits). Uncommitted slice = 6 files,
  +307/-44.

## Uncommitted work (this session, fixes the review findings)

Files modified (unstaged, nothing staged):

| File | Change |
|------|--------|
| `src/interfaces/tui/app.ts` | `routeWorkbenchClick` handles `approval.resolve` (identity-checked), `tab.next`, `task.select`, `artifact.select`, `artifact.open`; validates identity from the live snapshot. |
| `src/interfaces/tui/workbench/opentui/workbench-content.ts` | `OpenTuiClickAction` union extended (task/artifact/inspector/tab/approval). `tasksLines`/`artifactsLines`/`drawerLines` accept optional `clickTargets`. New `inspectorClickTarget`, `footerClickTarget`, `approvalClickTarget`. Toolbar text + hit ranges derived from one `toolbarSegments` source (fixes the duplicated-spacing judgment call). Approval card: index>0 decision row replaced with `Resolve oldest approval first`; click targets only on the oldest card. |
| `src/interfaces/tui/workbench/opentui/host.ts` | `onMouseUp` handlers for inspector, footer, approval regions. |
| `src/interfaces/tui/workbench/opentui/AGENTS.md` | Mouse contract bullet rewritten (one line). |
| `tests/tui/workbench/opentui-host.native.ts` | New tests: task/artifact row select, narrow task overlay, inspector+footer click, approval buttons resolve visible approval while covered panes blocked. |
| `tests/tui/workbench/renderer-seam.vitest.ts` | Stale task/artifact identity rejected. |

## Review findings status

From `/code-review` vs `main`:

- Standards — toolbar text vs click-range spacing duplicated → **fixed** (single
  `toolbarSegments` derivation).
- Spec P2 — task/artifact rows had no click targets → **fixed**.
- Spec P2 — approvals keyboard-only, host blocked clicks → **fixed** (buttons
  route through existing approval resolver; underlying clicks stay blocked).
- Review follow-up — later approval cards' approve/deny labels unclickable, and
  inspector filenames opened drawer without selecting file → **fixed** (last two
  edits, `4705`/`4706` in the session log).

All findings addressed. No open findings known from the last verified state.

## Verification state — **incomplete**

- Confirmed passing mid-session: build and native OpenTUI tests, after the core
  routing edit. **The final two edits (later-approval cards + inspector filename
  selection) were applied but tests were NOT re-run before the usage limit.**
- Do not claim any gate green. Re-run all of:

```bash
node -v
pnpm build
pnpm test:opentui
pnpm typecheck:unused
pnpm check:dead
node --test dist/tests/architecture/r1-boundary-freeze.test.js dist/tests/architecture/layer-boundaries.test.js
timeout 90 python3 scripts/opentui-pty-check.py
git diff --check
```

- `docs/2026-10-11-opentui-workbench-mockup-handoff.md` claims no local results
  either. Neither record certifies a gate.

## Next for the operator

1. Re-run the verification block above; the final two edits are unverified.
2. Decide staged slice: commit the 6-file mouse-fix slice (or fold into
   `008933b3`).
3. Run `detect_changes --scope all` before committing (AGENTS.md gate).
4. Confirm whether `feat/opentui-mouse-clicks` is pushed.

## Untracked working-tree noise (pre-existing, not from this task)

`Screenshot_2026-10-11_*.jpg`, `coordination-test/`, `docs/coord-test/`,
`docs/coordination-test/`, `test-coordination/`, `test/`, `tmp-coordination-a.txt`,
`tmp-coordination-b.txt`, `update-alix.sh`. Do not commit the screenshots unless
asked. Unknown provenance for the coordination/test dirs — inspect before staging.
