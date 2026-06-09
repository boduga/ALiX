# M0.22: Daemon Task Control + Status

## Two-Layer Architecture

```
CLI: alix daemon tasks|cancel        Inspector (read-only)
       │                                      │
       ▼                                      ▼
  Daemon Server ─── .alix/daemon-tasks.json ──► GET /api/daemon/tasks
       │
       ├── TaskRegistry (file-backed CRUD)
       ├── TaskQueue (FIFO, cooperative cancel)
       └── handleRun via runTask()
```

## Core Types

```typescript
type DaemonTaskStatus =
  | "queued" | "running" | "completed" | "failed"
  | "cancel_requested" | "cancelled";

type DaemonTaskRecord = {
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
```

## Task Lifecycle

```
submit → queued → running → completed
                   ↘ failed
cancel(queued)  → cancelled
cancel(running) → cancel_requested
cancel(completed/failed) → error
cancel(unknown) → error
```

## Cancel Behavior

| Current Status | Cancel Result |
|----------------|--------------|
| queued | cancelled immediately |
| running | cancel_requested (cooperative, next iteration) |
| cancel_requested | no-op |
| completed | error: cannot cancel completed |
| failed | error: cannot cancel failed |
| cancelled | no-op |
| unknown ID | error: task not found |

## Storage

- `.alix/daemon-tasks.json` — atomic write (temp file + rename)
- `pruneCompleted(max=100)` on each new submission

## Sub-milestones

| # | Title | Files |
|---|-------|-------|
| A | TaskRegistry | `src/daemon/task-registry.ts`, `tests/daemon/task-registry.test.ts` |
| B | Daemon queue lifecycle | `src/daemon/daemon-server.ts` — integrate registry |
| C | CLI tasks | `src/cli.ts` — `alix daemon tasks` |
| D | CLI cancel | `src/cli.ts` — `alix daemon cancel` + `daemon-types.ts` |
| E | RuntimeIndex Source 6 | `src/runtime/runtime-index.ts` |
| F | API + Inspector | `src/server/server.ts`, `src/ui/` — daemon task panel |
