# experiments/opentui — OpenTUI runtime spike

## Purpose

Isolated evaluation of pinned `@opentui/core` against ALiX's Node 26.4+ ESM
baseline for the approved
[OpenTUI Workbench migration design](../../docs/superpowers/specs/2026-10-09-opentui-workbench-migration-design.md).
It answers the runtime gate only: native renderer creation, static Workbench
layout/input/resize, in-memory frame checks, terminal restoration, packaging,
and a bounded steady-state load check. It does not select a renderer or touch
production TUI code.

## Ownership

| Path | Responsibility |
|------|----------------|
| `workbench-fixture.mjs` | Single source of the static four-agent fixture text. |
| `static-workbench.mjs` | `mountWorkbench` (OpenTUI renderables) and the `npm start` entry. |
| `harness.mjs` | Native test-renderer lifecycle (`withTestRenderer`, `disposeTestRenderer`). |
| `perf-check.mjs` | Diagnostic benchmark: full frame, input latency, idle CPU, RSS plateau, frame coalescing, and a provisional threshold verdict. |
| `pty-check.py` | Unix PTY checks: escape exit, Ctrl+C cancellation, SIGWINCH resize, focused typing, bracketed paste, terminal restoration. |
| `pty-check-win.py` | Windows ConPTY restoration check via pywinpty. |
| `*.test.mjs` | In-memory native tests (render, wide/medium/narrow layout, input, resize, cleanup). |
| `README.md` | Setup, versions, results, benchmark limitations, support matrix, gaps. |

## Local Contracts

- **Isolated and unpublished.** The spike depends on no repo source; the
  benchmark reads ALiX's compiled ANSI canvas from the git-ignored `dist/**`
  tree (built by `pnpm build`), and the experiment is excluded from the
  published package. It never changes the production renderer, root
  dependencies, or node_modules.
- **npm-managed on purpose.** The experiment carries its own `package.json` and
  `package-lock.json`; `scripts/check-package-manager.sh` exempts it. Project
  dependency management stays pnpm.
- **Fixture text has one source.** Roster/transcript/inspector/placeholder/
  footer strings live in `workbench-fixture.mjs`; `static-workbench.mjs`,
  `perf-check.mjs`, and the frame assertions import them rather than re-typing.
- **One teardown path.** Tests and the benchmark dispose the native renderer
  through `harness.mjs` so `destroy()` + `await closed` cannot drift.
- **Native Core loads only on Node ≥26.4.0 with ESM and
  `--experimental-ffi`.** Renderer creation fails without the flag.
- **Benchmark numbers are diagnostic.** ANSI and OpenTUI do different work;
  the benchmark compares shapes and trends, never a parity verdict. Its
  threshold `verdict` is provisional and requires operator sign-off before it
  gates a rollout (see spec amendment 2026-10-10).

## Work Guidance

- Keep the spike self-contained. New fixture state belongs in
  `workbench-fixture.mjs`, not duplicated into a test or the benchmark.
- Do not wire this into `src/`; renderer selection and WorkbenchViewState
  extraction are later, separately-reviewed slices.
- Record unmeasured gates in `README.md` "Remaining gaps" rather than assuming
  parity.

## Verification

```bash
npm test --prefix experiments/opentui        # in-memory native tests
npm run test:pty --prefix experiments/opentui # Unix terminal restoration
npm run bench --prefix experiments/opentui    # diagnostic (needs root pnpm build)
# Windows only: pip install pywinpty && python pty-check-win.py
```

`.github/workflows/opentui-spike.yml` runs `npm test` plus the Unix PTY check
(Linux/macOS) and the pywinpty ConPTY check (Windows) across Linux 26.4/26.11,
macOS, and Windows.

## Child DOX Index

None — this spike holds no separate contracts below it.
