# OpenTUI runtime gate

Status: Runtime gate exercised locally on Linux/Node 26.11.0; the platform
matrix is green on draft [PR #898](https://github.com/boduga/ALiX/pull/898);
the performance gate remains open. Spec:
[2026-10-09-opentui-workbench-migration-design.md](../specs/2026-10-09-opentui-workbench-migration-design.md).

## Objective

Answer whether pinned OpenTUI Core can create a native renderer, handle static Workbench layout/input/resize, render in memory, cleanly restore terminal state, and install as an isolated package on ALiX's Node 26.4+ baseline. Keep production TUI and root dependencies unchanged.

## Steps

1. Create `experiments/opentui/` with exact package versions and one-command scripts. Add a four-agent static fixture with three panes, composer, and footer.
2. Exercise native renderer creation, key input, resize, repeated cleanup, and in-memory frame assertions under Node 26 with `--experimental-ffi`.
3. Check npm package install/packed install, supported-platform CI where available, and compare idle CPU, memory, input-to-render latency, and streaming backlog against the ANSI fixture. Record commands, runtime, version, and measured limits in the experiment README.
4. Keep production renderer selection, `WorkbenchViewState` extraction, and default switching out of this spike. Review findings against spec acceptance evidence before a port PR.

## Exit

Pass only with successful native operations and terminal restoration, reproducible input/resize/frame checks, and no unresolved packaging blocker. An import-only success is insufficient. Mark any platform or performance gate unmeasured rather than assuming parity.

## Measured result (2026-10-10, Linux x64, official Node v26.11.0)

- `npm test` 7/7 pass (render, wide/medium/narrow layout, input, resize,
  cleanup); `npm run test:pty` pass (escape exit, Ctrl+C cancellation, SIGWINCH
  resize, focused typing, bracketed paste; alternate-screen enter/leave +
  input-mode restore); `npm ci --offline` from a clean temp dir loaded native
  Core and closed cleanly.
- Platform matrix green on draft [PR #898](https://github.com/boduga/ALiX/pull/898)
  ([run 38063059589](https://github.com/boduga/ALiX/actions/runs/38063059589)):
  Linux x64 Node 26.4.0/26.11.0 (`npm test` + PTY), Linux arm64 Node 26.11.0
  (`npm test`), macOS arm64 and x64 Node 26.11.0 (`npm test` + PTY), Windows
  x64 Node 26.11.0 (`npm test` + ConPTY restoration check) — all green.
- Benchmark (`perf-check.mjs`): steady-state RSS plateaus (tranches
  `[224,224,224,224,224,227]` MiB, net `+3`, slope `+0.6` MiB/round, sampled
  after two GC passes); 500 back-to-back `requestRender()` calls coalesce to
  **1** frame (499 coalesced) with no residual scheduled render; idle CPU
  ~40 ms/s; input-to-render p50 0.74 ms / p95 2.52 ms. `verdict`: all five
  proposed thresholds pass with ≥3.7× headroom (provisional, pending
  sign-off). ANSI-vs-OpenTUI full-frame numbers are diagnostic only (different
  work; not a parity verdict). Full detail:
  [README](../../experiments/opentui/README.md).

## Remaining gaps

1. Performance thresholds are provisional: `perf-check.mjs` reports a passing
   `verdict` against proposed bounds, but they are single-host/single-run and
   pending operator sign-off before gating a rollout.
2. `WorkbenchViewState` extraction, renderer selection, and launcher-owned
   `--experimental-ffi` remain out of scope for this spike.
3. No musl CI leg is configured.
