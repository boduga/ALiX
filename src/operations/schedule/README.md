# Agent-Proposed Scheduled Jobs

## Overview

Lets the agent *propose* a recurring job without ever scheduling one. A proposal
is validated and recorded as a pending approval in the global `ApprovalStore`; a
human approves it; the daemon materializes exactly one active job and enqueues it
when due. The agent has no write path to any OS persistence mechanism (cron, at,
systemd) — schedules live in ALiX state at `~/.alix/scheduled-tasks.json`.
Stopping the daemon stops dispatch; persisted jobs remain until revoked or
expired.

## Interface

- `ScheduleSpec` — structured union: `{kind:"daily", time}` | `{kind:"weekly", days, time}` | `{kind:"every", minutes}` [schedule-spec.ts:ScheduleSpec]
- `DAYS`, `MIN_INTERVAL_MIN` (5), `MAX_EXPIRY_DAYS` (30), `MAX_ACTIVE_JOBS` (20) [schedule-spec.ts:MIN_INTERVAL_MIN]
- `parseTime(time)`, `validateScheduleSpec(input)`, `describeSchedule(spec)` — pure validation/description [schedule-spec.ts:validateScheduleSpec]
- `nextRunAfter(spec, after)`, `advanceNextRun(spec, previous, now)`, `withinExpiryWindow(dateStr, now)` — schedule math [schedule-spec.ts:nextRunAfter]
- `SCHEDULE_CAPABILITY = "schedule.propose"`, `SCHEDULE_POLICY_REVISION = "schedule-v1"` [propose.ts:SCHEDULE_CAPABILITY]
- `validateProposal(input, now): ProposalValidation`, `proposalFingerprint(p)`, `proposeSchedule(input, deps)` [propose.ts:proposeSchedule]
- `ScheduledTaskStore` — `load`, `list`, `get`, `findByName`, `findByApprovalId`, `activeCount`, `upsert`, `create`, `update`, `remove`, `due`, `flush` [scheduled-task-store.ts:ScheduledTaskStore]
- `resolveScheduledTasksPath()` — `ALIX_SCHEDULED_TASKS_PATH` override or `~/.alix/scheduled-tasks.json` [scheduled-task-store.ts:resolveScheduledTasksPath]
- `ScheduledTaskService` — `materializeApproved()`, `tick()`, `runOnce()`, injected via `ScheduleServiceDeps` [scheduled-task-service.ts:ScheduledTaskService]
- `MaterializeSummary { created, skipped }` and `TickSummary { enqueued, expired }` [scheduled-task-service.ts:MaterializeSummary]
- `ScheduledTaskRecord` / `ScheduledTaskStatus = "active" | "expired"` [scheduled-task-store.ts:ScheduledTaskRecord]

## Invariants

- `every` interval must be an integer in `[5, 1440]` minutes; `daily`/`weekly` time must match `HH:MM` 24h [schedule-spec.ts:validateScheduleSpec]
- `weekly` requires 1..7 unique valid day names; duplicates and unknown days are rejected [schedule-spec.ts:validateScheduleSpec]
- A proposal's `expires` must be a `YYYY-MM-DD` strictly in the future and no more than `MAX_EXPIRY_DAYS` out [schedule-spec.ts:withinExpiryWindow]
- Proposal `name` must match `/^[a-z0-9][a-z0-9-]{1,40}$/`; `task` must be non-empty and ≤ 2000 chars; `cwd` must be absolute [propose.ts:validateProposal]
- `proposeSchedule` only ever writes a **pending** approval (`requestBound` with `capabilities: ["schedule.propose"]`, `riskLevel: "high"`) and returns "not scheduled" [propose.ts:proposeSchedule]
- Approval expiry tracks the job horizon (`expiresAt = "${expires}T23:59:59"`), not ApprovalStore's 30-minute default [propose.ts:proposeSchedule]
- Materialization is idempotent: a job is keyed by `approvalId`; an approval whose job already exists, whose expiry is not `"valid"`, or whose proposal fails validation is reported in `skipped` [scheduled-task-service.ts:materializeApproved]
- At most `MAX_ACTIVE_JOBS` jobs are active; materialization refuses beyond that [scheduled-task-service.ts:materializeApproved]
- `tick()` retires expired jobs *before* calling `due()` so an out-of-horizon job is never enqueued [scheduled-task-service.ts:tick]
- `advanceNextRun` preserves `every` phase and skips missed windows rather than bursting (no catch-up storm) [schedule-spec.ts:advanceNextRun]
- All times are local; `now` is injectable for deterministic tests [schedule-spec.ts:nextRunAfter]
- Store writes are serialized through an internal promise chain (`enqueueSave`) so concurrent mutations cannot interleave [scheduled-task-store.ts:ScheduledTaskStore]
- `load()` treats any read/parse failure as an empty registry [scheduled-task-store.ts:ScheduledTaskStore]

## Side Effects

- `proposeSchedule` writes a pending approval record into the `ApprovalStore` [propose.ts:proposeSchedule]
- `ScheduledTaskStore` persists the full job list atomically to `scheduled-tasks.json` on every mutation via `writeJsonFileAtomic` [scheduled-task-store.ts:ScheduledTaskStore]
- `ScheduledTaskService.tick` calls the injected `enqueue(task, cwd)` (daemon `TaskRegistry.create`) and updates `lastRunAt`, `runCount`, `nextRunAt` [scheduled-task-service.ts:tick]
- `runOnce` re-reads both the approval and task stores each cycle (daemon is long-lived) [scheduled-task-service.ts:runOnce]
- A scheduled run inherits no context from the proposing session; it enqueues only the approved task text as a fresh daemon task [scheduled-task-service.ts:tick]

## Verification

- Run: `pnpm test`
