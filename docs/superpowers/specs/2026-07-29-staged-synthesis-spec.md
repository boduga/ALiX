# Staged Synthesis + Progress Ledger — Design Spec

**Status:** Draft  
**Date:** 2026-07-29  
**Prerequisite:** None (standalone change to task-loop.ts)

---

## 1. Problem

The agent loop has one synthesis phase: after all tool calls complete, the model writes a summary. Between the user's initial request and that final summary, the operator sees only raw tool calls with no narrative context on what the agent is doing or why.

This creates two pain points:

1. **Silent execution:** during a long sequence of tool calls, the operator has no sense of progress
2. **Lost context on interruption:** if the operator interrupts mid-task (Ctrl+C), there's no record of what was done or what was pending

## 2. Solution

Two complementary mechanisms:

### 2a. Staged Synthesis

The loop triggers a **progress checkpoint** based on execution progress, not iteration count. The checkpoint asks the model for a brief (1–3 sentence) status update. Checkpoints fire when any of these thresholds are crossed since the last checkpoint:

| Trigger | Threshold | Rationale |
|---|---|---|
| Successful tool calls | ≥5 consecutive successful tool calls | Prevents long silent batches |
| Elapsed wall-clock | ≥30 seconds of continuous execution | Catches slow single tools (e.g. long builds) |
| Milestone transition | Execution phase → Verification phase (see Mode-Aware Prompts spec) | Natural breakpoint |

Checkpoints are suppressed if the model has already emitted substantive narrative (>80 chars of non-tool text) within the current window — we don't want to interrupt a model that's already talking.

The checkpoint prompt:

```
[Progress checkpoint — brief status update requested]
What progress have you made since the last checkpoint? 
What are you working on next? (1–3 sentences)
```

The model's response feeds both the operator view and the Progress Ledger (below).

### 2b. Progress Ledger

A runtime-owned structured ledger that tracks execution progress. The ledger is a plain-text block maintained by the loop and injected into the message list before each model turn.

**Format:**

```
[Progress Ledger]
  ✓ Identified registration files to modify
  ✓ Updated user registration endpoint
  ✓ Wrote unit tests for new registration path
  ⏳ Running typecheck
  ☐ Running integration tests
  ☐ Verifying migration rollback
```

**Status symbols:**

| Symbol | Meaning |
|---|---|
| `✓` | Completed |
| `⏳` | Current / in-progress (only one at a time) |
| `☐` | Pending / not yet attempted |
| `✗` | Failed / abandoned |

**Ownership and rules:**

- The **runtime** owns the ledger, not the model. The model suggests updates via a new `updateLedger(action, items)` instruction embedded in the checkpoint prompt.
- Actually, simpler: the model's checkpoint response is parsed to extract completed/in-progress items. Or simplest: the model just writes free text and the ledger is purely operator-facing (not parsed).
- **Recommended approach:** The model does not manage the ledger directly. The ledger is built from:
  - Tool call summaries (see Tool Summary spec) — each completed tool becomes a `✓ <summary>` line
  - Milestone markers — when mode shifts, the runtime inserts a heading like `--- Execution ---`
  - The operator sees the ledger in the agent-view scrollback

This keeps the ledger honest (it reflects actual tool execution, not model claims) and requires no new tool calls.

**Rendering in TUI:**

The ledger appears in the agent-view scrollback above the prompt row, styled dim (`\x1b[2m`), collapsed to the last N (≤10) entries by default. The operator can expand it with a keybinding.

## 3. Implementation

### 3.1 Progress checkpoint in task-loop.ts

Location: after the tool-execution loop, before the iteration continues or completion check fires.

```typescript
// ── Progress checkpoint ──────────────────────────────────
// If the model has been executing tools silently, ask for
// a brief status update so the operator stays oriented.
const TOOLS_SINCE_CHECKPOINT = 5;
const WALL_CLOCK_MS = 30_000;

if (
  toolCallsExecutedSinceCheckpoint >= TOOLS_SINCE_CHECKPOINT ||
  (wallClockSinceCheckpoint >= WALL_CLOCK_MS && toolCallsExecutedSinceCheckpoint > 0)
) {
  // Reset counters
  toolCallsExecutedSinceCheckpoint = 0;
  wallClockSinceCheckpoint = Date.now();

  // Only inject if the model hasn't already narrated
  const lastModelText = text.trim();
  if (lastModelText.length < 80) {
    messages.push({
      role: "user",
      content: "[Progress checkpoint — brief status update requested]\n" +
        "What progress have you made since the last checkpoint?\n" +
        "What are you working on next? (1–3 sentences)"
    });
    continue;
  }
}
```

### 3.2 Ledger construction

The ledger is built outside the model's turn, derived from tool execution:

```typescript
interface LedgerEntry {
  status: "completed" | "current" | "pending" | "failed";
  summary: string;    // from tool call summary or synthesised
  timestamp: number;
}

class ProgressLedger {
  private entries: LedgerEntry[] = [];

  /** Called after each tool call completes. */
  recordToolCall(toolCall: ToolCallRequest, succeeded: boolean): void {
    const summary = toolCall.summary ?? `${toolCall.name}`;
    this.entries.push({
      status: succeeded ? "completed" : "failed",
      summary,
      timestamp: Date.now(),
    });
  }

  /** Mark the most recent entry as "current" (in-progress). */
  markCurrent(): void { ... }

  /** Render to plain text for display. */
  render(maxLines = 10): string { ... }
}
```

### 3.3 Ledger injection

The rendered ledger is injected into messages before each model turn, positioned between the workspace/context sections and the conversation history. It serves as a real-time status reference for both the model and the operator.

## 4. Files Changed

| File | Change |
|---|---|
| `src/run/task-loop.ts` | Add checkpoint counters, injection logic, ProgressLedger class |
| `src/tui/views/agent-view.ts` | Render ledger in scrollback (dim style, collapsible) |
| `src/agent/system-prompt.ts` | No change (checkpoint prompt is hardcoded in the loop, not part of the base prompt) |

## 5. Non-goals

- The ledger is NOT parsed or enforced. It's a display aid, not a state machine.
- The model does NOT manage the ledger directly — no new tool calls for "update ledger"
- Checkpoints are NOT guaranteed at exact intervals — they're best-effort
- The ledger does NOT persist across sessions (no serialization on first iteration)

## 6. Future work (not in scope)

- Persistent ledger for `--resume` sessions
- Ledger exported as structured JSON for CI dashboards
