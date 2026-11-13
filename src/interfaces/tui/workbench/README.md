# Workbench

## Overview

The ALiX TUI workbench, split along a strict presentation boundary: a renderer-neutral model and set of event-derived projections, pure input routing and intent composition, screen geometry, and two interchangeable renderers (ANSI canvas and native OpenTUI) that paint the same immutable `WorkbenchViewState`. Runtime truth stays in `AgentSession` and `EventLog`; this subtree owns only presentation facts and operator intent.

## Subdirectories & Boundaries

- App: [./app/README.md](./app/README.md) - The pure `reduceWorkbenchUiState` reducer and the `WorkbenchStore` holding feature-gated operator UI state.
- Controller: [./controller/README.md](./controller/README.md) - Renderer-neutral intent composition that decides whether a store dispatch, host effect, or selection change owns an intent.
- Input: [./input/README.md](./input/README.md) - Pure key-to-intent routing, including composer, slash, approval, overlay, transcript, and coordination intents.
- Layout: [./layout/README.md](./layout/README.md) - Responsive screen-relative geometry for every paint region and the maximum composer height.
- Model: [./model/README.md](./model/README.md) - Immutable presentation view models, the action vocabulary, selection filters, and theme tokens shared by both renderers.
- OpenTUI: [./opentui/README.md](./opentui/README.md) - Native renderer host that mounts layout and content on a `CliRenderer` and wires terminal events.
- Projections: [./projections/README.md](./projections/README.md) - EventLog-derived agent, task, artifact, diff, and conversation read models.
- Render: [./render/README.md](./render/README.md) - Frame diffing and terminal-text primitives used by the ANSI renderer; no I/O and no renderer state.
- View State: [./view-state/README.md](./view-state/README.md) - The single immutable `WorkbenchViewState` assembled once and consumed unchanged by both renderers.
- Views: [./views/README.md](./views/README.md) - Presentation-only painters and line builders for the operator shell, drawers, and overlays.
