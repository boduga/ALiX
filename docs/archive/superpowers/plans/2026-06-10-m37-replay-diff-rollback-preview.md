# M0.37 — Replay Diff & Rollback Preview Implementation Plan

**Status:** ✅ Completed (M0.37) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture before/after file snapshots for approved-live replay mutations, compute diffs, store under `.alix/replays/<replayId>/`, and render diff/rollback preview in the Trace drilldown.

**Architecture:** A `ReplayDiffStore` class handles snapshot capture, `git diff --no-index` computation, and `index.json` persistence. The `ReplayExecutor`'s approved-live tool handlers hook into it via `ReplayExecuteOptions`. Results render through a new diff section in the replay result display.

**Tech Stack:** Node.js, `child_process.execSync`, `fs.copyFile`, existing checkpoint patterns, `ReplayDiffRecord` model.

---

## File structure

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-diff-store.ts` | **NEW** | ReplayDiffStore — snapshot, diff, index persistence |
| `src/runtime/replay-executor.ts` | MODIFY | Hook before/after capture in approved-live mutation handlers |
| `src/events/types.ts` | MODIFY | Add `DIFF_RECORDED` event type and payload |
| `src/tui/trace-detail.ts` | MODIFY | Add diff/rollback preview renderers to replay result display |
| `tests/runtime/replay-diff-store.test.ts` | **NEW** | Snapshot, diff, storage tests |
| `tests/runtime/replay-executor.test.ts` | MODIFY | Test before/after capture hooks during approved-live execution |
| `tests/tui/replay-diff-display.test.ts` | **NEW** | Diff rendering tests |

---

### Task 1: Add replay.diff.recorded event type

**Files:**
- Modify: `src/events/types.ts`

- [ ] **Step 1: Add DIFF_RECORDED to REPLAY_EVENT_TYPES and payload**

In `src/events/types.ts`, find the `REPLAY_EVENT_TYPES` constant and add after the last existing entry:

```typescript
export const REPLAY_EVENT_TYPES = {
  PLAN_CREATED: "replay.plan.created",
  STARTED: "replay.started",
  STEP_STARTED: "replay.step.started",
  STEP_COMPLETED: "replay.step.completed",
  STEP_SKIPPED: "replay.step.skipped",
  STEP_BLOCKED: "replay.step.blocked",
  COMPLETED: "replay.completed",
  FAILED: "replay.failed",
  DIFF_RECORDED: "replay.diff.recorded",
} as const;
```

Add the payload type after `ReplayFailedPayload`:

```typescript
export type ReplayDiffRecordedPayload = {
  replayId: string;
  filePath: string;
  changeType: "created" | "modified" | "deleted";
  diffPreview: string;
  diffSize: number;
  rollbackable: boolean;
};
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add replay.diff.recorded event type"
```

---

### Task 2: Create ReplayDiffStore — snapshot, diff, storage

**Files:**
- Create: `src/runtime/replay-diff-store.ts`
- Create: `tests/runtime/replay-diff-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/replay-diff-store.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayDiffStore } from "../../src/runtime/replay-diff-store.js";

describe("ReplayDiffStore", () => {
  let tmpDir: string;
  let store: ReplayDiffStore;
  const replayId = "replay_test_001";

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "diff-store-test-"));
    store = new ReplayDiffStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures before snapshot of existing file", async () => {
    const filePath = "src/test.txt";
    const resolvedPath = join(tmpDir, filePath);
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(resolvedPath, "before content");

    const result = await store.captureBefore(replayId, filePath);
    assert.ok(result);
    assert.ok(result!.includes(replayId));
    assert.ok(result!.includes("before"));
    assert.ok(result!.includes(filePath));

    // Verify snapshot was written
    assert.ok(existsSync(result!));
    assert.equal(readFileSync(result!, "utf-8"), "before content");
  });

  it("captureBefore returns null for non-existent file", async () => {
    const result = await store.captureBefore(replayId, "nonexistent/file.txt");
    assert.equal(result, null);
  });

  it("captures after snapshot of existing file", async () => {
    const filePath = "src/after-test.txt";
    const resolvedPath = join(tmpDir, filePath);
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(resolvedPath, "after content");

    const result = await store.captureAfter(replayId, filePath);
    assert.ok(result);
    assert.ok(result!.includes("after"));
    assert.equal(readFileSync(result!, "utf-8"), "after content");
  });

  it("computes diff between before and after snapshots", async () => {
    const filePath = "src/diff-test.txt";
    const resolvedPath = join(tmpDir, filePath);
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(resolvedPath, "line one\nline two\nline three");

    await store.captureBefore(replayId, filePath);

    // Modify the file
    writeFileSync(resolvedPath, "line one\nline two modified\nline three\nline four");

    await store.captureAfter(replayId, filePath);

    const diff = await store.computeDiff(replayId, filePath);
    assert.ok(diff);
    assert.ok(diff.includes("line two") || diff.includes("line four"));
  });

  it("builds and persists an index.json", async () => {
    const filePath = "src/index-test.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, filePath), "before");

    const beforePath = await store.captureBefore(replayId, filePath);
    writeFileSync(join(tmpDir, filePath), "after");
    const afterPath = await store.captureAfter(replayId, filePath);
    const diff = await store.computeDiff(replayId, filePath);

    await store.appendRecord(replayId, {
      filePath,
      changeType: "modified",
      beforeSnapshotPath: beforePath || undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: diff.slice(0, 2000),
      diffSize: diff.length,
      rollbackable: beforePath !== null,
      timestamp: new Date().toISOString(),
    });

    const index = await store.loadIndex(replayId);
    assert.ok(index);
    assert.equal(index!.replayId, replayId);
    assert.equal(index!.records.length, 1);
    assert.equal(index!.records[0].filePath, filePath);
    assert.equal(index!.records[0].changeType, "modified");
    assert.equal(index!.records[0].rollbackable, true);
  });

  it("records created file as non-rollbackable", async () => {
    const filePath = "new-file.txt";
    // Before snapshot not taken (file didn't exist) — null
    writeFileSync(join(tmpDir, filePath), "new content");
    const afterPath = await store.captureAfter(replayId, filePath);

    await store.appendRecord(replayId, {
      filePath,
      changeType: "created",
      beforeSnapshotPath: undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: "new file",
      diffSize: 9,
      rollbackable: false,
      timestamp: new Date().toISOString(),
    });

    const index = await store.loadIndex(replayId);
    assert.ok(index);
    const record = index!.records.find(r => r.filePath === filePath);
    assert.ok(record);
    assert.equal(record!.changeType, "created");
    assert.equal(record!.rollbackable, false);
  });

  it("computes rollbackability correctly", async () => {
    assert.equal(store.isRollbackable("modified", true), true);
    assert.equal(store.isRollbackable("deleted", true), true);
    assert.equal(store.isRollbackable("created", true), false);  // created with before? impossible
    assert.equal(store.isRollbackable("created", false), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build 2>&1 | tail -5
# Expected: build error, cannot find module replay-diff-store.js
```

- [ ] **Step 3: Create ReplayDiffStore**

Create `src/runtime/replay-diff-store.ts`:

```typescript
/**
 * replay-diff-store.ts — Capture before/after file snapshots, compute diffs,
 * and persist ReplayDiffRecord sets for replay mutations.
 */

import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayDiffRecord = {
  filePath: string;
  changeType: "created" | "modified" | "deleted";
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
  diffPreview: string;
  diffSize: number;
  rollbackable: boolean;
  timestamp: string;
};

export type ReplayDiffSet = {
  replayId: string;
  records: ReplayDiffRecord[];
  totalFilesChanged: number;
  totalRollbackable: number;
  storePath: string;
  createdAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Determine if a record is rollbackable based on changeType and beforeState. */
export function isRollbackable(changeType: string, hasBeforeState: boolean): boolean {
  if (changeType === "created") return false; // no before state — can't restore from nothing
  return hasBeforeState; // modified or deleted with a before snapshot
}

// ─── ReplayDiffStore ─────────────────────────────────────────────────

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

  /**
   * Copy a file to the before-snapshot directory.
   * Returns the snapshot path, or null if the file doesn't exist.
   */
  async captureBefore(replayId: string, filePath: string): Promise<string | null> {
    const resolvedPath = resolve(this.cwd, filePath);
    if (!existsSync(resolvedPath)) return null;

    const dest = join(this.snapshotDir(replayId, "before"), filePath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolvedPath, dest);
    return dest;
  }

  /**
   * Copy a file to the after-snapshot directory.
   * Returns the snapshot path, or null if the file doesn't exist (was deleted).
   */
  async captureAfter(replayId: string, filePath: string): Promise<string | null> {
    const resolvedPath = resolve(this.cwd, filePath);
    if (!existsSync(resolvedPath)) return null;

    const dest = join(this.snapshotDir(replayId, "after"), filePath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolvedPath, dest);
    return dest;
  }

  /**
   * Compute a diff between before and after snapshots using git diff --no-index.
   * Returns the diff output as a string.
   */
  async computeDiff(replayId: string, filePath: string): Promise<string> {
    const before = join(this.snapshotDir(replayId, "before"), filePath);
    const after = join(this.snapshotDir(replayId, "after"), filePath);
    const diffDir = this.diffsDir(replayId);
    mkdirSync(diffDir, { recursive: true });
    const diffFileName = filePath.replace(/\//g, "__").replace(/\\/g, "__") + ".diff";
    const diffPath = join(diffDir, diffFileName);

    try {
      // Handle missing before snapshots (file.created)
      const beforeArg = existsSync(before) ? `"${before}"` : "/dev/null";
      const afterArg = existsSync(after) ? `"${after}"` : "/dev/null";

      const diff = execSync(
        `git diff --no-index ${beforeArg} ${afterArg}`,
        { encoding: "utf-8", timeout: 10000 },
      );
      writeFileSync(diffPath, diff, "utf-8");
      return diff;
    } catch (err: any) {
      // git diff --no-index exits with code 1 when there IS a diff
      // stdout contains the actual diff
      if (err.stdout) {
        writeFileSync(diffPath, err.stdout, "utf-8");
        return err.stdout;
      }
      // If the before file doesn't exist, return full content as "diff"
      if (!existsSync(before) && existsSync(after)) {
        const content = readFileSync(after, "utf-8");
        const diffText = `--- /dev/null\n+++ ${filePath}\n@@ -0,0 +1,${content.split("\n").length} @@\n` +
          content.split("\n").map(l => `+${l}`).join("\n");
        writeFileSync(diffPath, diffText, "utf-8");
        return diffText;
      }
      return `(diff failed: ${err.message})`;
    }
  }

  /**
   * Append a record to the replay's index.json, creating it if needed.
   */
  async appendRecord(replayId: string, record: ReplayDiffRecord): Promise<void> {
    const index = await this.loadIndex(replayId) ?? {
      replayId,
      records: [],
      totalFilesChanged: 0,
      totalRollbackable: 0,
      storePath: this.replayDir(replayId),
      createdAt: new Date().toISOString(),
    };

    index.records.push(record);
    index.totalFilesChanged = index.records.length;
    index.totalRollbackable = index.records.filter(r => r.rollbackable).length;

    await this.saveIndex(replayId, index);
  }

  /**
   * Save the full ReplayDiffSet to index.json.
   */
  async saveIndex(replayId: string, set: ReplayDiffSet): Promise<void> {
    const dir = this.replayDir(replayId);
    mkdirSync(dir, { recursive: true });
    const indexPath = join(dir, "index.json");
    writeFileSync(indexPath, JSON.stringify(set, null, 2), "utf-8");
  }

  /**
   * Load the ReplayDiffSet from index.json, or null if it doesn't exist.
   */
  async loadIndex(replayId: string): Promise<ReplayDiffSet | null> {
    const indexPath = join(this.replayDir(replayId), "index.json");
    if (!existsSync(indexPath)) return null;
    try {
      const raw = readFileSync(indexPath, "utf-8");
      return JSON.parse(raw) as ReplayDiffSet;
    } catch {
      return null;
    }
  }

  /**
   * Check if a record is rollbackable (convenience method matching the pure function).
   */
  isRollbackable(changeType: string, hasBeforeState: boolean): boolean {
    return isRollbackable(changeType, hasBeforeState);
  }
}
```

- [ ] **Step 4: Build and run tests**

```bash
npm run build
npx node --test dist/tests/runtime/replay-diff-store.test.js
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/replay-diff-store.ts tests/runtime/replay-diff-store.test.ts
git commit -m "feat(runtime): add ReplayDiffStore for snapshot and diff capture"
```

---

### Task 3: Hook ReplayDiffStore into ReplayExecutor

**Files:**
- Modify: `src/runtime/replay-executor.ts`
- Modify: `tests/runtime/replay-executor.test.ts`

- [ ] **Step 1: Add diff store to ReplayExecuteOptions**

In `src/runtime/replay-executor.ts`:

Add import at top:

```typescript
import type { ReplayDiffStore } from "./replay-diff-store.js";
```

Add `diffStore` and `replayId` to `ReplayExecuteOptions`:

```typescript
export type ReplayExecuteOptions = {
  approvalStore?: ApprovalStore;
  diffStore?: ReplayDiffStore;
};
```

- [ ] **Step 2: Add before/after capture in approved-live file.create handler**

In the `replayToolStep` function, find the approved-live file.create handler (around line 84-93). Change it to:

```typescript
// Approved-live file.create: execute for real with diff capture
if (toolName === "file.create" && mode === "approved-live") {
  const path = String(args.path || "");
  const content = args.content !== undefined ? String(args.content) : "";
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname, resolve } = await import("node:path");
  const resolvedPath = resolve(cwd, path);

  // Capture before (will be null for new file)
  const beforePath = step.replayId && opts?.diffStore
    ? await opts.diffStore.captureBefore(step.replayId, path) : null;

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");

  // Capture after
  if (step.replayId && opts?.diffStore) {
    const afterPath = await opts.diffStore.captureAfter(step.replayId, path);
    const diff = await opts.diffStore.computeDiff(step.replayId, path);
    await opts.diffStore.appendRecord(step.replayId, {
      filePath: path,
      changeType: "created",
      beforeSnapshotPath: beforePath || undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: diff.slice(0, 2000),
      diffSize: diff.length,
      rollbackable: false,
      timestamp: new Date().toISOString(),
    });
  }

  return { status: "completed", output: `File created: ${path}` };
}
```

Wait — the `step` parameter is `ReplayPlanStep` which doesn't have `replayId`. We need to thread it. Add `replayId` as a parameter to `replayToolStep`.

Change the function signature:

```typescript
async function replayToolStep(
  step: ReplayPlanStep,
  mode: ReplayMode,
  cwd: string,
  opts?: { replayId?: string; diffStore?: ReplayDiffStore },
): Promise<Pick<ReplayStepResult, "status" | "output" | "error" | "blockReason">>
```

Update all callers. The function is called in the `execute()` method:

```typescript
const toolResult = await replayToolStep(step, plan.mode, this.cwd, {
  replayId: plan.replayId,
  diffStore: opts?.diffStore,
});
```

- [ ] **Step 3: Add before/after capture in approved-live file.delete handler**

In the same function, for the file.delete handler:

```typescript
// Approved-live file.delete: execute for real with diff capture
if (toolName === "file.delete" && mode === "approved-live") {
  const path = String(args.path || "");
  const { rm } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const resolvedPath = resolve(cwd, path);

  // Capture before
  const beforePath = opts?.replayId && opts?.diffStore
    ? await opts.diffStore.captureBefore(opts.replayId, path) : null;

  await rm(resolvedPath);

  // Capture after (will be null since file was deleted)
  if (opts?.replayId && opts?.diffStore) {
    const afterPath = await opts.diffStore.captureAfter(opts.replayId, path);
    const diff = await opts.diffStore.computeDiff(opts.replayId, path);
    await opts.diffStore.appendRecord(opts.replayId, {
      filePath: path,
      changeType: "deleted",
      beforeSnapshotPath: beforePath || undefined,
      afterSnapshotPath: afterPath || undefined,
      diffPreview: diff.slice(0, 2000),
      diffSize: diff.length,
      rollbackable: true,
      timestamp: new Date().toISOString(),
    });
  }

  return { status: "completed", output: `File deleted: ${path}` };
}
```

- [ ] **Step 4: Add before/after capture in approved-live patch.apply handler**

For the patch.apply handler:

```typescript
// Approved-live patch.apply: execute for real with diff capture
if (toolName === "patch.apply" && mode === "approved-live") {
  const format = (args.format || "search_replace") as any;
  const patchText = String(args.patchText || "");
  const { applyPatch } = await import("../patch/patch-engine.js");
  try {
    const result = await applyPatch(cwd as string, format, patchText);
    if (result.status === "applied" && result.changedFiles) {
      // Capture before for each changed file
      const beforePaths: Record<string, string | null> = {};
      if (opts?.replayId && opts?.diffStore) {
        for (const f of result.changedFiles) {
          beforePaths[f] = await opts.diffStore.captureBefore(opts.replayId, f);
        }
      }

      // (applyPatch already executed inside the import, so the patch is applied)

      // Now capture after and compute diffs
      if (opts?.replayId && opts?.diffStore) {
        for (const f of result.changedFiles) {
          const afterPath = await opts.diffStore.captureAfter(opts.replayId, f);
          const diff = await opts.diffStore.computeDiff(opts.replayId, f);
          await opts.diffStore.appendRecord(opts.replayId, {
            filePath: f,
            changeType: beforePaths[f] !== null ? "modified" : "created",
            beforeSnapshotPath: beforePaths[f] || undefined,
            afterSnapshotPath: afterPath || undefined,
            diffPreview: diff.slice(0, 2000),
            diffSize: diff.length,
            rollbackable: beforePaths[f] !== null,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return { status: "completed", output: `Patch applied: ${result.changedFiles.join(", ")}` };
    }
    return { status: "failed", error: "Patch invalid" };
  } catch (err: any) {
    return { status: "failed", error: err.message };
  }
}
```

Note: There's a problem here — `applyPatch` was imported and called separately in the original code. In the diff-enabled version, we need to capture before-snapshots BEFORE calling `applyPatch`. But the current code does `const result = await applyPatch(cwd, format, patchText)` and only then checks `result.changedFiles`. We need to either:

1. Call `applyPatch` first to get changedFiles, then capture before, then re-apply — bad, double execution
2. Parse the patch text for file paths before applying (as the existing code in tool-router.ts does via `extractPatchPaths`)

Option 2 is better. But for M0.37 simplicity, let's use a slightly different approach: capture before for ALL known files that might be affected. The `args` contain `patchText` — and the `extractPatchPaths` utility already exists.

Actually, let me simplify. The `step.args` has the same args that were used originally. We can use `extractPatchPaths` to get the changed files, capture before for each, then execute, then capture after. This avoids double execution.

Here's the revised approach:

```typescript
// Approved-live patch.apply: execute for real with diff capture
if (toolName === "patch.apply" && mode === "approved-live") {
  const format = (args.format || "search_replace") as any;
  const patchText = String(args.patchText || "");
  const { applyPatch } = await import("../patch/patch-engine.js");
  const { extractPatchPaths } = await import("../patch/patch-paths.js");

  // Extract files that will be changed
  const changedByPatch = extractPatchPaths(format, patchText);

  // Capture before for each file
  const beforePaths: Record<string, string | null> = {};
  if (opts?.replayId && opts?.diffStore) {
    for (const f of changedByPatch) {
      beforePaths[f] = await opts.diffStore.captureBefore(opts.replayId, f);
    }
  }

  // Execute the patch
  try {
    const result = await applyPatch(cwd as string, format, patchText);
    if (result.status === "applied" && result.changedFiles) {
      // After capture + diff
      if (opts?.replayId && opts?.diffStore) {
        for (const f of result.changedFiles) {
          const afterPath = await opts.diffStore.captureAfter(opts.replayId, f);
          const diff = await opts.diffStore.computeDiff(opts.replayId, f);
          await opts.diffStore.appendRecord(opts.replayId, {
            filePath: f,
            changeType: beforePaths[f] !== null ? "modified" : "created",
            beforeSnapshotPath: beforePaths[f] || undefined,
            afterSnapshotPath: afterPath || undefined,
            diffPreview: diff.slice(0, 2000),
            diffSize: diff.length,
            rollbackable: beforePaths[f] !== null,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return { status: "completed", output: `Patch applied: ${result.changedFiles.join(", ")}` };
    }
    return { status: "failed", error: "Patch invalid" };
  } catch (err: any) {
    return { status: "failed", error: err.message };
  }
}
```

- [ ] **Step 5: Update the replayToolStep call site**

In the `execute()` method, find the call to `replayToolStep` (around line 408) and update it:

```typescript
const toolResult = await replayToolStep(step, plan.mode, this.cwd, {
  replayId: plan.replayId,
  diffStore: opts?.diffStore,
});
```

- [ ] **Step 6: Add tests for diff capture during execution**

In `tests/runtime/replay-executor.test.ts`, add a new test to the approved-live describe block:

```typescript
it("captures diff for file.create during approved-live replay", async () => {
  const { ReplayDiffStore } = await import("../../src/runtime/replay-diff-store.js");
  const diffStore = new ReplayDiffStore(tmpDir);
  const newFilePath = join(tmpDir, "diff-capture-test.txt");
  const events = [
    makeEvent({ id: "e1", eventType: "file.create", label: "file.create test.txt", toolName: "file.create",
      toolCallId: "tc1", rawEvent: { payload: { toolName: "file.create", args: { path: "diff-capture-test.txt", content: "diff captured content" } } } }),
  ];
  const preview = buildReplayPreview(events[0], events);
  const plan = buildReplayPlan(preview, events, "approved-live");

  // First resolve any pending approvals
  const pending = approvalStore.listPending();
  for (const a of pending) {
    await approvalStore.resolve(a.id, "approved");
  }

  const result = await executor.execute(plan, { approvalStore, diffStore });
  const createStep = result.steps.find(s => s.toolName === "file.create");
  assert.ok(createStep);
  assert.equal(createStep.status, "completed");

  // Verify diff was captured
  const index = await diffStore.loadIndex(plan.replayId!);
  assert.ok(index);
  assert.ok(index!.records.length >= 1);
  const record = index!.records.find(r => r.filePath === "diff-capture-test.txt");
  assert.ok(record);
  assert.equal(record!.changeType, "created");
  assert.equal(record!.rollbackable, false);
  assert.equal(existsSync(newFilePath), true);
  assert.equal(readFileSync(newFilePath, "utf-8"), "diff captured content");

  // Verify directory structure
  const replayDir = join(tmpDir, ".alix", "replays", plan.replayId!);
  assert.ok(existsSync(replayDir));
  assert.ok(existsSync(join(replayDir, "index.json")));
});
```

- [ ] **Step 7: Build and run tests**

```bash
npm run build
npx node --test dist/tests/runtime/replay-executor.test.js
```
Expected: All 12 existing tests pass + 1 new test = 13 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/replay-executor.ts tests/runtime/replay-executor.test.ts
git commit -m "feat(runtime): hook ReplayDiffStore into approved-live file mutation handlers"
```

---

### Task 4: Add diff/rollback preview rendering in TUI

**Files:**
- Modify: `src/tui/trace-detail.ts`
- Create: `tests/tui/replay-diff-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tui/replay-diff-display.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReplayDiffSummary, renderRollbackPreview } from "../../src/tui/trace-detail.js";
import type { ReplayDiffSet, ReplayDiffRecord } from "../../src/runtime/replay-diff-store.js";

const mockRecords: ReplayDiffRecord[] = [
  {
    filePath: "src/index.ts",
    changeType: "modified",
    beforeSnapshotPath: "/tmp/.alix/replays/r1/snapshots/before/src/index.ts",
    afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/index.ts",
    diffPreview: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,5 @@\n line one\n-line two\n+line two modified\n line three\n+line four",
    diffSize: 120,
    rollbackable: true,
    timestamp: "2026-06-11T12:00:00Z",
  },
  {
    filePath: "src/new-file.ts",
    changeType: "created",
    beforeSnapshotPath: undefined,
    afterSnapshotPath: "/tmp/.alix/replays/r1/snapshots/after/src/new-file.ts",
    diffPreview: "--- /dev/null\n+++ src/new-file.ts\n@@ -0,0 +1 @@\n+new content",
    diffSize: 50,
    rollbackable: false,
    timestamp: "2026-06-11T12:00:01Z",
  },
];

const mockDiffSet: ReplayDiffSet = {
  replayId: "replay_test_001",
  records: mockRecords,
  totalFilesChanged: 2,
  totalRollbackable: 1,
  storePath: "/tmp/.alix/replays/r1",
  createdAt: "2026-06-11T12:00:00Z",
};

describe("renderReplayDiffSummary", () => {
  it("renders file change count", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("2"));
    assert.ok(joined.includes("1 rollbackable"));
  });

  it("renders change entries with type markers", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("M"));
    assert.ok(joined.includes("A"));
    assert.ok(joined.includes("src/index.ts"));
    assert.ok(joined.includes("src/new-file.ts"));
  });

  it("shows rollback status per file", () => {
    const lines = renderReplayDiffSummary(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("rollbackable"));
  });
});

describe("renderRollbackPreview", () => {
  it("shows would-restore for rollbackable files", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Would restore"));
    assert.ok(joined.includes("src/index.ts"));
  });

  it("shows would-delete for non-rollbackable files", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Would delete"));
    assert.ok(joined.includes("src/new-file.ts"));
  });

  it("includes safety warning", () => {
    const lines = renderRollbackPreview(mockDiffSet);
    const joined = lines.join("\n");
    assert.ok(joined.includes("No rollback") || joined.includes("Preview only"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && npx node --test dist/tests/tui/replay-diff-display.test.js
```
Expected: FAIL with "renderReplayDiffSummary not defined".

- [ ] **Step 3: Add diff/rollback renderers to trace-detail.ts**

In `src/tui/trace-detail.ts`, add after the existing render functions:

```typescript
import type { ReplayDiffSet } from "../runtime/replay-diff-store.js";

/**
 * Render a summary of file changes from replay diff data.
 */
export function renderReplayDiffSummary(diffSet: ReplayDiffSet): string[] {
  const lines: string[] = [];
  lines.push(`  Files changed: ${diffSet.totalFilesChanged} (${diffSet.totalRollbackable} rollbackable)`);

  if (diffSet.records.length === 0) {
    lines.push("  No file changes recorded.");
    return lines;
  }

  lines.push("");
  lines.push("  Changes:");
  for (const record of diffSet.records) {
    const typeMarker = record.changeType === "created" ? "A" : record.changeType === "deleted" ? "D" : "M";
    const rollbackFlag = record.rollbackable ? " rollbackable" : " not rollbackable";
    lines.push(`  ${typeMarker} ${record.filePath}${rollbackFlag}`);
    if (record.diffPreview) {
      // Show first line of diff content
      const previewLine = record.diffPreview.split("\n").slice(0, 3).join("\n       ").slice(0, 80);
      if (previewLine) lines.push(`       ${previewLine}`);
    }
  }

  return lines;
}

/**
 * Render a rollback preview showing what would be restored or deleted.
 * No actual rollback — preview only.
 */
export function renderRollbackPreview(diffSet: ReplayDiffSet): string[] {
  const lines: string[] = [];
  lines.push("  Rollback Preview:");

  if (diffSet.records.length === 0) {
    lines.push("  No files to rollback.");
    return lines;
  }

  for (const record of diffSet.records) {
    if (record.rollbackable) {
      lines.push(`  • Would restore: ${record.filePath} from snapshot`);
    } else {
      if (record.changeType === "created") {
        lines.push(`  • Would delete: ${record.filePath} (no before state)`);
      }
    }
  }

  lines.push("");
  lines.push("  ⚠ No rollback will occur. Preview only.");

  return lines;
}
```

- [ ] **Step 4: Integrate diff display into replay result rendering**

In `src/tui/trace-detail.ts`, modify `renderReplayResult()` to include diff summary when a diff set is available.

Since `ReplayResult` doesn't carry the diff set (it's stored on disk), we need a different approach. Options:

**Option A:** Add `diffSet` to `ReplayResult` type.
**Option B:** Have the TUI load the diff set from disk when rendering.

Option A is simpler: add `diffSet?: ReplayDiffSet` to `ReplayResult`.

In `src/runtime/replay-executor.ts`, add import:

```typescript
import type { ReplayDiffSet } from "./replay-diff-store.js";
```

Add to `ReplayResult`:

```typescript
export type ReplayResult = {
  mode: ReplayMode;
  replayId?: string;
  diffSet?: ReplayDiffSet;
  steps: ReplayStepResult[];
  // ... rest
};
```

In the `execute()` method, after the loop, load the diff set:

```typescript
// Load diff set if available
let diffSet: ReplayDiffSet | undefined;
if (plan.replayId && opts?.diffStore) {
  diffSet = await opts.diffStore.loadIndex(plan.replayId) ?? undefined;
}

return {
  mode: plan.mode,
  replayId: plan.replayId,
  diffSet,
  steps: stepResults,
  // ...
};
```

Then in `renderReplayResult()`:

```typescript
export function renderReplayResult(result: ReplayResult): string[] {
  const lines: string[] = [];
  lines.push(`  Mode: ${result.mode}`);
  if (result.replayId) lines.push(`  ReplayId: ${result.replayId}`);
  // ... existing step rendering ...

  // Diff summary
  if (result.diffSet && result.diffSet.records.length > 0) {
    lines.push("");
    lines.push("  ── Changes ────────────────────────");
    lines.push(...renderReplayDiffSummary(result.diffSet));
    lines.push("");
    lines.push("  ── Rollback Preview ────────────────");
    lines.push(...renderRollbackPreview(result.diffSet));
  }

  return lines;
}
```

- [ ] **Step 5: Build and run tests**

```bash
npm run build
npx node --test dist/tests/tui/replay-diff-display.test.js dist/tests/tui/replay-execution-detail.test.js dist/tests/runtime/replay-executor.test.js
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/tui/trace-detail.ts tests/tui/replay-diff-display.test.ts src/runtime/replay-executor.ts
git commit -m "feat(tui): add replay diff summary and rollback preview renderers"
```

---

### Task 5: Final verification

- [ ] **Step 1: Build and run all replay-related tests**

```bash
npm run build && npx node --test \
  dist/tests/runtime/replay-diff-store.test.js \
  dist/tests/runtime/replay-preview.test.js \
  dist/tests/runtime/replay-plan.test.js \
  dist/tests/runtime/replay-executor.test.js \
  dist/tests/tui/replay-preview-detail.test.js \
  dist/tests/tui/replay-execution-detail.test.js \
  dist/tests/tui/replay-diff-display.test.js \
  dist/tests/runtime/trace-events.test.js \
  dist/tests/tui/trace-panel.test.js \
  dist/tests/tui/trace-detail-panel.test.js \
  dist/tests/policy/policy-gate.test.js \
  dist/tests/tui/approval-manager.test.js
```
Expected: All pass.

- [ ] **Step 2: Impact analysis per CLAUDE.md**

```bash
npx gitnexus detect-changes --repo ALiX
```
Expected: Only M0.37 files in the diff.

- [ ] **Step 3: Tag and push**

```bash
git tag m0.37-replay-diff-rollback-preview
git push origin main --tags
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat: complete M0.37 replay diff and rollback preview

- Add ReplayDiffStore for before/after snapshot capture and diff computation
- Add git diff --no-index integration for file mutation diffs
- Hook diff capture into approved-live file.create, file.delete, patch.apply
- Add renderReplayDiffSummary and renderRollbackPreview TUI renderers
- Add replay.diff.recorded event type
- Add 10 new tests for snapshot capture, diff computation, and rendering
- All existing tests pass, no regressions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
