# Node 26 → OpenTUI hand-off

Updated 2026-10-10 (America/Edmonton). **Branch:** `spike/tui-opentui-runtime-gate`. [PR #898](https://github.com/boduga/ALiX/pull/898) is open (ready for review); every check on the PR is green.

## Landed prerequisite

[PR #896](https://github.com/boduga/ALiX/pull/896) merged at `f496c18abcf64b2fde40ac24e7215e8f04f89ad1`. ALiX requires Node `>=26.4.0`, pins `26.11.0` in `.nvmrc`, and uses ESM. The production TUI remains a custom ANSI canvas; there is no Blessed dependency.

## Scope: runtime spike + migration slices 1–3

The [migration design](superpowers/specs/2026-10-09-opentui-workbench-migration-design.md) approved an isolated experimental spike, and gates that spike on runtime, cleanup, packaging, and performance evidence. All four now pass, so PR #898 also carries the first three migration slices (renderer-neutral `WorkbenchViewState`; painter consumption + renderer selection; four-worker parity). The TUI [DOX contract](../src/interfaces/tui/AGENTS.md) and the as-built [spike plan](superpowers/plans/2026-10-10-opentui-runtime-gate.md) are updated with dated amendments.

Committed paths (PR #898):

- **Isolated spike** — `experiments/opentui/`: pinned `@opentui/core@0.5.17` + `web-tree-sitter@0.25.10`, lockfile, shared fixture (`workbench-fixture.mjs`), lifecycle (`harness.mjs`), static four-agent fixture, render/layout/input/resize/cleanup tests, Unix PTY checks (`pty-check.py`), Windows ConPTY check (`pty-check-win.py`), `perf-check.mjs`, child `AGENTS.md`, `README.md`.
- `.github/workflows/opentui-spike.yml` — Linux x64 26.4/26.11, Linux arm64, macOS arm64/x64, Windows x64; pinned action SHAs and `contents: read`.
- `scripts/check-package-manager.sh` — scoped exemption for the isolated npm lockfile.
- `AGENTS.md` — root Child DOX Index entry.
- **Production (slices 1–3)** — `src/interfaces/tui/workbench/view-state/` (`types.ts`, `assemble.ts`), `src/interfaces/tui/workbench/projections/conversation-cache.ts`, and consumption in `frame-painter.ts`, `views/agent-view.ts`, `views/types.ts`, `workbench/views/workbench-scrollback.ts`; `renderer` selection in `cli/commands/tui.ts` + `cli.ts`.
- **Tests** — `tests/tui/workbench/workbench-view-state.vitest.ts`, `tests/tui/workbench/view-state-parity.vitest.ts`, and the extended `tests/tui/workbench/four-worker-e2e.vitest.ts`.

No root dependency changed and the production renderer was **not** switched — the ANSI canvas remains the default. `experiments/opentui/node_modules/` is local install output and git-ignored; do not stage it.

## Local evidence

Used the official Node 26.11.0 binary at `/tmp/alix-node26/node-v26.11.0-linux-x64/bin/node`. The shell default `node` is still 24.x, so prepend that bin directory to `PATH` for spike commands.

- Spike: `npm test` 7/7; Unix PTY (Escape, Ctrl+C cancellation, SIGWINCH resize, focused typing/bracketed paste, terminal restoration); Windows ConPTY green in CI.
- Benchmark (`perf-check.mjs`): RSS plateaus; 500 `requestRender()` calls coalesce to 1 frame; idle CPU ~40 ms/s; input p50 0.74 / p95 2.52 ms; `verdict` passes all five **approved** thresholds (2026-10-10) with ≥3.7× headroom.
- Production: `pnpm typecheck`, `typecheck:unused`, `check:dead`, the R1/layer architecture tests, and all 1377 TUI tests pass; the four-worker parity tests pass.

## Gates and remaining work

1. **Runtime / cleanup / packaging / performance — pass.** Six-leg matrix green; thresholds approved. Caveat: performance evidence is single-host/single-run — widen across platforms before a rollout relies on it.
2. **Slices 1–3 landed.** Next: **slice 4 — production OpenTUI renderer** consuming `WorkbenchViewState`, single-terminal ownership, launcher-owned `--experimental-ffi`. Then a default-switch decision and canvas removal (later decisions, still gated on cross-renderer parity).
3. **Optional breadth** — no musl CI leg.

## Recommendation

Start with the **launcher groundwork** (the spec's named prerequisite for selected-renderer launch), not the renderer itself: make the bin launcher own `--experimental-ffi` re-exec and accept `--renderer opentui` end-to-end, with the OpenTUI path failing over **explicitly** (never silently rendering nothing) until the renderer lands. It is small, testable, and unblocks the renderer without committing to a large surface. Then build the renderer in reviewable pieces (layout → roster/transcript → inspector/composer → input routing), and only after that run the cross-renderer parity comparison and the default-switch decision.

Interaction parity is already well covered at the ANSI level (`input-router`, `composer-view`, `roster-shortcuts-integration`, `transcript-toolbar`, `coordination-entry`, and the 1377-test suite), so further ANSI-only parity tests have diminishing returns; the parity that is still unproven is cross-renderer and cannot exist until the renderer does.

## Suggested skills

- `gitnexus-work` — execute the launcher-groundwork plan with pre-edit impact checks and `detect_changes` gating each commit.
- `gitnexus-plan` — write an implementation-ready plan first.
- `tdd` — the launcher/selection change is small and test-first friendly.
- `caveman-commit` — commit-message style for this repo.
- `gitnexus-review` — review the diff before/after the renderer lands.

## GitNexus caveat for the next agent

`detect_changes` reports **CRITICAL** for `TuiOptions`/`FramePainter`/`AgentView` edits. The `TuiOptions` verdict is a **false positive**: the name is duplicated in the tracked scratch dump `docs/files-from-claude/runTui.ts`, and the resolver fuzzy-matches it; the real symbol has 2 references. Anchored impact for the classes is sane and confined to the TUI subsystem (`FramePainter` 6 direct / 1 module). Re-ran `analyze --force`; the index still stamps "behind" after rebuild (tool quirk). Treat compiler + tests as authoritative for these.

Current [OpenTUI runtime requirements](https://opentui.com/docs/getting-started/runtime-support/) specify Node 26.4+, ESM, and `--experimental-ffi`.
