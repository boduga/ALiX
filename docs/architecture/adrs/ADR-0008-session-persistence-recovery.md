# ADR-0008: Session Persistence and Recovery Model

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** Session lifecycle, persistence, checkpointing, resume, and crash recovery

---

## 1. Context

ALiX operates as an interactive CLI session that may last hours or days, spanning multiple turns, tool calls, subagent dispatches, and evolution phases. The session carries conversational state (messages), execution state (scope, state machine counters), evidence artifacts, and file-level changes.

The session must survive:

- Process termination (crash, SIGTERM, laptop sleep)
- Intentional restart (user runs `alix --resume <session-id>`)
- Long-running operations that outlive a single process invocation

The problem space has several dimensions:

- **Durability:** What state must survive a crash? What can be safely lost?
- **Replayability:** On resume, how does the system reconstruct its prior state accurately?
- **Performance:** Persistence must not block the interactive loop. Users should not wait for I/O.
- **Debuggability:** A corrupted session should fail detectably, not silently produce wrong results.
- **Cleanup:** Sessions accumulate state. Old or failed sessions should be manageable without manual filesystem surgery.

---

## 2. Decision

ALiX adopts an **append-first persistence model with periodic atomic snapshots and JSONL-based event logs**. The session directory is the single source of truth for resume.

### 2.1 Session Directory Structure

```
.alix/sessions/<session-uuid>/
├── messages.jsonl          # Append-only message log (NormalizedMessage[])
├── scope.json              # Latest scope snapshot (atomic write)
├── state.json              # Latest state machine snapshot (atomic write)
├── events.jsonl            # Append-only event log (subagent, tool, lifecycle events)
└── plan.md                 # Current session plan (if active)
```

Each session gets a UUID directory under `.alix/sessions/`. All persistence writes to this directory. No shared state across sessions.

### 2.2 Append-Only Message Log

Messages are stored as JSONL (`messages.jsonl`). New messages are appended to the file. Messages are never modified, deleted, or reordered after append.

```typescript
// Append unsaved messages (existing messages are never re-written)
async function saveMessages(sessionDir, messages, lastSavedCount):
  unsaved = messages.slice(lastSavedCount)
  if unsaved is empty: return
  append unsaved as JSONL to messages.jsonl
```

**Rationale:** Append-only storage provides crash resilience — a partial write only loses the last message, not the entire log. Recovery can process up to the last complete JSON line. Compare with rewrite-every-time, where a crash during write loses all prior messages.

The orchestrator tracks `lastSavedCount` — the number of messages already persisted. On each save cycle, only messages beyond that index are appended. This avoids re-serializing the full message array every turn.

### 2.3 Atomic State Snapshots

Scope and state are stored as atomic JSON files (`scope.json`, `state.json`). Written via `writeFile` (atomic on most filesystems for files under ~4KB) with the full JSON representation.

```typescript
async function saveScope(sessionDir, scope):
  writeFile(join(sessionDir, SCOPE_FILE), JSON.stringify(scope, null, 2))

async function saveState(sessionDir, state):
  writeFile(join(sessionDir, STATE_FILE), JSON.stringify(state, null, 2))
```

**Rationale:** Unlike the message log, scope and state are point-in-time snapshots. There is no "append history" concept — only the latest values matter for resume. Atomic write ensures the snapshot is never partially written.

### 2.4 Event Log

Lifecycle events (subagent dispatch, tool execution, evolution transitions) are recorded in `events.jsonl`:

```
{ "type": "subagent.started", "sessionId": "...", "taskId": "...", "role": "worker", "timestamp": "..." }
{ "type": "subagent.completed", "sessionId": "...", "taskId": "...", "status": "success", "timestamp": "..." }
{ "type": "tool.executed", "sessionId": "...", "tool": "read_file", "timestamp": "..." }
```

The event log serves two purposes:
1. **Replay context** during session resume — reconstruct what happened between saves.
2. **Audit trail** — provides a cross-session history of autonomous actions.

Events are append-only, like messages. They are written by the components that produce them, not by a central scheduler.

### 2.5 Resume Protocol

On `alix --resume <session-id>`:

```
resume(sessionId):
  1. Resolve session directory: .alix/sessions/<sessionId>/
  2. Load messages from messages.jsonl
  3. Load scope from scope.json
  4. Load state from state.json
  5. Replay events from events.jsonl
  6. Reconstruct SessionInfo from persisted metadata
  7. Return ReconstructedSession:
       { sessionId, sessionDir, messages, scopeSnapshot, stateSnapshot, planContent, completed }
```

The resumed session begins with all prior messages loaded. The orchestrator picks up at the last saved state. Events are replayed to reconstruct any in-memory state that was not captured in the snapshots (subagent ownership registry state, tool execution history).

### 2.6 Checkpoints (File-Level)

File checkpoints snapshots of specific files before mutation, stored in `.alix/checkpoints/<checkpoint-uuid>/`. Used by the mutation subsystem to provide rollback at the file level (distinct from A4's execution-level rollback).

```typescript
createFileCheckpoint(root, files):
  for each file:
    if exists: copy to .alix/checkpoints/<uuid>/<file>
    else: record as missing

restoreFileCheckpoint(checkpoint):
  for each file:
    if was missing: delete current
    else: copy from checkpoint back
```

**Rationale:** File-level checkpoints survive even if the session does not — they are on-disk, process-independent state. This is distinct from A4 execution rollback, which is an in-memory runtime concept that produces evidence.

### 2.7 Session Listing and Lifecycle

Sessions are discoverable through `alix session list`:

```
listSessions(cwd):
  scan .alix/sessions/ for UUID directories
  for each: load session info (state, message count, timestamps)
  sort by creation time (most recent first)
  return session list with status (completed, interrupted, in_progress, cancelled)
```

Session lifecycle:

```
Created (alix starts)
    │
    ▼
In Progress
    │
    ├── Interrupted (crash, SIGTERM)  →  Resumable
    ├── Completed (session ends normally) → Archived
    └── Cancelled (user abort) → Archived
```

Resumed sessions re-enter `in_progress`. Archived sessions are read-only artifacts for audit.

---

## 3. What Survives and What Does Not

### 3.1 Persisted (survives crash)

| Artifact | Format | Location |
|----------|--------|----------|
| Conversation messages | JSONL (append) | `messages.jsonl` |
| Scope snapshot | JSON (atomic) | `scope.json` |
| State machine counters | JSON (atomic) | `state.json` |
| Lifecycle events | JSONL (append) | `events.jsonl` |
| Active plan | Markdown | `plan.md` |
| File-level checkpoints | Copied files | `.alix/checkpoints/` |
| Execution evidence | JSONL (separate) | Evidence store (evolution module) |
| Governance decisions | In-memory store | Decision store (not persisted to disk as JSONL) |

### 3.2 Not Persisted (ephemeral, must be rebuilt)

| Artifact | Reason |
|----------|--------|
| Model token caches | Transient, model-specific, not part of session semantics |
| Subagent ownership registry | Rebuilt from event log replay |
| Tool execution history in memory | Replayed from event log or messages |
| Temporary filesystem state | Ephemeral by definition |
| Transient reasoning traces | Only structured findings survive (via SubagentResult) |
| Provider connection state | Re-established on resume |

---

## 4. Architectural Invariants

1. **The session directory is the single source of truth.** All persistence writes to `.alix/sessions/<uuid>/`. No external state stores.
2. **Messages are append-only.** Prior messages are never modified. This is the foundation of crash resilience.
3. **State snapshots are atomic.** Scope and state are written as complete JSON files, not incrementally patched. A partial write is detected as a JSON parse error.
4. **Resume is deterministic.** Given the same session directory, resume always produces the same reconstructed session.
5. **Session directories are self-contained.** Everything needed to resume a session lives in its directory. No cross-session references.
6. **Events are append-once.** Events are written at production time and never reordered. The event log is the audit trail.
7. **Crash corruption is bounded.** At most one message (the one being written at crash time) can be lost. Prior messages are structurally intact.

---

## 5. Consequences

### 5.1 Positive

- **Crash resilience:** Append-only messages mean prior conversation survives any crash. The interactive loop can resume with context intact.
- **Deterministic resume:** Loading messages, scope, and state from the session directory produces identical reconstructed state regardless of how many times resume is called.
- **Self-contained sessions:** Each session directory is independent. No shared state means no cross-session corruption, easy cleanup (delete a directory), and straightforward debugging.
- **Event audit trail:** The event log provides an append-only history of autonomous actions independent of the message log, enabling cross-session analysis without parsing conversation messages.
- **Low overhead:** Append-only writes are O(1) per turn. No rewrite of the full message array.

### 5.2 Negative

- **No cross-session deduplication:** Each session stores its own copies of shared artifacts (evidence, decisions). Cross-session queries require scanning all session directories.
- **Snapshot staleness:** Scope and state are snapshotted periodically, not on every change. A crash between snapshots loses the latest counter values (though prior messages survive).
- **Directory sprawl:** Long-lived usage produces many session directories. The `listSessions` function filters to UUID directories and limits results, but cleanup is manual.
- **No encryption-at-rest:** Session directories contain conversation content and evidence in plaintext JSONL. This is appropriate for a local-first CLI tool but would need remediation for shared environments.

---

## 6. Alternatives Considered

| Decision | Adopted | Rejected Alternative | Reason |
|----------|---------|---------------------|--------|
| Message storage | Append-only JSONL | Rewrite-every-turn JSON | Crash resilience: partial rewrite loses all prior messages |
| State storage | Atomic JSON snapshot | Incremental patch log | Simplicity: snapshots are small (~few KB), patch log adds complexity without benefit |
| Resume source | Session directory (filesystem) | Database (SQLite) | Zero dependency, portable, debuggable with standard tools |
| Session identity | UUID | Sequential counter | UUID avoids collisions in concurrent/CI scenarios |
| Event log | Separate JSONL | Embedded in messages | Separation of concerns: events are machine-readable metadata, messages are conversation |
| Checkpoints | Per-file copies | Git-based snapshots | Git doesn't track untracked files; checkpoints work for any file |

---

## 7. Key References

- `src/session/persist.ts` — `saveMessages()`, `saveScope()`, `saveState()`
- `src/session/resume.ts` — `resumeSession()`, `listSessions()`, `sessionInfo()`
- `src/checkpoints/checkpoint-manager.ts` — `createFileCheckpoint()`, `restoreFileCheckpoint()`
- `src/events/event-log.ts` — EventLog (JSONL append)
- `.alix/sessions/` — Runtime session storage directory
- `.alix/checkpoints/` — Runtime checkpoint storage directory
