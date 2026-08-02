# ALiX Capability Platform — Increment B: MetricsProjection (Session Metrics)

**Status:** Design (Increment B of the capability-platform completion roadmap)
**Branch:** `feat/capability-increment-b`
**Depends on:** Increment A (merged, #330) — `CapabilityProjection`, `ProjectionIds.capability`, `RuntimeSnapshot.capabilities`

## Goal

A **session-level metrics projection** that answers: *"How is this runtime/session performing overall?"* — event volume, tool throughput, tool latency aggregates, and capability-invocation volume — derived **from facts already in the EventLog**, exposed as a new `RuntimeSnapshot.metrics` typed field. No new event family, no telemetry producer.

This is the complement to `CapabilityProjection`:

| Projection | Question |
|------------|----------|
| CapabilityProjection | "Which capabilities are healthy?" (per-capability) |
| **MetricsProjection** | "How is the system performing?" (session-level) |
| TraceProjection | "What happened?" |
| TimelineProjection | "What did the operator experience?" |

## Scope

- **B1 — Session-level `MetricsProjection`** implementing the shared projection contract.
- **Replay-derived, non-durable** (Phase 7 spec `:94`: *"a hypothetical metrics projection might be replay-derived"*).
- **In-memory aggregation only** — no durable state, no `exportState`/`importState`, no checkpoint participation, no rollback surface.
- **`RuntimeSnapshot.metrics`** typed field + registration on the outer (runtime) collector via `ProjectionIds.metrics`.
- **No dedicated UI panel in Increment B** — projection + snapshot exposure only (Phase 7's projection-first philosophy). Consumers (Runtime tab, web UI, dashboard, CLI metrics command) come later against the immutable DTO.

## Non-Goals (explicitly excluded from B)

- **`metric.*` AlixEvent family** — deriving intelligence from existing facts, not introducing a telemetry-producer event vocabulary (would invert the dependency: `runtime facts → metric events → projection`).
- **Percentiles (p50/p95/p99)** — exact-vs-approximate, bounded memory, replay determinism, and storage semantics deserve their own design increment.
- **Token economics / cost** — scattered sparse payloads, not a first projection.
- **Dashboard / view redesign** — projection + snapshot exposure only.
- **Durable state / checkpoint participation** — replay-derived.
- **Global Timeline / cross-projection views** — Increment D.

## Snapshot shape

```ts
export interface MetricsProjectionSnapshot {
  readonly eventsProcessed: number;              // count of this session's events the projection processed
  readonly toolCalls: number;                    // volume: tool.requested seen
  readonly toolFailures: number;                 // volume: tool.failed seen
  readonly toolDuration: {
    readonly count: number;                      // resolved executions with a duration sample
    readonly totalMs: number;
    readonly minMs: number | null;
    readonly maxMs: number | null;
    readonly averageMs: number | null;           // count ? totalMs / count : null
  };
  readonly capabilityInvocations: number;        // volume: capability.InvocationStarted seen
  readonly startedAt: number | null;             // timestamp of first processed session event
  readonly lastEventAt: number | null;           // timestamp of last processed session event
}
```

All counters are O(1) aggregates — no unbounded sample array (percentiles would need one; that's why they're deferred). All numeric fields are finite (validated by the same `isFinite` rigor as `CapabilityProjection`).

## Event sources (derived, never produced)

| Metric | Event source | Payload field |
|--------|--------------|---------------|
| `eventsProcessed` | every session event | — |
| `toolCalls` (volume) | `tool.requested` | — |
| `toolFailures` | `tool.failed` | — |
| `toolDuration` samples | `tool.completed` / `tool.failed` | `durationMs` |
| `capabilityInvocations` | `capability.InvocationStarted` | — |
| `startedAt` / `lastEventAt` | first / last processed session event | `at` / `timestamp` |

- **`toolCalls` counts `tool.requested`** (work initiated — the volume read-model meaning), matching the operator's "how many tool calls has this session made?". `tool.requested` alone is a valid volume sample; it is idempotent by seq like every event (a re-read is skipped, never double-counted).
- **`toolDuration` samples come directly from the terminal payload's `durationMs`** (`ToolCompletedPayload`/`ToolFailedPayload`) — no request→terminal pairing, no phantom duration, no `at`-delta arithmetic. `count` = resolved executions carrying a duration; distinct from `toolCalls` volume by design (volume counts initiations, latency aggregates count completions).
- **`capabilityInvocations` counts `capability.InvocationStarted`** — invocations initiated, the volume meaning. Terminal events are NOT counted here (no per-invocation bookkeeping; that is `CapabilityProjection`'s job — this projection never duplicates per-capability aggregation).

## Key design decisions

**D1. Derive from existing events; never emit `metric.*`.** The projection is a read model, not a telemetry producer. `runtime facts → MetricsProjection → metrics snapshot`; never `runtime facts → metric events → projection`.

**D2. Session-level, complementary to `CapabilityProjection`.** Per-capability aggregation already exists (`CapabilityStat`). This projection aggregates at session level only (throughput, latency, volume) — the two never overlap, never double-count.

**D3. Replay-derived, non-durable.** Implements `ProjectionBuilder<MetricsProjectionSnapshot>` (update/snapshot/reset) — NOT `DurableProjectionBuilder`. `exportState()`/`importState()` are absent; the checkpoint envelope never references it. A collector restart rebuilds it from `beginningCursor()`. This is the Phase 7 `:94` precedent, and it removes the entire durable-state surface (no export/import, no rollback, no validation).

**D4. Builder isolation (Phase 7 invariant).** MetricsProjection MUST NOT depend on `CapabilityProjectionSnapshot`, `TraceProjectionSnapshot`, or any other builder's output. It consumes EventLog facts directly. Dependency graph stays `EventLog → builder`, never `builder → builder`.

**D5. Idempotent by seq (at-least-once safe).** In-memory `lastSeq` guard SKIPS already-applied seqs — never throws, never double-counts. The collector's save-failure path re-reads the same events; skipping is the only correct behavior (a throw would roll back `updateAll` and stall every projection's checkpoint).

**D6. Strict deterministic replay.** No `Date.now()`/`Math.random()` in update paths; timestamps from event `at`/`timestamp` with strict `Number.isFinite` parse (throw on malformed). All aggregates are order-independent given the same event stream (count/sum/min/max are).

**D7. No percentiles in B.** min/max/avg are the bounded-memory, determinism-clean latency aggregates. Percentiles (exact/approximate, bounded-memory, storage) are deferred to their own increment.

## Registration + surface

- `ProjectionIds.metrics` added to `src/tui/runtime/projection-ids.ts`.
- Registered on the **outer (runtime) collector** in the composition root (`src/cli/commands/tui.ts`), alongside trace/approval/capability — the session that sees `tool.*` + `capability.*` events.
- `RuntimeSnapshot.metrics: MetricsProjectionSnapshot | null` typed field (`src/tui/snapshot.ts`), assembled in `RuntimeCollectorImpl.sample()` via `snapshotOf<MetricsProjectionSnapshot>(ProjectionIds.metrics) ?? null`.
- Zero `RuntimeCollectorImpl` orchestration changes beyond the field assembly — adding a projection never modifies the collector's dispatch (Phase 7 acceptance bar).
- Like `CapabilityProjection`, this is a **Phase-7 registry-keyed** projection: `ProjectionRuntime.snapshotOf(ProjectionIds.metrics)`.

## Acceptance criteria

- ✅ A new `MetricsProjection` implements `ProjectionBuilder<MetricsProjectionSnapshot>` (update/snapshot/reset), registered on the outer runtime collector via `ProjectionIds.metrics` — zero collector-dispatch changes.
- ✅ Replay-derived and non-durable: no `exportState`/`importState`/`reset`-beyond-interface, no checkpoint participation; a restart rebuilds by replay.
- ✅ Correct session-level aggregates from the listed event sources: `eventsProcessed`, `toolCalls` (requested volume), `toolFailures`, `toolDuration` {count/totalMs/minMs/maxMs/averageMs}, `capabilityInvocations` (started volume), `startedAt`/`lastEventAt`.
- ✅ `RuntimeSnapshot.metrics` is a typed field; assembled `?? null`; consumed by tests (projection-first, no view).
- ✅ Idempotent by seq: re-feeding an already-seen batch does not throw nor double-count any counter.
- ✅ Builder isolation: MetricsProjection consumes EventLog facts only — no import of another projection's snapshot/DTOs.
- ✅ Deterministic: no `Date.now()` in update paths; strict timestamp parse; bounded memory (O(1) aggregates, no sample arrays).
- ✅ No duplication with `CapabilityProjection` (session-level only) and no double-counting across the two.
- ✅ Existing `tests/tui/runtime` stay green; new MetricsProjection tests cover volume counting, duration aggregates (min/max/avg incl. empty), idempotent replay, timestamp bounds, reset.
