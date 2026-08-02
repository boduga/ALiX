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

## Two complementary telemetry streams (never merged)

The CapabilityProjection consumes **two independent, complementary streams** — NOT a primary/fallback pair. "Fallback" would mean "use A if available, otherwise B," but that is explicitly NOT what happens: **both streams are always collected, both answer different questions, and their counters are never merged.**

| Stream | Events | Answers |
|---|---|---|
| **Invocation lifecycle** (authoritative runtime activity) | `capability.InvocationStarted` / `InvocationCompleted` / `InvocationFailed` / `InvocationCancelled` | "What happened during capability execution?" — invocations, success/failure, duration. Present when `CapabilityService` is wired. |
| **Tool telemetry** (complementary observation) | `tool.requested` / `tool.completed` / `tool.failed` (carry `canonicalCapability` + `durationMs`) | "Which capabilities were associated with tool executions?" — usage counters. Always on the log; robust headless. |

**No double-counting rule:** the two streams contribute to **separate counter sets**, never blended. A `tool.*` event contributes to the capability's `toolInvocationCount`/`toolFailureCount`/`toolDurationMs`; a `capability.Invocation*` lifecycle contributes to `invocationCount`/`invocationSucceeded`/`invocationFailed`/`invocationCancelled`/`invocationTotalDurationMs`. The streams are additive and semantically distinct.

## Snapshot shape

```ts
interface CapabilityProjectionSnapshot {
  readonly capabilities: Readonly<Record<string, CapabilityStat>>;  // keyed by capabilityId — O(1) lookup, deterministic overwrite
  readonly activeInvocations: number;                                // openByKey.size at snapshot time
}

interface CapabilityStat {
  readonly capabilityId: string;
  // Invocation lifecycle stream (authoritative runtime activity).
  readonly invocationCount: number;
  readonly invocationSucceeded: number;
  readonly invocationFailed: number;
  readonly invocationCancelled: number;
  readonly invocationTotalDurationMs: number;   // sum; avg = / invocationCount
  readonly lastInvocationAt: number | null;
  // Tool telemetry stream (complementary observation — non-overlapping).
  readonly toolInvocationCount: number;
  readonly toolFailureCount: number;
  readonly toolDurationMs: number;              // sum; avg = / toolInvocationCount
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
  toolCounts: Record<string, { invocationCount: number; failureCount: number; durationMs: number }>,
  lastSeq: number,                                                    // monotonic-event guard (deterministic replay)
}
```

Mirrors the trace builder's open/close matching, extended with the tool-telemetry counters (a separate complementary stream) and the `lastSeq` monotonic guard (Phase 7 deterministic-replay invariant). No `Date.now()`/`Math.random()` in update paths; timestamps come from event `at`/`timestamp` (strict parse, throw on malformed).

## Duration computation

`durationMs = terminal.at − started.at` for an invocation (the trace builder does the same). A terminal event without its start (unknown `invocationId`) is a no-op — never synthesizes a duration.

## Registration + surface

- **Register:** on the outer runtime collector (`src/cli/commands/tui.ts`), `projectionRuntime.register(ProjectionIds.capability, new CapabilityProjection())`. `ProjectionIds.capability = 'capability'`.
- **RuntimeSnapshot:** gains `readonly capabilities: CapabilityProjectionSnapshot | null` (a typed field, not the generic `projections` map). Assembled in `RuntimeCollectorImpl.sample()` via `snapshotOf<CapabilityProjectionSnapshot>(ProjectionIds.capability) ?? null`.
- **Consumer (Option B):** the Capabilities tab's right detail pane gains an **Activity** block for the selected capability — its invocation stats (`invocationCount`, `invocationSucceeded`, `invocationFailed`, `invocationCancelled`, avg duration, last invocation, tool-telemetry counters) alongside the existing metadata. The list/inventory stays on the live registry.

## Key design decisions

1. **Invocation identity:** keyed by `invocationId` (from `InvocationStarted`), closed by a terminal event (`Completed`/`Failed`/`Cancelled`). Open/close matching = the trace builder's pattern.
2. **Duration:** computed `terminal.at − started.at`, never `Date.now()`. No synthetic durations for unknown-start terminals.
3. **Strictly single-pass — late Started does NOT retroactively reconstruct:** a terminal event without its `Started` is a no-op, and a `Started` arriving after its terminal does NOT reconstruct the completed invocation. The projection is single-pass over the monotonic event stream; no buffering or reconciliation backfill. This preserves deterministic replay (a replay produces identical state).
4. **Unknown capabilities appear in the projection:** a `tool.completed` with `canonicalCapability: "foo.bar"` appears even if the registry no longer contains `foo.bar`. Projections represent historical facts; a capability disappearing from the registry must not erase history.
5. **Deterministic replay:** no clock in update paths; strict timestamp parse; `lastSeq` monotonic guard in durable state.
6. **Inventory vs activity separation:** the live registry stays authoritative for what capabilities exist + availability/health; the projection is authoritative for how they behave. **The projection NEVER queries `CapabilityRegistry`** — the two are independent read models sharing only `capabilityId`.
7. **`activeInvocations`** derived from `openByKey.size` at snapshot time — immediate "what's running now?" answer.

## Acceptance criteria

- ✅ A new `CapabilityProjection` implements `DurableProjectionBuilder<CapabilityProjectionSnapshot>` and registers on the outer runtime collector via `ProjectionIds.capability` — zero `RuntimeCollectorImpl` orchestration changes (Phase 7 acceptance bar: adding a projection never modifies the collector's dispatch).
- ✅ Invocation lifecycle and tool telemetry are two complementary streams feeding separate, non-overlapping counter sets.
- ✅ **The projection never queries `CapabilityRegistry`** — registry and projection are independent read models sharing only `capabilityId` (the registry stays authoritative for inventory; the projection for activity).
- ✅ Durable state round-trips through exportState/importState (restart reconstructs directly, no replay).
- ✅ Deterministic replay: no `Date.now()` in update paths; monotonic `lastSeq` guard; strict timestamp parse; strictly single-pass (a late `Started` after its terminal does NOT retroactively reconstruct).
- ✅ Unknown capabilities appear in the projection (historical facts outlive the registry).
- ✅ `RuntimeSnapshot.capabilities` is a typed field; the Capabilities-tab detail pane shows the selected capability's activity.
- ✅ Existing `tests/tui/runtime` stay green; new CapabilityProjection tests cover invocation lifecycle reconciliation, duration computation, tool-telemetry counters (no double counting), durable round-trip, deterministic replay, reset.
- ✅ The live registry tab's inventory behavior is unchanged (two independent data sources).

## Global constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript; vitest under `tests/**/*.vitest.ts`.
- `EventLog` API stays additive; `src/capability/*` untouched (the projection only READS bridged events; no new emission in this increment).
- Checkpoint envelope version STAYS `1`; `projections` envelope already supports arbitrary ids.
- Durable state JSON-serializable plain objects only.
- Replay-from-`beginningCursor()` remains the ONLY recovery for an invalid cursor.
- Commit convention: `feat(capabilities): ...` / `refactor(capabilities): ...` / `test(capabilities): ...` with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Risks / mitigations

- **Capability events only when `CapabilityService` wired:** mitigated by the tool-telemetry stream (always on the log) — the projection still derives capability activity headless.
- **Double counting (invocation + tool):** mitigated by the hard rule that the two counter sets are never merged.
- **Duration fidelity:** invocation duration computed from event `at` deltas (not wall-clock), matching the trace builder; no synthetic durations.
- **Capabilities-tab integration:** the tab's detail pane is extended, not restructured — low churn; the inventory list + selection logic is untouched.
