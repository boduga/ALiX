# Interfaces

## Overview

Operator-facing surfaces over ALiX runtime facts. The CLI owns commands and terminal presentation, the TUI projects runtime state into interactive views, and the Inspector supplies HTTP, read-model, and browser interfaces. Presentation is not execution or audit authority: runtime services remain the source of truth.

## Subdirectories & Boundaries

- CLI: [./cli/README.md](./cli/README.md) - `alix run` parsing, the learning-to-adaptation bridge, command handlers, shared CLI helpers, and terminal renderers.
- Inspector: [./inspector/README.md](./inspector/README.md) - Read-only session projections and comparisons from the persisted event stream.
- Server: [./server/README.md](./server/README.md) - The authenticated Inspector HTTP surface, SSE streams, route policy, and the two gated coordination execution POSTs.
- TUI: [./tui/README.md](./tui/README.md) - Interactive terminal presentation, workbench view state, renderers, and operator input routing.
- UI: [./ui/README.md](./ui/README.md) - Static browser Inspector assets for event streaming, replay, read views, and server-authorized coordination actions.
