# ALiX EventLog Projection Architecture (Canonical)

**Status:** Frozen — reference point for all future work
**Frozen at:** Phase 6, 2026-08-02
**Lineage:** Phase 4 (canonical event stream) → Phase 5 (incremental projections) → Phase 5.5 (durable projection checkpoints) → Phase 6 (unified timeline projection)

This document is the canonical statement of ALiX's event-sourcing architecture. Every subsequent feature — a new projection, a web UI, session replay, a metrics dashboard, a CLI consumer — MUST treat it as the reference. Where this document conflicts with a phase spec, this document wins; if you believe this document is wrong, amend it explicitly (do not silently deviate).

**Scope note:** this is the *conventions* layer. Implementation detail lives in the Phase 6 design spec — see [Cross-references](#cross-references). Do not duplicate mechanism here; record invariants.

---

## 1. Core invariant — the EventLog is the single source of truth

> **All narrative and execution facts live in one append-only EventLog. Projections own NO canonical state.**

- The EventLog is the only place facts are *stored*. Everything else is a derived view.
- A projection MAY keep in-memory derived state (for performance), but that state is **always** reproducible from the log — replay from `beginningCursor()` reconstructs it exactly.
- No tab, view, dashboard, or service is allowed to become a second store of truth for facts that belong in the log.
- The deprecated `timelineEvents[]` cache was the last violation of this invariant; it was removed in Phase 6 (D9). Any new "cache" must be explicitly a publication artifact, never a source of truth.

## 2. Projection contract — one lifecycle, derived directly from the log

> **Every projection implements the same lifecycle and derives directly from the EventLog batch.**

```ts
interface ProjectionBuilder<T> {
  update(events: readonly AlixEvent[]): void;   // reconcile; idempotent by event identity, replay-safe
  snapshot(): readonly T[];                     // fresh immutable DTOs
  reset(): void;                                // wipe in-memory state (recovery / corruption / hot reload)
}
```

- `update` is idempotent by event identity (typically `event.seq`, compounded with the projection's session) — replay-safe under at-least-once cursors.
- `snapshot` returns **fresh immutable DTOs**, never references into internal state.
- `reset` wipes in-memory projection state so a full replay from `beginningCursor()` rebuilds it (see [Checkpoint model](#4-checkpoint-model)).
- Every builder owns its own reconciliation semantics (append-only, lifecycle matching, terminal-first-wins, …). The contract defines *when* the hooks run, not *how* each projection reconciles.

## 3. Projection independence — builders never consume another builder's output

> **The dependency graph is always `EventLog → builder`. It is never `builder → builder`.**

- A projection must be reconstructable from the log alone. If two projections appear to need each other's output, the dependency is a design error — derive the shared fact from the log instead.
- This is what makes replay deterministic: restoring from `beginningCursor()` rebuilds every projection independently.
- It is also what makes projections **additive**: adding or removing a projection never requires changing an existing builder.

## 4. Checkpoint model — one projection = one durable checkpoint

> **Each projection owns exactly one cursor + one durable checkpoint. Checkpoints advance independently; recovery always rebuilds by replay.**

- **One projection ↔ one durable checkpoint.** There is no shared cursor or shared checkpoint store across projections — a shared store's log-global watermark starves later-starting collectors (they would recover past events they never consumed).
- **Independent advancement.** Each collector reads the log on its own schedule and advances its own watermark.
- **Save-before-publish.** A durable checkpoint advances only *after* the projection state required to reconstruct it has been built AND durably persisted. A published snapshot never represents a checkpoint position that was not durably saved — a crash leaves them aligned.
- **Recovery = replay.** On a beyond-head cursor, an invalid checkpoint, or corruption, the collector resets the builder (and its accounting) and replays from `beginningCursor()`. Recovery never "patches" state; it rebuilds it.
- The Phase 6 production wiring materializes this as three collectors — runtime (trace-only), chat sub-session, agent sub-session — each with its own store under `projections/<role>/`. Future projections follow the same shape.

## 5. Session routing — `sessionId` is the routing key

> **Every event carries a `sessionId`, stamped once at emit and immutable. `sessionId` identifies the projection domain, NOT the runtime that emitted the event.**

- Emitters stamp `sessionId` at append; it never changes afterward.
- A projection filters `event.sessionId === projection.sessionId` — projections never see another domain's events.
- An event may be emitted by one runtime but belong to a different projection domain (e.g. the task-loop runs in the outer runtime but emits agent-conversation events stamped `${sessionId}-agent`).
- The EventLog is **topology-agnostic**: it does not know about tabs, views, or UI structure. Routing is purely a projection concern.

## 6. Collector responsibility — orchestrates, never reasons

> **A collector orchestrates read → dispatch → checkpoint → publish. It contains NO domain logic.**

- Per sample the collector: reads the log once (incrementally from its cursor) → session-filters the batch → dispatches to its projection builders → saves its checkpoint → publishes a snapshot.
- Collectors hold no chat/agent/execution-specific logic — the builders own their state machines.
- A collector may skip a projection it is not wired for (e.g. a trace-only collector), but it still owns exactly one checkpoint.
- Future collectors/registries may fan out to N builders; the invariant that the collector only orchestrates is unchanged.

## 7. Future extensibility — new capabilities are just another projection

> **A new UI, replay engine, metrics dashboard, or web frontend is a projection over the EventLog — never a special-case subsystem.**

- Adding a projection = implementing `ProjectionBuilder<T>` and wiring it into a collector (or registry). No existing builder is modified.
- Examples of projections this model admits without new event stores: metrics, approvals, workflow, cost accounting, web-UI state, session replay, time-travel (snapshot at any event sequence).
- Multiple concurrent agents are already supported: each agent conversation is its own `sessionId` sub-session projection domain.

---

## Invariants checklist (for implementers and reviewers)

A change conforms to the projection architecture when all of the following hold. Use this as the review gate for any code touching the event/timeline/TUI surface.

- [ ] **Single source of truth:** facts are appended to the EventLog; no new second store of truth is introduced.
- [ ] **Projection contract:** any new projection implements `update`/`snapshot`/`reset` and derives from the log batch.
- [ ] **Projection independence:** no builder reads another builder's output; everything is derivable from the log alone.
- [ ] **One projection = one checkpoint:** each projection owns its own cursor + durable checkpoint; no shared watermark.
- [ ] **Recovery rebuilds by replay:** beyond-head/corruption handling resets the builder (and its accounting) and replays from `beginningCursor()`.
- [ ] **Session routing:** events carry an immutable `sessionId`; projections filter by it; the log knows nothing about UI topology.
- [ ] **Collector orchestrates only:** collectors read/dispatch/checkpoint/publish; domain logic lives in builders.
- [ ] **`sessionId` = projection domain, not emitting runtime:** cross-runtime emits are stamped for the domain they narrate.

## Cross-references

- **Event kernel** (append-only JSONL log, one source of truth): `docs/architecture/event-kernel-schema.md`
- **Phase 6 design** (implementation detail for the projection layer — contract, builders, collector, D1–D13): `docs/superpowers/specs/2026-07-31-capability-platform-phase6-design.md`
- **Phase 6 usage note** (consumer-facing behavior): `docs/capability-platform-phase6.md`
- **Phase 5.5** (durable projection checkpoints, `40072c38`): the save-before-publish and cursor machinery this document's checkpoint model rests on
- **Phase 4** (execution trace): the first projection, whose Runtime-tab behavior the outer collector preserves
