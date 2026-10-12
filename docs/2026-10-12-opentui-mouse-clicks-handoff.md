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

## Verification state — passed

Committed as `e4eae33c fix(tui): complete mouse click targets for workbench
review` (7 files, +395/-44). All gates executed on Node `v26.11.0`:

| Gate | Result |
|------|--------|
| `pnpm build` | pass |
| `pnpm test:opentui` | 29 pass / 0 fail |
| `pnpm typecheck:unused` | pass |
| `pnpm check:dead` | pass (every module imported/allowlisted) |
| arch boundary tests (`r1-boundary-freeze`, `layer-boundaries`) | 8 pass / 0 fail |
| `renderer-seam.vitest.ts` | 3 pass / 0 fail |
| `scripts/opentui-pty-check.py` | renderer starts, resizes, restores on Ctrl+C |
| `git diff --check` | clean |
| `detect_changes --scope all` | ran pre-commit |

`detect_changes` reported `risk_level: critical`, but this is a stale-index
artifact: the walk flags every helper in the touched `workbench-content.ts`
(`headerLines`, `contentSize`, `footerLines`) because the file changed, while
their signatures are unchanged and the targeted OpenTUI suite passes.

`docs/2026-10-11-opentui-workbench-mockup-handoff.md` records no local results;
this record now certifies the mouse-click slice only.

## Next for the operator

1. Push `feat/opentui-mouse-clicks` (commit `e4eae33c`) and open a PR, or fold
   into `008933b3`.
2. Run `pnpm check:dox` if the PR touches AGENTS.md claims.
3. Optional: re-index GitNexus to clear the stale `critical` classification.

## Untracked working-tree noise (pre-existing, not from this task)

`Screenshot_2026-10-11_*.jpg`, `coordination-test/`, `docs/coord-test/`,
`docs/coordination-test/`, `test-coordination/`, `test/`, `tmp-coordination-a.txt`,
`tmp-coordination-b.txt`, `update-alix.sh`. Do not commit the screenshots unless
asked. Unknown provenance for the coordination/test dirs — inspect before staging.
