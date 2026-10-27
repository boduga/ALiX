# D9 — Completion-event crash-boundary reconciliation design

2026-10-26. Historical design proposal. Subsequent partial implementation and executed daemon restart qualification are recorded in [D9-R3 evidence](D9-R3-daemon-restart-reconciliation.md); that record does not qualify every acceptance-matrix case below. D9 and LEAN-G01 remain BLOCKED.

## Reproduced boundary

`CoordinationCompletionService.finalize` persists the aggregate, attaches its reference and source fingerprint to the run, then appends `coordination.aggregate.completed`. An append failure is suppressed. A later `finalize` sees a fresh attached aggregate and returns before checking the event. The focused characterization test in `tests/kernel/coordination-finalization.test.ts` pins this behavior. A successful attach is **not** sufficient verification: `matchesAttachedAggregateEvent` requires a durable event with matching run ID, aggregate ref and fingerprint.

## Safety invariants

1. Reconciliation never executes workers, tools, approvals or model calls. It operates on completed aggregate evidence only.
2. A matching event is emitted at most once for a given `(runId, aggregateRef, sourceFingerprint)` even across processes and crashes. Do not implement a read-then-append outside a shared lock.
3. Revalidate the current attached ref, fingerprint and terminal status while holding the appropriate cross-process serialization boundary. Stale aggregates and replans cannot be promoted.
4. Event absence is not inferred from an in-memory counter or successful append return. A durable read is required.
5. On missing/corrupt/unreadable event history, preserve `verification=unverified` and surface a retryable diagnostic; never synthesize verified status.
6. A crash after the event append but before acknowledgement must be safe to retry without duplicating the event.

## Required atomicity design

The current finalization lock protects aggregate attachment, but the EventLog has a distinct append lock. Simply adding a `readAll` check before `append` leaves a cross-process race if another writer bypasses finalization, and a crash can occur between the two operations. Preferred implementation: add a narrowly scoped EventLog `appendIfAbsent` primitive that performs matching-event lookup and conditional append **under the same EventLog cross-process append lock**. It must use the same file, sequence allocation, and locking guarantees as ordinary append; its predicate must be restricted to a stable, exact event identity. Alternatively use a durable transactional outbox with a unique identity and replay worker, but its acknowledgment must still handle crash-after-append.

The completion service should, under the finalization lock, validate the persisted aggregate and current run attachment, then invoke the conditional EventLog append. Both first-time finalization and recovery must use this primitive. The daemon's per-session sink must expose the conditional operation and preserve the session containment check. Existing single-session callers need compatible behavior. A completed run with a missing event must be eligible for reconciliation without changing worker state or aggregate contents.

## Acceptance matrix

- RED: injected append failure after attach leaves CLI `verification=unverified`.
- GREEN: restart with healthy event sink reconciles one matching event and CLI becomes verified; worker/tool mutation counts remain unchanged.
- Crash after append but before acknowledgement: retry emits no duplicate.
- Concurrent finalizers/daemon instances: one matching event total.
- Stale fingerprint, replaced ref, nonterminal run, wrong session, missing aggregate, unreadable log: no event and no verified verdict.
- Existing successful finalization, attach-only, stale-event and architecture tests remain green.

## Scope and disposition

This design does not qualify tool-specific approval resumption, isolated subagents, interrupted tool receipt-to-worker-state recovery, multiworker cancellation/lease interleavings, or independent D1–D9 review. Do not mark D9/LEAN-G01 complete based on this document.
