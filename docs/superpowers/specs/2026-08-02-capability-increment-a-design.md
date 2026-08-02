# Capability Platform Increment A — CapabilityProjection Design

**Status:** Approved 2026-08-02
**Branch:** `feat/capability-increment-a`
**Relates to:** Phase 7 (projection platform, #329 → `96332aa1`); Phase 6 spec Future Direction (additional projections); Increments B/C/D follow (Metrics, ApprovalManager migration, Global Timeline).

## Goal

Add the **CapabilityProjection** — a lifecycle-reconciliation projection over `capability.Invocation*` events that answers "how are capabilities actually behaving?" (invocations, success/failure, average duration, last invocation, currently-running). It complements the live capability registry's **inventory** question ("what capabilities exist?") with a projection-derived **activity** view.

## Scope

- A new `CapabilityProjection` builder in `src/tui/runtime/`, registered on the outer runtime collector alongside trace + approval.
- A `RuntimeSnapshot.capabilities` field (typed).
- A Capabilities-tab activity panel (Option B): inventory (live registry) + activity (projection) rendered side-by-side, two independent data sources.

Explicitly out of scope (later increments / future):
- MetricsProjection (Increment B).
- ApprovalManager migration (Increment C).
- Global Timeline / cross-projection views (Increment D).
- Registry/health inventory projection (Option 3) — the live registry stays the inventory source; no registry-event emission.

## Architecture

```
EventLog
   |
   v
RuntimeCollectorImpl (outer sessionId)
   |
   v
ProjectionRuntime
   |-- trace
   |-- approval
   `-- capability  (NEW)
        |
        v
RuntimeSnapshot.capabilities
        |
        v
Capabilities tab → activity panel (alongside live-registry inventory)
```

## Source hierarchy (two independent, non-overlapping tiers)

| Tier | Events | Semantics | When used |
|---|---|---|---|
| **Primary — invocation lifecycle** | `capability.InvocationStarted` / `InvocationCompleted` / `InvocationFailed` / `InvocationCancelled` | Authoritative runtime activity | When `CapabilityService` is wired (TUI) |
| **Fallback — tool telemetry** | `tool.requested` / `tool.completed` / `tool.failed` (carry `canonicalCapability` + `durationMs`) | Separate telemetry counters | Always available; robust headless |

**No double-counting rule:** invocation counts and tool-usage counts are **separate counter sets**, never merged. A `tool.*` event contributes to a capability's `toolUsages`/`toolFailures`/`toolTotalDurationMs`; a `capability.Invocation*` lifecycle contributes to `invocations`/`succeeded`/`failed`/`cancelled`/`totalDurationMs`. The two sources answer different questions and are additive, never blended. Invocation lifecycle is authoritative for runtime activity; tool events are a robust telemetry fallback for capability-usage observation.

## Snapshot shape

```ts
interface CapabilityProjectionSnapshot {
  readonly capabilities: Readonly<Record<string, CapabilityStat>>;  // keyed by capabilityId — O(1) lookup, deterministic overwrite
  readonly activeInvocations: number;                                // openByKey.size at snapshot time
}

interface CapabilityStat {
  readonly capabilityId: string;
  readonly invocations: number;          // from Invocation* lifecycle
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly totalDurationMs: number;      // sum; avg = totalDurationMs / invocations
  readonly lastInvocationAt: number | null;
  readonly toolUsages: number;           // from tool.* fallback (non-overlapping)
  readonly toolFailures: number;
  readonly toolTotalDurationMs: number;
}
```

**Keyed snapshot:** every consumer looks up by `capabilityId`; O(1) lookup + deterministic overwrite. The UI derives ordering via `Object.values(...).sort(...)` when needed. Internally the builder keeps a `Map<string, CapabilityStat>` and materializes the keyed object in `snapshot()`.

## Durable state

```ts
{
  version: 1,
  openByKey: Array<{ key: string; lifecycle: InvocationLifecycle }>,  // open invocations (key = invocationId)
  terminalById: Array<{ id: string; entry: CapabilityInvocationEntry }>, // closed invocations
  closedFirstSequences: string[],                                     // dedup of closed invocations
  toolCounts: Record<string, { usages: number; failures: number; totalDurationMs: number }>,
  lastSeq: number,                                                    // monotonic-event guard (deterministic replay)
}
```

Mirrors the trace builder's open/close matching, extended with the tool-fallback counters and the `lastSeq` monotonic guard (Phase 7 deterministic-replay invariant). No `Date.now()`/`Math.random()` in update paths; timestamps come from event `at`/`timestamp` (strict parse, throw on malformed).

## Duration computation

`durationMs = terminal.at − started.at` for an invocation (the trace builder does the same). A terminal event without its start (unknown `invocationId`) is a no-op — never synthesizes a duration.

## Registration + surface

- **Register:** on the outer runtime collector (`src/cli/commands/tui.ts`), `projectionRuntime.register(ProjectionIds.capability, new CapabilityProjection())`. `ProjectionIds.capability = 'capability'`.
- **RuntimeSnapshot:** gains `readonly capabilities: CapabilityProjectionSnapshot | null` (a typed field, not the generic `projections` map). Assembled in `RuntimeCollectorImpl.sample()` via `snapshotOf<CapabilityProjectionSnapshot>(ProjectionIds.capability) ?? null`.
- **Consumer (Option B):** the Capabilities tab's right detail pane gains an **Activity** block for the selected capability — its invocation stats (`invocations`, `succeeded`, `failed`, `cancelled`, avg duration, last invocation, tool fallback counters) alongside the existing metadata. The list/inventory stays on the live registry.

## Key design decisions

1. **Invocation identity:** keyed by `invocationId` (from `InvocationStarted`), closed by a terminal event (`Completed`/`Failed`/`Cancelled`). Open/close matching = the trace builder's pattern.
2. **Duration:** computed `terminal.at − started.at`, never `Date.now()`. No synthetic durations for unknown-start terminals.
3. **Tool fallback is a SEPARATE counter set** (`toolUsages` etc.), never merged with invocation counts — clean, additive, unambiguous.
4. **Deterministic replay:** no clock in update paths; strict timestamp parse; `lastSeq` monotonic guard in durable state.
5. **Inventory vs activity separation:** the live registry stays authoritative for what capabilities exist + availability/health; the projection is authoritative for how they behave. Neither derives from the other.
6. **`activeInvocations`** derived from `openByKey.size` at snapshot time — immediate "what's running now?" answer.

## Acceptance criteria

- ✅ A new `CapabilityProjection` implements `DurableProjectionBuilder<CapabilityProjectionSnapshot>` and registers on the outer runtime collector via `ProjectionIds.capability` — zero `RuntimeCollectorImpl` orchestration changes (Phase 7 acceptance bar: adding a projection never modifies the collector's dispatch).
- ✅ Invocation lifecycle is authoritative; tool telemetry is a separate, non-overlapping counter set.
- ✅ Durable state round-trips through exportState/importState (restart reconstructs directly, no replay).
- ✅ Deterministic replay: no `Date.now()` in update paths; monotonic `lastSeq` guard; strict timestamp parse.
- ✅ `RuntimeSnapshot.capabilities` is a typed field; the Capabilities-tab detail pane shows the selected capability's activity.
- ✅ Existing `tests/tui/runtime` stay green; new CapabilityProjection tests cover invocation lifecycle reconciliation, duration computation, tool-fallback counters (no double counting), durable round-trip, deterministic replay, reset.
- ✅ The live registry tab's inventory behavior is unchanged (two independent data sources).

## Global constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript; vitest under `tests/**/*.vitest.ts`.
- `EventLog` API stays additive; `src/capability/*` untouched (the projection only READS bridged events; no new emission in this increment).
- Checkpoint envelope version STAYS `1`; `projections` envelope already supports arbitrary ids.
- Durable state JSON-serializable plain objects only.
- Replay-from-`beginningCursor()` remains the ONLY recovery for an invalid cursor.
- Commit convention: `feat(capabilities): ...` / `refactor(capabilities): ...` / `test(capabilities): ...` with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Risks / mitigations

- **Capability events only when `CapabilityService` wired:** mitigated by the tool-telemetry fallback (always on the log) — the projection still derives capability activity headless.
- **Double counting (invocation + tool):** mitigated by the hard rule that the two counter sets are never merged.
- **Duration fidelity:** invocation duration computed from event `at` deltas (not wall-clock), matching the trace builder; no synthetic durations.
- **Capabilities-tab integration:** the tab's detail pane is extended, not restructured — low churn; the inventory list + selection logic is untouched.
