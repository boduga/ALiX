# ALiX Capability Platform — Phase 6 (Timeline Projection Unification)

The Runtime tab's Execution Trace and the chat/agent timeline now share one
canonical source: the append-only EventLog with sessionId-routed projections.

A `ProjectionBuilder<T>` contract (update / snapshot / reset) keeps
`IncrementalExecutionTraceBuilder`'s mature lifecycle semantics untouched
and adds a new append-only `TimelineBuilder` for chat/agent entries. The
`RuntimeCollector` reads once per sample, dispatches the batch to both
builders, saves ONE checkpoint, and publishes a snapshot with `trace` + `timeline`.

`sessionId` is the routing dimension — the chat tab and the agent tab have
distinct sessionIds stamped on every emitted event, and each tab's
projection filters `event.sessionId === projection.sessionId`. The
persistence layer does NOT know about UI topology. Future consumers
(multi-chat, background agent, web UI, CLI, detached workflow) are identical
projections over the same log.

`timelineEvents[]` is removed in Phase 6 — it was a transitional in-memory
cache while the views migrated to `RuntimeSnapshot.timeline`. The log is now
the only source of truth for the timeline.

The operator timeline and platform (src/capability/*) are unchanged.
