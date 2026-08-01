# ALiX Capability Platform — Phase 5.5 (Durable Projection Checkpoints)

Execution-trace projection's checkpoint (cursor + timestamp) is now persisted
to disk, so a restarted TUI resumes from its last committed position instead of
replaying the whole session.

The checkpoint is a **commit marker**: the cursor advances and the snapshot
publishes only when the durable save succeeds. `EventLog.serializeCursor` /
`deserializeCursor` are the only way cursors cross the persistence boundary —
the representation stays opaque and versioned; no owner token is persisted.
`ProjectionCheckpointStore` writes atomically (tmp+rename) to
`.alix/sessions/<sessionId>/projection-checkpoint.json`.

Recovery falls back to `beginningCursor()` when the checkpoint is missing,
malformed, or incompatible. Write cadence is every successful sample (~100 byte
file); no throttle.

Operator timeline (chat) and the platform (`src/capability/`) are unchanged.
