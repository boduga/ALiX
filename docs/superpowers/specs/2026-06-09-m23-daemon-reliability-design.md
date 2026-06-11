# M0.23: Daemon Reliability + Recovery

## Recovery Contract

On daemon startup, before accepting commands:

| Before | After | Reason |
|--------|-------|--------|
| running | failed_orphaned | Daemon restarted while task was running |
| queued | queued | No work lost — safe to retry |
| cancel_requested | cancelled | Daemon restarted while cancellation was pending |
| completed | unchanged | Terminal |
| failed | unchanged | Terminal |
| cancelled | unchanged | Terminal |

## Three Slices

| # | Title | Description |
|---|-------|-------------|
| A | Startup recovery | TaskRegistry.reconcile() + daemon-server.ts init |
| B | Heartbeat | Periodic liveness timestamp in daemon.json |
| C | Inspector stale daemon | Warning when heartbeat is stale |

## Key Addition

New task status: `failed_orphaned` — a task that was running when the daemon crashed/restarted.

## Files

| File | Action |
|------|--------|
| `src/daemon/task-registry.ts` | Add `failed_orphaned` to status union, add `reconcileOnStartup()` method |
| `src/daemon/daemon-server.ts` | Call reconcileOnStartup() before `server.listen()` |
| `src/daemon/daemon-manager.ts` | Add heartbeat write interval |
| `tests/daemon/task-registry.test.ts` | Add reconciliation tests |
