# ALiX Terminal UI (TUI) Design Spec

> **For agentic workers:** Use superpowers:writing-plans after this spec is approved to create the implementation plan.

Date: 2026-05-24
Status: Draft

## Goal

Build a terminal-native TUI for ALiX that serves as the **primary interaction surface** — replacing the current stream-to-stdout approach with a polished, interactive REPL experience. The browser Inspector coexists as an alternative view into the same event log.

## Design Principles

1. **REPL, not widget grid** — Append text to scrollback buffer, use ANSI for visual effects. Don't take over the terminal.
2. **Async-first rendering** — Never block on UI. Agent continues while spinner animates.
3. **Event log as source of truth** — Both TUI and Inspector read from the same session events.
4. **Graceful degradation** — Works in basic terminals; enhanced in modern ones (256-color, UTF-8).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ ALiX TUI (src/tui/)                                     │
├─────────────────────────────────────────────────────────┤
│ Input Layer                                             │
│  - readline + custom keymap                             │
│  - History (file-backed)                                │
│  - Multi-line editing                                   │
├─────────────────────────────────────────────────────────┤
│ Render Loop (60fps)                                    │
│  - Diff-based rendering (only update changed lines)    │
│  - Cursor positioning                                   │
│  - ANSI escape sequences                                │
├─────────────────────────────────────────────────────────┤
│ Widgets (append to scrollback)                          │
│  - SpinnerWidget                                        │
│  - ProgressWidget                                      │
│  - StateTheaterWidget (Feature #1)                     │
│  - AgentTreeWidget (Feature #2)                        │
│  - BudgetBarWidget (Feature #3)                        │
│  - SessionBranchWidget (Feature #4)                    │
│  - VerificationTheaterWidget (Feature #5)             │
│  - DiffReelWidget (Feature #6)                         │
│  - MemoryLensWidget (Feature #7)                       │
│  - SoundDesignLayer (Feature #8 - optional/deferred)   │
├─────────────────────────────────────────────────────────┤
│ State Store                                            │
│  - Session events from EventLog                       │
│  - Current state machine state                         │
│  - Agent tree (subagent status)                       │
│  - Token budget                                        │
└─────────────────────────────────────────────────────────┘
            │
            │ Same event log
            ▼
┌─────────────────────────────────────────────────────────┐
│ Browser Inspector (src/ui/)                             │
│  - Timeline view                                       │
│  - Session replay                                      │
│  - Approval panel                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Input Layer (`src/tui/input/`)

**Files:**
- `reader.ts` — Custom readline wrapper with vi/emacs keybindings
- `history.ts` — File-backed command history (`.alix/tui-history`)
- `prompts.ts` — Confirm, select, text input using ANSI prompts

**Behavior:**
- Multi-line input: Enter adds newline, Ctrl+Enter submits
- Up/Down arrows: Navigate history
- Ctrl+C: Interrupt current agent action (not exit)
- Ctrl+Z: Suspend to background
- Tab: Completion for file paths, commands

### 2. Render Loop (`src/tui/render.ts`)

**Files:**
- `render.ts` — 60fps render loop with diff-based updates
- `ansi.ts` — ANSI escape sequence utilities
- `cursor.ts` — Cursor positioning, clearing, save/restore

**Behavior:**
- Render at 60fps when widgets are animating
- Idle at 10fps to handle incoming events
- Clear line for progress updates
- Save/restore cursor position for spinners

### 3. Widgets (`src/tui/widgets/`)

Each widget is a class that:
- Tracks its own state
- Renders to a string buffer
- Returns ANSI-formatted output
- Supports real-time updates

#### StateTheaterWidget (Feature #1)

```
┌─────────────────────────────────────────────────────────┐
│ ● UNDERSTAND   ○ PLAN   ○ EXECUTE   ○ VERIFY   ○ DONE  │
└─────────────────────────────────────────────────────────┘
```

- Animated: Current state pulses
- Shows reasoning snippet when expanded
- Color-coded: working (cyan), success (green), error (red)

#### AgentTreeWidget (Feature #2)

```
┌─────────────────────────────────────────────────────────┐
│ ● orchestrator                                          │
│   ├─ explorer (analyzing src/)          ● RUNNING      │
│   ├─ reviewer (reviewing safe-shell)    ○ PENDING      │
│   └─ test_investigator (finding tests)   ○ PENDING      │
└─────────────────────────────────────────────────────────┘
```

- Real-time updates as subagents spawn/complete
- Branching tree visualization
- Shows role, task, status per node
- Expandable to show findings

#### BudgetBarWidget (Feature #3)

```
┌─────────────────────────────────────────────────────────┐
│ TOKENS: ████████░░░░░░ 67% (42K/62K) │ Files: 12 │ S: 3  │
└─────────────────────────────────────────────────────────┘
```

- Live token budget visualization
- Shows context composition (files, symbols, history)
- Files: number of files in context
- S: search results cached

#### SessionBranchWidget (Feature #4)

```
┌─────────────────────────────────────────────────────────┐
│ SESSION: main ─┬─ experiment-1 (HEAD)                   │
│               └─ fix-memory-leak                        │
│                                                         │
│ Switch: [1] main [2] experiment-1 [3] fix-memory      │
└─────────────────────────────────────────────────────────┘
```

- Branch visualization (like git branch output)
- `alix branch <name>` creates new session branch
- `alix switch <id>` to change active session
- Merge/discard options per branch

#### DiffReelWidget (Feature #6)

```
┌─────────────────────────────────────────────────────────┐
│ ─── Before (src/cli.ts:42) ─────────────────────────────  │
│  const result = await executor.execute(request);       │
│                                                         │
│ +++ After ──────────────────────────────────────────────│
│  const result = await executor.execute(request, {      │
│ +     timeout: config.timeout,                          │
│ +   });                                                 │
└─────────────────────────────────────────────────────────┘
```

- Syntax highlighted before/after
- Line numbers
- Collapsible for large diffs
- Streaming: diff appears as file changes

#### VerificationTheaterWidget (Feature #5)

```
┌─────────────────────────────────────────────────────────┐
│ VERIFICATION ─────────────────────────────────────────  │
│  ✓ typecheck          [████████████████████] PASS      │
│  ◌ npm test           [███░░░░░░░░░░░░░░░░░░░] RUNNING   │
│  ○ build              [░░░░░░░░░░░░░░░░░░░░░░░░░] QUEUED│
│                                                         │
│ RESIDUAL RISK: [■■■□□] 60% verified                    │
│  ⚠ memory/store.ts not tested                         │
│  ⚠ config/loader.ts edge case not covered             │
└─────────────────────────────────────────────────────────┘
```

- Live progress bars per check (typecheck, test, build)
- Pass/fail animations with color coding (green, red)
- Streaming output for long-running checks
- Residual risk summary: percentage verified, uncovered areas
- Warning icons for files not covered by tests

#### MemoryLensWidget (Feature #7)

```
┌─────────────────────────────────────────────────────────┐
│ MEMORY ─────────────────────────────────────────────────  │
│  ▼ Project Context (2 entries)                          │
│      - Level 5 Shell Security implemented               │
│      - SafeShell whitelist covers 36 commands          │
│  ▼ Session Memory (3 entries)                          │
│      - Decision: use SafeShell over explicit catalog    │
│      - Decision: subagents use explorer/reviewer/worker │
│  ▼ Tool Cache (12 entries)                             │
│      - npm test results cached (1m ago)                │
│      - git status cached (30s ago)                      │
│  ▼ Repo Index (stale)                                   │
│      - Last updated: 2h ago (run alix index to refresh) │
└─────────────────────────────────────────────────────────┘
```

- Collapsible sections: Project, Session, Tool, Repo
- Decision cards show reasoning
- Tool cache shows freshness (time since last fetch)
- Repo index shows stale warning
- /memory command in TUI shows this panel

### 4. State Store (`src/tui/store.ts`)

**Files:**
- `store.ts` — Centralized state for TUI rendering
- `events.ts` — Bridge from EventLog to TUI state

**State shape:**
```typescript
interface TuiState {
  sessionId: string;
  agentState: AgentState;
  agentReasoning: string;
  subagents: SubagentNode[];
  tokenBudget: {
    used: number;
    max: number;
    files: number;
  };
  diffs: Diff[];
  pendingApproval: ApprovalRequest | null;
  inputMode: "command" | "multi-line" | "confirm";
}
```

---

## Node.js Stack

```json
{
  "dependencies": {
    "picocolors": "^1.0.0",
    "cli-spinners": "^2.9.0",
    "@inquirer/prompts": "^6.0.0"
  }
}
```

| Package | Purpose | Size |
|---------|---------|------|
| picocolors | Colors, ANSI sequences | 4KB |
| cli-spinners | Animated spinners | 15KB |
| @inquirer/prompts | Interactive prompts | 50KB |

**Total: ~70KB** (vs 500KB+ for Ink)

---

## Commands

```bash
alix              # Start interactive TUI
alix tui          # Alias for alix
alix run "task"   # Run in TUI mode (not --no-stream)
alix chat         # Start chat in TUI
alix branch <name> # Create session branch
alix switch <id>  # Switch session branch
```

**TUI Commands (inside session):**
```
/help          Show available commands
/branch <name> Create new session branch
/switch <id>   Switch to session branch
/memory        Show memory lens (Feature #7)
/approval      Show pending approvals
/diff          Show current diffs
/explain       Expand reasoning for current state
/exit          End session
```

---

## Sound Design Layer (Feature #8 — Deferred)

Audio cues for presence without distraction. **Optional, off by default.**

**Sounds:**
| Event | Sound | Purpose |
|-------|-------|---------|
| Thinking | Soft ambient tone | Agent is processing |
| Tool start | Subtle click | Visual cue supplement |
| Tool complete | Soft chime | Confirmation |
| Approval needed | Gentle bell | Attention without alarm |
| Error | Low tone | Something needs attention |
| Success | Positive chime | Task complete |
| Verification pass | Ascending tone | Tests green |
| Verification fail | Descending tone | Tests red |

**Implementation:**
- Optional dependency: `play-sound` or native `node:audio`
- Config: `config.tui.sounds: boolean` (default: false)
- User must opt-in
- Can be toggled with `/sounds on|off` command

---

## Coexistence with Browser Inspector

**Shared state:** Both TUI and Inspector read from `.alix/sessions/<id>/events.jsonl`

**TUI responsibilities:**
- Primary interaction surface
- Real-time output (spinners, progress)
- User input (commands, approvals)
- Subagent tree visualization
- Session branching

**Inspector responsibilities:**
- Historical analysis
- Session replay
- Compare multiple sessions
- Token usage charts
- Approval queue (alternative to TUI)

**Communication:** None needed — both read the same event log. TUI writes events, Inspector reads them.

---

## Error Handling

1. **Terminal too small** — If viewport < 80x24, show warning and continue with minimal mode
2. **No ANSI support** — Fall back to plain text output (same as current)
3. **Render failure** — Catch exceptions, fall back to plain output for that widget
4. **Stuck animation** — If spinner runs > 60s, show warning and allow manual input

---

## Self-Review

- [x] No placeholder code — all widgets have concrete rendering logic
- [x] Architecture matches REPL approach, not widget grid
- [x] Node.js stack is specified (not Rust)
- [x] Features 1-8 are covered:
  - StateTheaterWidget (Feature #1)
  - AgentTreeWidget (Feature #2)
  - BudgetBarWidget (Feature #3)
  - SessionBranchWidget (Feature #4)
  - VerificationTheaterWidget (Feature #5)
  - DiffReelWidget (Feature #6)
  - MemoryLensWidget (Feature #7)
  - SoundDesignLayer (Feature #8 - optional, deferred)
- [x] Browser Inspector coexistence is specified
- [x] Commands are defined
- [x] Error handling is specified

---

## Next Steps

After approval:
1. Invoke `superpowers:writing-plans` to create implementation plan
2. Implement TUI components in order: render loop → input → widgets → state store
3. Test with existing agent runs
4. Add TUI commands to CLI