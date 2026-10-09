# DOX — Runtime Daemon

## Purpose

Persistent background daemon for task execution, lifecycle management, and local command API.

## Ownership

- `daemon-manager.ts` — DaemonManager: PID/status lifecycle at `.alix/daemon.{pid,json}`. start/stop/status/isRunning.
- `daemon-server.ts` — Unix socket listener at `.alix/alixd.sock`. Accepts JSON-line commands (run, ping, cancel, status). Runs tasks via runTask() from the main ALiX runtime, streaming events back to the client. Owns the daemon's SIGTERM shutdown: `server.close()` then `shutdownProcessTraceClient()` (from `daemon-tracing-shutdown.ts`) before `exit(0)`.
- `daemon-tracing-shutdown.ts` — `shutdownProcessTraceClient(): Promise<void>` — fail-open bounded tracing shutdown for the daemon's SIGTERM handler. Never rejects; absorbs every failure (client shutdown reject, `getProcessTraceClient` failure) so the handler can follow with `process.exit(0)` unconditionally. Resolves the same memoized process client the run roots created via the config-free `getProcessTraceClient()` deep seam (`../tracing/client-factory.js`, dynamically imported) — Noop, zero-cost, when tracing was never enabled.
- `coordination-scheduler-service.ts` — `CoordinationSchedulerService`: periodic `tickAll`/lease-renew/heartbeat for coordination runs. `hostKind` scopes it (daemon ticks `daemon`-hosted runs only); `requestTick(runId)` ticks immediately (used by the approval watcher).
- `src/operations/schedule/scheduled-task-service.ts` — the daemon constructs `ScheduledTaskService` (`../schedule/`) on listen and ticks it every 60s (materialize human-approved `alix_schedule_propose` approvals → enqueue due jobs on the task queue; cleared on SIGTERM). Logic lives in `src/operations/schedule/`.
- `approval-watcher.ts` — `ApprovalWatcher`: polls `ApprovalStore`, expires due approvals, and calls `schedulerService.requestTick(runId)` for newly resolved coordination approvals so blocked runs resume.
- `task-registry.ts` — TaskRegistry: file-backed task record store at the global `~/.alix/daemon-tasks.json` (see `daemon-paths.ts`). Atomic writes. create/update/get/list/findQueued with pruneCompleted(cap=100). **R2.15: the per-user ledger (`~/.alix/runtime-ledger.db`) is AUTHORITATIVE.** `load()` rebuilds from `readLatestByEntityType("daemonTask")` (tombstones suppress file copies; file covers legacy zero-fact records; ledger db errors count and throw — fail-closed before startup). Every mutator (`create`/`update`/`reconcileOnStartup`) commits the classified diff (`daemonTask.created`/`updated`/`removed`, baseline from authority-backed records only) SYNCHRONOUSLY via `commitToLedger()` BEFORE returning — append failure counts, throws to the caller, and the in-memory mutation is rolled back (no JSON-only state); the JSON projection is then queued (`enqueueProjection`) and its failure counts as `projectionFailures`. The ledger workspace is captured at CONSTRUCTION (`ledgerCwd = homedir()`), never re-read at save time — a later `HOME` swap must not redirect an in-flight save's mirror. Status: `daemonTaskLedgerStatus()`.
- `daemon-task-ledger-reconcile.ts` — read-only comparison of `daemon-tasks.json` vs the per-user ledger (`missing_in_ledger` / `record_mismatch` (status, sessionId) / `projection_stale` / `projection_missing` / `version_behind` / `ledger_payload_invalid`); counts unknown event types, reports truncated reads. CLI: `alix daemon reconcile` (exit 1 on drift).
- `daemon-paths.ts` — Canonical daemon-task paths: `resolveDaemonTasksPath()` (global writer location), `resolveDaemonTasksReadPath(cwd)` (global with legacy `<cwd>/.alix` read fallback), `readDaemonTasks(cwd)`. All readers (CLI, RuntimeIndex, TUI, Inspector, recovery) must resolve through here, never hardcode the path.
- `daemon-types.ts` — DaemonCommand and DaemonResponse discriminated unions defining the wire protocol.
- CLI commands in `src/cli.ts` — `alix daemon {start|stop|status|tasks|cancel}`, `alix submit "<task>"`.
- Socket protocol commands: run, direct, ping, cancel, status (every declared command has a server handler).

## Local Contracts

- Daemon binds to a Unix socket only (`.alix/alixd.sock`). No remote access.
- Task queue is FIFO sequential (one task at a time). Queued tasks receive `queue.position`.
- **Both daemon execution branches run with governance wired (R1.5).** One
  project `ApprovalStore` is created per run and shared: the non-agent route
  branch passes it via `RuntimeContext.approvalStore` (route tool behaviors),
  and the agent `runTask` branch runs `sessionMode: "ask"` with
  `RunOpts.approvalStore` — state-changing tools mint durable pending
  approvals (operator-resolvable via `alix approvals`) instead of executing
  under silent `bypass`. A broken approvals dir fails open to headless
  fail-closed denies at the gate, never to allow.
- Cancellation is cooperative: `cancel_requested` status is checked between `runTask()` iterations. No SIGKILL.
- Task registry is file-backed and survives daemon restart.
- Inspector reads task state via `GET /api/daemon/tasks` (API, not direct file access).
- All events written by the daemon are compatible with the RuntimeIndex.

## Work Guidance

- The daemon is a standalone script spawned by DaemonManager. It uses dynamic imports for ALiX runtime modules.
- The daemon hosts `daemon`-hosted coordination runs (`alix coordination run --daemon`): on listen it starts a `CoordinationSchedulerService` (hostKind `daemon`) plus an `ApprovalWatcher`, and stops both on SIGTERM. Inspector-hosted runs are left to the Inspector so the two hosts never double-dispatch the same run.
- Adding a new command means: add type to `DaemonCommand`, add handler in `handleCommand()`, add client handler in the CLI `submit` or `daemon` handler.
- Protocol changes must stay backward-compatible for the socket protocol.

## Verification

- `tests/daemon/daemon-manager.test.ts` — PID/status lifecycle.
- `tests/daemon/task-registry.test.ts` — TaskRegistry CRUD and persistence.
- `tests/daemon/daemon-task-ledger-dualwrite.test.ts` — authority load, append-fail blocks projection, projection-failure tolerance + authority read, reconcileOnStartup mirror, legacy baseline, tampered status (HOME-isolated).
- `tests/daemon/daemon-protocol.test.ts` — Protocol type parsing.
- `tests/daemon/daemon-tracing-shutdown.vitest.ts` — `shutdownProcessTraceClient` fail-open surface: shutdown exactly once, shutdown-reject → resolves, `getProcessTraceClient`-fail → resolves. Vitest.
- `tests/daemon/daemon-sigterm.test.ts` — spawned-daemon SIGTERM integration: HOME-isolated spawn, SIGTERM after listening, process exits 0. Node:test (compiled via the `pnpm test:node` path).

## Child DOX Index

None.
