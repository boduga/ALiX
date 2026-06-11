# M0.37 — Replay Diff & Rollback Preview Design

> **One-liner:** M0.37 captures before/after file snapshots for approved-live replay mutations, computes diffs, stores them under `.alix/replays/<replayId>/`, and renders a rollback preview in the Trace drilldown — without executing any rollback.

---

## 1. Problem

M0.36 approved-live replay can modify files — create, delete, edit — with real side effects. Currently the executor mutates and moves on. If something goes wrong, the user has no visibility into what changed or how to revert it.

M0.37 fills that gap: every file mutation during approved-live replay captures a before-snapshot (if the file existed), an after-snapshot, and a computed diff. The user can view the diff in the Trace drilldown and see a rollback preview — a list of what *would* be restored, without actually restoring anything.

---

## 2. Goals

1. **Before-snapshot capture** — Before executing any file mutation in approved-live replay, copy the current file state to a replay snapshot directory.
2. **After-snapshot capture** — After the mutation, copy the new state.
3. **Diff computation** — Use `git diff --no-index` to compute the diff between before and after snapshots.
4. **Storage** — Store snapshots and diffs under `.alix/replays/<replayId>/`.
5. **ReplayDiffRecord model** — per-file record with `filePath`, `changeType` (created/modified/deleted), `diffPreview`, `rollbackable` flag.
6. **Rollback preview** — Show which files would be restored, from which snapshot, with a "no rollback" safety annotation.
7. **TUI diff display** — Show diff preview and rollback summary in the Trace drilldown panel.
8. **Events** — `replay.diff.recorded` event emitted per file change.
9. **Tests** — Prove before-snapshots are taken, diffs are computed, rollback preview is correct.

---

## 3. Non-goals

- **Actual rollback execution** — deferred to M0.38
- **Shell command output rollback** — shell side effects are not file-system tracked
- **Network side-effect diff** — not applicable
- **Batch replay diff across sessions** — deferred
- **Visual side-by-side diff** — text diff preview only

---

## 4. ReplayDiff model

```typescript
export type ReplayDiffRecord = {
  filePath: string;           // relative to workspace root
  changeType: "created" | "modified" | "deleted";
  beforeSnapshotPath?: string; // path relative to replay store
  afterSnapshotPath?: string;  // path relative to replay store
  diffPreview: string;         // first ~2000 chars of diff
  diffSize: number;
  rollbackable: boolean;       // true if before snapshot exists
  timestamp: string;
};

export type ReplayDiffSet = {
  replayId: string;
  mode: ReplayMode;
  records: ReplayDiffRecord[];
  totalFilesChanged: number;
  totalRollbackable: number;
  storePath: string;           // absolute path to .alix/replays/<replayId>/
  createdAt: string;
};
```

### Rollbackable definition

A record is `rollbackable` if:
- `changeType === "modified"` — before snapshot exists, file can be restored
- `changeType === "deleted"` — before snapshot exists, file can be restored
- `changeType === "created"` — **not rollbackable** (no before state — file didn't exist). Rollback means "delete the created file."

---

## 5. Snapshot and diff storage

### Directory structure

```
.alix/replays/<replayId>/
  index.json              ← ReplayDiffSet
  snapshots/
    before/
      path/to/file.txt    ← copy of file before mutation
    after/
      path/to/file.txt    ← copy of file after mutation
  diffs/
    path/to/file.txt.diff ← git diff output
```

### Storage

**File:** `src/runtime/replay-diff-store.ts` (NEW)

```typescript
export class ReplayDiffStore {
  constructor(private cwd: string) {}

  private replayDir(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId);
  }

  private snapshotDir(replayId: string, when: "before" | "after"): string {
    return join(this.replayDir(replayId), "snapshots", when);
  }

  private diffsDir(replayId: string): string {
    return join(this.replayDir(replayId), "diffs");
  }

  async captureBefore(replayId: string, filePath: string): Promise<string | null>;
  async captureAfter(replayId: string, filePath: string): Promise<string | null>;
  async computeDiff(replayId: string, filePath: string): Promise<string>;
  async saveIndex(replayId: string, set: ReplayDiffSet): Promise<void>;
  async loadIndex(replayId: string): Promise<ReplayDiffSet | null>;
}
```

### captureBefore()

```typescript
async captureBefore(replayId: string, filePath: string): Promise<string | null> {
  const resolvedPath = resolve(this.cwd, filePath);
  if (!existsSync(resolvedPath)) return null; // file doesn't exist yet (creation)
  
  const dest = join(this.snapshotDir(replayId, "before"), filePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(resolvedPath, dest);
  return dest;
}
```

### captureAfter()

```typescript
async captureAfter(replayId: string, filePath: string): Promise<string | null> {
  const resolvedPath = resolve(this.cwd, filePath);
  if (!existsSync(resolvedPath)) return null; // file was deleted
  
  const dest = join(this.snapshotDir(replayId, "after"), filePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(resolvedPath, dest);
  return dest;
}
```

### computeDiff()

Uses `git diff --no-index` to compare before/after snapshots:

```typescript
async computeDiff(replayId: string, filePath: string): Promise<string> {
  const before = join(this.snapshotDir(replayId, "before"), filePath);
  const after = join(this.snapshotDir(replayId, "after"), filePath);
  const diffDir = this.diffsDir(replayId);
  await mkdir(diffDir, { recursive: true });
  const diffPath = join(diffDir, `${filePath.replace(/\//g, "__")}.diff`);

  try {
    const { execSync } = await import("child_process");
    const diff = execSync(
      `git diff --no-index -- "${before}" "${after}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    await writeFile(diffPath, diff, "utf-8");
    return diff;
  } catch (err: any) {
    // git diff --no-index exits with code 1 when there's a diff
    // So we need to capture stdout even on "error"
    if (err.stdout) {
      await writeFile(diffPath, err.stdout, "utf-8");
      return err.stdout;
    }
    return `(diff failed: ${err.message})`;
  }
}
```

---

## 6. ReplayExecutor integration

The approved-live tool handlers in `replayExecutor.replayToolStep()` are the hooks. We add before/after snapshot calls around the actual mutations.

**For `file.create` (before is null, after is the new file):**

```typescript
// In the approved-live file.create handler, BEFORE mutation:
const diffStore = new ReplayDiffStore(cwd);
await diffStore.captureBefore(replayId, path);

// Execute (already exists)
await mkdir(...);
await writeFile(...);

// AFTER mutation:
const afterPath = await diffStore.captureAfter(replayId, path);
const diffSet = await diffStore.computeDiff(replayId, path);
```

**For `file.delete` (before is the file, after is null):**

```typescript
await diffStore.captureBefore(replayId, path);
await rm(resolvedPath);
// captureAfter returns null because file no longer exists
```

**For `patch.apply` (before for each changed file, after for each changed file):**

```typescript
// The patch result tells us which files changed
const result = await applyPatch(cwd, format, patchText);
if (result.changedFiles) {
  for (const f of result.changedFiles) {
    await diffStore.captureBefore(replayId, f);
  }
}
// ... after apply
if (result.changedFiles) {
  // Need to detect whether each file was created, modified, or deleted
}
```

### Where to hook in

The cleanest approach: add a `replayDiffStore?: ReplayDiffStore` to `ReplayExecuteOptions`. In `replayToolStep`, wrap the approved-live file mutation handlers with before/after capture.

But `replayToolStep` doesn't have access to the ReplayPlan's `replayId`. It only receives `(step, mode, cwd)`. We need to pass the diff store and replayId through.

Better approach: add `replayId` and `replayDiffStore` to the function parameters or use a class method instead of a standalone function.

Simplest refactor: add `replayId` and `replayDiffStore` to the `ReplayExecuteOptions` and make them available to `replayToolStep` by adding them as parameters or by restructuring the function to a class method.

Actually, the simplest approach: pass `replayId` and a `diffStore` reference through a context object:

```typescript
async function replayToolStep(
  step: ReplayPlanStep,
  mode: ReplayMode,
  cwd: string,
  opts?: { replayId?: string; diffStore?: ReplayDiffStore },
): Promise<Pick<ReplayStepResult, "status" | "output" | "error" | "blockReason">>
```

Then inside the file mutation handlers:

```typescript
// Capture before
const beforePath = opts?.diffStore && opts?.replayId
  ? await opts.diffStore.captureBefore(opts.replayId, path) : null;

// Execute mutation
await writeFile(resolvedPath, content, "utf8");

// Capture after and compute diff
if (opts?.diffStore && opts?.replayId) {
  const afterPath = await opts.diffStore.captureAfter(opts.replayId, path);
  const diffOutput = await opts.diffStore.computeDiff(opts.replayId, path);
  
  // Emit replay.diff.recorded event
  await opts.diffStore.appendRecord({
    filePath: path,
    changeType: beforePath ? "modified" : "created",
    beforeSnapshotPath: beforePath || undefined,
    afterSnapshotPath: afterPath || undefined,
    diffPreview: diffOutput.slice(0, 2000),
    diffSize: diffOutput.length,
    rollbackable: beforePath !== null,
    timestamp: new Date().toISOString(),
  });
}
```

---

## 7. TUI diff display

### Replay drilldown diff mode

Add `"diff"` to the trace detail modes, or extend the replay result display. Since the diff is a replay property (not a per-event property), the best UX is to add it to the replay result panel.

After rendering the replay result chain, if there are diffs:

```
── Replay Result ─────────────────────
  Mode: approved-live
  ReplayId: replay_1718000000_abc123
  Steps: 3 total, 2 completed, ...
  Files changed: 2 (2 rollbackable)

  ── Changes ─────────────────────────
  M src/index.ts        (+10 -2)  rollbackable
  A src/new-file.ts     (+25 -0)  not rollbackable

  ── Rollback Preview ────────────────
  Would restore: src/index.ts from snapshot
  Would delete:  src/new-file.ts (no before state)
  ⚠ No rollback will occur. Preview only.

  Keys: d=diff  s=summary  esc=close
```

### Diff detail view

When the user selects a file from the changes list (future, out of scope for M0.37), show the diff content. For M0.37, we show the summary + rollback preview in the same panel.

---

## 8. Events

Add a `replay.diff.recorded` event type:

```typescript
export const REPLAY_EVENT_TYPES = {
  // ... existing
  DIFF_RECORDED: "replay.diff.recorded",
};
```

Payload:

```typescript
export type ReplayDiffRecordedPayload = {
  replayId: string;
  filePath: string;
  changeType: "created" | "modified" | "deleted";
  diffPreview: string;      // first 500 chars
  diffSize: number;
  rollbackable: boolean;
};
```

---

## 9. Files

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-diff-store.ts` | **NEW** | ReplayDiffStore — snapshot, diff, storage |
| `src/runtime/replay-executor.ts` | MODIFY | Hook before/after capture in approved-live mutation handlers |
| `src/runtime/replay-plan.ts` | — | No changes needed (replayId already exists) |
| `src/events/types.ts` | MODIFY | Add `DIFF_RECORDED` and payload |
| `src/tui/trace-detail.ts` | MODIFY | Add diff/rollback renderers |
| `src/tui/store.ts` | MODIFY | Add replay diff state |
| `tests/runtime/replay-diff-store.test.ts` | **NEW** | Snapshot, diff, storage tests |
| `tests/runtime/replay-executor.test.ts` | MODIFY | Test before/after capture hooks |
| `tests/tui/replay-diff-display.test.ts` | **NEW** | Diff rendering tests |

---

## 10. Acceptance criteria

1. Before executing a file mutation in approved-live replay, a before-snapshot is captured at `.alix/replays/<replayId>/snapshots/before/<path>`
2. After execution, an after-snapshot is captured
3. Diff is computed via `git diff --no-index` and stored
4. Created files are `rollbackable: false` (no before state)
5. Modified/deleted files are `rollbackable: true`
6. Replay result display shows file change summary
7. Rollback preview shows "would restore" / "would delete" without executing
8. `replay.diff.recorded` event is emitted per file change
9. All existing tests continue to pass
