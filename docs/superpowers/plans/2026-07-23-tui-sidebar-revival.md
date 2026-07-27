# TUI Sidebar Revival & Status Bar Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the 4-panel right sidebar, add TOKENS/FILES status bar parity, and fix the header format to match the target operator interface.

**Branch:**

```bash
feat/tui-sidebar-revival
```

**Parent:**

```bash
feat/tui-blessed-adoption-pr-c
```

(after PR C.1 merge)

---

# Architecture Summary

The current Blessed renderer has three parity gaps:

1. Sidebar panels overlap because they are direct screen children.
2. Sidebar content is duplicated/minimal instead of using shared dashboard presentation data.
3. Header/status bar metadata does not match the target interface.

The implementation:

* Creates a sidebar container with four child panels.
* Introduces shared sidebar view models consumed by Canvas and Blessed.
* Adds `TOKENS` and `FILES` status fields.
* Extends normalized session metadata.
* Keeps renderers presentation-only.

---

# Global Constraints

These invariants must remain true:

* Renderer remains presentation-only.
* Renderer consumes only `OperatorViewState`.
* Renderer never mutates application state.
* Renderer never calls `process.exit()`.
* Application never reads raw keyboard bytes.
* Widgets are created once during `initialize()`.
* Widgets are updated during `render()`.
* Canvas renderer remains supported.
* Quit remains `Ctrl+C`.
* Renderer never infers runtime values.
* Builder/view-model layer owns defaults.
* Status bar order is fixed:

```text
TOKENS | FILES | DAEMON | EVENTS | SOPS | RULES
```

* Sidebar widgets are owned by `rightPaneContainer`.
* `neo-blessed` uses:

```ts
import blessed from 'neo-blessed'
```

---

# Task 1 — Sidebar Widget Hierarchy

## Purpose

Replace four overlapping screen widgets with a container-owned sidebar.

---

## Files

Modify:

```
src/tui/renderers/blessed-renderer.ts
tests/tui/blessed-renderer.vitest.ts
```

---

## New Widget Shape

Before:

```
screen
 ├── daemonPanel
 ├── approvalsPanel
 ├── runtimePanel
 └── sopsPanel
```

After:

```
screen
 └── rightPaneContainer
      ├── daemonPanel
      ├── approvalsPanel
      ├── runtimePanel
      └── sopsPanel
```

---

## Step 1 — Add failing hierarchy tests

Add:

```ts
it('exposes rightPaneContainer and four sidebar panels', async () => {
  const r = makeRenderer();
  await r.initialize(tc);

  const refs = r.getWidgetReferences();

  expect(refs.rightPaneContainer).toBeDefined();
  expect(refs.rightPane.daemon).toBeDefined();
  expect(refs.rightPane.approvals).toBeDefined();
  expect(refs.rightPane.runtime).toBeDefined();
  expect(refs.rightPane.sops).toBeDefined();
});
```

Add ownership test:

```ts
it('sidebar panels belong to rightPaneContainer only', async () => {
  const r = makeRenderer();
  await r.initialize(tc);

  const refs = r.getWidgetReferences();

  expect(refs.rightPaneContainer.children)
    .toContain(refs.rightPane.daemon);

  expect(refs.rightPaneContainer.children)
    .toContain(refs.rightPane.approvals);

  expect(refs.rightPaneContainer.children)
    .toContain(refs.rightPane.runtime);

  expect(refs.rightPaneContainer.children)
    .toContain(refs.rightPane.sops);

  expect(refs.screen.children)
    .not.toContain(refs.rightPane.daemon);

  expect(refs.screen.children)
    .not.toContain(refs.rightPane.approvals);
});
```

---

## Step 2 — Verify failure

Run:

```bash
pnpm vitest run tests/tui/blessed-renderer.vitest.ts
```

Expected:

```
FAIL
rightPaneContainer missing
```

---

## Step 3 — Implement container

Create:

```ts
this.rightPaneContainer = blessed.box({
  parent: this.body,
  top: HEADER_HEIGHT,
  left: '75%',
  width: '25%',
  height: `100%-${HEADER_HEIGHT + FOOTER_HEIGHT}`,
});
```

Create children:

```ts
this.rightPane = {
 daemon: blessed.box({
   parent:this.rightPaneContainer,
   top:0,
   height:'25%',
 }),

 approvals: blessed.box({
   parent:this.rightPaneContainer,
   top:'25%',
   height:'25%',
 }),

 runtime: blessed.box({
   parent:this.rightPaneContainer,
   top:'50%',
   height:'25%',
 }),

 sops: blessed.box({
   parent:this.rightPaneContainer,
   top:'75%',
   height:'25%',
 }),
};
```

---

## Step 4 — Update widget references

Return:

```ts
{
 screen,
 header,
 body,
 leftPane,

 rightPaneContainer,

 rightPane:{
   daemon,
   approvals,
   runtime,
   sops
 },

 promptBar,
 promptTextarea,
 tabBar,
 statusBar
}
```

---

## Step 5 — Persistence test

Verify:

```ts
after.rightPaneContainer
 === before.rightPaneContainer
```

and:

```ts
after.rightPane.daemon
 === before.rightPane.daemon
```

after multiple renders.

---

## Step 6 — Validate

Run:

```bash
pnpm vitest run tests/tui/blessed-renderer.vitest.ts
pnpm tsc --noEmit
```

---

## Step 7 — Commit

```bash
git add src/tui/renderers/blessed-renderer.ts tests/tui/blessed-renderer.vitest.ts

git commit -m "feat(tui): add sidebar container with stacked panels"
```

---

# Task 2 — Shared Sidebar View Models

## Purpose

Create a shared presentation layer consumed by Blessed and Canvas.

---

## Files

Modify:

```
src/tui/dashboard-renderer.ts
src/tui/renderers/blessed/sidebar-painter.ts
src/tui/presentation/types.ts
```

---

# View Model Types

Add:

```ts
export interface DaemonPanelViewModel {
  title:string;
  status:'running'|'stopped';

  pid:string;
  uptime:string;
  version:string;

  workspace:string;

  cpuPercent:number;
  memoryPercent:number;
  diskPercent:number;
}
```

Other models:

```ts
export interface ApprovalsPanelViewModel {
 pendingCount:number;
 items:Array<{
   id:string;
   toolName:string;
   target:string;
 }>;
 hint:string;
}


export interface RuntimePanelViewModel {
 eventCount:number;
 workflow:string;
 activeStep:string;
 startedAt:string;
 hint:string;
}


export interface SopsAndPolicyPanelViewModel {
 sopsCount:number;
 rulesCount:number;
 loadedSops:string[];
 hint:string;
}
```

---

# Important Rule

View models contain already-normalized values.

They do not call:

```ts
process.cwd()
Date.now()
filesystem APIs
```

Runtime data comes from snapshots/builders.

---

# Step 1 — Add formatter tests

Example:

```ts
expect(formatDaemonPanel(vm))
 .toContain('CPU');

expect(formatDaemonPanel(vm))
 .toContain('MEM');

expect(formatDaemonPanel(vm))
 .toContain('DISK');

expect(formatDaemonPanel(vm))
 .toContain('Workspace');
```

---

# Step 2 — Extract builders

Add:

```ts
buildDaemonPanelViewModel()

buildApprovalsPanelViewModel()

buildRuntimePanelViewModel()

buildSopsAndPolicyPanelViewModel()
```

Existing painters become:

```ts
snapshot
 |
buildViewModel()
 |
format()
 |
surface.write()
```

---

# Step 3 — Blessed painter consumes view models

`sidebar-painter.ts`

Responsibilities only:

* receive view models
* format text
* update Blessed widgets

Example:

```ts
refs.daemon.setContent(
 formatDaemonPanel(
   buildDaemonPanelViewModel(snapshot)
 )
);
```

No runtime collection.

---

# Step 4 — Validate

Run:

```bash
pnpm vitest run tests/tui/
```

---

# Step 5 — Commit

```bash
git add src/tui/dashboard-renderer.ts \
src/tui/renderers/blessed/sidebar-painter.ts \
src/tui/presentation/types.ts

git commit -m "feat(tui): introduce shared sidebar view models"
```

---

# Task 3 — TOKENS and FILES Status Metrics

## Files

Modify:

```
src/tui/snapshot.ts
src/tui/presentation/builder.ts
```

Create:

```
src/tui/presentation/formatters/tokens.ts
```

---

# Runtime Snapshot

Add only runtime facts:

```ts
RuntimeSnapshot {
 filesProcessed:number;
}
```

Meaning:

> Number of observed file-related runtime events.

Not:

* filesystem count
* cache size
* loaded files

---

# Token Formatting

Create:

```
src/tui/presentation/formatters/tokens.ts
```

Function:

```ts
formatTokens(
 used:number,
 max:number
):string
```

Examples:

```text
100/1000

1.2k/62k

1.5m/62m
```

---

# Status Bar Contract

Fixed order:

```text
TOKENS
FILES
DAEMON
EVENTS
SOPS
RULES
```

---

Example:

```text
TOKENS:1.2k/62k |
FILES:3 |
DAEMON:● running |
EVENTS:42 |
SOPS:2 |
RULES:6
```

---

# Commit

```bash
git add src/tui/snapshot.ts \
src/tui/presentation/builder.ts \
src/tui/presentation/formatters/tokens.ts

git commit -m "feat(tui): add token and file status metrics"
```

---

# Task 4 — Header Metadata Parity

## Files

Modify:

```
src/tui/presentation/types.ts
src/tui/presentation/builder.ts
src/tui/renderers/blessed-renderer.ts
src/tui/renderers/canvas-renderer.ts
```

---

# Metadata Contract

Runtime source:

```ts
sessionId?
agentOs?
cwd?
```

Presentation output:

```ts
interface SessionMetadata {
 version:string;
 mode:string;
 phase:string;

 sessionId:string;
 agentOs:string;
 cwd:string;
}
```

Builder normalization:

```ts
sessionId ?? "auto"

agentOs ?? "unknown"

cwd ?? "unknown"
```

---

# Header Output

Left:

```text
ALiX TUI - Interactive Session
```

Right:

```text
Agent OS: unknown | Session: auto | Mode: auto
```

---

# Blessed Fix

Remove legacy overwrite:

```text
ALiX TUI │ v1 │ Mode:auto
```

---

# Canvas

Use identical metadata formatting.

---

# Commit

```bash
git add src/tui/presentation/types.ts \
src/tui/presentation/builder.ts \
src/tui/renderers/blessed-renderer.ts \
src/tui/renderers/canvas-renderer.ts

git commit -m "feat(tui): restore operator header metadata parity"
```

---

# Task 5 — Regression Coverage

## Add tests for:

## Sidebar

* container ownership
* four child panels
* correct stacking

## Sidebar content

Verify:

```
CPU
MEM
DISK
Workspace
pending
events
SOPS
rules
```

appear.

---

## Status bar

Verify:

```ts
[
'TOKENS',
'FILES',
'DAEMON',
'EVENTS',
'SOPS',
'RULES'
]
```

---

## Header

Verify:

Contains:

```text
ALiX TUI - Interactive Session

Agent OS:
Session:
Mode:
```

Does not contain:

```text
ALiX TUI │ v
```

---

## Canvas parity

Mandatory verification:

Shared view models produce identical semantic content.

Canvas refactoring is optional.

---

# Final Verification

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

## Runtime Smoke Test

```bash
node bin/alix.js tui
```

Verify:

✅ four sidebar panels visible
✅ DAEMON metrics visible
✅ APPROVALS visible
✅ RUNTIME visible
✅ SOPS & POLICY visible
✅ TOKENS visible
✅ FILES visible
✅ header matches target
✅ `q` enters prompt
✅ Ctrl+C exits

---

## Canvas Smoke Test

```bash
ALIX_TUI_RENDERER=canvas node bin/alix.js tui
```

Verify:

✅ same layout
✅ same metadata
✅ same sidebar information

---

## Impact Checks

Before final commit:

```bash
gitnexus_impact
gitnexus_detect_changes
```

---

# Final Status

✅ Implementation-ready
✅ Scope controlled
✅ Renderer boundaries preserved
✅ Blessed/Canvas architecture remains clean
✅ Regression paths covered

