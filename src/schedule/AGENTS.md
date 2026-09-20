# src/schedule — Agent-Proposed Scheduled Jobs

Purpose: let the agent *propose* recurring jobs without ever scheduling one.
A proposal becomes a pending approval; a human approves it; the daemon
materializes an active job and enqueues it on schedule. The agent has no
write path to any OS persistence mechanism (cron, at, systemd) — scheduling
lives entirely inside ALiX state, so `systemctl stop alix` / deleting `.alix`
removes it.

## Ownership

| File | Responsibility |
|------|----------------|
| `schedule-spec.ts` | Pure vocabulary: validate/describe `ScheduleSpec` (daily/weekly/every), `nextRunAfter`, expiry window, caps (`MIN_INTERVAL_MIN`, `MAX_EXPIRY_DAYS`, `MAX_ACTIVE_JOBS`) |
| `scheduled-task-store.ts` | Active-jobs registry at `~/.alix/scheduled-tasks.json` (global, atomic writes). Only ever holds approved jobs |
| `propose.ts` | `schedule.propose` core: validate a proposal, record a pending `ApprovalStore` entry with `capabilities: ["schedule.propose"]` and `metadata.scheduleProposal` |
| `scheduled-task-service.ts` | Daemon-side logic: `materializeApproved()` (approval → one active job, keyed by approvalId) and `tick()` (enqueue due jobs, advance next run, expire) |

## Local Contracts

- **One approval surface.** Schedule proposals land in the (global)
  `ApprovalStore`; the human reviews them in `alix approvals` like any other
  approval. `ScheduledTaskStore` holds only approved/active jobs.
- **Agent never schedules.** `proposeSchedule` writes a *pending* approval and
  returns "not scheduled". Only a human `approve` + the daemon's
  `materializeApproved()` create an active job.
- **Idempotent materialization.** A job is keyed by `approvalId`; re-approval,
  restart, or a repeated tick never doubles a job.
- **Bounded.** `every` ≥ 5 min, expiry required and ≤ 30 days, ≤ 20 active jobs.
  Expired jobs are retired by `tick()`.
- **Fresh execution.** A scheduled run is enqueued as a normal daemon task
  (`TaskRegistry.create`), i.e. a new session with only the human-approved task
  text — it inherits no context from the session that proposed it.

## Work Guidance

- Keep `schedule-spec.ts` pure (no I/O, injectable `now`) so schedule math stays
  unit-testable and timezone-deterministic.
- Never let a scheduled run itself propose a schedule: `schedule.propose` is
  denied when the caller is a scheduled/headless/subagent run.

## Verification

```bash
pnpm build
pnpm vitest run tests/schedule --config vitest.config.mts
```

## Child DOX Index

None.
