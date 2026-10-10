# Node 26 → OpenTUI hand-off

Updated 2026-10-10 (America/Edmonton). **Current branch:** `spike/tui-opentui-runtime-gate`. Work is uncommitted; a spike draft PR is being opened to run platform CI.

## Landed prerequisite

[PR #896](https://github.com/boduga/ALiX/pull/896) merged at `f496c18abcf64b2fde40ac24e7215e8f04f89ad1`. ALiX requires Node `>=26.4.0`, pins `26.11.0` in `.nvmrc`, and uses ESM. [Final CI run 38028717817](https://github.com/boduga/ALiX/actions/runs/38028717817) passed every PR gate, including supply-chain, node-tests, TUI smoke, macOS 26.4/26.11, and Windows 26.11. The production TUI remains a custom ANSI canvas; there is no Blessed dependency.

## Approved scope and working tree

The [migration design](superpowers/specs/2026-10-09-opentui-workbench-migration-design.md) is approved for an **isolated experimental spike** only. It names `WorkbenchViewState`, single-renderer terminal ownership, import boundaries, semantic/interaction parity, and a performance gate. The TUI [DOX contract](../src/interfaces/tui/AGENTS.md) records this exception. The [spike plan](superpowers/plans/2026-10-10-opentui-runtime-gate.md) is now an as-built record with measured result and remaining gaps.

Uncommitted paths:

- `src/interfaces/tui/AGENTS.md` — approved spike exception.
- `docs/superpowers/specs/2026-10-09-opentui-workbench-migration-design.md`, `docs/superpowers/plans/2026-10-10-opentui-runtime-gate.md`, and this hand-off.
- `experiments/opentui/` — pinned `@opentui/core@0.5.17` and `web-tree-sitter@0.25.10`, lockfile, static four-agent fixture, render/input/resize/cleanup tests, PTY cleanup check, `perf-check.mjs`, and `README.md` (setup, versions, results, benchmark limitations, support matrix, gaps).
- `.github/workflows/opentui-spike.yml` — proposed Linux Node 26.4/26.11, macOS 26.11, and Windows 26.11 matrix with a 20-minute timeout. It has **not run**.

`experiments/opentui/node_modules/` is local install output and ignored by Git. No root dependency or production renderer code changed. Do not accidentally stage generated dependencies.

## Local evidence

Used official Node 26.11.0 binary at `/tmp/alix-node26/node-v26.11.0-linux-x64/bin/node` (checksum verified during PR #896). The shell default `node` is still 24.21.0, so prepend that Node 26 bin directory to `PATH` for spike commands.

- `npm test --prefix experiments/opentui` passed four native in-memory tests: frame regions/four agents, focused input, resize, repeated cleanup.
- `npm run test:pty --prefix experiments/opentui` passed on Linux: live frame, Escape exit, alternate-screen enter/leave, and raw input-mode restoration.
- `npm ci --offline` from a clean temp directory loaded native Core and closed successfully.
- Root `pnpm build` passed on Node 26.11.0; needed only to make compiled ANSI canvas code available for the diagnostic benchmark.
- Improved `npm run bench --prefix experiments/opentui` (diagnostic, not a parity verdict): steady-state RSS **plateaus** across six tranches of 2,000 merges (`[170,167,167,167,167,168]` MiB; net `-2`; tail slope `+0.2` MiB/round); **500 back-to-back `requestRender()` calls coalesce to 2 frames** with no residual scheduled render (no accumulating backlog); idle CPU ~51 ms/s; input-to-render p50 **0.78 ms**, p95 **2.68 ms**. ANSI vs OpenTUI full-frame timings still do different work and are diagnostic only. Full detail in `experiments/opentui/README.md`.

## Remaining gates

1. **Run the platform matrix through the draft PR.** Linux 26.4, macOS arm64, and Windows native load/tests are unmeasured. Fix any packaging or test differences; the PTY check is Unix-only, so Windows terminal restoration is an explicit, unrecorded gap (add a ConPTY check or record it).
2. **Close the performance gate.** Current numbers are single-host/single-run with differently framed workloads. Define a comparable ANSI/OpenTUI workload and thresholds before any pass claim.
3. **Then, and only then**, extract renderer-neutral `WorkbenchViewState` and add selected-renderer launch with launcher-owned `--experimental-ffi`. Default switching and ANSI canvas removal remain later decisions.

Current [OpenTUI runtime requirements](https://opentui.com/docs/getting-started/runtime-support/) specify Node 26.4+, ESM, and `--experimental-ffi`.
