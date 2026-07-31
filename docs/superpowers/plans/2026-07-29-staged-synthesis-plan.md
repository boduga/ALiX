# Staged Synthesis + Progress Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject mid-execution progress checkpoints derived from tool-call milestones (not iteration count) and maintain a runtime-owned progress ledger of completed/in-progress/pending work.

**Architecture:** Add progress-checkpoint counters to task-loop.ts — fires after N successful tool calls or 30s wall-clock without synthesis. The ProgressLedger class accumulates entries from tool-call summaries and renders a dim-style block in the agent-view scrollback. The ledger is model-independent (derived from tool execution, not parsed from text).

**Tech Stack:** TypeScript, TUI (TerminalCanvas), task-loop.ts

## Global Constraints

- Checkpoints must not fire if the model is already providing narrative
- Ledger is purely operator-facing — the model does not manage it directly
- No new tool calls or schema changes
- Ledger does not persist across sessions (first iteration)

---
## File Structure

| File | Role | Change |
|---|---|---|
| `src/run/progress-ledger.ts` | NEW — runtime-owned progress tracker | Class with `recordToolCall()`, `markCurrent()`, `render()` |
| `src/run/task-loop.ts` | Agent loop | Add checkpoint counters, injection logic, ProgressLedger instance |
| `src/tui/views/agent-view.ts` | TUI scrollback | Render ledger entries in dim style below the prompt row |

---

### Task 1: Create ProgressLedger class

**Files:**
- Create: `src/run/progress-ledger.ts`

**Interfaces:**
- Produces: `ProgressLedger` class

The ledger accumulates entries from tool-call execution. Each entry records one completed or failed tool call. The `render()` method produces a plain-text block for display.

- [ ] **Step 1: Create the file with types and class**

```typescript
// src/run/progress-ledger.ts
// Runtime-owned progress tracker. Derived FROM tool execution —
// the model never writes to the ledger directly.

export type LedgerStatus = "completed" | "failed" | "pending";

export interface LedgerEntry {
  status: LedgerStatus;
  summary: string;
  timestamp: number;
}

export interface LedgerSection {
  label: string;    // e.g. "Research", "Execution"
  entries: LedgerEntry[];
}

export class ProgressLedger {
  private sections: LedgerSection[] = [];
  private currentSection = "";

  /** Start a new section (e.g. "Execution", "Verification"). */
  startSection(label: string): void {
    this.currentSection = label;
    this.sections.push({ label, entries: [] });
  }

  /** Record a completed/failed tool call. */
  recordToolCall(toolName: string, summary: string | undefined, succeeded: boolean): void {
    const text = summary || toolName;
    const section = this.sections.find(s => s.label === this.currentSection)
      ?? this.sections[this.sections.length - 1]
      ?? { label: this.currentSection || "Tasks", entries: [] };
    if (!this.sections.includes(section)) this.sections.push(section);
    section.entries.push({
      status: succeeded ? "completed" : "failed",
      summary: text,
      timestamp: Date.now(),
    });
  }

  /** Render the last N entries across all sections as a plain-text block. */
  render(maxEntries = 10): string {
    const all: { label: string; entry: LedgerEntry }[] = [];
    for (const s of this.sections) {
      for (const e of s.entries) {
        all.push({ label: s.label, entry: e });
      }
    }
    const slice = all.slice(-maxEntries);
    if (slice.length === 0) return "";

    const lines: string[] = [];
    let lastLabel = "";
    for (const { label, entry } of slice) {
      if (label !== lastLabel) {
        lines.push(`─── ${label} ───`);
        lastLabel = label;
      }
      const symbol = entry.status === "completed" ? "✓"
        : entry.status === "failed" ? "✗"
        : "○";
      lines.push(`  ${symbol} ${entry.summary}`);
    }
    return lines.join("\n");
  }

  /** Reset all state (for new task). */
  reset(): void {
    this.sections = [];
    this.currentSection = "";
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean build (no importers yet).

---

### Task 2: Wire checkpoints into task-loop.ts

**Files:**
- Modify: `src/run/task-loop.ts`

Add the checkpoint counters and injection logic after the tool-execution loop. The checkpoint fires when ≥5 successful tool calls or ≥30s wall-clock have elapsed since the last checkpoint, AND the model's last text is under 80 characters (meaning it hasn't narrated recently).

- [ ] **Step 1: Add checkpoint state variables**

Near the top of `runTaskLoop`, after existing trackers:

```typescript
// ── Progress checkpoint state ──────────────────────────
let toolCallsSinceCheckpoint = 0;
let lastCheckpointWallClock = Date.now();
const CHECKPOINT_TOOL_CALL_THRESHOLD = 5;
const CHECKPOINT_WALL_CLOCK_MS = 30_000;
```

- [ ] **Step 2: Add ProgressLedger instance**

```typescript
const progressLedger = new ProgressLedger();
```

- [ ] **Step 3: Record tool calls in the ledger**

After line 530 (`const toolResult = await handleToolCall(...)`), add:

```typescript
// Record in progress ledger
progressLedger.recordToolCall(
  toolCall.name,
  (toolCall as any).summary,  // may be undefined
  !toolResult.error,
);
```

Also increment the counter:

```typescript
if (!toolResult.error) {
  toolCallsSinceCheckpoint++;
}
```

- [ ] **Step 4: Inject checkpoint after the tool-execution loop**

After the `for (const toolCall of toolCalls)` loop (after line 591), before the mutation tracking section, inject the checkpoint logic:

```typescript
// ── Progress checkpoint ──────────────────────────────────
const wallClockElapsed = Date.now() - lastCheckpointWallClock;
const modelText = text.trim();
const modelAlreadyNarrating = modelText.length >= 80;

if (
  !modelAlreadyNarrating &&
  (toolCallsSinceCheckpoint >= CHECKPOINT_TOOL_CALL_THRESHOLD ||
   (wallClockElapsed >= CHECKPOINT_WALL_CLOCK_MS && toolCallsSinceCheckpoint > 0))
) {
  toolCallsSinceCheckpoint = 0;
  lastCheckpointWallClock = Date.now();

  messages.push({
    role: "user",
    content:
      "[Progress checkpoint — brief status update requested]\n" +
      "What progress have you made since the last checkpoint?\n" +
      "What are you working on next? (1-3 sentences)",
  });
  continue;  // Skip to next iteration to get the model's response
}
```

- [ ] **Step 5: Inject ledger into messages for the model**

Before the model request (before the `config.model.streaming` check around line 326), inject the rendered ledger as a system message:

```typescript
const ledgerText = progressLedger.render(10);
if (ledgerText) {
  messages.push({
    role: "user",
    content: `[Progress Ledger]\n${ledgerText}`,
  });
}
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 3: Render ledger in TUI agent-view

**Files:**
- Modify: `src/tui/views/agent-view.ts`

- [ ] **Step 1: Add ledger rendering**

The ledger is part of `PerTabState` or derived from `ToolCallRequest` history. If the ledger lives in the session, the TUI reads it from the snapshot. For now, render it from a new field on `PerTabState`:

```typescript
// In PerTabState (src/tui/state.ts)
export interface PerTabState {
  // ...existing fields
  progressLedger?: string;  // NEW — rendered text of the progress ledger
}
```

In `agent-view.ts`, after the approval section and before the scrollback offset, add:

```typescript
// Progress ledger — dim-style status block
if (ctx.perTab.progressLedger) {
  const ledgerLines = ctx.perTab.progressLedger.split("\n");
  for (const line of ledgerLines) {
    allLines.push({ kind: 'plan', text: line, isFirst: false });  // re-use dim plan style
  }
}
```

- [ ] **Step 2: Sync ledger from snapshot**

In `app.ts` `syncPendingApprovals` (or a new `syncProgressLedger`), copy the ledger text from the snapshot to `perTab.progressLedger`. Add `progressLedger` to `DashboardSnapshot`:

```typescript
// In snapshot.ts
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata | null;
  readonly daemon: DaemonMetricsSnapshot | null;
  readonly approvals: ApprovalSnapshot | null;
  readonly runtime: RuntimeSnapshot | null;
  readonly sops: SopSnapshot | null;
  readonly policy: PolicySnapshot | null;
  readonly progressLedger?: string;  // NEW
}
```

In `snapshot-builder.ts`, read the ledger from `agentSession.getState()` or equivalent.

- [ ] **Step 3: Build and verify**

```bash
npm run build
npx vitest run tests/tui/
```

Expected: all tests pass.

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Run full test suite**

```bash
npm run build
npx vitest run
```

Expected: all tests pass (no behavioral change when checkpoints don't fire).

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(synthesis): add progress checkpoints and progress ledger

Adds execution-progress-driven checkpoints that fire after 5 successful
tool calls or 30s wall-clock, asking the model for a brief status update.
ProgressLedger class derives a structured status view from tool execution
(not model text). Rendered in TUI agent-view as a dim-style block.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
