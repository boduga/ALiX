# PR C.1 — Blessed Input Widget Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Replace the temporary raw-stdin chat/agent input implementation with a real **neo-blessed textarea** while preserving the existing application architecture.

The application **continues owning all input state** (`PerTabState.inputBuffer`). The renderer owns widgets only. Communication occurs exclusively through typed `RendererEvent`s.

This PR builds on **PR C (Blessed Renderer Adoption)** and does **not** modify the Canvas renderer.

**Branch**

```
feat/tui-blessed-input-pr-c1
```

from

```
feat/tui-blessed-adoption-pr-c
```

---

# Architecture

## Ownership

```
Keyboard
    │
    ▼
neo-blessed textarea
    │
RendererEvent
    │
    ▼
Application State
(PerTabState.inputBuffer)
    │
    ▼
ViewModelBuilder
    │
    ▼
OperatorViewState
    │
    ▼
BlessedRenderer.render()
```

The renderer never owns application state.

The application never manipulates widget internals.

Each layer has a single responsibility.

---

# Design Principles

* Application remains the single source of truth.
* Renderer remains presentation-only.
* No raw stdin typing logic.
* Renderer emits events only.
* Renderer never mutates application state.
* Canvas renderer remains untouched.
* TerminalControl ownership remains unchanged.
* Widgets are created once during `initialize()`.
* Widgets are updated during `render()`.
* Renderer never calls `process.exit()`.

---

# Widget Layout

```
screen
└── root
    ├── header
    ├── body
    │   ├── leftPane (80%)
    │   │   ├── mainContent
    │   │   └── approvalHint
    │   └── rightPane (20%)
    │       ├── daemon
    │       ├── approvals
    │       ├── runtime
    │       └── sops/policy
    ├── promptBar
    │   └── promptTextarea
    ├── tabBar
    └── statusBar
```

Only the left pane scrolls.

Sidebar panels never move regardless of main content length.

---

# Task 1 — Renderer contracts

## Files

```
src/tui/renderer/types.ts
src/tui/presentation/types.ts
```

---

* [ ] Add new renderer event

```ts
type RendererEvent =
  | { type: 'exit' }
  | { type: 'switchTab'; tab: TabId }
  | { type: 'cycleTab'; forward: boolean }
  | { type: 'homeTab' }
  | { type: 'focusInput' }
  | { type: 'blurInput' }
  | { type: 'inputChanged'; value: string }
  | { type: 'submitInput'; value: string }
  | {
      type: 'resolveApproval';
      status: 'approved' | 'denied';
    };
```

---

* [ ] Extend `ViewContent`

```ts
interface ViewContent {
    ...
    pendingApprovalHint: string | null;
}
```

---

Run

```bash
pnpm tsc --noEmit
```

Commit

```
feat(tui): add renderer input events
```

---

# Task 2 — Blessed input widgets

## File

```
src/tui/renderers/blessed-renderer.ts
```

---

* [ ] Create

```
promptBar
promptTextarea
approvalHint
```

during `initialize()`.

---

Textarea configuration

```ts
blessed.textarea({
    height: 1,
    inputOnFocus: true,
    mouse: false,
});
```

---

Approval hint

```
bottom:0
height:1
hidden:true
```

---

Widgets are created once only.

---

Run

```
pnpm tsc --noEmit
```

Commit

```
feat(tui): add blessed prompt widgets
```

---

# Task 3 — Keyboard integration

## File

```
src/tui/renderers/blessed/keyboard-handler.ts
```

---

* [ ] Register screen shortcuts

```
Ctrl+C
Tab
Shift+Tab
Escape
1-7
```

---

* [ ] Register textarea handlers

Every edit

```ts
emit({
    type: 'inputChanged',
    value: textarea.getValue(),
});
```

---

Enter

```ts
emit({
    type: 'submitInput',
    value: textarea.getValue(),
});
```

---

Approval shortcuts

Only when approval hint visible

```
a
d
```

emit

```ts
resolveApproval
```

---

Renderer never touches application state.

---

Run

```
pnpm vitest run tests/tui/blessed-renderer.vitest.ts
```

Commit

```
feat(tui): integrate textarea keyboard events
```

---

# Task 4 — Renderer synchronization

## File

```
src/tui/renderers/blessed-renderer.ts
```

---

During render

Synchronize only if necessary

```ts
if (textarea.getValue() !== viewState.input.buffer) {
    textarea.setValue(viewState.input.buffer);
}
```

---

Show prompt

```
chat
agent
```

Hide prompt

```
all other tabs
```

---

Focus

```
chat
agent
```

Blur

```
others
```

---

Approval hint

```ts
show()
hide()
setContent()
```

based on

```
viewState.viewContent.pendingApprovalHint
```

---

Run

```
pnpm vitest run tests/tui/blessed-renderer.vitest.ts
```

Commit

```
feat(tui): synchronize textarea with application state
```

---

# Task 5 — Application integration

## File

```
src/tui/app.ts
```

---

Remove

* raw stdin typing
* raw backspace
* raw enter
* raw approval handling

Keep

* Ctrl+C
* navigation
* terminal lifecycle

---

Handle new renderer events

```ts
switch (event.type) {

case 'inputChanged':
    state.views[state.activeTab].inputBuffer = event.value;
    break;

case 'submitInput':
    handleRenderSubmit(event.value);
    break;

case 'resolveApproval':
    resolveApprovalFromView(event.status);
    break;

}
```

---

Quit behavior

```
Ctrl+C
```

always exits.

```
q
```

only exits when textarea is not focused.

This behavior naturally falls out of Blessed focus management. No explicit `inputFocused` flag is required.

---

Run

```
pnpm vitest run
pnpm tsc --noEmit
```

Commit

```
feat(tui): replace raw input with renderer events
```

---

# Task 6 — ViewModel updates

## File

```
src/tui/presentation/builder.ts
```

---

Populate

```ts
pendingApprovalHint
```

Example

```
[2 pending approvals — press 'a' to approve, 'd' to deny]
```

Otherwise

```
null
```

No renderer formatting logic.

---

Run

```
pnpm vitest run tests/tui/view-model.vitest.ts
```

Commit

```
feat(tui): expose approval hint in ViewContent
```

---

# Task 7 — Tests

## File

```
tests/tui/blessed-renderer.vitest.ts
```

---

* [ ] Widgets created once
* [ ] Widgets survive multiple renders
* [ ] Focus on chat
* [ ] Blur on runtime
* [ ] `inputChanged` emitted
* [ ] `submitInput` emitted
* [ ] `resolveApproval` emitted
* [ ] Approval hint show/hide
* [ ] `q` does not exit while typing
* [ ] Renderer contains no `DashboardSnapshot`
* [ ] Renderer contains no `PerTabState`
* [ ] Renderer contains no `process.exit`

---

Application tests

* [ ] `inputChanged` updates `PerTabState.inputBuffer`
* [ ] `submitInput` routes to existing handlers
* [ ] Raw stdin typing removed
* [ ] Ctrl+C still exits

---

Run

```bash
pnpm vitest run
pnpm tsc --noEmit
```

Commit

```
test(tui): cover blessed textarea workflow
```

---

# Verification

## Automated

```bash
pnpm vitest run

pnpm tsc --noEmit

test -f src/tui/canvas.ts
```

---

## Manual

```bash
node dist/cli.js tui
```

Verify

* ✅ Left pane scrolls independently
* ✅ Right sidebar remains fixed
* ✅ Chat prompt visible on Chat tab
* ✅ Agent prompt visible on Agent tab
* ✅ Other tabs hide prompt
* ✅ Typing updates the prompt live
* ✅ Enter submits and clears the buffer
* ✅ Tab switching preserves each tab's input buffer
* ✅ `q` inserts text while typing
* ✅ `Ctrl+C` always exits
* ✅ Pending approval hint appears when applicable
* ✅ Pressing `a` or `d` resolves approvals
* ✅ Canvas renderer continues working via:

```bash
ALIX_TUI_RENDERER=canvas node dist/cli.js tui
```

---

# Invariants

```bash
grep DashboardSnapshot src/tui/renderers/
# empty

grep PerTabState src/tui/renderers/
# empty

grep "process.exit" src/tui/renderers/
# empty

grep "neo-blessed" src/tui/presentation/
# empty

grep "\.snapshot\|\.\state" src/tui/presentation/formatters/
# empty
```

## Success Criteria

* Blessed uses a native `textarea` for chat and agent input.
* The application remains the sole owner of input state.
* Renderer communicates exclusively through typed `RendererEvent`s.
* Input survives snapshot refreshes and tab switches.
* Left and right panes remain fully independent.
* Canvas renderer remains fully functional and untouched for fallback.
* All tests and type checks pass.

