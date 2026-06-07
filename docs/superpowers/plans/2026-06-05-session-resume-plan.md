# Session Resume Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-05-session-resume-design.md`
**Goal:** Make interrupted `alix run` sessions resumable via `--resume <session-id>`.
**Risk:** Medium — touches agent loop and task loop, but changes are additive (new files + small hooks).

---

## Tasks

### Task 1: State serialization support in existing types

**Files:** `src/autonomy/scope-tracker.ts`, `src/autonomy/state-machine.ts`

Add `toJSON()` / `fromJSON()` to `ScopeTracker` and `TaskStateMachine`.

**ScopeTracker changes:**
```typescript
class ScopeTracker {
  toJSON(): ScopeSnapshot {
    return {
      approvedPaths: [...this.approvedPaths],
      deniedPaths: [...this.deniedPaths],
      pendingApprovals: this.pendingApprovals.map(a => ({ path: a.path, type: a.type })),
    };
  }
  static fromJSON(snapshot: ScopeSnapshot): ScopeTracker {
    const st = new ScopeTracker(/* ... */);
    st.approvedPaths = new Set(snapshot.approvedPaths);
    st.deniedPaths = new Set(snapshot.deniedPaths);
    st.pendingApprovals = snapshot.pendingApprovals;
    return st;
  }
}
```

**TaskStateMachine changes:**
```typescript
class TaskStateMachine {
  toJSON(): StateSnapshot {
    return { ...this.counters, state: this.state, reason: this.reason };
  }
  static fromJSON(snapshot: StateSnapshot, onTransition, limiter): TaskStateMachine {
    const sm = new TaskStateMachine(limiter, onTransition);
    sm.counters = { ...snapshot };
    sm.state = snapshot.state;
    return sm;
  }
}
```

### Task 2: Create session persistence module

**File:** `src/session/persist.ts` (NEW)

Functions:
- `saveMessages(sessionDir, messages)` — JSONL append to `messages.jsonl`
- `saveScope(sessionDir, scope)` — atomic write to `scope.json`
- `saveState(sessionDir, state)` — atomic write to `state.json`
- `saveSessionState(sessionDir, { messages, scope, state })` — batch save all three

All operations are idempotent and append-only (messages) or atomic-write (scope/state).

### Task 3: Create session resume module

**File:** `src/session/resume.ts` (NEW)

Functions:
- `listSessions(cwd)` — scan `.alix/sessions/`, read `state.json` + first user event for each dir
- `sessionInfo(cwd, sessionId)` — load metadata for one session
- `loadMessages(sessionDir)` — parse `messages.jsonl`
- `loadScope(sessionDir)` — parse `scope.json` → `ScopeTracker`
- `loadState(sessionDir)` — parse `state.json` → state machine counters
- `loadPlan(cwd, sessionId)` — read `.alix/plans/<session-id>.md`
- `reconstructSession(cwd, sessionId)` — full orchestration: load all artifacts, validate cwd/session match, return reconstructed state
- `ensureSessionDir(sessionDir)` — create directory if missing

Return type:
```typescript
type ReconstructedSession = {
  messages: NormalizedMessage[];
  scopeTracker: ScopeTracker | null;
  stateSnapshot: StateSnapshot | null;
  planContent: string | null;
  completed: boolean;  // true if session.ended event found
  sessionDir: string;
};
```

### Task 4: Wire persistence into task loop

**File:** `src/run/task-loop.ts`

After each iteration completes (after tool calls + model response cycle), call `saveSessionState()`:
- Save messages from `TaskLoopDeps.messages`
- Save scope from `scopeTracker.toJSON()`
- Save state from `stateMachine.toJSON()`

Best insertion point: after `handleToolCall` returns and before next iteration's provider call.

**Performance note:** JSONL append is O(1). Scope/state writes are tiny (<1KB). No measurable perf impact.

### Task 5: Wire resume into agent loop

**File:** `src/agent/agent-loop.ts`

Add resume block right after `initAgent()`:

```typescript
// Resume path — reconstruct state from prior session
if (opts?.resumeSessionId) {
  const { reconstructSession } = await import("../session/resume.js");
  const reconstructed = await reconstructSession(cwd, opts.resumeSessionId);

  if (reconstructed.completed) {
    return { sessionId: ctx.sessionId, summary: "Session already completed.", streamed: opts?.streaming };
  }

  // Use reconstructed messages instead of fresh task
  messages = reconstructed.messages;

  // Restore scope if available
  if (reconstructed.scopeTracker) {
    // apply to the fresh scopeTracker
  }

  // Restore state machine counters
  if (reconstructed.stateSnapshot) {
    // set counters on stateMachine
  }

  // Load plan
  if (reconstructed.planContent) {
    approvedPlanContent = reconstructed.planContent;
  }

  // Skip plan phase
  opts = { ...opts, planMode: false };
}
```

### Task 6: CLI commands and flags

**File:** `src/cli.ts`

Add `alix session` subcommand group:

```typescript
// alix session list
if (command === "session" && args[0] === "list") {
  const { listSessions } = await import("./session/resume.js");
  const sessions = await listSessions(cwd);
  // Print table: ID | Task | Status | Iterations | Date
  process.exit(0);
}

// alix session show <id>
if (command === "session" && args[0] === "show") {
  // Print session details: config, events summary, scope, outcome
  process.exit(0);
}
```

Add `--resume` to `alix run`:

```typescript
// In the alix run handler:
if (resumeSessionId) {
  opts.resumeSessionId = resumeSessionId;
}
```

### Task 7: Wire state persistence in task loop

**File:** `src/run/task-loop.ts`

Insert save calls in the main loop body. The key is saving after each complete model-turn (after tool results are received and processed, before the next model call).

The simplest and safest approach: save at the top of each iteration (before provider call), so if the process dies mid-iteration, we resume from the last complete turn.

Actually, better: save at the END of each iteration, after the model has responded and tools have been called. This guarantees we save only complete turns.

Insert after line that handles tool results, around where the `completed` flag is checked.

### Task 8: Create `src/session/index.ts` barrel export

**File:** `src/session/index.ts` (NEW)

```typescript
export { saveMessages, saveScope, saveState, saveSessionState } from "./persist.js";
export { listSessions, loadMessages, loadScope, loadState, loadPlan, reconstructSession } from "./resume.js";
```

### Task 9: Add cli.ts session subcommand imports

Add `--resume <id>` flag parsing to the `alix run` handler in `cli.ts`.
Add `session` subcommand (list, show) to `cli.ts`.

### Task 10: Tests

**Files:** `tests/session/persist.test.ts` (NEW), `tests/session/resume.test.ts` (NEW)

Test persistence:
- Save messages → append to JSONL → read back matches
- Save scope → write → read back matches original
- Save state → write → read back matches
- Batch save + concurrent safety

Test resume:
- Resume from saved messages → correct ordering
- Resume with missing scope → null scope
- Resume completed session → refused
- Resume with plan → plan loaded
- listSessions → returns correct metadata
- sessionInfo → returns correct fields

---

## Build Sequence

1. Task 1 (serialization support) — prerequisite
2. Task 2 (persist.ts) — depends on nothing
3. Task 3 (resume.ts) — depends on Task 2
4. Task 4 (wire into task loop) — depends on Task 2
5. Task 5 (wire into agent loop) — depends on Task 3
6. Task 6 (CLI) — depends on Task 3
7. Task 7 (state persistence wiring) — depends on Task 4
8. Task 8 (barrel export) — after Tasks 2-3
9. Task 9 (CLI wiring) — after Task 6
10. Task 10 (tests) — after everything else

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `messages.jsonl` grows large | Append-only; use same truncation/compression as events.jsonl |
| Resume with wrong config warns silently | Warn prominently if provider differs |
| Scope state gets out of sync | Re-approve paths on resume if scope.json is stale |
| Messages get duplicated on resume | Track the last-saved message index; skip duplicates |
| Performance overhead of per-iteration save | JSONL append is <1ms; scope/state writes are <5ms |
