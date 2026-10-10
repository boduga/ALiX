# OpenTUI runtime gate

Status: Runtime gate exercised on Linux/Node 26.11.0; platform CI and the
performance gate remain open. No PR yet. Spec:
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

- `npm test` 4/4 pass (render, input, resize, cleanup); `npm run test:pty` pass
  (alternate-screen enter/leave + input-mode restore); `npm ci --offline` from
  a clean temp dir loaded native Core and closed cleanly.
- Benchmark (`perf-check.mjs`): steady-state RSS plateaus (tranches
  `[170,167,167,167,167,168]` MiB, net `-2`, slope `+0.2` MiB/round); 500
  back-to-back `requestRender()` calls coalesce to 2 frames with no residual
  scheduled render; idle CPU ~51 ms/s; input-to-render p50 0.78 ms / p95
  2.68 ms. ANSI-vs-OpenTUI full-frame numbers are diagnostic only (different
  work; not a parity verdict). Full detail:
  [README](../../experiments/opentui/README.md).

## Remaining gaps

1. Platform CI (Linux 26.4, macOS, Windows, musl) has not run; Windows has no
   terminal-restoration check (PTY check is Unix-only).
2. Performance gate not closed: measurements are Linux/one-run; no comparable
   ANSI/OpenTUI workload or thresholds yet.
3. `WorkbenchViewState` extraction, renderer selection, and launcher-owned
   `--experimental-ffi` remain out of scope for this spike.
