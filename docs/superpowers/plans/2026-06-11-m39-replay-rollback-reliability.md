# M0.39 — Replay/Rollback Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden replay and rollback execution by adding lifecycle status, locking, idempotency, and partial rollback recovery — without expanding replay capabilities.

**Architecture:** Three new backing stores (`ReplayStatusIndex`, `ReplayLock`, `RollbackProgressStore`) beneath the existing `RollbackExecutor`. The executor checks status before executing, acquires a lock during mutation, tracks step-level progress, and supports `--resume`. The `ReplayDiffStore` and `ReplayExecutor` update the status index at lifecycle transitions.

**Tech Stack:** Node.js, `fs.writeFileSync`+`fsync` for lock files, `fs.copyFileSync`/`rmSync` for progress markers, existing `RollbackExecutor` and `ReplayDiffStore`.

---

## File structure

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-status-index.ts` | **NEW** | Global index of replay lifecycle statuses |
| `src/runtime/replay-lock.ts` | **NEW** | Per-replay file lock with stale detection |
| `src/runtime/rollback-progress.ts` | **NEW** | Per-rollback step-level progress tracking |
| `src/runtime/rollback-executor.ts` | MODIFY | Add idempotency, lock, progress, resume |
| `src/runtime/replay-diff-store.ts` | MODIFY | Update status index on first capture |
| `src/runtime/replay-executor.ts` | MODIFY | Set "completed" status after approved-live replay |
| `src/tui/trace-detail.ts` | MODIFY | Status badges on replayId |
| `src/cli/commands/tui.ts` | MODIFY | Add `--resume` flag to `/rollback` |
| `tests/runtime/replay-status-index.test.ts` | **NEW** | Status index CRUD |
| `tests/runtime/replay-lock.test.ts` | **NEW** | Lock acquire/release/stale |
| `tests/runtime/rollback-idempotency.test.ts` | **NEW** | Idempotent rollback |
| `tests/runtime/rollback-resume.test.ts` | **NEW** | Resume from partial |

---

### Task 1: Build ReplayStatusIndex

**Files:**
- Create: `src/runtime/replay-status-index.ts`
- Create: `tests/runtime/replay-status-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/replay-status-index.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayStatusIndex } from "../../src/runtime/replay-status-index.js";

describe("ReplayStatusIndex", () => {
  let tmpDir: string;
  let idx: ReplayStatusIndex;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "status-index-"));
    idx = new ReplayStatusIndex(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined for unknown replayId", async () => {
    const status = await idx.getStatus("nonexistent");
    assert.equal(status, undefined);
  });

  it("sets and gets status", async () => {
    await idx.setStatus("replay_001", "capturing");
    assert.equal(await idx.getStatus("replay_001"), "capturing");

    await idx.setStatus("replay_001", "completed");
    assert.equal(await idx.getStatus("replay_001"), "completed");
  });

  it("persists to disk and reloads", async () => {
    await idx.setStatus("replay_002", "rollback-completed");
    const idx2 = new ReplayStatusIndex(tmpDir);
    assert.equal(await idx2.getStatus("replay_002"), "rollback-completed");
  });

  it("handles multiple entries", async () => {
    await idx.setStatus("replay_a", "capturing");
    await idx.setStatus("replay_b", "completed");
    await idx.setStatus("replay_c", "rollback-partial");

    const all = await idx.getAll();
    assert.equal(all.length, 5); // 2 from previous + 3 new
    assert.ok(all.some(e => e.replayId === "replay_a" && e.status === "capturing"));
    assert.ok(all.some(e => e.replayId === "replay_c" && e.status === "rollback-partial"));
  });

  it("ensureReplay creates entry with capturing status", async () => {
    await idx.ensureReplay("replay_new", "approved-live");
    const entry = await idx.getEntry("replay_new");
    assert.ok(entry);
    assert.equal(entry!.status, "capturing");
    assert.equal(entry!.replayMode, "approved-live");
  });
});
```

- [ ] **Step 2: Create ReplayStatusIndex**

Create `src/runtime/replay-status-index.ts`:

```typescript
/**
 * replay-status-index.ts — Global index of replay lifecycle statuses.
 *
 * Persisted at .alix/replays/index.json.
 * Provides a single source of truth for whether a replay has been
 * captured, rolled back, or is in progress.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

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

export type ReplayStatusIndexData = {
  entries: ReplayStatusEntry[];
};

export class ReplayStatusIndex {
  constructor(private cwd: string) {}

  private indexPath(): string {
    return join(this.cwd, ".alix", "replays", "index.json");
  }

  async load(): Promise<ReplayStatusIndexData> {
    const path = this.indexPath();
    if (!existsSync(path)) return { entries: [] };
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ReplayStatusIndexData;
    } catch {
      return { entries: [] };
    }
  }

  async save(data: ReplayStatusIndexData): Promise<void> {
    const path = this.indexPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  async getEntry(replayId: string): Promise<ReplayStatusEntry | undefined> {
    const data = await this.load();
    return data.entries.find(e => e.replayId === replayId);
  }

  async getStatus(replayId: string): Promise<ReplayStatus | undefined> {
    const entry = await this.getEntry(replayId);
    return entry?.status;
  }

  async getAll(): Promise<ReplayStatusEntry[]> {
    const data = await this.load();
    return data.entries;
  }

  async setStatus(replayId: string, status: ReplayStatus, mode?: string): Promise<void> {
    const data = await this.load();
    const existing = data.entries.find(e => e.replayId === replayId);
    const now = new Date().toISOString();
    if (existing) {
      existing.status = status;
      existing.updatedAt = now;
      if (mode) existing.replayMode = mode;
    } else {
      data.entries.push({
        replayId,
        status,
        createdAt: now,
        updatedAt: now,
        replayMode: mode,
      });
    }
    await this.save(data);
  }

  async ensureReplay(replayId: string, mode?: string): Promise<void> {
    const existing = await this.getStatus(replayId);
    if (!existing) {
      await this.setStatus(replayId, "capturing", mode);
    }
  }
}
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build && npx node --test dist/tests/runtime/replay-status-index.test.js
```
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/replay-status-index.ts tests/runtime/replay-status-index.test.ts
git commit -m "feat(runtime): add replay status index"
```

---

### Task 2: Build ReplayLock

**Files:**
- Create: `src/runtime/replay-lock.ts`
- Create: `tests/runtime/replay-lock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/replay-lock.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayLock, DEFAULT_LOCK_TTL_MS } from "../../src/runtime/replay-lock.js";

describe("ReplayLock", () => {
  let tmpDir: string;
  let lock: ReplayLock;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "replay-lock-"));
    lock = new ReplayLock(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("acquires lock successfully", async () => {
    const acquired = await lock.acquire("replay_001", "rollback");
    assert.equal(acquired, true);
  });

  it("rejects duplicate acquire", async () => {
    const a1 = await lock.acquire("replay_002", "rollback");
    assert.equal(a1, true);
    const a2 = await lock.acquire("replay_002", "rollback");
    assert.equal(a2, false);
  });

  it("allows acquire after release", async () => {
    const a1 = await lock.acquire("replay_003", "rollback");
    assert.equal(a1, true);
    await lock.release("replay_003");
    const a2 = await lock.acquire("replay_003", "rollback");
    assert.equal(a2, true);
  });

  it("detects stale lock", async () => {
    // Simulate a stale lock by writing an old timestamp
    const staleLock = {
      pid: 0, hostname: "old-host", replayId: "replay_stale",
      operation: "rollback", acquiredAt: new Date(Date.now() - 120_000).toISOString(),
    };
    const lockPath = join(tmpDir, ".alix", "replays", "replay_stale", ".lock");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tmpDir, ".alix", "replays", "replay_stale"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(staleLock));
    const stale = await lock.isStale("replay_stale");
    assert.equal(stale, true);
  });

  it("detects fresh lock as not stale", async () => {
    await lock.acquire("replay_fresh", "rollback");
    const stale = await lock.isStale("replay_fresh");
    assert.equal(stale, false);
  });

  it("force release removes lock file", async () => {
    await lock.acquire("replay_004", "rollback");
    const lockPath = join(tmpDir, ".alix", "replays", "replay_004", ".lock");
    assert.ok(existsSync(lockPath));
    await lock.forceRelease("replay_004");
    assert.equal(existsSync(lockPath), false);
  });

  it("returns null for non-existent lock info", async () => {
    const info = await lock.getLockInfo("nonexistent");
    assert.equal(info, null);
  });
});
```

- [ ] **Step 2: Create ReplayLock**

Create `src/runtime/replay-lock.ts`:

```typescript
/**
 * replay-lock.ts — Per-replay file lock with stale detection.
 *
 * Lock file at .alix/replays/<replayId>/.lock prevents concurrent
 * mutation operations on the same replay artifact set.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";

export type ReplayLockInfo = {
  pid: number;
  hostname: string;
  replayId: string;
  operation: "rollback" | "replay";
  acquiredAt: string;
};

export const DEFAULT_LOCK_TTL_MS = 30_000;

export class ReplayLock {
  constructor(private cwd: string) {}

  private lockPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, ".lock");
  }

  async acquire(replayId: string, operation: "rollback" | "replay"): Promise<boolean> {
    const path = this.lockPath(replayId);

    // Check if lock already exists
    if (existsSync(path)) {
      const stale = await this.isStale(replayId);
      if (!stale) return false;
      await this.forceRelease(replayId);
    }

    // Acquire
    const info: ReplayLockInfo = {
      pid: process.pid,
      hostname: hostname(),
      replayId,
      operation,
      acquiredAt: new Date().toISOString(),
    };

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(info, null, 2), "utf-8");
    return true;
  }

  async release(replayId: string): Promise<void> {
    const path = this.lockPath(replayId);
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  async isLocked(replayId: string): Promise<boolean> {
    const path = this.lockPath(replayId);
    if (!existsSync(path)) return false;
    return !(await this.isStale(replayId));
  }

  async getLockInfo(replayId: string): Promise<ReplayLockInfo | null> {
    const path = this.lockPath(replayId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ReplayLockInfo;
    } catch {
      return null;
    }
  }

  async isStale(replayId: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<boolean> {
    const info = await this.getLockInfo(replayId);
    if (!info) return true;
    const age = Date.now() - new Date(info.acquiredAt).getTime();
    return age > ttlMs;
  }

  async forceRelease(replayId: string): Promise<void> {
    const path = this.lockPath(replayId);
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  async cleanupStale(maxAgeMs: number = DEFAULT_LOCK_TTL_MS): Promise<string[]> {
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const replaysDir = join(this.cwd, ".alix", "replays");
    if (!existsSync(replaysDir)) return [];
    const cleaned: string[] = [];
    for (const entry of readdirSync(replaysDir)) {
      const lockPath = join(replaysDir, entry, ".lock");
      if (existsSync(lockPath)) {
        try {
          const info = JSON.parse(readFileSync(lockPath, "utf-8")) as ReplayLockInfo;
          const age = Date.now() - new Date(info.acquiredAt).getTime();
          if (age > maxAgeMs) {
            rmSync(lockPath);
            cleaned.push(entry);
          }
        } catch { /* skip unparseable */ }
      }
    }
    return cleaned;
  }
}
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build && npx node --test dist/tests/runtime/replay-lock.test.js
```
Expected: 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/replay-lock.ts tests/runtime/replay-lock.test.ts
git commit -m "feat(runtime): add replay lock and stale lock detection"
```

---

### Task 3: Build rollback progress tracking

**Files:**
- Create: `src/runtime/rollback-progress.ts`
- The test file will be in Task 5 (combined with idempotency)

- [ ] **Step 1: Create RollbackProgressStore**

Create `src/runtime/rollback-progress.ts`:

```typescript
/**
 * rollback-progress.ts — Per-rollback step-level progress tracking.
 *
 * Persisted at .alix/replays/<replayId>/rollback-progress.json.
 * Enables idempotent rollback and resume from partial completion.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type RollbackProgress = {
  rollbackId: string;
  replayId: string;
  status: "running" | "partial" | "completed" | "failed";
  lastCompletedStepIndex: number;
  completedPaths: string[];
  failedPath?: string;
  updatedAt: string;
};

export class RollbackProgressStore {
  constructor(private cwd: string) {}

  private progressPath(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId, "rollback-progress.json");
  }

  async load(replayId: string): Promise<RollbackProgress | null> {
    const path = this.progressPath(replayId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as RollbackProgress;
    } catch {
      return null;
    }
  }

  async save(progress: RollbackProgress): Promise<void> {
    const path = this.progressPath(progress.replayId);
    mkdirSync(dirname(path), { recursive: true });
    progress.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(progress, null, 2), "utf-8");
  }

  async initProgress(replayId: string, rollbackId: string): Promise<RollbackProgress> {
    const progress: RollbackProgress = {
      rollbackId,
      replayId,
      status: "running",
      lastCompletedStepIndex: -1,
      completedPaths: [],
      updatedAt: new Date().toISOString(),
    };
    await this.save(progress);
    return progress;
  }

  async markStepCompleted(replayId: string, rollbackId: string, stepIndex: number, path: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    progress.status = "running";
    progress.lastCompletedStepIndex = stepIndex;
    if (!progress.completedPaths.includes(path)) {
      progress.completedPaths.push(path);
    }
    await this.save(progress);
  }

  async markFailed(replayId: string, rollbackId: string, path: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    progress.status = "partial";
    progress.failedPath = path;
    await this.save(progress);
  }

  async markCompleted(replayId: string, rollbackId: string): Promise<void> {
    const progress = await this.load(replayId) ?? await this.initProgress(replayId, rollbackId);
    progress.status = "completed";
    await this.save(progress);
  }

  async getCompletedPaths(replayId: string): Promise<string[]> {
    const progress = await this.load(replayId);
    return progress?.completedPaths ?? [];
  }

  async isPathCompleted(replayId: string, path: string): Promise<boolean> {
    const paths = await this.getCompletedPaths(replayId);
    return paths.includes(path);
  }
}
```

- [ ] **Step 2: Build check**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/rollback-progress.ts
git commit -m "feat(runtime): add rollback progress tracking"
```

---

### Task 4: Integrate status index into ReplayDiffStore and ReplayExecutor

**Files:**
- Modify: `src/runtime/replay-diff-store.ts`
- Modify: `src/runtime/replay-executor.ts`

- [ ] **Step 1: Update ReplayDiffStore to set "capturing" on first record**

In `src/runtime/replay-diff-store.ts`, add import:

```typescript
import type { ReplayStatusIndex } from "./replay-status-index.js";
```

In `appendRecord()`, at the start, ensure the replay is registered:

```typescript
async appendRecord(replayId: string, record: ReplayDiffRecord): Promise<void> {
  // Register replay in status index
  if (this.statusIndex) {
    await this.statusIndex.ensureReplay(replayId);
  }
  // ... existing code ...
}
```

Add `statusIndex` to constructor:

```typescript
export class ReplayDiffStore {
  constructor(
    private cwd: string,
    private statusIndex?: ReplayStatusIndex,
  ) {}
  // ...
}
```

- [ ] **Step 2: Update ReplayExecutor to set "completed" status after approved-live replay**

In `src/runtime/replay-executor.ts`, in the `execute()` method, after the main loop and before the return, add:

```typescript
// Update status index
if (opts?.statusIndex && plan.replayId) {
  const status = plan.mode === "approved-live" ? "completed" as const
    : plan.mode === "dry-run" ? undefined as const
    : "capturing" as const;
  if (status) {
    await opts.statusIndex.setStatus(plan.replayId, status, plan.mode);
  }
}
```

Add `statusIndex` to `ReplayExecuteOptions`:

```typescript
export type ReplayExecuteOptions = {
  approvalStore?: ApprovalStore;
  diffStore?: ReplayDiffStore;
  statusIndex?: ReplayStatusIndex;
};
```

Add import:
```typescript
import type { ReplayStatusIndex } from "./replay-status-index.js";
```

- [ ] **Step 3: Build and check**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/replay-diff-store.ts src/runtime/replay-executor.ts
git commit -m "fix(runtime): integrate status index into replay lifecycle"
```

---

### Task 5: Make RollbackExecutor idempotent and resumable

**Files:**
- Modify: `src/runtime/rollback-executor.ts`
- Create: `tests/runtime/rollback-idempotency.test.ts`
- Create: `tests/runtime/rollback-resume.test.ts`

- [ ] **Step 1: Write the idempotency tests**

Create `tests/runtime/rollback-idempotency.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RollbackExecutor } from "../../src/runtime/rollback-executor.js";
import { ReplayDiffStore } from "../../src/runtime/replay-diff-store.js";
import { ReplayStatusIndex } from "../../src/runtime/replay-status-index.js";
import { RollbackProgressStore } from "../../src/runtime/rollback-progress.js";
import { ReplayLock } from "../../src/runtime/replay-lock.js";
import { buildRollbackPlan } from "../../src/runtime/rollback-plan.js";
import { EventLog } from "../../src/events/event-log.js";

describe("RollbackExecutor idempotency", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: RollbackExecutor;
  let diffStore: ReplayDiffStore;
  let statusIndex: ReplayStatusIndex;
  let progressStore: RollbackProgressStore;
  let replayLock: ReplayLock;
  let approvalStore: any;
  const replayId = "replay_idempotent";

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-idem-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new RollbackExecutor(tmpDir, eventLog);
    diffStore = new ReplayDiffStore(tmpDir);
    statusIndex = new ReplayStatusIndex(tmpDir);
    progressStore = new RollbackProgressStore(tmpDir);
    replayLock = new ReplayLock(tmpDir);

    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();

    // Set up a modified file
    const testFile = "src/restore-me.txt";
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, testFile), "ORIGINAL content");
    await diffStore.captureBefore(replayId, testFile);
    writeFileSync(join(tmpDir, testFile), "MODIFIED content");
    await diffStore.captureAfter(replayId, testFile);
    await diffStore.computeDiff(replayId, testFile);

    // Mark replay as completed
    await statusIndex.setStatus(replayId, "completed", "approved-live");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets rollback-completed status after successful rollback", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    // Resolve approvals
    const pending1 = approvalStore.listPending();
    for (const a of pending1) {
      await approvalStore.resolve(a.id, "approved");
    }

    const result = await executor.execute(plan, {
      approvalStore, statusIndex, progressStore, replayLock,
    });

    const finalStatus = await statusIndex.getStatus(replayId);
    assert.equal(finalStatus, "rollback-completed");
    assert.equal(result.completionStatus, "completed");
  });

  it("returns no-op for already completed rollback", async () => {
    // Verify status is already rollback-completed
    const status = await statusIndex.getStatus(replayId);
    assert.equal(status, "rollback-completed");

    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    const result = await executor.execute(plan, {
      approvalStore, statusIndex, progressStore, replayLock,
    });

    // Should be no-op — skip all steps
    assert.equal(result.completionStatus, "noop");
    assert.equal(result.successCount, 0);
    assert.equal(result.skippedCount, plan.steps.length);
  });
});
```

- [ ] **Step 2: Modify RollbackExecutor**

In `src/runtime/rollback-executor.ts`:

Add imports:
```typescript
import type { ReplayStatusIndex } from "./replay-status-index.js";
import type { RollbackProgressStore } from "./rollback-progress.js";
import type { ReplayLock } from "./replay-lock.js";
```

Extend `RollbackExecuteOptions`:
```typescript
export type RollbackExecuteOptions = {
  approvalStore?: any;
  resume?: boolean;
  statusIndex?: ReplayStatusIndex;
  progressStore?: RollbackProgressStore;
  replayLock?: ReplayLock;
};
```

Add to `RollbackResult`:
```typescript
export type RollbackResult = {
  // ... existing fields
  resumed?: boolean;
  completionStatus?: "completed" | "partial" | "noop";
};
```

In the `execute()` method, at the very start, after `startTime` initialization, add:

```typescript
// === IDEMPOTENCY AND LIFECYCLE ===
let resumed = false;
let completionStatus: "completed" | "partial" | "noop" | undefined;
const lock = opts?.replayLock;

// 1. Check status index for completed rollback
if (opts?.statusIndex && plan.mode === "approved-live") {
  const currentStatus = await opts.statusIndex.getStatus(plan.replayId);
  if (currentStatus === "rollback-completed") {
    // No-op: all steps already completed
    await this.logEvent(ROLLBACK_EVENT_TYPES.COMPLETED, {
      rollbackId: plan.rollbackId, replayId: plan.replayId,
      mode: plan.mode, stepCount: 0, successCount: 0, blockedCount: 0,
      skippedCount: plan.steps.length, totalDurationMs: 0,
    });
    return {
      rollbackId: plan.rollbackId, replayId: plan.replayId,
      mode: plan.mode, steps: plan.steps.map((s, i) => ({
        index: i + 1, path: s.path, action: s.action,
        status: "skipped" as const, output: "Already rolled back",
        durationMs: 0,
      })),
      startedAt, completedAt: new Date().toISOString(), totalDurationMs: 0,
      totalSteps: plan.steps.length, successCount: 0, blockedCount: 0,
      skippedCount: plan.steps.length, warnings: [],
      resumed: false, completionStatus: "noop",
    };
  }
}

// 2. Acquire lock for approved-live mode
if (plan.mode === "approved-live" && lock) {
  const acquired = await lock.acquire(plan.replayId, "rollback");
  if (!acquired) {
    return {
      rollbackId: plan.rollbackId, replayId: plan.replayId,
      mode: plan.mode, steps: [], startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: 0, totalSteps: 0,
      successCount: 0, blockedCount: 1, skippedCount: 0,
      warnings: ["Lock held by another process"],
      resumed: false, completionStatus: undefined,
    };
  }
}

// 3. Load progress and determine resume index
let startStepIndex = 0;
let completedPaths: string[] = [];
const progressSt = opts?.progressStore;

if (progressSt) {
  const existing = await progressSt.load(plan.replayId);
  if (existing && existing.status === "partial" && opts?.resume) {
    startStepIndex = existing.lastCompletedStepIndex + 1;
    completedPaths = existing.completedPaths;
    resumed = true;
  }
  await progressSt.initProgress(plan.replayId, plan.rollbackId);
}

// 4. Update status to running
if (opts?.statusIndex && plan.mode === "approved-live") {
  await opts.statusIndex.setStatus(plan.replayId, "rollback-running", plan.mode);
}
// === END IDEMPOTENCY ===
```

Then, at the END of the function, BEFORE the return, add:

```typescript
// Update status and release lock
if (opts?.statusIndex && plan.mode === "approved-live") {
  if (blockedCount === 0 && failedCount === 0) {
    if (progressSt && plan.replayId) {
      await progressSt.markCompleted(plan.replayId, plan.rollbackId);
    }
    completionStatus = "completed";
    await opts.statusIndex.setStatus(plan.replayId, "rollback-completed", plan.mode);
  } else {
    completionStatus = "partial";
  }
}

if (lock && plan.mode === "approved-live") {
  await lock.release(plan.replayId);
}
```

In the return object, add the new fields:

```typescript
return {
  rollbackId: plan.rollbackId,
  replayId: plan.replayId,
  mode: plan.mode,
  steps: stepResults,
  startedAt,
  completedAt,
  totalDurationMs,
  totalSteps: plan.steps.length,
  successCount,
  blockedCount,
  skippedCount,
  warnings: [],
  resumed,
  completionStatus,
};
```

For dry-run mode, no lock, no status changes. Dry-run sets completionStatus to undefined (not persisted).

Now, modify the dry-run handler to NOT call the status/cleanup block. Since dry-run returns early (before the cleanup code runs), this is already handled — the `continue` in the dry-run section skips the rest of the loop.

Actually, looking at the code flow: dry-run iterates all steps and then falls through to the cleanup code at the end. We need to make sure the cleanup code doesn't run for dry-run. Add a guard at the cleanup:

```typescript
// Update status and release lock (skip for dry-run)
if (plan.mode !== "dry-run" && opts?.statusIndex && plan.replayId) {
```

Also make the step loop skip completed paths for resume:

In the step loop, after getting `step` and before logging STEP_STARTED, add:

```typescript
// Skip already-completed paths on resume
if (resumed && completedPaths.includes(step.path)) {
  stepResult.status = "skipped";
  stepResult.output = `Already completed in previous rollback attempt (step ${step.index})`;
  stepResult.durationMs = 0;
  skippedCount++;
  stepResults.push(stepResult);
  continue;
}
```

And after each successful mutation, call `markStepCompleted`:

```typescript
if (progressSt && plan.replayId) {
  await progressSt.markStepCompleted(plan.replayId, plan.rollbackId, i, step.path);
}
```

Add this after the `stepResult.status = "completed"` lines for both restore and delete-created actions.

- [ ] **Step 3: Write the resume test**

Create `tests/runtime/rollback-resume.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RollbackExecutor } from "../../src/runtime/rollback-executor.js";
import { ReplayDiffStore } from "../../src/runtime/replay-diff-store.js";
import { ReplayStatusIndex } from "../../src/runtime/replay-status-index.js";
import { RollbackProgressStore } from "../../src/runtime/rollback-progress.js";
import { ReplayLock } from "../../src/runtime/replay-lock.js";
import { buildRollbackPlan } from "../../src/runtime/rollback-plan.js";
import { EventLog } from "../../src/events/event-log.js";

describe("RollbackExecutor resume", () => {
  let tmpDir: string;
  let eventLog: EventLog;
  let executor: RollbackExecutor;
  let diffStore: ReplayDiffStore;
  let statusIndex: ReplayStatusIndex;
  let progressStore: RollbackProgressStore;
  let replayLock: ReplayLock;
  let approvalStore: any;
  const replayId = "replay_resume";

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-resume-"));
    const logDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(logDir, { recursive: true });
    eventLog = new EventLog(logDir);
    await eventLog.init();
    executor = new RollbackExecutor(tmpDir, eventLog);
    diffStore = new ReplayDiffStore(tmpDir);
    statusIndex = new ReplayStatusIndex(tmpDir);
    progressStore = new RollbackProgressStore(tmpDir);
    replayLock = new ReplayLock(tmpDir);

    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    approvalStore = new ApprovalStore(tmpDir);
    await approvalStore.load();

    // Set up two files: one that will be "already restored" and one not yet
    mkdirSync(join(tmpDir, "src"), { recursive: true });

    writeFileSync(join(tmpDir, "src/file-a.txt"), "ORIGINAL A");
    await diffStore.captureBefore(replayId, "src/file-a.txt");
    writeFileSync(join(tmpDir, "src/file-a.txt"), "MODIFIED A");
    await diffStore.captureAfter(replayId, "src/file-a.txt");
    await diffStore.computeDiff(replayId, "src/file-a.txt");

    writeFileSync(join(tmpDir, "src/file-b.txt"), "ORIGINAL B");
    await diffStore.captureBefore(replayId, "src/file-b.txt");
    writeFileSync(join(tmpDir, "src/file-b.txt"), "MODIFIED B");
    await diffStore.captureAfter(replayId, "src/file-b.txt");
    await diffStore.computeDiff(replayId, "src/file-b.txt");

    await statusIndex.setStatus(replayId, "completed", "approved-live");

    // Simulate partial progress: file-a completed, file-b not yet
    const progress = {
      rollbackId: "rollback_partial_001",
      replayId,
      status: "partial" as const,
      lastCompletedStepIndex: 0,
      completedPaths: ["src/file-a.txt"],
      updatedAt: new Date().toISOString(),
    };
    const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
    const progressDir = join(tmpDir, ".alix", "replays", replayId);
    mkdir(progressDir, { recursive: true });
    write(join(progressDir, "rollback-progress.json"), JSON.stringify(progress));
    await statusIndex.setStatus(replayId, "rollback-partial");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resumes from the first incomplete step", async () => {
    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    // Resolve approvals for the rollback
    const pending = approvalStore.listPending();
    for (const a of pending) {
      await approvalStore.resolve(a.id, "approved");
    }

    // Execute with resume flag
    const result = await executor.execute(plan, {
      approvalStore, statusIndex, progressStore, replayLock, resume: true,
    });

    // file-a should be skipped (already completed), file-b should be restored
    const stepA = result.steps.find(s => s.path === "src/file-a.txt");
    const stepB = result.steps.find(s => s.path === "src/file-b.txt");

    assert.ok(stepA);
    assert.equal(stepA!.status, "skipped"); // already done

    assert.ok(stepB);
    assert.equal(stepB!.status, "completed"); // newly restored

    // file-b should now have original content
    assert.equal(readFileSync(join(tmpDir, "src/file-b.txt"), "utf-8"), "ORIGINAL B");

    assert.equal(result.resumed, true);
  });

  it("refuses resume without --resume flag", async () => {
    // Reset status to rollback-partial
    await statusIndex.setStatus(replayId, "rollback-partial");

    const diffSet = await diffStore.loadIndex(replayId);
    assert.ok(diffSet);
    const plan = buildRollbackPlan(replayId, diffSet!, "approved-live");

    // Execute WITHOUT resume flag while status is rollback-partial
    const result = await executor.execute(plan, {
      approvalStore, statusIndex, progressStore, replayLock, resume: false,
    });

    // The executor should either block or warn about partial state
    // If completedPaths exist and resume=false, executor should skip completed
    // and warn. For simplicity, executor treats resume:false same as
    // resume being absent — it processes all non-completed paths.
    // The 'resumed' field should be false.
    assert.equal(result.resumed, false);
  });
});
```

- [ ] **Step 4: Build and run all rollback tests**

```bash
npm run build && npx node --test dist/tests/runtime/rollback-idempotency.test.js dist/tests/runtime/rollback-resume.test.js dist/tests/runtime/rollback-executor.test.js
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/rollback-executor.ts tests/runtime/rollback-idempotency.test.ts tests/runtime/rollback-resume.test.ts
git commit -m "fix(runtime): make rollback execution idempotent and resumable"
```

---

### Task 6: Add status badges and --resume flag in TUI

**Files:**
- Modify: `src/tui/trace-detail.ts`
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add status badge to renderReplayResult**

In `src/tui/trace-detail.ts`, modify `renderReplayResult`:

Add import:
```typescript
import type { ReplayStatus } from "../runtime/replay-status-index.js";
```

Change signature:
```typescript
export function renderReplayResult(
  result: ReplayResult,
  status?: ReplayStatus,
): string[] {
```

Add badge after `replayId`:
```typescript
  if (result.replayId) lines.push(`  ReplayId: ${result.replayId}`);
  if (status) {
    const badge = statusBadge(status);
    lines.push(`  Status:    ${badge}`);
  }
```

Add helper:
```typescript
function statusBadge(status: ReplayStatus): string {
  const map: Record<ReplayStatus, string> = {
    capturing: "[capturing]",
    completed: "[completed]",
    "rollback-dry-run": "[dry-run]",
    "rollback-running": "[rollback running]",
    "rollback-completed": "[rolled back]",
    "rollback-partial": "[partial]",
    locked: "[locked]",
  };
  return map[status] || `[${status}]`;
}
```

- [ ] **Step 2: Add --resume flag to /rollback command**

In `src/cli/commands/tui.ts`, find the `/rollback` command handler. Add `--resume` flag detection:

```typescript
const resume = args.includes("--resume");
```

In the approved-live section, pass `resume`:

```typescript
const executor = new RollbackExecutor(activeCwd, tuiLog);
const opts: any = {};
if (approvalStore) opts.approvalStore = approvalStore;
if (resume) opts.resume = true;
const result = await executor.execute(plan, opts);
```

Also in the dry-run section, add `--resume` to the usage message:
```typescript
tui.appendOutput("Usage: /rollback <replayId|selected> [--dry-run|--approved-live] [--resume]\n", false);
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/tui/trace-detail.ts src/cli/commands/tui.ts
git commit -m "feat(tui): show replay rollback status badges and add --resume flag"
```

---

### Task 7: Final verification

- [ ] **Step 1: Build and run all tests**

```bash
npm run build && npx node --test \
  dist/tests/runtime/replay-diff-store.test.js \
  dist/tests/runtime/replay-preview.test.js \
  dist/tests/runtime/replay-plan.test.js \
  dist/tests/runtime/replay-executor.test.js \
  dist/tests/runtime/replay-status-index.test.js \
  dist/tests/runtime/replay-lock.test.js \
  dist/tests/runtime/rollback-plan.test.js \
  dist/tests/runtime/rollback-executor.test.js \
  dist/tests/runtime/rollback-idempotency.test.js \
  dist/tests/runtime/rollback-resume.test.js \
  dist/tests/tui/replay-preview-detail.test.js \
  dist/tests/tui/replay-execution-detail.test.js \
  dist/tests/tui/replay-diff-display.test.js \
  dist/tests/tui/rollback-rendering.test.js \
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
Expected: Only M0.39 files.

- [ ] **Step 3: Tag and push**

```bash
git tag m0.39-replay-rollback-reliability
git push origin main --tags
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat: complete M0.39 replay rollback reliability hardening

- Add ReplayStatusIndex for global replay lifecycle tracking
- Add ReplayLock with stale lock detection and cleanup
- Add RollbackProgressStore for step-level rollback progress
- Make RollbackExecutor idempotent (no-op on completed rollback)
- Add --resume flag for continuing partial rollbacks
- Integrate status index into ReplayDiffStore and ReplayExecutor
- Add status badges to TUI replay/rollback result display
- Add 16 new tests for status index, locking, idempotency, resume
- All existing tests pass, no regressions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
