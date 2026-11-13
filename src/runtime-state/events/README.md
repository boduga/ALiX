# Session Event Log

## Overview
The append-only session event store (`events.jsonl`) and the canonical event-type vocabulary the whole runtime shares. `EventLog` is the single writer authority every session event flows through: it allocates self-correcting sequence numbers, hands out opaque log-local cursors, supports incremental replay, and notifies watchers. `types.ts` defines the `AlixEvent` envelope and the per-domain `*_EVENT_TYPES` constants that projections and emitters consume. This module does not interpret payloads; projections do.

## Interface
- `EventLog` with `init`, `append`, `appendIfAbsent`, `readAll`, `readSince`, `beginningCursor`, `getCursor`, `cursorsEqual`, `serializeCursor`, `deserializeCursor`, `watch`, `startWatching`, `close` [event-log.ts:EventLog]
- `EventLogCursor` as an opaque, log-local position marker [event-log.ts:EventLogCursor]
- `EventLogCursorError` as the discriminating failure type for unusable serialized cursors [event-log.ts:EventLogCursorError]
- `AlixEvent`, `NewEvent`, `SessionProjection`, and `EventMeta` envelope types [types.ts:AlixEvent] [types.ts:NewEvent] [types.ts:EventMeta]
- `EventActor` union covering user, agent, system, tool, policy, verifier, subagent, authorization, coordination, and operator [types.ts:EventActor]
- Tool payload contracts `ToolRequestPayload`, `ToolStartedPayload`, `ToolOutputPayload`, `ToolCompletedPayload`, `ToolFailedPayload` [types.ts:ToolRequestPayload]
- `assertToolEventCorrelation` enforces the executionId → invocationId → toolCallId hierarchy [types.ts:assertToolEventCorrelation]
- `payloadString` reads a non-empty string field from an untyped payload [types.ts:payloadString]
- Event-type vocabularies: `TOOL_EVENT_TYPES`, `PATCH_EVENT_TYPES`, `FILE_EVENT_TYPES`, `AGENT_EVENT_TYPES`, `MCP_EVENT_TYPES`, `OWNERSHIP_EVENT_TYPES`, `COORDINATION_EVENT_TYPES`, `COLLABORATION_EVENT_TYPES`, `CONFLICT_EVENT_TYPES`, `SUBAGENT_EVENT_TYPES`, `AGENT_LIFECYCLE_EVENT_TYPES` [types.ts:TOOL_EVENT_TYPES] [types.ts:COORDINATION_EVENT_TYPES] [types.ts:AGENT_LIFECYCLE_EVENT_TYPES]
- Event-type vocabularies: `CONTEXT_EVENT_TYPES`, `POLICY_EVENT_TYPES`, `ARTIFACT_EVENT_TYPES`, `APPROVAL_EVENT_TYPES`, `REPLAY_EVENT_TYPES`, `ROLLBACK_EVENT_TYPES` [types.ts:APPROVAL_EVENT_TYPES] [types.ts:REPLAY_EVENT_TYPES] [types.ts:ROLLBACK_EVENT_TYPES]
- Payload shapes such as `AgentLifecyclePayload`, `ApprovalLifecyclePayload`, `ArtifactCreatedPayload`, and the replay/rollback payloads [types.ts:AgentLifecyclePayload] [types.ts:ApprovalLifecyclePayload] [types.ts:ArtifactCreatedPayload]

## Invariants
- `append` serializes same-process writers through a per-path in-memory queue and cross-process writers through a `.lock` file opened exclusively [event-log.ts:appendLocked]
- Sequence allocation is disk-resynced under the lock, never instance-local; `init` only seeds a starting hint [event-log.ts:init] [event-log.ts:resyncFromDisk]
- The resync size gate primes only under the lock or arithmetically after this instance's own write; `init` deliberately never primes it [event-log.ts:init]
- Crash recovery relies on `events.jsonl` being append-only; an out-of-band same-length truncate-and-rewrite would fool the size gate [event-log.ts:lastKnownSize]
- Lock breaking requires a demonstrably gone owner: fresh heartbeats are never stolen, a stale heartbeat is broken only when the owner PID is dead, and a locally-owning PID is never stolen [event-log.ts:shouldBreakLock]
- Legacy locks without owner metadata fall back to mtime staleness [event-log.ts:shouldBreakLock]
- Tail resync doubles its window geometrically from 64KB and never degrades to a whole-file read while a complete line is reachable, bounding lock hold at O(last-line size) [event-log.ts:readMaxSeqFromTail]
- Lock retry, heartbeat, and deadline use the real clock captured at module load so fake timers cannot hang a contender [event-log.ts:RealDate]
- Cursors are opaque: internals live in a `WeakMap`, so `Object.keys` and JSON expose nothing [event-log.ts:eventLogCursorBrand] [event-log.ts:cursorInternals]
- A cursor belongs to exactly one `EventLog` instance; foreign cursors throw from `readSince` and make `cursorsEqual` return false rather than throw [event-log.ts:unwrap] [event-log.ts:tryUnwrap]
- `readSince` returns events with `seq > cursor.seq` ascending; the returned cursor is the highest seq included, so retrying from the input cursor is at-least-once [event-log.ts:readSince]
- A cursor or checkpoint beyond the current head throws `EventLogCursorError` so callers can fall back to `beginningCursor()` instead of silently skipping events [event-log.ts:deserializeCursor] [event-log.ts:readSince]
- `deserializeCursor` has exactly four failure modes, all `EventLogCursorError`: malformed JSON, unsupported version, invalid seq, and seq beyond head [event-log.ts:deserializeCursor]
- Serialized cursors are position claims, not transferable cursors: no owner token is persisted and the restored cursor carries this instance's owner [event-log.ts:serializeCursor]
- `appendIfAbsent` evaluates its predicate against durable history while holding the append lock; a match returns the original event without writing, consuming a seq, or notifying watchers [event-log.ts:appendIfAbsent]
- Malformed lines are skipped by `readAll` and by full-read resync rather than failing the read [event-log.ts:readAll] [event-log.ts:resyncFromFullRead]
- `startWatching` seals a byte offset before watching, resets on truncation, and delivers anything appended between construction and watch registration [event-log.ts:startWatching]
- New event types belong in `types.ts`; this module must not interpret payloads [types.ts:TOOL_EVENT_TYPES]

## Side Effects
- Creates the session directory and appends one JSON line per event to `events.jsonl` [event-log.ts:appendLocked]
- Creates, heartbeats (1s), and unlinks `events.jsonl.lock`; only unlinks when the token is still ours [event-log.ts:appendLocked]
- Writes durable sequence numbers and timestamps into every appended event [event-log.ts:appendLocked]
- Registers an `fs.watch` handle plus a polling fallback timer during `startWatching`, both released by the returned stop function [event-log.ts:startWatching]
- Invokes in-process watcher listeners after each successful append, swallowing listener errors [event-log.ts:appendLocked]

## Verification
- Run: `pnpm test`
