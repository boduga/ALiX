# OpenTUI Workbench content handoff

Updated 2026-10-10 (America/Edmonton). Branch: `feat/opentui-native-layout`.

## Landed baseline

- `fec4b3b6` (`feat/opentui-launcher-groundwork`) prepared launcher-owned `--experimental-ffi` for explicit `alix tui --renderer opentui`. The selected renderer still exits with an unavailable error before terminal setup.
- `a0c2f7da` (`feat/opentui-native-layout`) added pinned production OpenTUI dependencies, retained native regions, responsive frame tests, and the native CI matrix. Pushed as `origin/feat/opentui-native-layout`.
- The ANSI canvas remains the default. OpenTUI does not yet own terminal input or display live snapshots.

The earlier [Node 26/OpenTUI handoff](2026-10-09-node26-opentui-handoff.md) explains the runtime gate and migration order. The approved [migration design](superpowers/specs/2026-10-09-opentui-workbench-migration-design.md) governs parity and the later default-switch decision.

## Content slice

The next reviewable piece is agent-roster and transcript content inside the retained layout. Slice paths:

- `src/interfaces/tui/workbench/opentui/workbench-content.ts` (new): mounts persistent roster, transcript, and roster-overlay `TextRenderable` nodes. Reads `WorkbenchViewState` slices; applies the existing run and transcript selectors; preserves unavailable roster state; clips content to computed pane geometry.
- `src/interfaces/tui/workbench/opentui/workbench-layout.ts`: exposes the latest computed geometry so content can size before OpenTUI's render pass.
- `tests/tui/workbench/opentui-layout.native.ts`: adds native frames for run/agent selection, filters, compact/detailed tool output, paused follow, short-window roster, unavailable state, and a very long transcript item.
- `src/interfaces/tui/workbench/opentui/AGENTS.md`: records content ownership and partial-slice contracts.

This is still a partial renderer slice. Task/artifact drawer bodies, approvals, transcript scroll controls, keyboard/paste routing, live snapshot wiring, and terminal lifecycle remain to be built; inspector and composer landed in the slice below. Keep the CLI's explicit unavailable exit until a complete selected renderer can own the terminal. Cross-renderer parity gates the later default switch.

## Review findings and current fix

Spec review found four gaps, now addressed in the working tree: paused follow, failed-only tool filtering under the error category, selected-run identity, and selected-agent visibility in a short roster.

Code-quality review found a high-risk long-item path: full wrapping plus `unshift(...wrapped)` could stall or throw on huge output. The latest edit bounds each item by visible pane size and inserts rows individually. It also freezes the last observed conversation snapshot while follow is paused, so append/filter/resize recompute from the same semantic history. The build and nine native tests pass after those edits. The bounded rendering and pause behavior were re-reviewed in closeout with no remaining gap.

## Verification

- `pnpm build` passed after the final bounded-rendering/pause changes.
- Direct Node 26 native run passed all 9 named tests after those changes.
- `pnpm typecheck:unused`, `pnpm check:dead`, and both architecture tests passed before the final changes, and again in closeout.
- `git diff --check` passed after the final changes and this handoff edit.
- The earlier committed layout slice passed build, native frames, shared composer/geometry tests, architecture tests, dependency-pin checks, and DOX audit.

Use the official Node 26.11.0 binary for local verification:

```bash
PATH=/tmp/alix-node26/node-v26.11.0-linux-x64/bin:$PATH pnpm build
PATH=/tmp/alix-node26/node-v26.11.0-linux-x64/bin:$PATH pnpm test:opentui
PATH=/tmp/alix-node26/node-v26.11.0-linux-x64/bin:$PATH pnpm typecheck:unused
```

The `pnpm test:opentui` wrapper reports one test file. Run `node --experimental-ffi dist/tests/tui/workbench/opentui-layout.native.js` directly under Node 26 to see each named assertion on failure.

## Closeout result

Committed as `3af27254` (`feat(tui): render OpenTUI roster and transcript`) on `feat/opentui-native-layout`.

1. Re-reviewed paused append followed by resize/filter, compact versus detailed output, selected-agent scope, short-window clipping, and the bounded long-output path. No remaining code-quality gap.
2. `pnpm build`, `pnpm test:opentui` (9/9), `pnpm typecheck:unused`, `pnpm check:dead`, both architecture tests (8/8), the `tests/tui` vitest set (1380/1380), and `git diff --check` all pass. DOX pass complete; the nearest owner `src/interfaces/tui/workbench/opentui/AGENTS.md` carries the content contracts.
3. Indexed the new source file, then GitNexus `detect-changes --scope all` reported 5 files / 19 symbols, 0 affected processes, low risk, not partial.

## GitNexus caveat

Before editing, `impact mountOpenTuiWorkbenchLayout --direction upstream` returned `UNKNOWN` with no resolved callers; text search found only the native test. `impact place --direction upstream` reported `CRITICAL` with 49 processes and 20 modules, including unrelated CLI/governance paths. Treat the warning as unresolved graph evidence, not an all-clear. Shared Workbench model and layout functions were left unchanged. The index reported one commit behind HEAD during this slice; it was refreshed before the closeout `detect-changes` run.

No PR has been opened for the content slice; it is committed on `feat/opentui-native-layout` as `3af27254`.

## Inspector and composer slice

The next reviewable piece added native inspector and composer content:

- `workbench-content.ts` now mounts retained inspector and composer `TextRenderable` nodes alongside roster/transcript/overlay. Inspector reuses the shared `buildAgentInspectorSections` builder and clips to the pane; composer renders the shared `layoutComposer` rows with the `>`/`…` prefix and the empty placeholder.
- `workbench-layout.ts` exposes the latest `ComposerLayout` (not just geometry) so content renders the same wrapped rows the layout sized.
- `tests/tui/workbench/opentui-layout.native.ts` adds inspector selection/aggregate frames and composer placeholder/draft/multiline frames (11 native tests).

Committed as `829e29cd` (`feat(tui): render OpenTUI inspector and composer`). Remaining view content: task/artifact drawer bodies, approvals, transcript scroll controls, then input routing, live snapshot wiring, and terminal lifecycle.

Verification: `pnpm build`; `pnpm test:opentui` 11/11; `pnpm typecheck:unused`; `pnpm check:dead`; both architecture tests 8/8; `tests/tui` vitest 1380/1380; `pnpm check:dox`; `git diff --check`. GitNexus `detect-changes --scope all` reported 4 files / 55 symbols, 0 affected processes, low risk, not partial. Anchored `impact` for `mountOpenTuiWorkbenchLayout`/`buildAgentInspectorSections` again returned NUL-corrupted, fuzzy-matched CRITICAL caller sets (the known resolver defect); text search confirms the only callers are the native test and `agent-view.ts` respectively.
