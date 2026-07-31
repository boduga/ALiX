# ALiX Capability Platform — Phase 4 Design (Execution Trace)

**Status:** Approved — Ready for Implementation
**Date:** 2026-07-31
**Depends on:** Phase 3 (`docs/superpowers/specs/2026-07-31-capability-platform-phase3-design.md`) — merged 2026-07-31 (`a731ec6a`)

> Upgrades the Runtime tab from a flat `actor:type` event list into a structured,
> lifecycle-aware **Execution Trace** — a projection over the append-only
> `EventLog`, grouped into operator-meaningful lifecycle units (tool runs, policy
> verdicts, capability invocations, runtime transitions). Execution telemetry
> stays in its own stream; the operator timeline (`timelineEvents[]`) is
> untouched.

## Goal

Give operators a rich debugging surface over what ALiX is *doing* right now —
the execution telemetry behind the operator narrative — by upgrading the
existing Runtime tab to render lifecycle-grouped execution entries with
client-side filtering. No new tab, no navigation churn.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **Execution Trace is a second stream, not a timeline extension.** The operator timeline (`timelineEvents[]`, Phase 3) is the curated operator narrative; the Execution Trace is diagnostic execution telemetry. Two audiences, two mental models, two streams. |
| D2 | **EventLog is the execution-truth source.** The append-only `EventLog` (already carrying `tool.*`, `policy.*`/`patch.*`, `capability.*`, workflow/phase events) becomes the canonical execution record. The trace is a *projection* over it. |
| D3 | **Temporary architectural boundary.** During Phase 4, `timelineEvents[]` remains canonical for the operator timeline and `EventLog` remains canonical for execution telemetry. A future "Timeline Projection" phase may unify both surfaces on a shared append-only event log — explicitly out of scope now, not accidental debt. |
| D4 | **Lifecycle grouping before retention.** The builder groups raw events into lifecycle units (a `tool.started`→`stdout`→`completed` sequence collapses to one entry with duration). Retention then applies to *lifecycle units*, never raw events. |
| D5 | **Running entries are never evicted.** The window keeps every open (`running`) lifecycle entry; only terminal (`completed`/`failed`/`cancelled`) units participate in the bounded keep-last-N eviction. An in-progress tool must not vanish mid-run. |
| D6 | **RuntimeView renders DTOs only.** The view never calls `EventLog` APIs and never interprets raw events — it renders `ExecutionTraceEntry[]` produced by the builder and window, assembled by the collector into the snapshot. Dependency chain: `EventLog → RuntimeCollector → RuntimeSnapshot → RuntimeView`. |
| D7 | **Filtering is view-local presentation state.** The collector always produces the complete bounded trace; the view decides All / Tool / Capability / Policy / Runtime. Filter state lives in `PerTabState`. |
| D8 | **Builder output is immutable and detached.** `ExecutionTraceBuilder` never mutates `AlixEvent`s and never returns references into `EventLog` payloads — entries contain copied DTO fields only. `RuntimeSnapshot.trace` is `readonly`. **RuntimeView never mutates `ExecutionTraceEntry` instances** — filtering and rendering operate on readonly DTOs. This mirrors Phase-3's `appendTimelineEvent` identity rule in the opposite direction: timeline events intentionally support lifecycle mutation; trace entries intentionally do not. |
| D9 | **Incremental-ready builder interface.** The builder is specified as `build(events)` today (implemented over `readAll()`), but its interface must admit a future incremental `update(newEvents)` without changing the collector or view. |
| D10 | **Builder consumes EventLog facts only.** `ExecutionTraceBuilder` never reads `timelineEvents[]` or capability presenters — it is a pure function of the `EventLog` stream. Capability lifecycle entries are derived from the `capability.*` bridge events (or their `CapabilityEvent` equivalents) already in the log. |

## Architecture

### Execution trace entry — the lifecycle unit

Named unions so the builder/view/tests never repeat the literals:

```ts
export type ExecutionTraceKind = 'tool' | 'policy' | 'capability' | 'runtime';
export type ExecutionTraceStatus = 'running' | 'completed' | 'failed' | 'cancelled';
```

The entry is an explicitly-readonly DTO — the contract enforces the invariant:

```ts
/** Runtime-local deterministic trace entry id (e.g. `tr-${seq}`). NOT durable
 *  across sessions; if replay/persistence arrives, `sessionId + sequence`
 *  becomes the durable identity. */
export interface ExecutionTraceEntry {
  readonly id: string;
  readonly kind: ExecutionTraceKind;
  readonly status: ExecutionTraceStatus;
  /** One-line title — "tool.search", "Policy: Allow", "core.session.list". */
  readonly title: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly durationMs?: number;
  /** Provenance back to the raw EventLog, without leaking raw events into the UI. */
  readonly sourceEvents: {
    readonly firstSequence: number;
    readonly lastSequence?: number;
  };
}
```

### Pipeline

```
EventLog (append-only execution truth)
    │
    ▼
RuntimeCollectorImpl  (polls, orchestrates)
    │
    ├── ExecutionTraceBuilder  (pure: events → lifecycle entries)
    │        └── ExecutionTraceWindow  (retention policy)
    │
    └── RuntimeSnapshot
          ├── …existing summary fields…
          └── trace: readonly ExecutionTraceEntry[]
                    │
                    ▼
              RuntimeView  (renders DTOs + client-side filter)
```

**Stage responsibilities:**
- **`ExecutionTraceBuilder`** — pure. Answers "what lifecycle entries exist?" Groups over the complete known history (starts with `EventLog.readAll()`; interface designed so an incremental `update(newEvents)` slots in later without touching the collector/view). Owns the lifecycle map.
- **`ExecutionTraceWindow`** — retention only. Answers "which entries are retained?" Keeps every open (`running`) entry; keeps the last N (e.g. 50) terminal units. **Ordering rule:** terminal entries render oldest→newest, then open (`running`) entries appended after them — a long-running tool cannot visually dominate the tab forever. Conceptually separate from building; initially co-located in the same file. **Formal interface** — no builder logic, no EventLog knowledge, no timestamp interpretation, only retention:

```ts
export interface ExecutionTraceWindow {
  apply(entries: readonly ExecutionTraceEntry[]): readonly ExecutionTraceEntry[];
}
```
- **`RuntimeCollectorImpl`** — orchestrates. Polls `readAll()` → builder → window → assembles `RuntimeSnapshot`. Keeps the existing summary header (phase/intent/workflow) and the existing poll-failure keeps-previous-snapshot behavior.
- **`RuntimeView`** — renders summary header + lifecycle-aware trace rows. Applies the client-side filter over `trace`. Never calls `EventLog`.

### Grouping rules (builder)

- **Tool:** `tool.started` + `tool.stdout*` + `tool.completed`/`tool.failed` → one entry (`▶ tool.search … ✔ completed (183 ms)` with stdout detail).
- **Policy:** `policy.check.started` + `policy.allowed`/`denied` → one verdict entry (`✔ Policy: Allow`). `patch.*` checkpoint/rollback events group under policy too.
- **Capability:** `capability.*` lifecycle (the `toAlixEvent` bridge already in the log: `capability.started` / `completed` / `failed` / `cancelled`, or their `CapabilityEvent` equivalents) → one entry (invocation, status, output). The builder derives these from the **EventLog facts only** — it never reads `timelineEvents[]` or capability presenter state (D10).
- **Runtime:** `runtime.transition` / phase changes / workflow created/completed → one entry.

### Snapshot migration

`RuntimeSnapshot` keeps its existing fields. The new `trace` field is added; the old flat `events?: readonly RuntimeEventSnapshot[]` is marked **deprecated during migration** and deleted after every consumer migrates (same incremental pattern as Phase 3):

```ts
export interface RuntimeSnapshot {
  readonly events?: readonly RuntimeEventSnapshot[]; // deprecated — migrate to trace
  readonly trace: readonly ExecutionTraceEntry[];
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
}
```

### Filter state

```ts
export type RuntimeTraceFilter = 'all' | 'tool' | 'capability' | 'policy' | 'runtime';
```

On `PerTabState`: `runtimeTraceFilter: RuntimeTraceFilter` (default `'all'`). The view maps an `ExecutionTraceEntry.kind` to the filter group; `'all'` shows everything.

## Data Flow

```
tool.started, tool.stdout, tool.completed   ─┐
policy.check.started, policy.allowed        ─┼─► ExecutionTraceBuilder ─► ExecutionTraceEntry[]
capability.InvocationStarted/…              ─┘         │
                                                 ExecutionTraceWindow (running kept, terminal keepLast 50)
                                                         │
                                                   RuntimeSnapshot.trace (readonly)
                                                         │
                                              RuntimeView (filter: all/tool/capability/policy/runtime)
```

## Error Handling

- **Poll failure** — collector keeps the previous snapshot (existing behavior; the runtime tab never blanks).
- **Entry stuck `running`** (terminal event missing) — the entry stays open and visible; the builder never crashes on a missing terminal event.
- **`readAll()` large logs** — grouping is over the full history (correctness), rendering is bounded by lifecycle units; the incremental `update(newEvents)` path is the documented future optimization.

## Testing Strategy

- **Builder (pure unit tests):** tool lifecycle collapse (`started`+`stdout`+`completed` → one entry with duration + sourceEvents range), policy verdict collapse, capability lifecycle (derived from `capability.*` EventLog facts only), runtime transition entry, terminal-vs-open classification, immutability (output is a detached DTO — mutating the entry does not touch the source events; entries are `readonly`).
- **Window:** running entries always retained; terminal keepLast(50); ordering — terminal entries oldest→newest, running entries appended after them.
- **Snapshot:** `trace` is `readonly`; deprecated `events` present during migration then deleted; consumers updated.
- **View:** filter renders the correct subsets (tool/capability/policy/runtime/all); summary header intact; scroll (`J`/`K`) preserved.
- **Gate:** `npx tsc -p tsconfig.json --noEmit` + `npx vitest run tests/tui --config vitest.config.mts` green.

## Success Criteria

- ✅ The Runtime tab renders lifecycle-grouped execution entries (a tool run is ONE row with duration + stdout, not four raw events).
- ✅ Running entries never disappear mid-run; terminal entries are bounded (keep-last-N).
- ✅ All / Tool / Capability / Policy / Runtime filtering works entirely client-side over the trace.
- ✅ `RuntimeView` never calls `EventLog` and never interprets raw events — dependency chain `EventLog → RuntimeCollector → RuntimeSnapshot → RuntimeView` holds.
- ✅ `timelineEvents[]` and its views are untouched; `src/capability/*` unmodified.
- ✅ Builder is pure and testable; trace entries are immutable DTOs with `sourceEvents` provenance; TUI suite + tsc green.

## Non-Goals (Phase 4)

- **Unifying the operator timeline onto the EventLog.** Explicitly deferred to a future "Timeline Projection" phase (D3).
- **Incremental `update(newEvents)` implementation.** The builder interface admits it; Phase 4 implements `build(readAll())`.
- **Live streaming / WebSocket.** Polling (1s) is the existing pattern; no new transport.
- **Trace persistence / replay.** Execution entries are runtime DTOs; durability is a later concern.
- **New tabs / navigation changes.** The trace lives in the existing Runtime tab.
- **`src/capability/*` modification.** Platform stays UI-unaware.

## Future Direction

- **Incremental builder** — `ExecutionTraceBuilder.update(newEvents)` over a persisted cursor, once `EventLog.readSince(cursor)` exists.
- **Timeline Projection phase** — unify `timelineEvents[]` + execution trace on a shared append-only event log, answering which user/agent messages belong in the log and how replay reconstructs mutable timeline entries.
- **Trace export / full-history view** — a non-bounded trace surface for deep debugging.
- **Web UI reuse** — the immutable `ExecutionTraceEntry[]` DTO is projection-friendly for a future web surface.
