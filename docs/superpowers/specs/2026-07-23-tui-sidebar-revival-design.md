# TUI Sidebar Revival & Status Bar Parity — Design

**Date:** 2026-07-23
**Status:** Approved for Planning
**Branch:** `feat/tui-sidebar-revival`
**Parent:** `feat/tui-blessed-adoption-pr-c` (after PR C.1 merge)
**Builds on:** PR C.1 — Blessed Text Input Widget Integration

---

# 1. Problem

The current Blessed TUI diverges from the target operator interface in four areas.

---

## 1.1 Sidebar geometry is broken

The current sidebar creates four widgets directly under the screen:

```text
screen
 ├── daemonPanel
 ├── approvalsPanel
 ├── runtimePanel
 └── sopsPanel
```

All panels currently receive:

```ts
top: 1
height: '25%'
```

Because they share identical coordinates, they overlap.

The last appended widget visually wins.

This is a **layout ownership bug**, not a missing feature.

---

## 1.2 Sidebar content parity is missing

The current Blessed sidebar painter renders a generic panel loop.

The richer dashboard content already exists:

* DAEMON

  * workspace
  * CPU
  * memory
  * disk
  * runtime state

* APPROVALS

  * pending items
  * counts
  * review hint

* RUNTIME

  * events
  * workflow
  * started time
  * runtime information

* SOPS & POLICY

  * SOPS counts
  * policy rules
  * hints

The data and presentation model already exist.

The problem is that the Blessed renderer does not consume the same dashboard representation.

---

## 1.3 Status bar lacks parity

Current status bar:

```
DAEMON | EVENTS | SOPS | RULES
```

Target:

```
TOKENS | FILES | DAEMON | EVENTS | SOPS | RULES
```

Existing:

* TOKENS source exists through token budget tracking.
* FILES has no runtime projection.

A new session file activity metric is required.

---

## 1.4 Header format diverges

Current Blessed renderer initializes:

```
ALiX TUI - Interactive Session
```

but later overwrites it during render:

```
ALiX TUI │ v1.x │ Mode:auto
```

Target:

```
ALiX TUI - Interactive Session

Agent OS: unknown | Session: auto | Mode: auto
```

The renderer currently lacks metadata required to produce this.

---

# 2. Design Principles

## Renderer responsibility

Renderers are presentation-only.

They:

* consume `OperatorViewState`
* update widgets/canvas
* never mutate application state
* never infer runtime information

---

## Shared presentation pipeline

Dashboard information flows through a shared representation:

```
Runtime State
      |
      v
Dashboard Snapshot
      |
      v
Dashboard View Models
      |
      +----------------+
      |                |
      v                v
Canvas Renderer   Blessed Renderer
```

The source of truth is the dashboard view model.

Canvas and Blessed may have different drawing implementations, but they consume identical panel data.

---

# 3. Sidebar Architecture

## 3.1 Widget hierarchy

Replace the current overlapping structure:

```
screen
 ├── daemonPanel
 ├── approvalsPanel
 ├── runtimePanel
 └── sopsPanel
```

with:

```
screen
└── root
    ├── header
    ├── body
    │   ├── leftPane
    │   │   ├── mainContent
    │   │   └── approvalHint
    │   │
    │   └── rightPaneContainer
    │       ├── daemonPanel
    │       ├── approvalsPanel
    │       ├── runtimePanel
    │       └── sopsPanel
    │
    ├── promptBar
    ├── tabBar
    └── statusBar
```

---

## 3.2 Container geometry

`rightPaneContainer`

```ts
{
  top: HEADER_HEIGHT,
  left: '75%',
  width: '25%',
  height: BODY_HEIGHT
}
```

Children:

```ts
daemonPanel:
  top: 0
  height: 25%

approvalsPanel:
  top: '25%'
  height: 25%

runtimePanel:
  top: '50%'
  height: 25%

sopsPanel:
  top: '75%'
  height: 25%
```

Panels are container-owned.

They are never attached directly to the screen.

---

# 4. Sidebar Rendering

## 4.1 Shared panel view models

`dashboard-renderer.ts` remains the source of truth for dashboard panel composition.

However, Blessed will not directly reuse Canvas drawing primitives.

Instead:

```
DashboardSnapshot
        |
        v
Panel View Models
        |
        +-------------+
        |             |
        v             v
 Canvas Painter   Blessed Painter
```

Example:

```ts
DaemonPanelViewModel {
  workspace: string
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  status: string
}
```

---

## 4.2 Blessed sidebar painter

`sidebar-painter.ts` becomes responsible only for rendering view models into Blessed widgets.

Example:

```ts
renderSidebar(
  panels,
  snapshot,
  widgetRefs
)
```

Responsibilities:

* receive panel data
* format Blessed text
* update widget contents

Not responsible for:

* collecting runtime data
* computing metrics
* building business state

---

# 5. Status Bar

## 5.1 New status order

Status bar ordering is part of the operator UX contract.

Fixed order:

```
TOKENS
FILES
DAEMON
EVENTS
SOPS
RULES
```

---

## 5.2 Status fields

`buildStatusBar()`:

```ts
[
  {
    label: 'TOKENS',
    value: formatTokens(runtime.tokenUsage)
  },
  {
    label: 'FILES',
    value: String(runtime.filesProcessed)
  },
  {
    label: 'DAEMON',
    value: daemon.running
      ? '● running'
      : '○ stopped'
  },
  {
    label: 'EVENTS',
    value: runtime.totalEventCount
  },
  {
    label: 'SOPS',
    value: sops.totalLoaded
  },
  {
    label: 'RULES',
    value: policy.rules.length
  }
]
```

Example:

```
TOKENS: 1.2k/62k | FILES: 0 | DAEMON: ● running | EVENTS: 42 | SOPS: 2 | RULES: 6
```

---

# 6. Files Metric

## 6.1 Runtime field

Add:

```ts
RuntimeSnapshot {
  filesProcessed: number
}
```

Meaning:

> Number of file-related operations observed during this session.

Examples:

* file reads
* file writes
* file processing events

It does not represent:

* filesystem inventory
* cached files
* loaded files in memory

---

## 6.2 Collector

Add lightweight collector:

```
src/tui/runtime-collector.ts
```

Responsibilities:

* inspect runtime event stream
* count file-related operations
* expose session metric

No filesystem scanning.

---

# 7. Token Formatting

Compact display:

Examples:

```
1200/62000
```

becomes:

```
1.2k/62k
```

Utility:

```ts
formatTokens(
 used,
 max
)
```

---

# 8. Header Metadata

## 8.1 Extend presentation model

`OperatorViewState.sessionMetadata`

```ts
{
  version: string;
  mode: string;
  phase: string;

  sessionId?: string;
  agentOs?: string;
  cwd?: string;
}
```

---

## 8.2 Ownership

The view-model builder owns defaults.

Renderers do not infer values.

Example:

```ts
agentOs:
  snapshot.agentOs ?? "unknown"

session:
  snapshot.sessionId ?? "auto"
```

---

## 8.3 Blessed output

Left:

```
ALiX TUI - Interactive Session
```

Right:

```
Agent OS: unknown | Session: auto | Mode: auto
```

---

## 8.4 Canvas parity

Canvas renderer consumes the same metadata.

No renderer-specific header logic.

---

# 9. File Changes

| File                                           | Change                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `src/tui/renderers/blessed-renderer.ts`        | Add sidebar container, child ownership model, fix header rendering |
| `src/tui/renderers/blessed/sidebar-painter.ts` | Replace generic panel loop with Blessed panel view rendering       |
| `src/tui/dashboard-renderer.ts`                | Ensure panel view models are shared by Canvas and Blessed          |
| `src/tui/presentation/builder.ts`              | Add TOKENS/FILES fields, metadata projection                       |
| `src/tui/presentation/types.ts`                | Extend session metadata                                            |
| `src/tui/snapshot.ts`                          | Add `filesProcessed` runtime field                                 |
| `src/tui/runtime-collector.ts`                 | Collect file activity metric                                       |
| `src/tui/renderers/canvas-renderer.ts`         | Consume new header metadata                                        |
| `tests/tui/blessed-renderer.vitest.ts`         | Sidebar hierarchy, header, status bar tests                        |
| `tests/tui/view-model.vitest.ts`               | Metadata and status projection tests                               |
| `tests/tui/snapshot.vitest.ts`                 | Runtime metric tests                                               |

---

# 10. Implementation Tasks

## Task 1 — Sidebar widget hierarchy

* Create `rightPaneContainer`
* Move four panels under container
* Preserve widget lifecycle
* Update widget references

Acceptance:

* Four panels visible simultaneously
* No overlapping widgets

---

## Task 2 — Shared sidebar presentation

* Extract/verify panel view models
* Update Blessed painter
* Preserve Canvas behavior

Acceptance:

* Both renderers display identical dashboard information

---

## Task 3 — Status metrics

* Add TOKENS
* Add FILES
* Add `filesProcessed`
* Add runtime collector

Acceptance:

```
TOKENS | FILES | DAEMON | EVENTS | SOPS | RULES
```

visible in status bar.

---

## Task 4 — Header parity

* Extend metadata model
* Builder supplies defaults
* Blessed consumes metadata
* Canvas consumes metadata

Acceptance:

```
ALiX TUI - Interactive Session

Agent OS: unknown | Session: auto | Mode: auto
```

---

## Task 5 — Regression tests

Add coverage for:

* sidebar widget ownership
* panel positions
* header preservation
* status fields
* metadata projection
* Canvas parity

---

# 11. Invariants

* Renderer remains presentation-only.
* Renderer consumes only `OperatorViewState`.
* Renderer never mutates application state.
* Renderer never calls `process.exit()`.
* Application never reads raw keyboard bytes.
* Widgets are created once during initialization.
* Widgets are updated during render.
* Canvas renderer remains supported.
* Quit remains `Ctrl+C`.
* Sidebar widgets are owned by `rightPaneContainer`.
* Status bar ordering is fixed UX contract.

---

# 12. Verification

## Type check

```bash
pnpm tsc --noEmit
```

Expected:

```
clean
```

---

## Tests

```bash
pnpm vitest run tests/tui/
```

Expected:

```
all passing
```

---

## Blessed smoke test

```bash
node bin/alix.js tui
```

Verify:

✅ Four sidebar panels visible
✅ DAEMON shows metrics
✅ APPROVALS shows hints
✅ RUNTIME shows events/workflow
✅ SOPS & POLICY shows rules
✅ TOKENS visible
✅ FILES visible
✅ Header matches target
✅ `q` enters chat input
✅ `Ctrl+C` exits

---

## Canvas smoke test

```bash
ALIX_TUI_RENDERER=canvas node bin/alix.js tui
```

Verify identical layout and metadata.

---

## Impact checks

Before commit:

```bash
gitnexus_impact
gitnexus_detect_changes
```

---

# 13. Out of Scope

* Approval cards inside chat history
* Mouse support
* Tab highlight redesign
* Workspace metadata enrichment
* Full AgentSession metadata integration

---

# 14. Risks

## Blessed container migration

Risk:

Existing widget persistence tests may assume sidebar widgets are direct screen children.

Mitigation:

Update test seam while preserving widget lifecycle.

---

## Panel rendering coupling

Risk:

Existing dashboard renderer may combine data preparation and drawing.

Mitigation:

Extract shared panel view models without duplicating business logic.

---

## File metric accuracy

Risk:

Runtime events may not perfectly represent all file activity.

Mitigation:

Document metric as observed file operations, not filesystem truth.

---

## Metadata availability

Risk:

`agentOs` and `sessionId` may initially resolve to defaults.

Mitigation:

Presentation contract supports future runtime integration without renderer changes.

---

**Final status: Ready for `writing-plans`** ✅

