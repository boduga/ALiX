# TUI Projection Runtime

## Overview
Event-sourced projection layer that turns the `EventLog` batch for a session into
immutable, renderer-neutral snapshots (timeline, execution trace, approvals,
capabilities, metrics, context, evolution). Each projection is a builder that
derives entirely from the event batch; the `ProjectionRuntime` owns registration,
deterministic dispatch, transactional rollback, checkpoint durability, and reset
coordination. Snapshots are consumed by the Workbench view-state assembler and
by renderers, not by this package.

## Interface
- `ProjectionRuntime`, `RegisteredProjection`, `createProjectionRuntime` — registration, `updateAll`, snapshot extraction, durable state export/import, rollback [projection-runtime.ts:ProjectionRuntime]
- `ProjectionRegistrationError` — empty or duplicate projection id [projection-runtime.ts:ProjectionRegistrationError]
- `ProjectionRollbackError` — update and rollback both failed, preserving both errors [projection-runtime.ts:ProjectionRollbackError]
- `ProjectionBuilder<TSnapshot>` (`update`, `snapshot`, `reset`) [projection-builder.ts:ProjectionBuilder]
- `DurableProjectionBuilder<TSnapshot>` (`exportState`, `importState`) [durable-projection-builder.ts:DurableProjectionBuilder]
- `ProjectionState`, `ProjectionStateSnapshot` (read-only id → state map) [projection-state.ts:ProjectionStateSnapshot]
- `ProjectionIds` canonical id table (timeline, trace, approval, capability, metrics, context, evolution, agents, tasks, diffs, artifacts) [projection-ids.ts:ProjectionIds]
- `ProjectionCheckpointStore`, `FileProjectionCheckpointStore`, `PersistedProjectionCheckpoint`, `CHECKPOINT_CONTAINER_VERSION` [projection-checkpoint-store.ts:FileProjectionCheckpointStore]
- `TimelineBuilder`, `TimelineEntry`, `TimelineBuilderState`, `TIMELINE_TYPES` [timeline-builder.ts:TimelineBuilder]
- `IncrementalExecutionTraceBuilder`, `ExecutionTraceEntry`, `ExecutionTraceRetention`, `createExecutionTraceRetention`, `computeExecutionTrace` [execution-trace-builder.ts:IncrementalExecutionTraceBuilder], [execution-trace.ts:ExecutionTraceEntry]
- `ApprovalProjection`, `ApprovalProjectionEntry`, `ApprovalProjectionSnapshot`, `MAX_COMPLETED` [approval-projection.ts:ApprovalProjection]
- `ApprovalProjectionCollector` — projection snapshot to `ApprovalCollector` adapter [approval-projection-collector.ts:ApprovalProjectionCollector]
- `CapabilityProjection`, `CapabilityStat`, `CapabilityProjectionSnapshot` [capability-projection.ts:CapabilityProjection]
- `ContextProjectionBuilder`, `ContextProjectionSnapshot` [context-projection.ts:ContextProjectionBuilder]
- `MetricsProjection`, `MetricsProjectionSnapshot` [metrics-projection.ts:MetricsProjection]
- `evolution/` — self-driven read model over canonical evolution artifacts: [./evolution/README.md](./evolution/README.md); `EvolutionProjection`, `EvolutionProjectionSnapshot`, `assembleEvolutionSnapshot`, `buildEvolutionLinks` [evolution/evolution-projection.ts:EvolutionProjection], [evolution/evolution-projection-snapshot.ts:EvolutionProjectionSnapshot], [evolution/evolution-snapshot-assembler.ts:assembleEvolutionSnapshot], [evolution/evolution-link-builder.ts:buildEvolutionLinks]

## Invariants
- A builder is DURABLE only if it implements BOTH `exportState` and `importState`; a builder with one of the two is treated as non-durable [projection-runtime.ts:ProjectionRuntime]
- `updateAll` is transactional for durable builders: a throw restores every durable builder via `exportState`/`importState` and propagates, so no partial durable mutation survives [projection-runtime.ts:ProjectionRuntime]
- Non-durable builders are omitted from the durable envelope and are not rolled back; this is safe because they are idempotent-by-seq and self-heal on the next sample [projection-runtime.ts:ProjectionRuntime]
- Builders receive events in EventLog sequence order; execution order is not semantic and every projection derives only from the EventLog batch [projection-runtime.ts:ProjectionRuntime]
- Registration trims whitespace first, then rejects empty or duplicate ids; `snapshotOf` normalizes the id the same way [projection-runtime.ts:ProjectionRuntime]
- `restoreState` rejects a non-plain-object envelope and ignores ids that are not registered (rolling-upgrade safety) [projection-runtime.ts:ProjectionRuntime]
- `snapshotOfAsync` awaits an I/O-backed builder's Promise and returns sync values immediately [projection-runtime.ts:ProjectionRuntime]
- Durable state must round-trip exactly, capturing ALL mutable fields a builder mutates, or transactional rollback breaks [durable-projection-builder.ts:DurableProjectionBuilder]
- Checkpoint load treats corrupt JSON, a non-object, an unknown `version`, or a missing/invalid `cursor`/`committedAt` as `null` (not-found) [projection-checkpoint-store.ts:FileProjectionCheckpointStore]
- Timeline is append-only: entries are never mutated, only this builder's `sessionId` entries are kept, and replay identity is the compound `${sessionId}:${seq}:${type}` key rather than the random event `id` [timeline-builder.ts:TimelineBuilder]
- Timeline snapshot orders deterministically by `firstSequence` with an `id` tiebreaker, never by timestamp [timeline-builder.ts:TimelineBuilder]
- Timeline `importState` structurally validates every entry (version 1, required fields, optional field types) and rejects malformed persisted state [timeline-builder.ts:TimelineBuilder]
- Approval projection rejects non-monotonic event sequences, preserves pending first-request order, caps completed history at `MAX_COMPLETED` (50), and refuses to resume an already-completed approval [approval-projection.ts:ApprovalProjection], [approval-projection.ts:MAX_COMPLETED]
- Approval `resumed` status leaves the entry pending; only `approval.resume.failed` is non-terminal and does not close it [approval-projection.ts:ApprovalProjection]
- Approval collector hides `pending`/`resumed` statuses from the UI record and reports pending/completed totals [approval-projection-collector.ts:ApprovalProjectionCollector]
- Capability projection never re-opens a terminalized invocation and never queries the `CapabilityRegistry`; it skips already-applied seqs instead of throwing [capability-projection.ts:CapabilityProjection]
- Metrics projection is deliberately non-durable, O(1) per counter, replay-derived, and skips already-applied seqs [metrics-projection.ts:MetricsProjection]
- Context projection is budget-agnostic; its retention caps are 200 recent turns, 200 tool results, 50 ledger lines, and 20 errors [context-projection.ts:ContextProjectionBuilder]
- Execution trace retention never evicts running entries; terminal entries are bounded to `maxTerminal` (default 50) [execution-trace-builder.ts:createExecutionTraceRetention]
- Evolution stages with no canonical EventLog emitter are declared authoritative from persisted artifacts read fresh every cycle, never inferred [evolution/evolution-projection.ts:NON_EVENTLOG_AUTHORITATIVE_STAGES]
- Evolution stage status distinguishes `available` from `empty`; `empty` is not `unavailable` [evolution/evolution-projection-snapshot.ts:StageStatus]

## Side Effects
- `FileProjectionCheckpointStore` reads and writes `<sessionDir>/projection-checkpoint.json`, creating the directory recursively and writing atomically via tmp file + rename [projection-checkpoint-store.ts:FileProjectionCheckpointStore]
- `EvolutionProjection` is I/O-backed: its `snapshot()` reads lifecycle, forecasts, correlations, recommendations, and learning proposals through injected `EvolutionReadSources` [evolution/evolution-projection.ts:EvolutionReadSources]
- `EvolutionProjection` uses a deterministic clock, defaulting to `Date.now()`, for its cycle timestamp [evolution/evolution-projection.ts:EvolutionProjection]
- All other builders are in-memory projections with no disk, network, or EventLog writes [projection-runtime.ts:ProjectionRuntime]

## Verification
- Run: `pnpm test`
