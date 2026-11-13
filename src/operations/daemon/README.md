# Runtime Daemon

## Overview
The runtime daemon is the per-user persistent background host for ALiX task execution. It owns the local JSON-line socket API, FIFO task queue, task registry, approval polling, daemon-hosted coordination scheduling, and process lifecycle metadata. It runs tasks in-process through the shared route and `runTask` paths, streams events to connected clients, and keeps global state under `~/.alix`.

## Interface
- `DaemonCommand` and `DaemonResponse` define the local wire protocol for `run`, `direct`, `ping`, `status`, and `cancel`, plus streamed session/task/direct events [daemon-types.ts:DaemonCommand] [daemon-types.ts:DaemonResponse].
- `DaemonManager` manages start, stop, status, liveness, PID/status files, and socket-owner verification [daemon-manager.ts:DaemonManager].
- `handleCommand()` dispatches every declared socket command and writes structured error frames for unknown or invalid commands [daemon-server.ts:handleCommand].
- `TaskRegistry` is the file-backed, ledger-authoritative task record store with `create`, `update`, `get`, `list`, `findQueued`, and startup reconciliation [task-registry.ts:TaskRegistry].
- `resolveDaemonSocketAddress()` selects `<dir>/alixd.sock` on POSIX or a hashed named pipe on Windows [daemon-paths.ts:resolveDaemonSocketAddress].
- `recordWorkspaceActivity()` upserts project activity in the global workspace registry [workspace-registry.ts:recordWorkspaceActivity].
- `ApprovalWatcher` polls approvals, expires due records, resumes eligible continuations, and ticks affected coordination runs [approval-watcher.ts:ApprovalWatcher].
- `CoordinationSchedulerService` owns daemon-hosted scheduler timers for polling, lease renewal, and worker heartbeats [coordination-scheduler-service.ts:CoordinationSchedulerService].
- `DaemonToolContinuationResumer` validates host-attributed continuations and resumes approved tool operations through the normal claim path [tool-continuation-resumer.ts:DaemonToolContinuationResumer].
- `DaemonRuntimeExecutor` adapts non-agent route execution onto socket response frames [daemon-runtime-executor.ts:DaemonRuntimeExecutor].
- `reconcileDaemonTaskLedger()` compares the JSON projection with ledger facts and reports drift [daemon-task-ledger-reconcile.ts:reconcileDaemonTaskLedger].
- `shutdownProcessTraceClient()` performs fail-open tracing shutdown for SIGTERM [daemon-tracing-shutdown.ts:shutdownProcessTraceClient].

## Invariants
- Daemon state is per-user and global: task records, workspace activity, PID/status metadata, and the socket live under `~/.alix`, with a legacy read fallback for task files [daemon-paths.ts:resolveDaemonTasksReadPath] [daemon-manager.ts:DaemonManager.globalDir].
- Server admission is exclusive. The lifecycle lock is held until process death, and socket admission uses a kernel or fail-closed portable lock; ambiguous ownership refuses startup [daemon-server.ts:lifecycle].
- Daemon binding is local-only through a Unix socket or Windows named pipe; no remote listener is created [daemon-paths.ts:resolveDaemonSocketAddress] [daemon-server.ts:server].
- Execution is FIFO and sequential: `processQueue()` refuses to start while `taskRunning` and drains one queued item at a time [daemon-server.ts:processQueue] [daemon-server.ts:taskQueue].
- `direct` requests are classified before any registry, session, or event-log setup, so an ephemeral request creates none of that state [daemon-server.ts:handleCommand].
- An accepted cancellation is terminal: both execution branches check the task signal or `cancel_requested` before recording `completed` [daemon-server.ts:handleRun].
- The per-user ledger is authoritative for daemon tasks; a failed ledger append rolls back the in-memory mutation instead of leaving JSON-only state [task-registry.ts:TaskRegistry.commitToLedger] [task-registry.ts:TaskRegistry.create].
- Startup reconciliation marks interrupted `running` tasks `failed_orphaned` and pending cancellations `cancelled`, while queued tasks remain retryable [task-registry.ts:TaskRegistry.reconcileOnStartup].
- Owner status is published only after exclusive admission and successful listen; heartbeat updates use temporary-file rename publication [daemon-server.ts:server.listen] [daemon-server.ts:startHeartbeat].
- A daemon-hosted scheduler service ticks only runs whose `hostKind` is `daemon`, preventing double dispatch with the Inspector [coordination-scheduler-service.ts:CoordinationSchedulerService.tickAll].
- Continuation resumption requires a matching daemon run, worker, attempt, assigned agent, approval binding, ownership claims, and owned write scope; missing evidence stays blocked [tool-continuation-resumer.ts:DaemonToolContinuationResumer.worker].
- A successfully resumed approved tool returns the worker to `pending`, not `completed`, so normal scheduling must finish the objective [tool-continuation-resumer.ts:DaemonToolContinuationResumer.resume].
- Committed successful outcomes are recovered only through `ApprovalStore.loadCommitted`, without re-executing the tool [tool-continuation-resumer.ts:DaemonToolContinuationResumer.recoverSucceeded].
- The task JSON projection is secondary to ledger facts; projection failures are counted and the authority read remains usable [task-registry.ts:TaskRegistry.projectJson] [task-registry.ts:daemonTaskLedgerStatus].

## Side Effects
- `DaemonManager.start()` spawns a detached `daemon-server` child and waits for owner status plus socket readiness [daemon-manager.ts:DaemonManager.start].
- The server writes `~/.alix/daemon.pid` and `~/.alix/daemon.json`, creates the global directory, and listens on the configured socket [daemon-server.ts:server.listen].
- `DaemonManager.stop()` sends SIGTERM only after socket-owner verification, waits for exit, then updates or removes only the matching owner metadata [daemon-manager.ts:DaemonManager.stop].
- Task mutations commit ledger facts synchronously and enqueue atomic JSON projection writes to `~/.alix/daemon-tasks.json` [task-registry.ts:TaskRegistry.commitToLedger] [task-registry.ts:TaskRegistry.projectJson].
- Workspace activity is persisted to `~/.alix/workspaces.json` with serialized `.tmp` plus rename writes [workspace-registry.ts:save] [workspace-registry.ts:recordWorkspaceActivity].
- Runs create project session event logs and forward non-internal events to the connected client socket [daemon-server.ts:createDaemonEventLog].
- Coordination scheduling starts timers for ticks, lease renewal, worker heartbeats, and terminal-run reconciliation [coordination-scheduler-service.ts:CoordinationSchedulerService.start].
- Approval scans expire due approvals, invoke eligible continuation resumption on every scan, and request immediate scheduler ticks [approval-watcher.ts:ApprovalWatcher.scan].
- Tool continuation holds and renews ownership leases, monitors durable worker state, aborts on context change, and updates worker status after the outcome [tool-continuation-resumer.ts:DaemonToolContinuationResumer.resume].
- Scheduled tasks are materialized from approved schedule proposals and enqueued on the daemon task queue every 60 seconds [daemon-server.ts:startScheduleService].
- SIGTERM stops the approval watcher and scheduled-task timer, shuts down coordination and tool resumption, closes the server, then shuts down tracing [daemon-server.ts:process.on] [daemon-tracing-shutdown.ts:shutdownProcessTraceClient].
- Lifecycle, continuation, and reconciliation failures are logged to stderr rather than silently discarded [daemon-server.ts:lifecycle] [approval-watcher.ts:ApprovalWatcher.scan].

## Verification
- Run: `pnpm test`
