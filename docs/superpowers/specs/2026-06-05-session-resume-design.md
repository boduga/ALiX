# Session Resume Design

**Status:** ✅ Completed (M0.7) — Design implemented and committed to main.

**Goal:** Allow users to resume interrupted `alix run` sessions. If a session hits max iterations, is cancelled mid-execution, or the user wants to continue where they left off, they can resume with the prior context intact — no re-planning, no re-execution of completed steps.

**Why this matters:** This is the #1 UX gap. Currently, if a session is interrupted, all context is lost. The user must start from scratch. With resume, long-running tasks become interruptible and iterative.

---

## 1. UX Summary

```bash
# List past sessions
alix session list
# → Shows recent sessions: session ID, task preview, status (completed/failed/interrupted), timestamp

# Resume a specific session
alix run --resume <session-id>
# → Rebuilds context from saved messages and events
# → Agent continues from the last exchange
# → If plan existed, it's re-injected
# → Previously completed tool calls are NOT re-executed

# Also works with TUI
alix tui
# → Shows active session with resume option for interrupted ones
```

**Key UX decisions:**
- Session listing uses the existing `.alix/sessions/` directory — no new storage
- `--resume` flag on `alix run` is the primary resume mechanism
- `alix session list` is the discoverability command
- Resume is always opt-in (user must specify `--resume`)

---

## 2. What Needs to Persist

| Artifact | Current State | Resume Needs |
|----------|---------------|--------------|
| Event log (`events.jsonl`) | ✅ Always saved | Core — reconstructs sequence |
| Message history | ❌ Not saved in agent runs | **Must persist `messages.jsonl`** |
| Approved plan | ✅ Saved to `.alix/plans/<id>.md` | Read at resume time |
| Scope state | ❌ Not persisted | **Must persist `scope.json`** |
| Run counters | ❌ Not persisted | Can infer from events; save `state.json` for accuracy |
| Checkpoints | ✅ On disk | Already preserved |
| Context bundle | ❌ Ephemeral | Recompiled at resume (fast, cheap) |
| Memory context | ✅ In memory store | Already preserved |

### 2.1 New Persisted Files

Each session directory (`<cwd>/.alix/sessions/<id>/`) gains:

**`messages.jsonl`** — The full conversation history (user → model → tool results → model …)
```jsonl
{"role":"user","content":"add healthz endpoint"}
{"role":"assistant","content":"I'll add a healthz endpoint...","tool_calls":[...]}
{"role":"tool","tool_call_id":"...","content":"..."}
{"role":"assistant","content":"Done. The healthz endpoint is added."}
```

**`scope.json`** — ScopeTracker state
```json
{"approvedPaths":["src/routes/health.ts","src/routes/index.ts"],"deniedPaths":[],"pendingApprovals":[]}
```

**`state.json`** — StateMachine counters + termination reason
```json
{"iterations":3,"repairs":0,"fileChanges":2,"shellCommands":5,"lastState":"executing","reason":"max_iterations"}
```

### 2.2 Existing Files (already preserved)

- `events.jsonl` — append-only event log (already working)
- `checkpoints/` — file checkpoints for rollback (already working)

### 2.3 Plan File (already preserved)

`.alix/plans/<session-id>.md` — the approved plan, if one existed.

---

## 3. Architecture

### 3.1 Two New Files in `src/session/`

**`src/session/persist.ts`** — Save session state at key points
- `saveMessages(sessionDir, messages)` — append messages to `messages.jsonl`
- `saveScope(sessionDir, scope)` — write `scope.json`
- `saveState(sessionDir, state)` — write `state.json`
- `saveAll(sessionDir, messages, scope, state)` — batch save

**`src/session/resume.ts`** — Load and reconstruct session state
- `listSessions(cwd)` — scan `.alix/sessions/` for directories with events.jsonl, return metadata
- `loadMessages(sessionDir)` — read `messages.jsonl`
- `loadScope(sessionDir)` — read `scope.json`
- `loadState(sessionDir)` — read `state.json`
- `reconstructSession(cwd, sessionId)` — orchestrate full reconstruction

### 3.2 Integration Points

**In `agent-loop.ts` (runTask):**
- After `initAgent()`, if resuming:
  - Load messages from `messages.jsonl` instead of starting with just the task
  - Load scope state and inject into `ScopeTracker`
  - Load state machine counters and set on `TaskStateMachine`
  - Load plan from `.alix/plans/<id>.md` if it exists
  - Skip the plan phase (plan already approved)
  - Skip context compilation (or recompile — it's fast)
- At the end of each iteration in the task loop, call `saveMessages()` and `saveState()` to persist incremental state
- On session end, save final state

**In `cli.ts`:**
- Add `alix session list` — scan sessions directory, show table
- Add `alix session show <id>` — show session details and last events
- Add `--resume <id>` to `alix run`

**In `task-loop.ts`:**
- After each model response + tool execution cycle, persist incremental state
- This is the safety net: even if the process is killed, the last iteration is saved

### 3.3 Message Persistence Strategy

Messages must be saved **after each complete iteration** (model response + tool results). This is the critical state checkpoint.

```
Iteration 1:
  user → model → tool calls → tool results → model (completes)
  ↓
  Append all messages to messages.jsonl

Iteration 2:
  model → tool calls → tool results → model (completes)
  ↓
  Append new messages to messages.jsonl
```

**Append-only:** Write new messages at the end of `messages.jsonl`, never re-read and rewrite. This matches the `events.jsonl` pattern.

**On resume:**
1. Read `messages.jsonl` into `NormalizedMessage[]`
2. Read `state.json` to get counters
3. Read `scope.json` to restore scope
4. Init agent with prior session ID and directory
5. Provider sees the full message history — no tool call is repeated because tool results are in the history
6. The model picks up where it left off

### 3.4 What Happens on Resume

```
alix run --resume <session-id>

1. cli.ts parses --resume
2. Reads scope.json → restores ScopeTracker
3. Reads state.json → restores state machine counters
4. Reads messages.jsonl → full conversation history
5. Reads plan file (if exists) → re-injects into system prompt
6. Calls initAgent() with existing sessionId + sessionDir
7. Skips plan phase (already approved)
8. Task loop starts with full message history
9. Provider sees last assistant message with tool results
10. No tools re-executed — they're already in the message history
11. Model continues naturally
```

---

## 4. Safety & Edge Cases

| Case | Behavior |
|------|----------|
| Resume a completed session | Warn and refuse ("Session already completed") |
| Resume with missing messages.jsonl | Partial resume: reconstruct from events.jsonl (lossy) |
| Resume with missing scope.json | Fresh scope (re-approve paths) |
| Resume after git changes | Warn that working tree differs from checkpoint state |
| Resume with different config | Use current config; warn if provider changed |
| Resume in different cwd | Error: session was created in a different directory |
| Kill during message write | At most one iteration lost (next resume picks up from last complete save) |
| Resume + --no-plan | Plan is already approved; --no-plan respects that (don't re-plan) |
| Resume a session that had `--session-mode bypass` | Same mode applied; warn if new mode differs |

### 4.1 Fallback: Event Reconstruction

If `messages.jsonl` is missing (e.g., old session created before this feature), reconstruct from `events.jsonl`:
1. Read all `agent.message` + `user.message` events in sequence
2. Read `tool.completed` / `tool.failed` events
3. Build a best-effort `NormalizedMessage[]` array
4. Mark as "reconstructed" (less reliable — model may behave differently)

---

## 5. Implementation Phases

### Phase 1: Persistence Layer (core)
- `src/session/persist.ts` — save messages, scope, state
- `src/session/resume.ts` — load and reconstruct

### Phase 2: Integration
- Wire `saveAll()` into `task-loop.ts` (after each iteration)
- Wire `reconstructSession()` into `agent-loop.ts` resume path
- Save `scope.json` from `ScopeTracker` on state transitions

### Phase 3: CLI
- `alix session list` — scan and display sessions
- `alix session show <id>` — detail view
- `alix run --resume <id>` — resume flag

### Phase 4: Polish
- Fallback event reconstruction
- Warnings for edge cases
- Tests

---

## 6. Files Changed

| File | Change |
|------|--------|
| `src/session/persist.ts` | **NEW** — message, scope, state persistence |
| `src/session/resume.ts` | **NEW** — session reconstruction |
| `src/cli.ts` | Add `alix session` subcommands + `--resume` flag |
| `src/agent/agent-loop.ts` | Resume path in `runTask()` |
| `src/run/task-loop.ts` | Incremental state persistence after each iteration |
| `src/run.ts` | Add `resumeSessionId` to `RunOpts` |
| `src/autonomy/scope-tracker.ts` | Add `toJSON()` / `fromJSON()` for serialization |
| `src/autonomy/state-machine.ts` | Add `toJSON()` / `fromJSON()` for serialization |
| `src/events/event-log.ts` | No changes needed (already append-only, restartable) |
| `tests/` | New tests for persist, resume, CLI |
