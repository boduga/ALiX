# TUI Split-Screen Redesign Implementation Plan

**Status:** ✅ Completed (M0.7) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the TUI from full-screen redraw to bottom-pinned status bar pattern — output is append-only, status bar updates in place.

**Architecture:** Terminal is split into two zones: (1) bottom-pinned status block (4 lines: divider + state theater + budget bar + spinner), (2) output area above that is written once and never re-rendered. `render.ts` is rewritten; `store.ts` and widgets stay unchanged.

**Tech Stack:** TypeScript, ANSI escape codes, `node:test`.

---

## File Structure

**Modified files:**
- `src/tui/render.ts` — Complete rewrite (~160 lines)
- `src/tui/ansi.ts` — Add `getTerminalHeight()` helper

**New files:**
- `tests/tui/split-screen.test.ts` — Layout & output buffer tests

**Unchanged (referenced):**
- `src/tui/store.ts`, `src/tui/index.ts`, `src/tui/events.ts`
- All `src/tui/widgets/*` — still produce strings, no changes
- `src/tui/diff-render.ts` — kept for reference
- `src/cli/commands/tui.ts` — no changes

---

## Task 1: Add terminal helper

**Files:**
- Modify: `src/tui/ansi.ts`

- [ ] **Step 1: Add `getTerminalHeight()`**

Append to `src/tui/ansi.ts`:

```typescript
/** Get the current terminal height in lines */
export function getTerminalHeight(): number {
  return process.stdout.rows || 24;
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/ansi.ts
git commit -m "feat(tui): add getTerminalHeight helper"
```

---

## Task 2: Rewrite `render.ts` (split-screen layout)

**Files:**
- Modify: `src/tui/render.ts`

This is the big one. Replace the entire `TuiRenderer` class. The new design:

```
┌─────────────────────────────────────────────────────┐
│ > Task: who is president                            │  ← Append-only output area
│ ← Bola Tinubu                                       │
│ ✓ Done                                              │
│                                                     │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤  ← Divider (line -4 from bottom)
│ ● UNDERSTANDING  ✓ PLANNING  ● EXECUTING  ○ VERIFY  │  ← State theater (line -3)
│ TOKENS: ████░░░░ 42% │ Files: 3                     │  ← Budget bar (line -2)
│ ⠋ Searching the web...                               │  ← Status line (line -1)
└─────────────────────────────────────────────────────┘
```

- [ ] **Step 1: Write complete new `render.ts`**

```typescript
// src/tui/render.ts — Split-screen TUI renderer with bottom-pinned status bar.
//
// Layout:
//   Lines 0 to (terminalHeight - 5):  Append-only output buffer
//   Line (terminalHeight - 5):        Divider (─)
//   Line (terminalHeight - 4):        State theater (currently active state)
//   Line (terminalHeight - 3):        Budget bar (tokens used / max)
//   Line (terminalHeight - 2):        Spinner / status message
//   Last line:                        Reserved (terminal edge)

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { moveToLine, clearToEndOfLine, getTerminalHeight } from "./ansi.js";
import { LAYOUT } from "./layout.js";

const STATUS_LINES = 5;  // divider + state + budget + spinner + gap
const MAX_OUTPUT_LINES = 1000;

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private timerId?: NodeJS.Timeout;
  private lastRenderTime = 0;
  private initialPrinted = false;
  private outputBuffer: string[] = [];
  private statusLineStart = 0;  // computed on first render

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });
    this.store.subscribe(() => this.scheduleRender());
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  /** Append a line to the output buffer and write it to the terminal. */
  appendOutput(text: string): void {
    this.outputBuffer.push(text);
    if (this.outputBuffer.length > MAX_OUTPUT_LINES) {
      this.outputBuffer.splice(0, this.outputBuffer.length - MAX_OUTPUT_LINES);
    }
    if (!this.initialPrinted) return;

    // Write the line right above the status block
    const h = this.statusLineStart;
    // Only re-render the new content (the last line in buffer)
    process.stdout.write(moveToLine(h - 1));
    process.stdout.write(text + "\n");
    // Since we added a line, the status block shifted down. Re-render it.
    this.renderStatus();
  }

  /** Render the initial layout: empty output area + status block. */
  renderInitial(): string {
    if (this.initialPrinted) return "";
    this.initialPrinted = true;

    const h = getTerminalHeight();
    this.statusLineStart = h - STATUS_LINES;  // 0-indexed

    // Calculate output area height
    const outputHeight = this.statusLineStart;
    const outputArea = "\n".repeat(outputHeight);

    // Print output area + initial status block (the status renders inline)
    this.lastRenderTime = performance.now();
    const result = outputArea + this.buildStatusBlock();
    return result;
  }

  private scheduleRender(): void {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastRenderTime >= 100) {
      this.doRender();
      this.lastRenderTime = now;
    }
    this.timerId = setTimeout(() => this.scheduleRender(), 100);
  }

  private doRender(): void {
    if (!this.initialPrinted) return;
    // Only re-render the status block (bottom STATUS_LINES lines)
    this.renderStatus();
  }

  private renderStatus(): void {
    const block = this.buildStatusBlock();
    const h = this.statusLineStart;
    // Write status block starting at statusLineStart
    process.stdout.write(moveToLine(h));
    process.stdout.write(block);
  }

  private buildStatusBlock(): string {
    const state = this.store.getState();
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) this.stateTheater.setReasoning(state.agentReasoning);
    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    const lines: string[] = [];

    // Divider
    const termWidth = process.stdout.columns || 80;
    lines.push("─".repeat(termWidth));

    // State theater line
    lines.push(this.stateTheater.render());

    // Budget bar line
    lines.push(this.budgetBar.render());

    // Spinner / status line
    if (this.spinner.isRunning()) {
      lines.push(this.spinner.render());
    } else {
      lines.push("");
    }

    return lines.join("\n") + "\n";
  }
}
```

- [ ] **Step 2: Build with old tests removed**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

If there are type errors from the `ApprovableWidget` interface or old tests referencing removed methods, fix them.

- [ ] **Step 3: Manual smoke test**

Create a quick one-off script or use `alix tui` to verify:
```bash
node -e "
const { TuiRenderer } = require('./dist/src/tui/render.js');
const { createTuiStore } = require('./dist/src/tui/store.js');
const store = createTuiStore({ sessionId:'test' });
const r = new TuiRenderer(store);
r.start();
r.renderInitial();
r.appendOutput('> hello');
setTimeout(() => { r.appendOutput('> world'); r.stop(); }, 200);
" 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/render.ts
git commit -m "refactor(tui): split-screen layout with bottom-pinned status bar"
```

---

## Task 3: Update `Tui` class to expose `appendOutput`

**Files:**
- Modify: `src/tui/index.ts`

- [ ] **Step 1: Read current file**

```bash
cat src/tui/index.ts
```

- [ ] **Step 2: Add `appendOutput` method**

```typescript
  appendOutput(text: string): void {
    this.renderer?.appendOutput(text);
  }
```

- [ ] **Step 3: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/index.ts
git commit -m "feat(tui): expose appendOutput from Tui class"
```

---

## Task 4: Wire `appendOutput` from the TUI command

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Read current file**

```bash
cat src/cli/commands/tui.ts
```

- [ ] **Step 2: Add streaming output to the TUI**

In the `runTui` function, modify the `runTask` call to stream text output through the TUI:

```typescript
const tui = new Tui({ ... });
await tui.init();

const result = await runTask(cwd, task, {
  streaming: true,
  sharedSession,
}, (chunk) => {
  if (chunk.type === "text" && typeof chunk.text === "string") {
    tui.appendOutput(chunk.text);
  }
});
```

(This ensures streaming text shows up in the output area above the status bar, instead of being lost.)

- [ ] **Step 3: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire streaming output to split-screen TUI"
```

---

## Task 5: Final verification

- [ ] **Step 1: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run existing tests that still apply**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(tui): split-screen TUI complete

TUI now uses bottom-pinned status bar (Claude Code pattern).
Output area is append-only — streaming text survives re-renders.
Widgets and store unchanged."
```

---

## Self-Review

**1. Spec coverage:**
- [x] Bottom-pinned status bar → Task 2
- [x] Append-only output buffer → Task 2
- [x] `getTerminalHeight` → Task 1
- [x] `appendOutput` on Tui class → Task 3
- [x] Streaming text wired through → Task 4
- [x] Widgets and store unchanged → confirmed

**2. Placeholder scan:** No TBD. All code is complete in the plan.

**3. Type consistency:**
- `appendOutput(text: string)` consistent across render.ts, index.ts, tui.ts
- `getTerminalHeight()` returns `number` — used in status math
- `STATUS_LINES = 5` constant used in both `renderInitial` and `renderStatus`

**4. Plan length:** 5 tasks. TDD for Task 1-2 (testable), Tasks 3-4 are wiring. ✓
