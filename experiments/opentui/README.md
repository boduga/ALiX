# OpenTUI runtime spike

Experimental, isolated `@opentui/core` fixture beside ALiX's production ANSI
canvas. This spike only answers the **runtime gate**: can pinned OpenTUI Core
create a native renderer on ALiX's Node 26.4+ baseline, render a static
Workbench, take input, resize, cleanly restore the terminal, install as an
isolated package, and hold a bounded steady state under load.

Nothing here is wired into production. The ANSI canvas remains the default
renderer, no root dependency changed, and `experiments/opentui/node_modules/`
is local install output (git-ignored). Scope and rationale:
[spec](../../docs/superpowers/specs/2026-10-09-opentui-workbench-migration-design.md),
[plan](../../docs/superpowers/plans/2026-10-10-opentui-runtime-gate.md).

## Requirements

- **Node.js 26.4.0+** with ESM and the `--experimental-ffi` flag (native Core).
  `engines.node` is pinned to `>=26.4.0`; tested on the official 26.11.0 binary.
- A C-less install: the native core arrives as a platform `optionalDependency`
  (`@opentui/core-{linux,darwin,win32}-*`), so no toolchain is needed.
- Python 3 for the Unix PTY check only.

Exact dependencies (see `package-lock.json`):

| Package | Version | Role |
| --- | --- | --- |
| `@opentui/core` | `0.5.17` | Native renderer (Zig core + JS). |
| `web-tree-sitter` | `0.25.10` | Peer dependency required by `@opentui/core`. |

## Setup

```bash
npm ci --prefix experiments/opentui --no-audit --no-fund
```

One command to see the fixture render, then exit with Escape or Ctrl+C:

```bash
npm start --prefix experiments/opentui     # node --experimental-ffi static-workbench.mjs
```

Or from inside `experiments/opentui/`, prepending the Node 26 bin directory:

```bash
export PATH="/path/to/node-v26.11.0-linux-x64/bin:$PATH"
npm ci --no-audit --no-fund
npm start
```

## Commands

| Command (from `experiments/opentui/`) | Purpose |
| --- | --- |
| `npm test` | Seven in-memory native tests: frame regions/four agents, wide/medium/narrow layouts, focused input, resize, repeated cleanup. |
| `npm run test:pty` | Unix PTY checks: live frame, Escape exit, Ctrl+C cancellation, SIGWINCH resize, alternate-screen enter/leave, raw input-mode restoration. |
| `npm run bench` | Diagnostic microbenchmark (`perf-check.mjs`). Needs `--expose-gc` (set in the script). |
| `npm start` | Interactive static fixture. |

The benchmark imports ALiX's compiled canvas (`../../dist/src/interfaces/tui/canvas.js`),
so run root `pnpm build` first.

The static fixture (`static-workbench.mjs`) is a four-agent, three-pane
Workbench shell: `Agents` roster, `Transcript`, `Inspector`, `Composer`, and
`Footer` at 120x30. Fixture text lives once in `workbench-fixture.mjs`; the
native test-renderer lifecycle lives once in `harness.mjs`.

## Local results

Linux x86_64, official Node **v26.11.0**, `@opentui/core@0.5.17`, one run.

- `npm test` — **7/7 pass** (render, wide/medium/narrow layout, input, resize, idempotent cleanup).
- `npm run test:pty` — **pass**: frame painted; Escape exit, Ctrl+C cancellation,
  and SIGWINCH resize each exited 0 with `\x1b[?1049h`/`\x1b[?1049l`
  alternate-screen enter/leave observed and `ECHO`/`ICANON` restored.
- `npm ci --offline` installed the package from the isolated lockfile into a
  clean temp directory; `createTestRenderer()` loaded native Core there and
  closed cleanly.

### Benchmark

Default run (`FRAMES=200 UPDATES=5000 ROUNDS=6 UPDATES_PER_ROUND=2000 BURST=500`):

```json
{
  "fullFrame": {
    "ansiCanvasPaintAndSerializeMsPerFrame": 28.586,
    "openTuiRenderMsPerFrame": 1.722
  },
  "inputToRender": { "updates": 5000, "p50Ms": 0.78, "p95Ms": 3.56 },
  "idleCpuMsPerSecond": 42.2,
  "steadyStateRss": {
    "samplesMiB": [212, 211, 212, 212, 212, 213],
    "netGrowthMiB": 1,
    "tailSlopeMiBPerRound": 0.4
  },
  "frameBacklog": {
    "requestsFired": 500,
    "framesRenderedForBurst": 1,
    "coalesced": 499,
    "hasScheduledRenderAfterDrain": false
  }
}
```

Reading the numbers:

- **Steady-state RSS plateaus.** Six tranches of 2,000 merges hold a flat
  ~212 MiB working set after warmup (`netGrowthMiB: 1`, tail slope +0.4
  MiB/round), sampled after two GC passes. No unbounded growth was observed.
  An earlier single before/after sample showed `+63 MiB`; the plateau
  measurement is the trustworthy one — a cold first tranche includes native
  warmup.
- **Frame requests coalesce.** 500 back-to-back `requestRender()` calls
  produced **1** frame (sampled after `idle()` drained the burst, before the
  settle render), and `hasScheduledRender` cleared after drain — the scheduler
  collapses pending work into flags rather than a growing queue. No
  accumulating frame backlog was observed.
- **Idle CPU ~42 ms/s** with no input over one second.
- **Input latency** p50 **0.78 ms**, p95 **3.56 ms** over 5,000 bounded
  keystrokes driving a full re-render each.

### Benchmark limitations — read before quoting

- ANSI `renderFrame()` (allocate + paint + serialize) and OpenTUI
  `renderOnce()` (native composite + transport) **do different work**. Compare
  shapes and trends, not absolute milliseconds; this is **not** a parity
  verdict.
- Single Linux host, single run, no pinned CPU. Treat as diagnostic.
- The `requestRender()` coalescing probe fires synchronously and does not
  simulate an external producer streaming frames over wall-clock time.
- Native `getNativeStats()` timing fields have undocumented units and are
  intentionally not reported.

## Support matrix

| OS | Node | Status |
| --- | --- | --- |
| Linux x64 | 26.11.0 | **Verified** — local tests/PTY/benchmark plus CI green. |
| Linux x64 | 26.4.0 | **Verified in CI** — green. |
| macOS arm64 | 26.11.0 | **Verified in CI** — `npm test` plus PTY terminal restoration green. |
| Windows x64 | 26.11.0 | **Native load + in-memory tests green in CI**; terminal restoration **not implemented** (PTY check is Unix-only). |

`.github/workflows/opentui-spike.yml` ran on draft PR
[#898](https://github.com/boduga/ALiX/pull/898)
([native-core run 38031068405](https://github.com/boduga/ALiX/actions/runs/38031068405));
every declared leg passed. No Linux arm64, musl, or macOS x64 leg is configured.

## Remaining gaps (do not report as passed)

1. **Windows terminal restoration unmeasured.** Native load and in-memory
   tests pass on Windows CI, but the PTY restoration check is Unix-only and has
   no Windows (ConPTY) equivalent yet.
2. **PTY paste and focus unmeasured.** The PTY checks cover frame paint, Escape
   exit, Ctrl+C cancellation, SIGWINCH resize, and cleanup; bracketed paste and
   focus semantics are not asserted (the in-memory input test covers focus at
   the renderable level only).
3. **Performance gate not closed.** Idle CPU, latency, RSS plateau, and
   frame-coalescing are measured on one Linux host/run and still need a
   comparably framed workload before any threshold is set.
4. **Not wired.** `WorkbenchViewState` extraction, renderer selection at the
   CLI composition root, and launcher-owned `--experimental-ffi` are later
   slices, out of scope here.
