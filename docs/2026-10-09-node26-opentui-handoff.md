# Node 26 → OpenTUI hand-off

Updated 2026-10-10 (America/Edmonton). **Current branch:** `spike/tui-opentui-runtime-gate`. Committed; draft [PR #898](https://github.com/boduga/ALiX/pull/898) is open with the platform matrix green.

## Landed prerequisite

[PR #896](https://github.com/boduga/ALiX/pull/896) merged at `f496c18abcf64b2fde40ac24e7215e8f04f89ad1`. ALiX requires Node `>=26.4.0`, pins `26.11.0` in `.nvmrc`, and uses ESM. [Final CI run 38028717817](https://github.com/boduga/ALiX/actions/runs/38028717817) passed every PR gate, including supply-chain, node-tests, TUI smoke, macOS 26.4/26.11, and Windows 26.11. The production TUI remains a custom ANSI canvas; there is no Blessed dependency.

## Approved scope and spike contents

The [migration design](superpowers/specs/2026-10-09-opentui-workbench-migration-design.md) is approved for an **isolated experimental spike** only. It names `WorkbenchViewState`, single-renderer terminal ownership, import boundaries, semantic/interaction parity, and a performance gate. The TUI [DOX contract](../src/interfaces/tui/AGENTS.md) records this exception. The [spike plan](superpowers/plans/2026-10-10-opentui-runtime-gate.md) is now an as-built record with measured result and remaining gaps.

Committed paths (draft PR #898):

- `src/interfaces/tui/AGENTS.md` — approved spike exception.
- `docs/superpowers/specs/2026-10-09-opentui-workbench-migration-design.md`, `docs/superpowers/plans/2026-10-10-opentui-runtime-gate.md`, and this hand-off.
- `experiments/opentui/` — pinned `@opentui/core@0.5.17` and `web-tree-sitter@0.25.10`, lockfile, shared fixture (`workbench-fixture.mjs`), renderer lifecycle (`harness.mjs`), static four-agent fixture, render/layout/input/resize/cleanup tests, Unix PTY checks (`pty-check.py`), Windows ConPTY check (`pty-check-win.py`), `perf-check.mjs`, `AGENTS.md` (child DOX contract), and `README.md` (setup, versions, results, benchmark limitations, support matrix, gaps).
- `.github/workflows/opentui-spike.yml` — Linux x64 Node 26.4/26.11, Linux arm64, macOS arm64/x64, and Windows 26.11 matrix, pinned action SHAs and `contents: read`; green on PR #898 ([run 38063059589](https://github.com/boduga/ALiX/actions/runs/38063059589)).
- `scripts/check-package-manager.sh` — scoped exemption so the isolated npm lockfile (and its workflow/hand-off references) do not trip the pnpm-only policy.
- `AGENTS.md` — root Child DOX Index entry for `experiments/opentui/AGENTS.md`.

`experiments/opentui/node_modules/` is local install output and ignored by Git. No root dependency or production renderer code changed. Do not accidentally stage generated dependencies.

## Local evidence

Used official Node 26.11.0 binary at `/tmp/alix-node26/node-v26.11.0-linux-x64/bin/node` (checksum verified during PR #896). The shell default `node` is still 24.21.0, so prepend that Node 26 bin directory to `PATH` for spike commands.

- `npm test --prefix experiments/opentui` passed seven native in-memory tests: frame regions/four agents, wide/medium/narrow layout, focused input, resize, repeated cleanup.
- `npm run test:pty --prefix experiments/opentui` passed on Linux: live frame, Escape exit, Ctrl+C cancellation, SIGWINCH resize, and focused typing/bracketed paste, each with alternate-screen enter/leave and raw input-mode restoration.
- Windows terminal restoration is covered by `pty-check-win.py` (ConPTY via pywinpty) on the Windows CI leg; it cannot run on this Linux dev host.
- `npm ci --offline` from a clean temp directory loaded native Core and closed successfully.
- Root `pnpm build` passed on Node 26.11.0; needed only to make compiled ANSI canvas code available for the diagnostic benchmark.
- `npm run bench --prefix experiments/opentui` (diagnostic, not a parity verdict): steady-state RSS **plateaus** across six tranches of 2,000 merges (`[224,224,224,224,224,227]` MiB; net `+3`; tail slope `+0.6` MiB/round, two GC passes); **500 back-to-back `requestRender()` calls coalesce to 1 frame** with no residual scheduled render (no accumulating backlog); idle CPU ~40 ms/s; input-to-render p50 **0.74 ms**, p95 **2.52 ms**; `verdict` passes all five proposed thresholds with ≥3.7× headroom (provisional). ANSI vs OpenTUI full-frame timings do different work and are diagnostic only. Full detail in `experiments/opentui/README.md`.

## Remaining gates

1. **Sign off provisional performance thresholds.** `perf-check.mjs` now reports a passing `verdict` against proposed absolute bounds (spec amendment 2026-10-10), but they are single-host/single-run and need operator sign-off before gating a rollout.
2. **`WorkbenchViewState` slice 1 landed** (`src/interfaces/tui/workbench/view-state/`, tests in `tests/tui/workbench/workbench-view-state.vitest.ts`). The ANSI painter does not yet consume it and there is no CLI renderer selection. Slice 2 wires the painter onto the boundary and adds selected-renderer launch with launcher-owned `--experimental-ffi`; default switching and ANSI canvas removal remain later decisions.
3. **Optional platform breadth.** No musl CI leg is configured. Windows terminal restoration is verified green by `pty-check-win.py` (ConPTY via pywinpty) in CI; Linux arm64 and macOS x64 legs are now green too.

Current [OpenTUI runtime requirements](https://opentui.com/docs/getting-started/runtime-support/) specify Node 26.4+, ESM, and `--experimental-ffi`.
