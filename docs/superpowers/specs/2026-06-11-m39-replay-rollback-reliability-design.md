# M0.39 — Replay/Rollback Reliability Hardening Design

**Status:** ✅ Completed (M0.39) — Design implemented and committed to main.

> **One-liner:** M0.39 hardens replay and rollback execution by adding lifecycle status, locking, idempotency, and partial rollback recovery — without expanding replay capabilities.

> **Safety loop capstone:** `execute → observe → inspect → replay → diff → rollback → **harden**`

---

## 1. Problem

M0.38 rollback execution works, but it has no durability guarantees:

- **No global status index** — there's no single source of truth for whether a replay has been rolled back. Running `/rollback replayId --approved-live` twice would restore snapshots twice (duplicate restore).
- **No concurrency protection** — two rollback operations on the same `replayId` could run in parallel and corrupt file state.
- **No crash recovery** — if the process dies mid-rollback, there's no record of which files were restored and which weren't.
- **No stale lock detection** — a crashed rollback leaves no marker; the user has no way to know recovery is needed.
- **No TUI visibility** — the trace drilldown shows `replayId` but not its lifecycle status (completed? rolled back? partial?).

M0.39 closes all these gaps with a thin durability layer that plugs into the existing `RollbackExecutor` and `ReplayDiffStore`.

---

## 2. Goals

1. **ReplayStatusIndex** — `.alix/replays/index.json` tracks every known `replayId` through its lifecycle: `capturing → completed → rollback-running → rollback-completed | rollback-partial`.
2. **ReplayLock** — `.alix/replays/<replayId>/.lock` prevents concurrent mutation. Stale lock detection via timestamp + configurable TTL.
3. **RollbackProgress** — `.alix/replays/<replayId>/rollback-progress.json` records step-by-step completion for resume and idempotency.
4. **RollbackExecutor idempotency** — check status index and progress before executing. `rollback-completed` = no-op. Completed paths are skipped on re-execution.
5. **Rollback resume** — `/rollback <replayId> --approved-live --resume` continues from the last incomplete step.
6. **TUI status badges** — `replayId` in trace drilldown shows status badge: `completed`, `rolled-back`, `partial`, `locked`.
7. **Lock lifecycle** — Lock acquired before any mutation, released after completion. Stale locks cleaned up on startup and on detect.

---

## 3. Non-goals

- **No new replay modes**
- **No new event families** — reuse existing `rollback.*` events
- **No new broad commands** — only `--resume` flag added to `/rollback`
- **No batch replay**
- **No scheduled replay**
- **No rollback of shell/network side effects**
- **No cross-session status sharing**

---

## 4. ReplayStatusIndex

### Location

```
.alix/replays/index.json
```

### Model

```typescript
export type ReplayStatus =
  | "capturing"
  | "completed"
  | "rollback-dry-run"
  | "rollback-running"
  | "rollback-completed"
  | "rollback-partial"
  | "locked";

export type ReplayStatusEntry = {
  replayId: string;
  status: ReplayStatus;
  createdAt: string;
  updatedAt: string;
  replayMode?: string;
};

export type ReplayStatusIndex = {
  entries: ReplayStatusEntry[];
};
```

### File: `src/runtime/replay-status-index.ts` (NEW)

```typescript
export class ReplayStatusIndex {
  constructor(private cwd: string) {}

  private indexPath(): string {
    return join(this.cwd, ".alix", "replays", "index.json");
  }

  async load(): Promise<ReplayStatusIndex>;
  async save(index: ReplayStatusIndex): Promise<void>;
  async getStatus(replayId: string): Promise<ReplayStatus | undefined>;
  async setStatus(replayId: string, status: ReplayStatus, mode?: string): Promise<void>;
  async ensureReplay(replayId: string, mode?: string): Promise<void>; // creates with "capturing" if missing
}
```

### Status transitions

```
capturing → completed            (ReplayDiffStore finishes capturing)
completed → rollback-running     (RollbackExecutor starts approved-live)
completed → rollback-dry-run     (RollbackExecutor starts dry-run)
rollback-running → rollback-completed  (all steps done)
rollback-running → rollback-partial    (crash or failure mid-steps)
rollback-partial → rollback-running    (--resume starts)
locked → *                        (only after lock release)
```

The `ReplayDiffStore` is already taking snapshots. The captureAfter/computeDiff calls happen in the ReplayExecutor's approved-live handlers. We can add `ensureReplay` calls there: when the first diff record is appended, set status to `"capturing"`. When replay completes successfully, set `"completed"`.

Actually, `ReplayDiffStore` creates the index.json per-replay when `appendRecord()` is called. The global index should be updated when:
- First snapshot is captured → `"capturing"`
- Replay executor completes → `"completed"` (set from the executor or diff store when the replay finishes)
- Rollback executor starts → `"rollback-running"`
- Rollback executor completes → `"rollback-completed"` or `"rollback-partial"`

---

## 5. ReplayLock

### Location

```
.alix/replays/<replayId>/.lock
```

### Model

```typescript
export type ReplayLockInfo = {
  pid: number;
  hostname: string;
  replayId: string;
  operation: "rollback" | "replay";
  acquiredAt: string;
};
```

### File: `src/runtime/replay-lock.ts` (NEW)

```typescript
export const DEFAULT_LOCK_TTL_MS = 30_000; // 30 seconds

export class ReplayLock {
  constructor(private cwd: string) {}

  private lockPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, ".lock");
  }

  async acquire(replayId: string, operation: "rollback" | "replay"): Promise<boolean>;
  async release(replayId: string): Promise<void>;
  async isLocked(replayId: string): Promise<boolean>;
  async getLockInfo(replayId: string): Promise<ReplayLockInfo | null>;
  async isStale(replayId: string, ttlMs?: number): Promise<boolean>;
  async forceRelease(replayId: string): Promise<void>;
  async cleanupStale(maxAgeMs?: number): Promise<string[]>; // returns cleaned replayIds
}
```

### Lock acquisition rules

1. Write `.lock` file atomically (write + fsync). If file already exists, check staleness.
2. If lock exists and NOT stale → `acquire()` returns `false` (locked by another process).
3. If lock exists and IS stale → `forceRelease()` then `acquire()`.
4. On `release()`, delete `.lock` file.

### Staleness detection

```typescript
async isStale(replayId: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<boolean> {
  const info = await this.getLockInfo(replayId);
  if (!info) return true; // no lock = not stale (doesn't exist)
  const age = Date.now() - new Date(info.acquiredAt).getTime();
  return age > ttlMs;
}
```

---

## 6. RollbackProgress

### Location

```
.alix/replays/<replayId>/rollback-progress.json
```

### Model

```typescript
export type RollbackProgress = {
  rollbackId: string;
  replayId: string;
  status: "running" | "partial" | "completed" | "failed";
  lastCompletedStepIndex: number;
  completedPaths: string[];
  failedPath?: string;
  updatedAt: string;
};
```

### File: `src/runtime/rollback-progress.ts` (NEW)

```typescript
export class RollbackProgressStore {
  constructor(private cwd: string) {}

  private progressPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, "rollback-progress.json");
  }

  async load(replayId: string): Promise<RollbackProgress | null>;
  async save(progress: RollbackProgress): Promise<void>;
  async markStepCompleted(replayId: string, rollbackId: string, stepIndex: number, path: string): Promise<void>;
  async markFailed(replayId: string, rollbackId: string, path: string): Promise<void>;
  async markCompleted(replayId: string, rollbackId: string): Promise<void>;
  async getCompletedPaths(replayId: string): Promise<string[]>;
  async isPathCompleted(replayId: string, path: string): Promise<boolean>;
}
```

---

## 7. RollbackExecutor integration

### Idempotency flow (approved-live)

```
RollbackExecutor.execute(plan, opts)
  │
  ├── 1. Check ReplayStatusIndex for replayId
  │     ├── "rollback-completed" → return no-op result (all done)
  │     └── "rollback-partial" + !opts.resume → refuse (suggest --resume)
  │
  ├── 2. Acquire ReplayLock
  │     └── fail → return blocked result (another process holds lock)
  │
  ├── 3. Initialize/load RollbackProgress
  │     ├── "partial" → resume from lastCompletedStepIndex + 1
  │     └── new → create with status "running"
  │
  ├── 4. Set status to "rollback-running"
  │
  ├── 5. For each step:
  │     ├── check if path in completedPaths → skip (already done)
  │     ├── execute normally
  │     ├── markStepCompleted(stepIndex, path)
  │     └── on error → markFailed, set status "rollback-partial", break
  │
  ├── 6. All steps done → set status "rollback-completed"
  │
  └── 7. Release lock
```

### execute() changes

Add new fields to `RollbackExecuteOptions`:

```typescript
export type RollbackExecuteOptions = {
  approvalStore?: any;
  resume?: boolean;
};
```

Add new fields to `RollbackResult`:

```typescript
export type RollbackResult = {
  // ... existing fields
  resumed?: boolean;           // true if this execution was resumed
  completionStatus?: string;   // "completed" | "partial" | "noop" (idempotent skip)
};
```

---

## 8. ReplayDiffStore integration

The `ReplayDiffStore` already creates per-replay directories. We add:

1. **After first snapshot capture** → `ReplayStatusIndex.setStatus(replayId, "capturing")`
2. **After diff recorded** → status stays "capturing" until replay executor completes
3. **Replay executor on completion** → `ReplayStatusIndex.setStatus(replayId, "completed")`

The replay executor doesn't currently set status. We add a lightweight integration: the approved-live replay handler in `ReplayExecutor` calls `statusIndex.setStatus(replayId, "completed")` after successful execution.

---

## 9. Lock lifecycle

| Event | Action |
|-------|--------|
| RollbackExecutor.execute() starts | Acquire lock |
| RollbackExecutor.execute() completes | Release lock |
| RollbackExecutor.execute() crashes mid-step | Lock remains (stale). ReplayLock.isStale() returns true after TTL |
| Next startup / /rollback --resume | Detect stale lock → force release → acquire fresh |
| Dry-run rollback | No lock needed (no mutations) |

### Startup cleanup

Add a command or hook to clean stale locks:

```
alix replays cleanup   ← scans .alix/replays/*/.lock, releases stale ones
```

This is optional for M0.39. The `--resume` flag handles the common case. We can add the CLI command later.

---

## 10. TUI status badges

In `src/tui/trace-detail.ts`, modify `renderReplayResult()` and `renderRollbackResult()` to show status badges.

### Replay result badge

```
  ReplayId: replay_1718000000_abc  [completed]
  Rollback: rollback-completed     [rolled back]
```

### Badge icons

| Status | Badge |
|--------|-------|
| `capturing` | `[capturing]` |
| `completed` | `[completed]` |
| `rollback-dry-run` | `[dry-run]` |
| `rollback-running` | `[rollback running]` |
| `rollback-completed` | `[rolled back]` |
| `rollback-partial` | `[partial]` |
| `locked` | `[locked]` |

### Implementation

The TUI display already renders `replayId` in the replay result. We add a status badge by loading the `ReplayStatusIndex` when rendering.

For the replay result renderer, add a `status?: ReplayStatus` option:

```typescript
export function renderReplayResult(
  result: ReplayResult,
  status?: ReplayStatus,
): string[] {
```

For the rollback result renderer, the `RollbackResult` already has `rollbackId`. The `ReplayStatusIndex` can be loaded in the TUI command handler and passed through.

---

## 11. Files

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-status-index.ts` | **NEW** | Global index of replay lifecycle statuses |
| `src/runtime/replay-lock.ts` | **NEW** | Per-replay file lock with stale detection |
| `src/runtime/rollback-progress.ts` | **NEW** | Per-rollback step-level progress tracking |
| `src/runtime/rollback-executor.ts` | MODIFY | Add idempotency checks, lock, progress, resume |
| `src/runtime/replay-diff-store.ts` | MODIFY | Update status index on capture |
| `src/runtime/replay-executor.ts` | MODIFY | Set status to "completed" after approved-live replay |
| `src/tui/trace-detail.ts` | MODIFY | Add status badges to replay/rollback result renderers |
| `tests/runtime/replay-status-index.test.ts` | **NEW** | Status index CRUD tests |
| `tests/runtime/replay-lock.test.ts` | **NEW** | Lock acquire/release/stale tests |
| `tests/runtime/rollback-idempotency.test.ts` | **NEW** | Idempotent rollback tests |
| `tests/runtime/rollback-resume.test.ts` | **NEW** | Resume from partial rollback tests |

---

## 12. Acceptance criteria

1. Creating a replay diff record sets status to `"capturing"` in the global index
2. Completing an approved-live replay sets status to `"completed"`
3. Rollback of a `"completed"` replay sets status to `"rollback-running"` then `"rollback-completed"`
4. Completed rollback cannot run twice (returns no-op result)
5. Active lock blocks concurrent rollback (returns blocked result)
6. Stale lock older than TTL is detected and can be force-released
7. Partial rollback records `lastCompletedStepIndex` and `completedPaths`
8. `--resume` flag continues from the first incomplete path
9. Completed paths are skipped on resume
10. Dry-run rollback does not acquire lock, does not change status
11. TUI shows status badge next to `replayId`
12. All existing tests continue to pass (156+ tests)
