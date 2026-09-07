# DOX — Runtime Daemon

**Purpose:** Persistent background daemon for task execution, lifecycle management, and local command API.

**Ownership:**
- `daemon-manager.ts` — DaemonManager: PID/status lifecycle at `.alix/daemon.{pid,json}`. start/stop/status/isRunning.
- `daemon-server.ts` — Unix socket listener at `.alix/alixd.sock`. Accepts JSON-line commands (run, ping, cancel, status). Runs tasks via runTask() from the main ALiX runtime, streaming events back to the client. Owns the daemon's SIGTERM shutdown: `server.close()` then `shutdownProcessTraceClient()` (from `daemon-tracing-shutdown.ts`) before `exit(0)` (Task 14; extracted for testability in Task 15).
- `daemon-tracing-shutdown.ts` — **Task 15:** `shutdownProcessTraceClient(): Promise<void>` — fail-open bounded tracing shutdown for the daemon's SIGTERM handler. Never rejects; absorbs every failure (client shutdown reject, `getProcessTraceClient` failure) so the handler can follow with `process.exit(0)` unconditionally. Resolves the same memoized process client the run roots created via the config-free `getProcessTraceClient()` deep seam (`../tracing/client-factory.js`, dynamically imported) — Noop, zero-cost, when tracing was never enabled.
- `task-registry.ts` — TaskRegistry: file-backed task record store at `.alix/daemon-tasks.json`. Atomic writes. create/update/get/list/findQueued with pruneCompleted(cap=100).
- `daemon-types.ts` — DaemonCommand and DaemonResponse discriminated unions defining the wire protocol.
- CLI commands in `src/cli.ts` — `alix daemon {start|stop|status|tasks|cancel}`, `alix submit "<task>"`.

**Local Contracts:**
- Daemon binds to a Unix socket only (`.alix/alixd.sock`). No remote access.
- Task queue is FIFO sequential (one task at a time). Queued tasks receive `queue.position`.
- Cancellation is cooperative: `cancel_requested` status is checked between `runTask()` iterations. No SIGKILL.
- Task registry is file-backed and survives daemon restart.
- Inspector reads task state via `GET /api/daemon/tasks` (API, not direct file access).
- All events written by the daemon are compatible with the RuntimeIndex.

**Work Guidance:**
- The daemon is a standalone script spawned by DaemonManager. It uses dynamic imports for ALiX runtime modules.
- Adding a new command means: add type to `DaemonCommand`, add handler in `handleCommand()`, add client handler in the CLI `submit` or `daemon` handler.
- Protocol changes must stay backward-compatible for the socket protocol.

**Verification:**
- `tests/daemon/daemon-manager.test.ts` — PID/status lifecycle (4 tests).
- `tests/daemon/task-registry.test.ts` — TaskRegistry CRUD and persistence (6 tests).
- `tests/daemon/daemon-protocol.test.ts` — Protocol type parsing (5 tests).
- `tests/daemon/daemon-tracing-shutdown.vitest.ts` — `shutdownProcessTraceClient` fail-open surface (Task 15): shutdown exactly once, shutdown-reject → resolves, `getProcessTraceClient`-fail → resolves. Vitest.
- `tests/daemon/daemon-sigterm.test.ts` — spawned-daemon SIGTERM integration (Task 15): HOME-isolated spawn, SIGTERM after listening, process exits 0. Node:test (compiled via the `pnpm test:node` path).
