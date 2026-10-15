# DOX — Event Log (session event store)

## Purpose

The append-only session event log and its canonical event-type vocabulary. `event-log.ts` is the single writer authority every session event flows through; `types.ts` is the event-type/payload contract the whole runtime shares.

## Ownership

- `event-log.ts` — `EventLog`: the per-session `events.jsonl` store. Append with self-correcting sequence allocation, opaque cursors (`beginningCursor`/`getCursor`/`readSince`), `readAll`, and watchers. Owns the cross-process append lock and the bounded tail resync.
- `types.ts` — canonical `AlixEvent` shape, `TOOL_EVENT_TYPES`, and the event-type union consumed by every projection.

## Local Contracts

- **One append authority, cross-process safe.** `append` serializes same-process writers through an in-memory queue and cross-process writers through a lock file (`.lock`, `wx` create, 1s heartbeat, owner `{pid,token,heartbeat}`). `shouldBreakLock` breaks a held lock only when the owner is demonstrably gone: a fresh heartbeat is never stolen; a stale heartbeat is broken only if the owner PID is dead (`signal 0`); legacy locks (no owner metadata) fall back to mtime staleness. A locally-owning PID is never stolen from. A live-but-slow holder therefore blocks contenders until the 5s acquisition deadline, then the append throws.
- **Sequence allocation is disk-resynced, never instance-local — with a size-gated fast path.** `append` re-derives `nextSeq` from the durable file under the lock before writing (`resyncFromDisk`), so multiple `EventLog` instances on one `sessionDir` (a TUI emitter and a task loop, or N subagent processes) never share a seq. `init` seeds `nextSeq` once; that value is a starting hint, not the allocation truth. Under the lock, an unchanged file size (`lastKnownSize`) skips the tail read — no peer wrote, so `nextSeq` is already correct; any size change (including truncation) falls through to the tail read. Multi-writer correctness is unchanged. Pinned by `tests/events/event-log.test.ts` ("size-gated resync still observes a peer append").
- **The resync window grows geometrically; it never degrades to a whole-file read while a complete line is reachable.** `readMaxSeqFromTail` starts at `RESYNC_TAIL_BYTES` (64KB) and doubles until a parseable complete line fits or the whole file is covered. This matters because ONE event can exceed 64KB (context bundles reached 126KB/141KB in session `1791853059081`): a fixed window then straddled a single huge line, found no complete line, and fell back to `resyncFromFullRead` — re-reading the ENTIRE growing file under the append lock on every append, holding it for seconds and timing out peer writers (`Timed out acquiring EventLog append lock`). Geometric growth bounds the lock hold at O(last-line size), independent of log length. Pinned by `tests/events/event-log.test.ts` ("append latency is flat as the log grows", "append stays cheap when the most recent event exceeds the tail window").
- **Append telemetry must not sit on this lock.** Observability events written per-cycle (e.g. a scheduler tick heartbeat) contend for the same lock authoritative completion events need. Emit durable records on meaningful transitions, not per poll cadence — the scheduler's `coordination.tick.completed` gating follows this rule (see `src/coordination/kernel/AGENTS.md`).
- Never read or write `events.jsonl` outside this module; cursors are opaque (`WeakMap`-backed) and belong to exactly one instance.

## Work Guidance

- A change to sequence allocation, the lock protocol, or the resync window is a cross-cutting correctness change — run `tests/events/event-log.test.ts` (seq uniqueness across instances AND processes, lock reclaim, flat/oversized-tail latency) before anything else.
- New event types belong in `types.ts`; projections consume them, this module does not interpret payloads.

## Verification

- `tests/events/event-log.test.ts` — seq uniqueness (multi-instance + multi-process), lock reclaim/stale/live, incremental `readSince`, flat append latency, oversized-tail regression, watchers.
- `tests/events/event-log-cursor.vitest.ts` — cursor opacity and foreign-cursor rejection.

## Child DOX Index

None.
