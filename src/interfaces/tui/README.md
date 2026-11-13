# TUI

## Overview
ALiX's interactive terminal presentation and operator-input layer. It projects runtime facts into immutable snapshots and typed view state, paints them to the terminal (custom ANSI canvas by default, native OpenTUI when selected), and routes operator intent back to runtime services. It owns neither task execution nor policy decisions nor audit truth: `AgentSession` and `EventLog` remain the canonical runtime state, and the TUI only presents it.

## Interface
- `TuiApp` — composition root that wires terminal lifecycle, snapshots, input, and runtime ports; `TuiAppOptions` is its injected dependency surface [app.ts:TuiApp] [app.ts:TuiAppOptions]
- `RendererId` selects the presentation backend: `'canvas'` (default) or `'opentui'` [app.ts:RendererId]
- `SnapshotBuilder` composes one immutable dashboard read model per refresh tick; `DashboardSnapshot` and `RuntimeSnapshot` are those read models [snapshot-builder.ts:SnapshotBuilder] [snapshot.ts:DashboardSnapshot] [snapshot.ts:RuntimeSnapshot]
- `RuntimeCollector` / `RuntimeCollectorOptions` host EventLog-derived projections for one session and expose a cached `RuntimeSnapshot` [runtime-collector.ts:RuntimeCollector] [runtime-collector.ts:RuntimeCollectorOptions]
- `FramePainter` / `FramePainterDeps` own full-frame composition over read-only state and runtimes [frame-painter.ts:FramePainter] [frame-painter.ts:FramePainterDeps]
- `TuiAppState`, `PerTabState`, `TAB_ORDER`, `createInitialTuiAppState` define presentation state, per-tab state, ordered tabs, and initial state [state.ts:TuiAppState] [state.ts:PerTabState] [state.ts:TAB_ORDER] [state.ts:createInitialTuiAppState]
- `TuiRenderer` (frame buffer and repaint scheduling), `TerminalCanvas`, and `writeRowsToCanvas` compose and emit terminal output [render.ts:TuiRenderer] [canvas.ts:TerminalCanvas] [canvas.ts:writeRowsToCanvas]
- `createTerminalControl` with `captureStderr`, `releaseStderr`, and `installEmergencyCleanup` own terminal modes and cleanup [terminal-control.ts:createTerminalControl] [terminal-control.ts:captureStderr] [terminal-control.ts:releaseStderr] [terminal-control.ts:installEmergencyCleanup]
- `IInput` / `IOutput` abstract byte-level input and string-level output so tests inject streams [io.ts:IInput] [io.ts:IOutput]
- `graphemeWidth` supplies display-column measurement for grapheme-aware canvas writes [terminal-text.ts:graphemeWidth]
- Blocks: [./blocks/README.md](./blocks/README.md)
- Evolution: [./evolution/README.md](./evolution/README.md)
- Helpers: [./helpers/README.md](./helpers/README.md)
- Runtime projections: [./runtime/README.md](./runtime/README.md)
- Views: [./views/README.md](./views/README.md)
- Workbench app: [./workbench/app/README.md](./workbench/app/README.md)
- Workbench controller: [./workbench/controller/README.md](./workbench/controller/README.md)
- Workbench input: [./workbench/input/README.md](./workbench/input/README.md)
- Workbench layout: [./workbench/layout/README.md](./workbench/layout/README.md)
- Workbench model: [./workbench/model/README.md](./workbench/model/README.md)
- Workbench OpenTUI renderer: [./workbench/opentui/README.md](./workbench/opentui/README.md)
- Workbench projections: [./workbench/projections/README.md](./workbench/projections/README.md)
- Workbench view-state: [./workbench/view-state/README.md](./workbench/view-state/README.md)
- Workbench views: [./workbench/views/README.md](./workbench/views/README.md)
- `capabilities`, `workbench`, and `workbench/render` are supporting areas without their own contracts here.

## Invariants
- Runtime facts flow one way: EventLog/runtime projections → immutable snapshots → views; views never emit runtime events or infer successful runtime transitions [app.ts:TuiApp]
- Workbench presentation state is presentation-only; runtime truth remains `AgentSession`/`EventLog` [app.ts:TuiApp]
- A newer snapshot generation supersedes an in-flight build, and a stale generation yields `null` rather than overwriting fresher state [snapshot-builder.ts:SnapshotBuilder] [app.ts:start]
- The terminal is owned only when the renderer is not `opentui`; `ownsTerminal = renderer !== 'opentui'` gates terminal modes, stderr capture, resize handling, and input attachment [app.ts:start]
- With `renderer: 'opentui'`, canvas painting is bypassed and the Workbench view state is delivered through `onWorkbenchFrame` instead [app.ts:paintFullFrame]
- Runtime collectors await checkpoint recovery before the first sample, so recovery cannot race an incomplete restore [runtime-collector.ts:start]
- Runtime collectors coalesce EventLog watch notifications into serialized 20 ms projection samples; the one-second interval is a recovery/clock fallback [runtime-collector.ts:RuntimeCollector] [runtime-collector.ts:scheduleEventSample] [app.ts:start]
- Canvas cells reserve terminal display columns for complete graphemes, so wide characters and emoji cannot shift adjacent chrome or split across frame patches [terminal-text.ts:graphemeWidth] [canvas.ts:TerminalCanvas]
- Frame painting is read-only over the supplied state, views, and runtimes [frame-painter.ts:FramePainter]
- Stderr capture is active only when stderr is a TTY, so piped stderr and unit tests stay untouched [terminal-control.ts:captureStderr]
- Cleanup is idempotent: `stop()` returns immediately when already detached [app.ts:stop]

## Side Effects
- Writes terminal escape sequences: alternate buffer (unless `ALIX_TUI_ALT_BUFFER=0`), cursor visibility, raw mode, bracketed paste, and cursor-blink control [terminal-control.ts:createTerminalControl]
- Installs `SIGINT`/`SIGTERM`/`exit` handlers that run cleanup and exit on signals [terminal-control.ts:installEmergencyCleanup]
- Captures `process.stderr.write` while the TUI owns the screen, bounded at 32 KiB, retaining the most recent diagnostics and replaying them on release [terminal-control.ts:captureStderr] [terminal-control.ts:releaseStderr]
- Subscribes to stdin data and stdout `resize`, and unsubscribes both during cleanup [app.ts:start] [app.ts:cleanupSync]
- Starts a one-second refresh timer and clears it on `stop()` [app.ts:start] [app.ts:stop]
- Starts and stops the injected daemon metrics collector [app.ts:start] [app.ts:stop]
- Invokes the injected `onWorkbenchFrame` callback when the OpenTUI renderer produces a frame [app.ts:paintFullFrame]
- Injects the plan-approval gate into the agent session when the session exposes the optional setter [app.ts:start]

## Verification
- Run: `pnpm test`
