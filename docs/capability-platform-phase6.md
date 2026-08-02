# ALiX Capability Platform — Phase 6 (Timeline Projection Unification)

The Runtime tab's Execution Trace and the chat/agent timeline now share one
canonical source: the append-only EventLog with sessionId-routed projections.

A `ProjectionBuilder<T>` contract (update / snapshot / reset) keeps
`IncrementalExecutionTraceBuilder`'s mature lifecycle semantics untouched
and adds a new append-only `TimelineBuilder` for chat/agent entries. Three
projections run over ONE log — the outer runtime collector (execution trace
only), the chat sub-session, and the agent sub-session. Each reads once per
sample, dispatches to its builders, saves its OWN checkpoint, and publishes a
snapshot with `trace` and/or `timeline`.

`sessionId` is the routing dimension — the runtime, chat, and agent domains
have distinct sessionIds stamped on every emitted event, and each projection
filters `event.sessionId === projection.sessionId`. The persistence layer does
NOT know about UI topology. Future consumers (multi-chat, background agent,
web UI, CLI, detached workflow) are identical projections over the same log.

`timelineEvents[]` is removed in Phase 6 — it was a transitional in-memory
cache while the views migrated to `RuntimeSnapshot.timeline`. The log is now
the only source of truth for the timeline.

The operator timeline and platform (src/capability/*) are unchanged.

**This phase's architecture is canonical — the projection invariants are
frozen in [`docs/architecture/eventlog-projection-architecture.md`](architecture/eventlog-projection-architecture.md).**
