# M0.38 — Rollback Execution Design

> **One-liner:** M0.38 executes rollback only from captured replay diff artifacts, under PolicyGate approval, with full `rollbackId` → `replayId` trace linkage.

> **Boundary:** Rollback only applies to files captured by `ReplayDiffStore`. `Rollback` does not infer changes outside `.alix/replays/<replayId>/`. `Rollback` does not revert arbitrary git state.

---

## 1. Safety Contract

1. **Rollback requires an existing `replayId`** with a valid `index.json` in `.alix/replays/<replayId>/`
2. **Rollback only touches files listed in the diff index** — no inferred paths, no glob matches
3. **Modified/deleted files restore from before snapshots** — `copyFileSync` from snapshot back to workspace
4. **Created files may be deleted** only when explicitly marked `"created"` in the diff record
5. **Rollback requires PolicyGate approval** per file mutation — side-effecting rollback steps create ApprovalStore entries
6. **Every rollback step emits `rollback.*` events** with `rollbackId` and `replayId`
7. **Rollback produces its own `rollbackId`** linked to the source `replayId`
8. **Shell side effects are not rollbackable** — `shell.run` never produces rollback files unless it also created diff records

---

## 2. Goals

1. **RollbackPlan** — Build from `ReplayDiffSet`, classify each step as restore/delete-created/skip
2. **RollbackExecutor** — Execute rollback in dry-run or approved-live mode
3. **Rollback modes** — `"dry-run"` (show what would happen) and `"approved-live"` (actually restore/delete)
4. **PolicyGate re-check** — Every mutation step requires PolicyGate approval
5. **`rollbackId`** — Unique ID per rollback session, linked to source `replayId`
6. **`rollback.*` events** — 8 event types with full trace linkage
7. **TUI commands** — `/rollback <replayId> --dry-run`, `/rollback <replayId> --approved-live`
8. **TUI rendering** — Rollback result with per-step outcomes
9. **Tests** — Restore from snapshot, delete created file, dry-run mutates nothing, approval required

---

## 3. Non-goals

- **Rollback of shell side effects** — shell.run not rollbackable unless it produced captured file diffs
- **Rollback of network tools** — not applicable
- **Batch rollback across replays** — one replayId at a time
- **Undo individual steps** — rollback is all-or-nothing for a replay session
- **Visual diff rollback** — text output only

---

## 4. RollbackPlan model

```typescript
export type RollbackMode = "dry-run" | "approved-live";

export type RollbackStepAction = "restore" | "delete-created" | "skip";

export type RollbackStep = {
  path: string;
  action: RollbackStepAction;
  rollbackable: boolean;
  reason?: string;
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
};

export type RollbackPlan = {
  rollbackId: string;
  replayId: string;
  mode: RollbackMode;
  cwd: string;
  steps: RollbackStep[];
  createdAt: string;
};
```

### Builder

```typescript
export function buildRollbackPlan(
  replayId: string,
  diffSet: ReplayDiffSet,
  diffStore: ReplayDiffStore,
  mode: RollbackMode,
): RollbackPlan
```

The builder:
1. Generates `rollbackId` from `rollback_${Date.now()}_${random}`
2. Maps each `ReplayDiffRecord` to a `RollbackStep`:
   - `changeType === "modified"` → `action: "restore"` (if rollbackable), `reason`: has before snapshot
   - `changeType === "deleted"` → `action: "restore"` (if rollbackable), `reason`: file was deleted
   - `changeType === "created"` → `action: "delete-created"` (always allowed — we created it)
   - Not rollbackable but `.rollbackable === true` (contradiction) → `action: "skip"`, `reason`: missing before snapshot
   - Records with `.rollbackable === false` → `action: "skip"`, `reason`: no before state to restore
3. Returns the plan sorted by path

---

## 5. RollbackExecutor

```typescript
export class RollbackExecutor {
  constructor(
    private cwd: string,
    private eventLog: EventLog,
  ) {}

  async execute(
    plan: RollbackPlan,
    opts?: { approvalStore?: ApprovalStore },
  ): Promise<RollbackResult>
}
```

### Execution flow

```
buildRollbackPlan(replayId, diffSet, diffStore, mode)
  │
  ▼
emit rollback.plan.created { rollbackId, replayId, ... }
emit rollback.started { rollbackId, replayId }
  │
  ▼
For each step:
  │
  ├── action === "skip" → emit rollback.step.skipped { rollbackId, path, reason }
  │
  ├── mode === "dry-run"
  │     ├── "restore" → emit rollback.step.completed with output "Would restore: <path>"
  │     └── "delete-created" → emit rollback.step.completed with output "Would delete: <path>"
  │
  └── mode === "approved-live"
        ├── 1. PolicyGate check (approval store required)
        ├── 2. If no approval → create pending approval → block
        ├── 3. If approved → execute:
        │     ├── "restore" → copyFileSync(snapshot, path) → emit completed
        │     └── "delete-created" → rm(path) → emit completed
        └── 4. On failure → emit rollback.step.blocked
  │
  ▼
emit rollback.completed { rollbackId, replayId, summary }
return RollbackResult
```

### RollbackResult

```typescript
export type RollbackResult = {
  rollbackId: string;
  replayId: string;
  mode: RollbackMode;
  steps: RollbackStepResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  totalSteps: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  warnings: string[];
};

export type RollbackStepResult = {
  index: number;
  path: string;
  action: RollbackStepAction;
  status: "completed" | "blocked" | "skipped";
  output?: string;
  error?: string;
  blockReason?: string;
  durationMs?: number;
};
```

---

## 6. Approval model for rollback

Each side-effecting rollback step (restore or delete-created) in approved-live mode requires approval:

```
Rollback step: restore src/index.ts
  → ApprovalStore.request({ reason: `Rollback ${rollbackId}: restore src/index.ts`, capability: "file.write", toolId: "file.restore" })
  → User /approve <id>
  → copyFileSync(beforeSnapshot, resolvedPath)
```

This uses the existing ApprovalStore with `toolId: "file.restore"` or `"file.delete"` — distinct from replay's `file.create`/`file.delete` so users can distinguish them.

---

## 7. Event model

```typescript
export const ROLLBACK_EVENT_TYPES = {
  PLAN_CREATED: "rollback.plan.created",
  STARTED: "rollback.started",
  STEP_STARTED: "rollback.step.started",
  STEP_COMPLETED: "rollback.step.completed",
  STEP_SKIPPED: "rollback.step.skipped",
  STEP_BLOCKED: "rollback.step.blocked",
  COMPLETED: "rollback.completed",
  FAILED: "rollback.failed",
} as const;
```

Each event payload carries:

```typescript
type RollbackEventPayload = {
  rollbackId: string;
  replayId: string;
  path?: string;
  action?: "restore" | "delete-created" | "skip";
  approvalId?: string;
  reason?: string;
  status?: string;
  outputPreview?: string;
};
```

### TraceEvent integration

Add `"rollback"` to `TraceSourceType` and add rollback mapping in `toTraceEvent()`:

```typescript
if (type.startsWith("rollback.")) {
  const p = payload as any;
  return {
    id, timestamp: ts, rawEvent,
    sourceType: "rollback" as any,
    eventType: type,
    label: `rollback ${type.replace("rollback.", "")}`,
    status: type.includes("blocked") || type.includes("failed") ? "failed" : "success",
    detail: p.reason || "",
    sessionId: p.sessionId,
    replayId: p.replayId,
  };
}
```

---

## 8. TUI UX

### Commands

```
/rollback <replayId> --dry-run        Show what would be restored/deleted
/rollback <replayId> --approved-live   Actually restore/delete with approval
/rollback selected --dry-run           Rollback the selected replayId
/rollback selected --approved-live
```

### Confirmation for approved-live

```
Rollback replay replay_abc with real file changes?
Type: rollback yes --replay replay_abc
```

### Result display

```
── Rollback Result ────────────────────
  RollbackId: rollback_1718000000_xyz
  ReplayId:   replay_1718000000_abc
  Mode: approved-live
  Steps: 3 total, 2 restored, 0 blocked, 1 skipped

  Chain:
  ✔ 1. restore   src/index.ts          5ms
       File restored from snapshot
  ✔ 2. restore   src/utils/helper.ts   3ms
       File restored from snapshot
  ○ 3. skip      src/new-file.ts
       Created files are not restored from snapshot

  Keys: s=summary  esc=close
```

---

## 9. Files

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/rollback-plan.ts` | **NEW** | RollbackPlan, RollbackStep types, buildRollbackPlan() |
| `src/runtime/rollback-executor.ts` | **NEW** | RollbackExecutor with dry-run and approved-live modes |
| `src/events/types.ts` | MODIFY | Add ROLLBACK_EVENT_TYPES and payload types |
| `src/runtime/trace-events.ts` | MODIFY | Add "rollback" to TraceSourceType, add rollback mapping in toTraceEvent() |
| `src/tui/trace-detail.ts` | MODIFY | Add renderRollbackResult() |
| `src/cli/commands/tui.ts` | MODIFY | Add /rollback command handler |
| `tests/runtime/rollback-plan.test.ts` | **NEW** | Plan building tests |
| `tests/runtime/rollback-executor.test.ts` | **NEW** | Execution tests |
| `tests/tui/rollback-rendering.test.ts` | **NEW** | Rendering tests |

---

## 10. Acceptance criteria

1. `buildRollbackPlan()` loads replay diff index and produces steps for each record
2. Modified/deleted records produce `"restore"` steps (if rollbackable)
3. Created records produce `"delete-created"` steps
4. Non-rollbackable records produce `"skip"` steps with reason
5. Dry-run rollback returns output without mutating any files
6. Approved-live rollback restores modified files from before snapshots
7. Approved-live rollback deletes created files
8. Approved-live rollback requires PolicyGate approval (creates ApprovalStore entries)
9. All `rollback.*` events carry `rollbackId` and `replayId`
10. Rollback result is rendered in trace drilldown
