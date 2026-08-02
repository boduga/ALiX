# Capability Platform Increment B — MetricsProjection Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-02-capability-increment-b-design.md`

## Global Constraints

- **Frozen projection architecture** (`docs/architecture/eventlog-projection-architecture.md`) — EventLog single source of truth; projections own no canonical state.
- **Replay-derived, non-durable** (Phase 7 `:94`) — MetricsProjection implements `ProjectionBuilder<T>` only; NO `exportState`/`importState`, NO checkpoint participation.
- **Platform prerequisite:** `ProjectionRuntime` currently REQUIRES every builder to be durable (`register`/`captureState`/`restoreState` all assume `DurableProjectionBuilder`). Phase 7 `:94`'s "MAY be non-durable" is aspirational — this increment implements it. Task 1 is the prerequisite.
- **Builder isolation (D4)** — never imports another projection's snapshot/DTOs; consumes EventLog facts only.
- **Idempotent by seq (D5)** — skip already-applied seqs, never throw on re-read (collector's at-least-once path).
- **No `Date.now()`/`Math.random()`** in update paths; strict `Number.isFinite` timestamp parse.
- **Per CLAUDE.md:** run `gitnexus_impact` on `MetricsProjection` (post-index) before editing; `gitnexus_detect_changes()` before commit.

## Task 1: `ProjectionRuntime` non-durable-builder support (Phase 7 :94)

**File:** `src/tui/runtime/projection-runtime.ts`

Widen the runtime so a builder MAY be non-durable (`ProjectionBuilder`), discriminated structurally, and **omitted from the durable envelope** — exactly the Phase 7 `:94` contract ("exportState() omits it and checkpoint persistence never depends on non-durable builders").

- **Type guard** — `function isDurable(builder: ProjectionBuilder<unknown>): builder is DurableProjectionBuilder<unknown>` = `'exportState' in builder && 'importState' in builder` (structural; a `ProjectionBuilder` with those methods is durable).
- **`RegisteredProjection.builder`** widens to `ProjectionBuilder<unknown>`.
- **`register(id, builder: ProjectionBuilder<unknown>)`** — accepts both; keeps the empty/duplicate-id `ProjectionRegistrationError`.
- **`createProjectionRuntime`** signature: `ReadonlyArray<readonly [string, ProjectionBuilder<unknown>]>`.
- **`captureState()`** (internal, used by `updateAll` rollback AND `exportState`) — iterate registrations; call `exportState()` ONLY when `isDurable(builder)`; non-durable builders are omitted (no `exportState`, no envelope entry).
- **`restoreState()`** — `if (s !== undefined && isDurable(builder)) builder.importState(s)`; a non-durable builder is never `importState`'d.
- **`resetAll()`** — unchanged (calls `reset()` on every builder, durable or not).

**Rollback semantics for non-durable builders (document in code):** on `updateAll` failure, a non-durable builder's partial mutation is NOT rolled back (`captureState` omits it). This is SAFE because the builder is idempotent-by-seq (D5): the checkpoint did not advance, the next sample re-reads from the old cursor, and the builder skips already-applied seqs — it self-heals. `updateAll` still throws (the batch fails), so the durable checkpoint never commits partial state.

**Tests** — `tests/tui/runtime/projection-runtime.vitest.ts` (extend):
1. Register a non-durable builder alongside durable ones → `updateAll` delivers events to all; `exportState()` omits the non-durable id.
2. `importState(exportState())` round-trips durable ids and does NOT call `importState` on the non-durable builder.
3. **Rollback with a throwing durable builder** → durable builders restored; non-durable builder NOT `importState`'d (no crash) and self-heals on re-feed (counts not double).
4. **Rollback when the non-durable builder itself throws** → `updateAll` throws, durable builders rolled back; re-feeding the same batch does not double-count the non-durable builder.
5. `resetAll()` resets both durable and non-durable builders.

## Task 2: `MetricsProjection` builder

**File:** `src/tui/runtime/metrics-projection.ts` (new)

Implement `MetricsProjection implements ProjectionBuilder<MetricsProjectionSnapshot>` (import `ProjectionBuilder` from `./projection-builder.js` — NOT `DurableProjectionBuilder`).

```ts
import type { AlixEvent } from '../../events/types.js';
import { TOOL_EVENT_TYPES, type ToolCompletedPayload, type ToolFailedPayload } from '../../events/types.js';
import type { ProjectionBuilder } from './projection-builder.js';

export interface MetricsProjectionSnapshot {
  readonly eventsProcessed: number;
  readonly toolCalls: number;
  readonly toolFailures: number;
  readonly toolDuration: {
    readonly count: number;
    readonly totalMs: number;
    readonly minMs: number | null;
    readonly maxMs: number | null;
    readonly averageMs: number | null;
  };
  readonly capabilityInvocations: number;
  readonly startedAt: number | null;
  readonly lastEventAt: number | null;
}
```

Private mutable counters (all O(1), no arrays; finite-validated on write):

```ts
private eventsProcessed = 0;
private toolCalls = 0;
private toolFailures = 0;
private durationCount = 0;
private durationTotalMs = 0;
private durationMinMs: number | null = null;
private durationMaxMs: number | null = null;
private capabilityInvocations = 0;
private startedAt: number | null = null;
private lastEventAt: number | null = null;
private lastSeq = 0;   // in-memory idempotency guard (not durable)
```

**`update(events)`:**

```ts
update(events: readonly AlixEvent[]): void {
  for (const e of events) {
    if (e.seq <= this.lastSeq) continue;   // D5: skip already-applied, never throw
    this.lastSeq = e.seq;
    const ts = this.parseTimestamp(e);
    this.eventsProcessed++;
    if (this.startedAt === null) this.startedAt = ts;
    this.lastEventAt = ts;
    if (e.type === TOOL_EVENT_TYPES.REQUESTED) { this.toolCalls++; continue; }
    if (e.type === TOOL_EVENT_TYPES.COMPLETED || e.type === TOOL_EVENT_TYPES.FAILED) {
      const p = (e.payload ?? {}) as Partial<ToolCompletedPayload & ToolFailedPayload>;
      if (e.type === TOOL_EVENT_TYPES.FAILED) this.toolFailures++;
      if (typeof p.durationMs === 'number' && Number.isFinite(p.durationMs)) this.recordDuration(p.durationMs);
      continue;
    }
    if (e.type === 'capability.InvocationStarted') { this.capabilityInvocations++; continue; }
  }
}
```

- `recordDuration(ms)`: `durationCount++`, `durationTotalMs += ms`, min/max via `Math.min`/`Math.max` against null-coalesced. `averageMs = count ? total / count : null`.
- **Strict timestamp parse (D6):** private `parseTimestamp(e)` reads payload `at` (number) falling back to `e.timestamp` (Date.parse), throwing `'metrics projection: invalid timestamp on seq N'` on non-finite — same rigor as `CapabilityProjection.parseAt`. `startedAt`/`lastEventAt` = FIRST/LAST processed event's timestamp.
- **`snapshot()`:** fresh immutable DTO — `{ eventsProcessed, toolCalls, toolFailures, toolDuration: { count, totalMs, minMs, maxMs, averageMs }, capabilityInvocations, startedAt, lastEventAt }`. Never returns references into internal fields.
- **`reset()`:** zero all counters + `lastSeq = 0`.
- **Does NOT define** `exportState`/`importState` (non-durable; Task 1 handles the runtime discrimination).

## Task 3: Register + `RuntimeSnapshot.metrics`

- `src/tui/runtime/projection-ids.ts`: add `metrics: 'metrics'` to `ProjectionIds`.
- `src/tui/snapshot.ts`: add `readonly metrics: MetricsProjectionSnapshot | null` to `RuntimeSnapshot` (import the type).
- `src/cli/commands/tui.ts` composition root: register `[ProjectionIds.metrics, new MetricsProjection()]` on the **outer (runtime)** collector (alongside trace/approval/capability). Chat/agent collectors do NOT register metrics (no tool/capability events there).
- `src/tui/runtime-collector.ts` `sample()`: assemble `metrics: this.projectionRuntime.snapshotOf<MetricsProjectionSnapshot>(ProjectionIds.metrics) ?? null` in `nextCache`. Zero dispatch changes.

## Task 4: Tests

**File:** `tests/tui/runtime/metrics-projection.vitest.ts` (new) — mirror `capability-projection.vitest.ts` helper style.

1. **Volume + duration aggregates** — feed requested/completed/failed with `durationMs`; assert `toolCalls`, `toolFailures`, `toolDuration` {count/totalMs/minMs/maxMs/averageMs}.
2. **Empty state** — fresh snapshot: `toolDuration` all-null/zero, `startedAt`/`lastEventAt` null.
3. **Idempotent replay (D5)** — re-feed same batch; snapshot unchanged, no double-count.
4. **Capability volume** — `InvocationStarted` → `capabilityInvocations`; terminal events do NOT count.
5. **Timestamp bounds** — `startedAt` = first event's, `lastEventAt` = last event's; malformed timestamp throws `/timestamp/`.
6. **reset()** — after `reset()`, snapshot back to empty.
7. **Isolation (D4)** — file imports only `AlixEvent`/payload types, never another projection's DTO.

**Extend** `tests/tui/runtime/runtime-collector.vitest.ts`: after a sample, assert `snapshot.metrics` is populated (wiring parity with the A collector test).

## Task 5: Wire + full verify

- `pnpm typecheck` clean.
- `pnpm vitest run tests/tui` green.
- Full suite (exclude `tests/run/plan-approval.vitest.ts` vim-spawn hang) green.
- `gitnexus_detect_changes()` — expect LOW risk; changed: `projection-runtime.ts`, `metrics-projection.ts`, `projection-ids.ts`, `snapshot.ts`, `runtime-collector.ts`, `tui.ts`, + tests.
- `graphify update .` per CLAUDE.md.

## Acceptance

- `ProjectionRuntime` supports non-durable builders (Task 1) — registered non-durable builders update/reset, are omitted from `exportState`/checkpoint, and self-heal on re-read; durable builders' rollback invariant is preserved.
- MetricsProjection implements `ProjectionBuilder` (non-durable), registered via `ProjectionIds.metrics` on the outer runtime collector, exposed as `RuntimeSnapshot.metrics ?? null`.
- Correct session aggregates per spec event sources; idempotent by seq; no `Date.now()`; bounded memory; no duplication with CapabilityProjection.
- Existing `tests/tui/runtime` stay green; new projection tests cover the table in Task 4.
