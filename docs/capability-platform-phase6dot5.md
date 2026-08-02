# ALiX Capability Platform — Phase 6.5 (Durable Projection State)

The checkpoint envelope now carries durable projection state alongside the
cursor. A restart restores a projection's in-memory state (timeline + trace)
directly from the checkpoint instead of re-deriving it by replaying the log.

The cursor was always durable — it records *how far* a projection has read.
Phase 6.5 makes the projection's *derived state* durable too: the
`TimelineBuilder`'s append-only entries and the `IncrementalExecutionTraceBuilder`'s
lifecycles are serialized into the same checkpoint envelope, in the **same save
transaction as the cursor**. On the next start, a valid checkpoint restores the
builders directly — already-consumed events are not re-read from the log.

**`DurableProjectionBuilder<T>`** — a builder that wants durable state
implements `exportState(): ProjectionState` / `importState(state): void` on top
of the `ProjectionBuilder<T>` contract (`update` / `snapshot` / `reset`). State
must be a JSON-serializable plain object (no Maps/Sets/Dates) so it can ride the
envelope, and it must round-trip exactly through `exportState` → `importState`.
The envelope `state` block is keyed **per role** — `timeline`, `trace`, and
future projections each get their own key, so a trace-only collector persists
only its own projection's state.

**Backward compatible.** The checkpoint envelope `version` stays `1`; the
`state` block is additive. A legacy checkpoint (written before Phase 6.5, with no
`state` block) restores the cursor as before and replays forward from it —
identical to pre-6.5 behavior.

**Hard boundary — persisted state is never trusted on an invalid cursor.** A
valid cursor (deserialized cleanly, at or below the log head) restores `state`
directly. An invalid cursor — malformed JSON, unsupported version, invalid
payload, or a `seq` beyond the current log head — takes the one and only
recovery: reset both builders and replay from `beginningCursor()`. In that path
the persisted `state` is discarded, never imported. Operational save/load
failures preserve the current checkpoint + cache and retry next sample.

**The checkpoint and recovery invariants are canonical — recorded in
[`docs/architecture/eventlog-projection-architecture.md`](architecture/eventlog-projection-architecture.md).**
