# OpenTUI Workbench migration — architecture decision

Status: Approved 2026-10-10 for an experimental OpenTUI spike. No default renderer change, ANSI canvas removal, Node baseline change, or production OpenTUI dependency is approved before the runtime gate passes.

## Decision

Allow an experimental `@opentui/core` renderer beside ALiX's current ANSI canvas for the Workbench. Keep the existing renderer as the default until runtime support and behavioral parity are demonstrated. Retire the canvas renderer only through a later, evidence-backed rollout decision.

This approval permits an isolated OpenTUI experiment beside the custom ANSI canvas. It supersedes the framework restriction in [2026-10-03-tui-workbench-preview-parity-design.md](2026-10-03-tui-workbench-preview-parity-design.md) for that experiment only. `src/interfaces/tui/AGENTS.md` retains the canvas as the production renderer until a later rollout decision.

## Current boundary

- `src/interfaces/cli/commands/tui.ts` constructs `SnapshotBuilder` and `TuiApp`; `ALIX_TUI_WORKBENCH=1` enables Workbench presentation.
- `src/interfaces/tui/snapshot-builder.ts` composes an immutable dashboard snapshot. `runtime/` and `workbench/projections/` derive event-backed read models.
- `workbench/model/ui-state.ts`, `workbench/app/workbench-store.ts`, and `workbench/input/input-router.ts` already own selection, overlays, composer state, and typed input intents.
- `frame-painter.ts`, `canvas.ts`, `workbench/views/`, `workbench/layout/responsive-layout.ts`, and terminal I/O own current painting, geometry, frame diffing, and raw input.
- The TUI has no Blessed dependency. This is a renderer migration, not a Blessed removal.

## Proposed boundary

`SnapshotBuilder` and existing Workbench projections supply immutable runtime facts. `WorkbenchStore` owns presentation state. A narrow controller maps renderer input to existing Workbench intents and runtime command ports. OpenTUI views receive read models and presentation state; they never query subsystem services or emit runtime events.

Keep existing projections, selection semantics, transcript items, and source identity. Assemble a renderer-neutral `WorkbenchViewState` from `SnapshotBuilder` output and `WorkbenchStore` state; both renderers consume it. Add assembly only where a current painter still constructs semantic data. Do not introduce a persisted Workbench state store or duplicate event stream. OpenTUI owns terminal layout, focus, scrolling, frame output, and cleanup once selected as renderer.

```ts
interface WorkbenchViewState {
  header: HeaderViewModel
  roster: RosterViewModel
  transcript: TranscriptViewModel
  inspector: InspectorViewModel
  composer: ComposerViewModel
  footer: FooterViewModel
  selection: SelectionState
  overlay: OverlayState
}
```

`workbench/view-state/**` may import only renderer-neutral Workbench models/projections and Experience-layer interfaces. Neither renderer may derive additional semantic runtime or operator-intent state; renderer-local layout, focus, and scroll caches remain presentation details. No renderer directly imports subsystem implementations.

At most one renderer may own terminal input, terminal output, raw-mode state, resize subscriptions, and cleanup handlers in a TUI process.

## Runtime gate

ALiX declares Node.js `>=26.4.0`, pins 26.11.0 in `.nvmrc`, and uses ESM after [runtime PR #896](https://github.com/boduga/ALiX/pull/896) merged on 2026-10-10. [OpenTUI's runtime documentation](https://opentui.com/docs/getting-started/runtime-support/) requires Node.js 26.4.0+ with ESM and `--experimental-ffi` for native Core use. The remaining runtime gate is native loading, terminal behavior, and packaging on ALiX's supported platforms.

First spike, in isolated `experiments/opentui/`: install pinned `@opentui/core`, start and close a renderer, render a static three-pane Workbench fixture with fake four-agent data, exercise resize and keyboard input, and run an in-memory render test. Verify native package loading and clean terminal restoration on supported release platforms. Record exact dependency version, runtime, commands, failures, and screenshots or frame assertions. No production dependency or renderer switch until this gate passes.

Use the existing Node 26.4+ baseline for the experimental renderer, selected explicitly through a renderer option and loaded dynamically. Arrange launcher-owned `--experimental-ffi` activation so the operator can run `alix tui` without supplying the flag. The ANSI canvas remains the default during parity work. A successful import alone does not pass the gate; native renderer creation must succeed.

## Migration slices

1. Extract `WorkbenchViewState` from existing snapshots and UI state. Preserve approval authority, agent/task identity, transcript source ranges, artifact scoping, and unknown/unavailable distinctions.
2. Add explicit renderer selection at the CLI composition root. Enforce single-renderer terminal ownership. Default remains current renderer.
3. Reproduce the fixed four-worker Workbench fixture: header, roster, transcript, inspector, composer, and footer at wide, medium, narrow, and short terminal sizes.
4. Route OpenTUI keyboard and paste events through `routeWorkbenchInput` or equivalent typed intents. Verify focus, overlay priority, approval keys, cancellation, queued follow-ups, slash completion, and Unicode editing.
5. Wire live snapshots and streaming. Compare both renderers against the same event fixture and one real four-worker coordination run.
6. Evaluate default switch only after parity, platform packaging, and terminal cleanup evidence. Remove the old canvas path only in a separately reviewed cleanup.

## Acceptance evidence

- Node 26.4+ native renderer starts, resizes, handles input, and restores terminal state on exit and cancellation. Any proposed Bun support requires its own measured evidence.
- Existing Workbench semantic tests pass unchanged where renderer-neutral. OpenTUI frame assertions cover wide/medium/narrow layouts; PTY tests cover input, paste, focus, resize, cancellation, and cleanup.
- Approvals remain authoritative and visible above other overlays. Selected agent, run, task, and artifact identities survive streaming and resize; unavailable data is never displayed as zero.
- OpenTUI views import no execution, coordination, governance, or runtime-state implementation. Runtime commands pass through the existing composition/controller boundary.
- A four-worker scenario shows the same roster, transcript, inspector, approvals, artifacts, completion status, and operator actions in both renderers. Parity is semantic and interaction parity, not cell-for-cell or styling parity.
- Measure ANSI and OpenTUI on the fixed fixture before setting thresholds: idle CPU, memory over time, input-to-render latency, and streaming frame backlog. Gate rollout on no pathological idle CPU increase, unbounded memory growth, unacceptable input latency, or accumulating frame backlog.

## Spike deliverable

Keep the first PR confined to `experiments/opentui/`: a pinned package, static Workbench fixture, input, resize, cleanup, and in-memory render checks, plus a README with reproducible commands and results. The spike answers the runtime and terminal gate; extracting `WorkbenchViewState` and wiring production CLI selection are later slices.

## Metrics after parity

Start with measures that have defined timestamps or counters: projection age (`render time - snapshot generatedAt`), projection-to-render latency, and keypress-to-render latency. Show unavailable when timestamps cannot be correlated. Existing token and context-utilization projections should be reused. Defer parallel speedup, completion accuracy, and cost per successful task until their baseline and success definitions are specified and instrumented in owning subsystems.

## Amendment 2026-10-10: spike support files

The spike deliverable ("confined to `experiments/opentui/`") is amended to allow the minimum supporting artifacts the runtime gate itself needs, keeping the production renderer, root dependencies, and `node_modules` untouched:

- `.github/workflows/opentui-spike.yml` — the platform matrix that proves native load and packaging on Linux/macOS/Windows.
- `scripts/check-package-manager.sh` — a scoped exemption so the experiment's deliberately isolated npm lockfile does not trip the pnpm-only policy.
- `src/interfaces/tui/AGENTS.md` — the DOX line recording this approved exception.
- `experiments/opentui/AGENTS.md` — the child contract for the new boundary.

No other production file is in scope. `WorkbenchViewState` extraction, renderer selection, and launcher-owned `--experimental-ffi` remain later slices.
