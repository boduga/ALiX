# M0.22: Daemon Task Control + Status

**Status:** ✅ Completed (M0.22) — Plan implemented and committed to main.

**Goal:** Add file-backed task registry, cooperative cancel, CLI task management, and Inspector visibility to the daemon.

**Files:**

| Task | Files |
|------|-------|
| A: TaskRegistry | `src/daemon/task-registry.ts`, `tests/daemon/task-registry.test.ts` |
| B: Daemon lifecycle | `src/daemon/daemon-server.ts` |
| C: CLI tasks | `src/cli.ts` |
| D: CLI cancel | `src/cli.ts`, `src/daemon/daemon-types.ts` |
| E: RuntimeIndex | `src/runtime/runtime-index.ts` |
| F: API + Inspector | `src/server/server.ts`, `src/ui/app.js`, `tests/server/server.test.ts` |

---

### A: TaskRegistry

**Create `src/daemon/task-registry.ts`**:

```typescript
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type DaemonTaskStatus =
  | "queued" | "running" | "completed" | "failed"
  | "cancel_requested" | "cancelled";

export type DaemonTaskRecord = {
  id: string;
  task: string;
  status: DaemonTaskStatus;
  sessionId?: string;
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
  error?: string;
};

export class TaskRegistry {
  private tasks: DaemonTaskRecord[] = [];
  private filePath: string;
  private maxCompleted = 100;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "daemon-tasks.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) { this.tasks = []; return; }
    try {
      this.tasks = JSON.parse(await readFile(this.filePath, "utf-8"));
    } catch { this.tasks = []; }
  }

  private async save(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(this.tasks, null, 2), "utf-8");
    await rename(tmp, this.filePath);
  }

  create(task: string): DaemonTaskRecord {
    const record: DaemonTaskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      task, status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.push(record);
    this.pruneCompleted();
    this.save().catch(() => {});
    return record;
  }

  update(id: string, changes: Partial<DaemonTaskRecord>): DaemonTaskRecord | null {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    this.tasks[idx] = { ...this.tasks[idx], ...changes, updatedAt: new Date().toISOString() };
    this.save().catch(() => {});
    return this.tasks[idx];
  }

  get(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id);
  }

  list(): DaemonTaskRecord[] {
    return [...this.tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Find a queued task by ID (for cancel-from-queue). */
  findQueued(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id && t.status === "queued");
  }

  private pruneCompleted(): void {
    const completed = this.tasks.filter(t =>
      t.status === "completed" || t.status === "failed" || t.status === "cancelled"
    );
    if (completed.length <= this.maxCompleted) return;
    const toRemove = completed.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, completed.length - this.maxCompleted);
    const removeIds = new Set(toRemove.map(t => t.id));
    this.tasks = this.tasks.filter(t => !removeIds.has(t.id));
  }
}
```

**Test:** 6 tests covering create, update status flow, get, list ordering, findQueued, and persistence.

---

### B: Daemon queue lifecycle

In `daemon-server.ts`:
- Import `TaskRegistry`, create instance, `await registry.load()` on startup
- In `handleRun`: `registry.update(taskId, { status: "running", sessionId, startedAt: ... })` at start, `registry.update(taskId, { status: "completed" })` on success, `registry.update(taskId, { status: "failed", error })` on failure
- In `handleCommand("run")`: generate taskId via `registry.create(task)`, pass taskId through the queue item, send `{ type: "task.created", taskId }` to client
- Cancel: add `handleCommand("cancel")` that finds the task, cancels queued immediately or sets `cancel_requested` for running, removes from queue if queued

---

### C+D: CLI tasks + cancel

In `cli.ts`:
- `alix daemon tasks` — reads `.alix/daemon-tasks.json` directly (or via daemon socket `status` command), prints table
- `alix daemon cancel <taskId>` — connects to daemon socket, sends `{ command: "cancel", taskId }`, prints result

Add to `daemon-types.ts`:
```typescript
| { command: "cancel"; taskId: string };
```

In daemon response types:
```typescript
| { type: "task.created"; taskId: string; task: string; position: number }
| { type: "task.cancelled"; taskId: string }
| { type: "cancel.error"; taskId: string; message: string }
```

---

### E: RuntimeIndex Source 6

In `runtime-index.ts`, add after source 5:

```typescript
// Source 6: daemon-tasks.json
const tasksPath = join(cwd, ".alix", "daemon-tasks.json");
if (existsSync(tasksPath)) {
  try {
    const raw = await readFile(tasksPath, "utf-8");
    const records = JSON.parse(raw) as any[];
    for (const r of records) {
      events.push({
        id: r.id, timestamp: r.updatedAt || r.createdAt,
        source: "daemon_task", action: `daemon.task.${r.status}`,
        sessionId: r.sessionId, status: r.status, summary: r.task,
        payload: { error: r.error },
      });
    }
  } catch {}
}
```

---

### F: API + Inspector

- `GET /api/daemon/tasks` — reads `.alix/daemon-tasks.json`, returns JSON
- Inspector Daemon panel: list tasks with ID, status, session, timestamps, task text
- Copyable cancel commands for running/queued tasks
