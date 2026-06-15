# M0.77a — Coordination Data Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the core coordination types (`CoordinationRun`, `WorkerAssignment`) and a persistent file-backed store that tracks multi-agent execution state, linking each worker to its ownership scopes and authorization decisions.

**Architecture:** Coordination types sit ABOVE the existing `WorkflowRun` / `TaskGraph` system. A `CoordinationRun` wraps one or more `WorkerAssignment`s, each of which references a `TaskNode` from the graph system via its `task` string and links to ownership scopes. A `CoordinationStore` persists runs as JSON files under `.alix/coordination/`. No execution logic yet — just the data model and persistence.

**Tech Stack:** TypeScript, existing `TaskNode`, `WorkflowRun`, `OwnershipRegistry`.

---

## File Structure

### Create
- `src/kernel/coordination-types.ts` — `CoordinationRun`, `WorkerAssignment`, `WorkerStatus`, helper constructors
- `src/kernel/coordination-store.ts` — File-backed `CoordinationStore` (CRUD operations on `.alix/coordination/`)
- `tests/kernel/coordination-store.test.ts` — unit tests for persistence

---

## Design

### CoordinationRun vs existing WorkflowRun

The existing `WorkflowRun` (in `workflow-run.ts`) tracks a single agent session — its goal, mode, budget, status. A `CoordinationRun` extends that concept with the coordinator's agent identity and an explicit array of worker assignments.

A `CoordinationRun` is created by the coordinator (ALiX in multi-agent mode). It references the agent's own session via `sessionId`, and each `WorkerAssignment` carries the task description, dependency order, ownership scopes (for the ownership gate), and a reference to the persisted result.

### WorkerAssignment vs existing TaskNode

The existing `TaskNode` (in `task-graph.ts`) is the graph executor's unit. A `WorkerAssignment` is a coordination-layer unit that maps a task to an agent slot. Key differences:
- `WorkerAssignment` has `ownershipScopes: string[]` — maps to ownership registry paths for path-based conflict detection
- `WorkerAssignment` has a simpler status lifecycle (`pending → ready → running → blocked → completed/failed/cancelled`) vs `TaskNode`'s more detailed `TaskNodeStatus`
- `WorkerAssignment.resultRef` points to a file or store key where the worker's output is persisted
- `WorkerAssignment` does NOT duplicate `TaskNode`'s `inputs`/`outputs`/`artifacts`/`memoryRefs` — those stay on the graph side

### Status lifecycle

```
                  ┌──────────────────────────────────┐
                  │           pending                │
                  └────────┬─────────────────────────┘
                           │ dependencies resolved
                           ▼
                  ┌──────────────────────────────────┐
                  │           ready                  │
                  └────────┬─────────────────────────┘
                           │ assigned & started
                           ▼
                  ┌──────────────────────────────────┐
         ┌───────│           running                │───────┐
         │       └────────┬─────────────────────────┘       │
         │                │                                  │
         │ dependency     │ completed                       │ abandoned
         │ blocked        ▼                                  │
         ▼       ┌──────────────────────────────────┐        ▼
  ┌──────────┐  │          completed                │  ┌──────────┐
  │ blocked  │  └──────────────────────────────────┘  │ cancelled│
  └──────────┘                                        └──────────┘
         │                          │                        │
         │ retry                    │ error                  │
         ▼                          ▼                        ▼
  ┌──────────┐              ┌──────────┐
  │ ready    │              │  failed  │
  └──────────┘              └──────────┘
```

---

### Task 1: Coordination types

**Files:**
- Create: `src/kernel/coordination-types.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
/**
 * coordination-types.ts — Core data model for multi-agent coordination.
 *
 * This sits ABOVE the existing WorkflowRun/TaskGraph system.
 * A CoordinationRun tracks one coordinator orchestration run with
 * multiple WorkerAssignments, each of which maps to a task slot
 * with ownership scopes for conflict detection.
 */

export type WorkerStatus =
  | "pending"      // not yet eligible
  | "ready"        // dependencies resolved, waiting for assignment
  | "running"      // actively executing
  | "blocked"      // blocked by dependency failure or resource contention
  | "completed"    // finished successfully
  | "failed"       // finished with error
  | "cancelled";   // cancelled before completion

export type CoordinationRunStatus =
  | "planning"     // coordinator is decomposing the goal
  | "running"      // one or more workers active
  | "blocked"      // all workers blocked or pending
  | "completed"    // all workers completed successfully
  | "failed";      // one or more workers failed and cannot proceed

export interface WorkerAssignment {
  /** Unique ID for this assignment (uuid) */
  id: string;

  /** Which coordination run owns this worker */
  coordinationRunId: string;

  /** The agent ID that will execute this task */
  agentId: string;

  /** Human-readable task description */
  taskLabel: string;

  /** Detailed goal prompt — what the worker should accomplish */
  goalPrompt: string;

  /** IDs of other WorkerAssignments that must complete first */
  dependencies: string[];

  /** Ownership scopes for path-based conflict detection.
   *  Each scope is a minimatch pattern (e.g. "src/**"). */
  ownershipScopes: string[];

  /** Current status */
  status: WorkerStatus;

  /** Reference to the persisted result (file path or store key).
   *  Set when status transitions to "completed" or "failed". */
  resultRef?: string;

  /** Error message, set when status is "failed" */
  error?: string;

  /** When this assignment was created */
  createdAt: string;

  /** When this assignment last changed status */
  updatedAt: string;
}

export interface CoordinationRun {
  /** Unique run ID (e.g. "coord_<uuid>") */
  id: string;

  /** Session ID of the coordinator agent */
  sessionId: string;

  /** The top-level goal being decomposed */
  rootGoal: string;

  /** Current run status */
  status: CoordinationRunStatus;

  /** Which agent (agentId) is the coordinator */
  coordinatorAgentId: string;

  /** All worker assignments in this run */
  workers: WorkerAssignment[];

  /** Schema version for forward compatibility */
  schemaVersion: "1.0";

  /** When the run was created */
  createdAt: string;

  /** When the run last changed status */
  updatedAt: string;
}

// ─── Constructors ─────────────────────────────────────────────────────

export function createCoordinationRun(opts: {
  sessionId: string;
  rootGoal: string;
  coordinatorAgentId: string;
}): CoordinationRun {
  const now = new Date().toISOString();
  return {
    id: `coord_${randomUUID()}`,
    sessionId: opts.sessionId,
    rootGoal: opts.rootGoal,
    status: "planning",
    coordinatorAgentId: opts.coordinatorAgentId,
    workers: [],
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
}

export function createWorkerAssignment(opts: {
  coordinationRunId: string;
  agentId: string;
  taskLabel: string;
  goalPrompt: string;
  dependencies?: string[];
  ownershipScopes?: string[];
}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id: `worker_${randomUUID()}`,
    coordinationRunId: opts.coordinationRunId,
    agentId: opts.agentId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    dependencies: opts.dependencies ?? [],
    ownershipScopes: opts.ownershipScopes ?? [],
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function transitionWorkerStatus(
  worker: WorkerAssignment,
  status: WorkerStatus,
  extra?: { resultRef?: string; error?: string },
): WorkerAssignment {
  return {
    ...worker,
    status,
    resultRef: extra?.resultRef ?? worker.resultRef,
    error: extra?.error ?? worker.error,
    updatedAt: new Date().toISOString(),
  };
}

export function transitionCoordinationRunStatus(
  run: CoordinationRun,
  status: CoordinationRunStatus,
): CoordinationRun {
  return { ...run, status, updatedAt: new Date().toISOString() };
}

/**
 * Compute the coordination run status from its workers' statuses.
 * - all completed → "completed"
 * - any failed and no path forward → "failed"
 * - any running → "running"
 * - all pending/blocked → "blocked"
 * - else → "running"
 */
export function recomputeRunStatus(run: CoordinationRun): CoordinationRunStatus {
  const allCompleted = run.workers.every(w => w.status === "completed");
  if (allCompleted && run.workers.length > 0) return "completed";

  const hasFailed = run.workers.some(w => w.status === "failed");
  const hasRunning = run.workers.some(w => w.status === "running" || w.status === "ready");
  if (hasFailed && !hasRunning) return "failed";

  const allIdle = run.workers.every(w =>
    w.status === "pending" || w.status === "blocked" || w.status === "cancelled"
  );
  if (allIdle && run.workers.length > 0) return "blocked";

  return "running";
}
```

- [ ] **Step 2: Build-check**

```bash
npm run build 2>&1 | head -20
```

Expected: clean compile. Note: needs `randomUUID` import — add `import { randomUUID } from "node:crypto";` at the top.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-types.ts
git commit -m "feat(coordination): add CoordinationRun, WorkerAssignment types with constructors"
```

---

### Task 2: Coordination store

**Files:**
- Create: `src/kernel/coordination-store.ts`

- [ ] **Step 1: Write the CoordinationStore class**

```typescript
/**
 * coordination-store.ts — File-backed persistent store for CoordinationRun
 * and WorkerAssignment records.
 *
 * Each run is persisted as .alix/coordination/<runId>.json.
 * Workers are embedded within the run JSON, not stored separately.
 *
 * Lock coordination: no file locking (single-file-per-run avoids
 * cross-write corruption). Callers must not write the same run
 * concurrently from multiple processes.
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CoordinationRun, CoordinationRunStatus, WorkerAssignment, WorkerStatus } from "./coordination-types.js";
import { transitionWorkerStatus, transitionCoordinationRunStatus, recomputeRunStatus } from "./coordination-types.js";

export class CoordinationStore {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = join(cwd, ".alix", "coordination");
  }

  private runPath(runId: string): string {
    return join(this.baseDir, `${runId}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  /** Save a coordination run (full overwrite). */
  async save(run: CoordinationRun): Promise<void> {
    await this.ensureDir();
    run.updatedAt = new Date().toISOString();
    await writeFile(this.runPath(run.id), JSON.stringify(run, null, 2), "utf-8");
  }

  /** Load a coordination run by ID. */
  async load(runId: string): Promise<CoordinationRun | null> {
    const path = this.runPath(runId);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as CoordinationRun;
    } catch {
      return null;
    }
  }

  /** List all coordination runs, newest first. */
  async list(): Promise<CoordinationRun[]> {
    if (!existsSync(this.baseDir)) return [];
    const files = await readdir(this.baseDir);
    const runs: CoordinationRun[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.baseDir, file), "utf-8");
        runs.push(JSON.parse(raw) as CoordinationRun);
      } catch {
        // skip corrupt files
      }
    }
    return runs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /** List runs in a specific status. */
  async listByStatus(status: CoordinationRunStatus): Promise<CoordinationRun[]> {
    const all = await this.list();
    return all.filter(r => r.status === status);
  }

  /** Delete a coordination run. */
  async delete(runId: string): Promise<boolean> {
    const path = this.runPath(runId);
    if (!existsSync(path)) return false;
    await writeFile(path, JSON.stringify({ deleted: true, runId }), "utf-8");
    return true;
  }

  // ── Worker-level operations ──────────────────────────────────────

  /** Add a worker to an existing run. */
  async addWorker(runId: string, worker: WorkerAssignment): Promise<CoordinationRun | null> {
    const run = await this.load(runId);
    if (!run) return null;
    run.workers.push(worker);
    run.status = recomputeRunStatus(run);
    await this.save(run);
    return run;
  }

  /** Update a single worker's status by ID within a run. */
  async updateWorkerStatus(
    runId: string,
    workerId: string,
    status: WorkerStatus,
    extra?: { resultRef?: string; error?: string },
  ): Promise<CoordinationRun | null> {
    const run = await this.load(runId);
    if (!run) return null;
    const idx = run.workers.findIndex(w => w.id === workerId);
    if (idx === -1) return null;
    run.workers[idx] = transitionWorkerStatus(run.workers[idx], status, extra);
    run.status = recomputeRunStatus(run);
    await this.save(run);
    return run;
  }

  /** Get workers that are "ready" (dependencies resolved, not yet running). */
  getReadyWorkers(run: CoordinationRun): WorkerAssignment[] {
    const completedIds = new Set(
      run.workers.filter(w => w.status === "completed").map(w => w.id)
    );
    return run.workers.filter(w =>
      w.status === "ready" ||
      (w.status === "pending" && w.dependencies.every(d => completedIds.has(d)))
    );
  }

  /** Find the next worker that is ready and not yet assigned. */
  nextReadyWorker(run: CoordinationRun): WorkerAssignment | undefined {
    return this.getReadyWorkers(run).find(w => w.status !== "running");
  }

  /** Check if all workers in a run have reached a terminal state. */
  isComplete(run: CoordinationRun): boolean {
    return run.workers.length > 0 &&
      run.workers.every(w =>
        w.status === "completed" || w.status === "failed" || w.status === "cancelled"
      );
  }
}
```

- [ ] **Step 2: Build-check**

```bash
npm run build 2>&1 | head -20
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/coordination-store.ts
git commit -m "feat(coordination): add CoordinationStore with file-backed persistence"
```

---

### Task 3: Tests

**Files:**
- Create: `tests/kernel/coordination-store.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
/**
 * coordination-store.test.ts — Unit tests for CoordinationStore.
 *
 * Tests persistence, worker lifecycle transitions, ready-worker
 * detection (dependency resolution), and run-status recomputation.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
  transitionWorkerStatus,
  recomputeRunStatus,
} from "../../src/kernel/coordination-types.js";
import type { CoordinationRun, WorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("CoordinationStore", () => {
  let tmpDir: string;
  let store: CoordinationStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coord-test-"));
    store = new CoordinationStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a run", async () => {
    const run = createCoordinationRun({
      sessionId: "session-1",
      rootGoal: "Test goal",
      coordinatorAgentId: "alix",
    });
    await store.save(run);
    const loaded = await store.load(run.id);
    assert.ok(loaded, "should load saved run");
    assert.equal(loaded?.rootGoal, "Test goal");
    assert.equal(loaded?.status, "planning");
  });

  it("returns null for missing run", async () => {
    const loaded = await store.load("coord_nonexistent");
    assert.equal(loaded, null);
  });

  it("lists runs newest first", async () => {
    const run1 = createCoordinationRun({ sessionId: "s1", rootGoal: "First", coordinatorAgentId: "alix" });
    const run2 = createCoordinationRun({ sessionId: "s2", rootGoal: "Second", coordinatorAgentId: "alix" });
    await store.save(run1);
    await store.save(run2);
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].rootGoal, "Second"); // newest first
  });

  it("adds a worker to a run", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    await store.save(run);

    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "worker-a",
      taskLabel: "Research",
      goalPrompt: "Find relevant info",
    });
    const updated = await store.addWorker(run.id, worker);
    assert.ok(updated);
    assert.equal(updated!.workers.length, 1);
    assert.equal(updated!.workers[0].taskLabel, "Research");
  });

  it("updates a worker's status", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "w1", taskLabel: "Task", goalPrompt: "do it",
    });
    await store.addWorker(run.id, worker);

    const updated = await store.updateWorkerStatus(run.id, worker.id, "running");
    assert.ok(updated);
    const found = updated!.workers.find(w => w.id === worker.id);
    assert.equal(found?.status, "running");
  });

  it("detects ready workers by dependency resolution", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Dep test", coordinatorAgentId: "alix" });
    await store.save(run);

    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "Step 1", goalPrompt: "do it" });
    const w2 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "Step 2", goalPrompt: "do it", dependencies: [w1.id] });
    await store.addWorker(run.id, w1);
    await store.addWorker(run.id, w2);

    // Only w1 should be ready initially (no dependencies)
    let ready = store.getReadyWorkers(run);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, w1.id);

    // After marking w1 completed, w2 becomes ready
    const updatedRun = await store.updateWorkerStatus(run.id, w1.id, "completed");
    assert.ok(updatedRun);
    ready = store.getReadyWorkers(updatedRun!);
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, w2.id); // only w2 now
  });

  it("isComplete returns false with no workers", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Empty", coordinatorAgentId: "alix" });
    assert.equal(store.isComplete(run), false);
  });

  it("isComplete returns true when all workers terminal", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Complete", coordinatorAgentId: "alix" });
    await store.save(run);
    const w1 = createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "Task", goalPrompt: "do it" });
    await store.addWorker(run.id, w1);
    await store.updateWorkerStatus(run.id, w1.id, "completed");
    const loaded = await store.load(run.id);
    assert.ok(loaded);
    assert.equal(store.isComplete(loaded), true);
  });
});

describe("recomputeRunStatus", () => {
  it("returns planning when no workers", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    assert.equal(recomputeRunStatus(run), "running");
  });

  it("returns completed when all workers completed", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "completed");
    run.workers[1] = transitionWorkerStatus(run.workers[1], "completed");
    assert.equal(recomputeRunStatus(run), "completed");
  });

  it("returns failed when some workers failed and none running", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "failed", { error: "oops" });
    assert.equal(recomputeRunStatus(run), "failed");
  });

  it("returns running when any worker is active", () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "Test", coordinatorAgentId: "alix" });
    run.workers = [
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w1", taskLabel: "A", goalPrompt: "a" }),
      createWorkerAssignment({ coordinationRunId: run.id, agentId: "w2", taskLabel: "B", goalPrompt: "b" }),
    ];
    run.workers[0] = transitionWorkerStatus(run.workers[0], "running");
    run.workers[1] = transitionWorkerStatus(run.workers[1], "completed");
    assert.equal(recomputeRunStatus(run), "running");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run build && node --test dist/tests/kernel/coordination-store.test.js
```

Expected: ~12-14 tests pass (depending on exact number of `it` blocks).

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/coordination-store.test.ts
git commit -m "test(coordination): add unit tests for CoordinationStore and status recomputation"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/kernel/coordination-store.test.js` — all pass
3. `npm run test:node:ci` — existing tests still pass
4. `git nexus detect_changes` — show only `src/kernel/coordination-types.ts`, `src/kernel/coordination-store.ts`, `tests/kernel/coordination-store.test.ts`
