# Capability Platform Increment A — CapabilityProjection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `CapabilityProjection` — a lifecycle-reconciliation projection over `capability.Invocation*` events (invocation lifecycle stream) + tool-event `canonicalCapability`/`durationMs` (complementary tool-telemetry stream), answering "how are capabilities actually behaving?" — registered on the outer runtime collector and surfaced as a Capabilities-tab activity panel.

**Architecture:** A new `DurableProjectionBuilder<CapabilityProjectionSnapshot>` in `src/tui/runtime/`, following the trace builder's open/close reconciliation + the Phase-7 platform invariants (no collector orchestration changes to add a projection). Registered via `ProjectionIds.capability` on the outer runtime collector. `RuntimeSnapshot.capabilities` typed field feeds the Capabilities-tab detail pane's Activity block.

**Tech Stack:** TypeScript (strict, NodeNext ESM `.js` specifiers), vitest. Files: `src/tui/runtime/capability-projection.ts` (new), `tests/tui/runtime/capability-projection.vitest.ts` (new), `src/tui/runtime/projection-ids.ts`, `src/tui/runtime-collector.ts`, `src/tui/snapshot.ts`, `src/tui/capabilities/capabilities-view.ts`.

## Global Constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript; vitest under `tests/**/*.vitest.ts`.
- **Two complementary streams, never merged:** invocation lifecycle (authoritative runtime activity) → `invocationCount`/`invocationSucceeded`/`invocationFailed`/`invocationCancelled`/`invocationTotalDurationMs`/`lastInvocationAt`; tool telemetry (complementary) → `toolInvocationCount`/`toolFailureCount`/`toolDurationMs`. Separate counter sets.
- **Strictly single-pass:** a terminal event without its `Started` is a no-op; a `Started` arriving after its terminal does NOT retroactively reconstruct. No buffering/backfill.
- **Unknown capabilities appear:** a `tool.completed` with `canonicalCapability: "foo.bar"` appears even if the registry no longer has `foo.bar` (history outlives the registry).
- **The projection NEVER queries `CapabilityRegistry`** — independent read model; shares only `capabilityId`.
- **Deterministic replay:** no `Date.now()`/`Math.random()` in update paths; strict timestamp parse (throw on malformed); `lastSeq` monotonic guard in durable state.
- Durable state JSON-serializable plain objects only; round-trips via exportState/importState.
- **Acceptance bar:** registering the projection does NOT modify `RuntimeCollectorImpl` orchestration (dispatch/checkpoint) beyond the snapshot assembly for the new typed field.
- Commit convention: `feat(capabilities): ...` with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---
---

### Task 1: `CapabilityProjection` builder

**Files:**
- Create: `src/tui/runtime/capability-projection.ts`
- Create: `tests/tui/runtime/capability-projection.vitest.ts`

**Interfaces:**
- Consumes: `DurableProjectionBuilder<TSnapshot>` (`durable-projection-builder.ts`), `ProjectionState` (`projection-state.js`), `AlixEvent` (`events/types.js`).
- Produces (Task 2/3 depend on these):
  ```ts
  export interface CapabilityStat {
    readonly capabilityId: string;
    readonly invocationCount: number;
    readonly invocationSucceeded: number;
    readonly invocationFailed: number;
    readonly invocationCancelled: number;
    readonly invocationTotalDurationMs: number;
    readonly lastInvocationAt: number | null;
    readonly toolInvocationCount: number;
    readonly toolFailureCount: number;
    readonly toolDurationMs: number;
  }
  export interface CapabilityProjectionSnapshot {
    readonly capabilities: Readonly<Record<string, CapabilityStat>>;  // keyed by capabilityId
    readonly activeInvocations: number;                                // openByKey.size
  }
  export class CapabilityProjection implements DurableProjectionBuilder<CapabilityProjectionSnapshot> {
    update(events: readonly AlixEvent[]): void;
    snapshot(): CapabilityProjectionSnapshot;
    reset(): void;
    exportState(): ProjectionState;
    importState(state: ProjectionState): void;
  }
  ```

- [ ] **Step 1: Write the failing test** `tests/tui/runtime/capability-projection.vitest.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CapabilityProjection } from '../../../src/tui/runtime/capability-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  // capability.* events carry `at` in the payload; tool events carry `timestamp`.
  return { id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(at).toISOString(), type, actor: 'system', payload: { ...payload, at } };
}

describe('CapabilityProjection', () => {
  it('reconciles invocation lifecycle into per-capability stats', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'filesystem.read' }, 1, 1000)]);
    p.update([evt('capability.InvocationCompleted', { invocationId: 'i1' }, 2, 3000)]);
    const s = p.snapshot();
    const stat = s.capabilities['filesystem.read']!;
    expect(stat.invocationCount).toBe(1);
    expect(stat.invocationSucceeded).toBe(1);
    expect(stat.invocationTotalDurationMs).toBe(2000);   // 3000 − 1000
    expect(s.activeInvocations).toBe(0);
  });

  it('tracks active invocations and computes duration on failure', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'shell.exec' }, 1, 1000)]);
    expect(p.snapshot().activeInvocations).toBe(1);
    p.update([evt('capability.InvocationFailed', { invocationId: 'i1', error: 'boom' }, 2, 2500)]);
    const stat = p.snapshot().capabilities['shell.exec']!;
    expect(stat.invocationFailed).toBe(1);
    expect(stat.invocationTotalDurationMs).toBe(1500);
    expect(p.snapshot().activeInvocations).toBe(0);
  });

  it('terminal without start is a no-op (strictly single-pass)', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationCompleted', { invocationId: 'ghost' }, 1, 1000)]);
    expect(p.snapshot()).toEqual({ capabilities: {}, activeInvocations: 0 });
  });

  it('a Started arriving after its terminal does NOT retroactively reconstruct', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationFailed', { invocationId: 'i1', error: 'x' }, 1, 1000)]);
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'repo.read' }, 2, 2000)]);
    // The late Started creates a NEW open invocation (i1 now open again), not a
    // reconstruction of the failed one. The failed terminal left no stat.
    expect(p.snapshot().activeInvocations).toBe(1);   // the late Started is now open
  });

  it('tracks tool telemetry as a separate non-overlapping counter set', () => {
    const p = new CapabilityProjection();
    p.update([
      evt('tool.requested', { toolCallId: 't1', toolName: 'read', capability: 'file.read', canonicalCapability: 'filesystem.read' }, 1, 1000),
      evt('tool.completed', { toolCallId: 't1', toolName: 'read', canonicalCapability: 'filesystem.read', durationMs: 500 }, 2, 1500),
    ]);
    const stat = p.snapshot().capabilities['filesystem.read']!;
    expect(stat.toolInvocationCount).toBe(1);
    expect(stat.toolDurationMs).toBe(500);
    expect(stat.invocationCount).toBe(0);   // invocation stream untouched
  });

  it('unknown capabilities appear (history outlives the registry)', () => {
    const p = new CapabilityProjection();
    p.update([evt('tool.completed', { toolCallId: 't1', toolName: 'x', canonicalCapability: 'foo.bar', durationMs: 10 }, 1, 1000)]);
    expect(p.snapshot().capabilities['foo.bar']!.toolInvocationCount).toBe(1);
  });

  it('exportState/importState round-trips durable state', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000)]);
    p.update([evt('tool.completed', { toolCallId: 't1', canonicalCapability: 'a.b', durationMs: 5 }, 2, 1500)]);
    const state = p.exportState();
    const p2 = new CapabilityProjection();
    p2.importState(state);
    expect(p2.snapshot()).toEqual(p.snapshot());
  });

  it('rejects non-monotonic events (deterministic replay)', () => {
    const p = new CapabilityProjection();
    p.update([evt('tool.completed', { toolCallId: 't1', canonicalCapability: 'a.b', durationMs: 1 }, 1, 1000)]);
    expect(() => p.update([evt('tool.completed', { toolCallId: 't2', canonicalCapability: 'a.b', durationMs: 1 }, 1, 1000)])).toThrow(/non-monotonic/);
  });

  it('reset clears everything', () => {
    const p = new CapabilityProjection();
    p.update([evt('capability.InvocationStarted', { invocationId: 'i1', capabilityId: 'a.b' }, 1, 1000)]);
    p.reset();
    expect(p.snapshot()).toEqual({ capabilities: {}, activeInvocations: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/capability-projection.vitest.ts`
Expected: FAIL — module `capability-projection.js` not found.

- [ ] **Step 3: Write the implementation** `src/tui/runtime/capability-projection.ts`

```ts
import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState } from './projection-state.js';

export interface CapabilityStat {
  readonly capabilityId: string;
  readonly invocationCount: number;
  readonly invocationSucceeded: number;
  readonly invocationFailed: number;
  readonly invocationCancelled: number;
  readonly invocationTotalDurationMs: number;
  readonly lastInvocationAt: number | null;
  readonly toolInvocationCount: number;
  readonly toolFailureCount: number;
  readonly toolDurationMs: number;
}

export interface CapabilityProjectionSnapshot {
  readonly capabilities: Readonly<Record<string, CapabilityStat>>;
  readonly activeInvocations: number;
}

/** Strict timestamp parse — malformed timestamps break deterministic replay. */
function parseAt(e: AlixEvent, fallbackField: 'at' | 'timestamp'): number {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const raw = fallbackField === 'at' ? p.at : e.timestamp;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(t)) throw new Error(`capability projection: invalid timestamp on seq ${e.seq}`);
  return t;
}

const INVOCATION_TERMINAL = new Set(['capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled']);
const TOOL_TERMINAL = new Set(['tool.completed', 'tool.failed']);

function zeroStat(capabilityId: string): CapabilityStat {
  return {
    capabilityId,
    invocationCount: 0, invocationSucceeded: 0, invocationFailed: 0, invocationCancelled: 0,
    invocationTotalDurationMs: 0, lastInvocationAt: null,
    toolInvocationCount: 0, toolFailureCount: 0, toolDurationMs: 0,
  };
}

interface InvocationLifecycle {
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly startedAt: number;
}

/**
 * Lifecycle-reconciliation projection over capability invocations (primary)
 * + tool telemetry (complementary, never merged). Two independent streams:
 *   - Invocation lifecycle: capability.InvocationStarted/Completed/Failed/Cancelled.
 *   - Tool telemetry: tool.requested/completed/failed (canonicalCapability).
 * Strictly single-pass: a terminal without its Started is a no-op; a late
 * Started after its terminal does NOT retroactively reconstruct. Unknown
 * capabilities appear (history outlives the registry). Never queries the
 * CapabilityRegistry — independent read model sharing only capabilityId.
 * Deterministic replay: no Date.now(); strict timestamp parse; lastSeq guard.
 */
export class CapabilityProjection implements DurableProjectionBuilder<CapabilityProjectionSnapshot> {
  private readonly stats = new Map<string, CapabilityStat>();
  private readonly open = new Map<string, InvocationLifecycle>();   // key: invocationId
  private lastSeq = 0;

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      if (e.seq < this.lastSeq) throw new Error(`capability projection: non-monotonic event sequence (${e.seq} < ${this.lastSeq})`);
      this.lastSeq = e.seq;
      if (e.type === 'capability.InvocationStarted') {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        const capabilityId = typeof p.capabilityId === 'string' ? p.capabilityId : undefined;
        if (!invocationId || !capabilityId) continue;
        this.open.set(invocationId, { invocationId, capabilityId, startedAt: parseAt(e, 'at') });
        continue;
      }
      if (INVOCATION_TERMINAL.has(e.type)) {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const invocationId = typeof p.invocationId === 'string' ? p.invocationId : undefined;
        if (!invocationId) continue;
        const open = this.open.get(invocationId);
        if (!open) continue;   // terminal without start → no-op
        const endedAt = parseAt(e, 'at');
        const stat = this.touch(open.capabilityId);
        stat.invocationCount++;
        if (e.type === 'capability.InvocationCompleted') stat.invocationSucceeded++;
        else if (e.type === 'capability.InvocationFailed') stat.invocationFailed++;
        else stat.invocationCancelled++;
        stat.invocationTotalDurationMs += Math.max(0, endedAt - open.startedAt);
        stat.lastInvocationAt = Math.max(stat.lastInvocationAt ?? 0, endedAt);
        this.open.delete(invocationId);
        continue;
      }
      if (e.type === 'tool.requested' || e.type === 'tool.completed' || e.type === 'tool.failed') {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const cap = typeof p.canonicalCapability === 'string' ? p.canonicalCapability : undefined;
        if (!cap) continue;
        const stat = this.touch(cap);
        if (e.type === 'tool.completed' || e.type === 'tool.failed') {
          stat.toolInvocationCount++;
          if (e.type === 'tool.failed') stat.toolFailureCount++;
          const dur = p.durationMs;
          if (typeof dur === 'number') stat.toolDurationMs += dur;
        }
      }
    }
  }

  snapshot(): CapabilityProjectionSnapshot {
    const capabilities: Record<string, CapabilityStat> = Object.create(null);
    for (const [id, stat] of this.stats) capabilities[id] = { ...stat };
    return { capabilities, activeInvocations: this.open.size };
  }

  reset(): void {
    this.stats.clear();
    this.open.clear();
    this.lastSeq = 0;
  }

  exportState(): ProjectionState {
    return {
      version: 1,
      stats: [...this.stats.entries()].map(([id, s]) => ({ id, stat: { ...s } })),
      open: [...this.open.entries()].map(([id, lc]) => ({ id, lifecycle: { ...lc } })),
      lastSeq: this.lastSeq,
    };
  }

  importState(state: ProjectionState): void {
    const s = state as { version?: unknown; stats?: unknown; open?: unknown; lastSeq?: unknown };
    if (s?.version !== 1 || !Array.isArray(s.stats) || !Array.isArray(s.open) || typeof s.lastSeq !== 'number') {
      throw new Error('capability projection state: invalid or unsupported version');
    }
    // Validate BEFORE mutating.
    for (const { id, stat } of s.stats as Array<{ id: unknown; stat: unknown }>) {
      if (typeof id !== 'string' || typeof stat !== 'object' || stat === null) throw new Error('capability projection state: malformed stat');
    }
    for (const { id, lifecycle } of s.open as Array<{ id: unknown; lifecycle: unknown }>) {
      const lc = lifecycle as Partial<InvocationLifecycle>;
      if (typeof id !== 'string' || typeof lc !== 'object' || lc === null || typeof lc.capabilityId !== 'string' || typeof lc.startedAt !== 'number') {
        throw new Error('capability projection state: malformed open lifecycle');
      }
    }
    this.stats.clear();
    this.open.clear();
    for (const { id, stat } of s.stats as Array<{ id: string; stat: CapabilityStat }>) this.stats.set(id, { ...stat });
    for (const { id, lifecycle } of s.open as Array<{ id: string; lifecycle: InvocationLifecycle }>) this.open.set(id, { ...lifecycle });
    this.lastSeq = s.lastSeq;
  }

  private touch(capabilityId: string): CapabilityStat {
    let stat = this.stats.get(capabilityId);
    if (!stat) { stat = zeroStat(capabilityId); this.stats.set(capabilityId, stat); }
    return stat;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/capability-projection.vitest.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tui/runtime/capability-projection.ts tests/tui/runtime/capability-projection.vitest.ts
git commit -m "feat(capabilities): CapabilityProjection builder — invocation lifecycle + tool telemetry (Increment A)"
```

---
---

### Task 2: Register + snapshot field

**Files:**
- Modify: `src/tui/runtime/projection-ids.ts` (add `capability`)
- Modify: `src/tui/runtime-collector.ts` (snapshot assembly — add `capabilities` field)
- Modify: `src/tui/snapshot.ts` (add `capabilities` to `RuntimeSnapshot`)
- Modify: `src/cli/commands/tui.ts` (register `capability` on the outer runtime collector)
- Modify: `tests/tui/runtime/runtime-collector.vitest.ts` (assert `snapshot.capabilities` present)

**Interfaces:**
- Consumes: `CapabilityProjection` + `CapabilityProjectionSnapshot` (Task 1).
- Produces: `RuntimeSnapshot.capabilities: CapabilityProjectionSnapshot | null`; `ProjectionIds.capability = 'capability'`.

- [ ] **Step 1: Add the id** — `src/tui/runtime/projection-ids.ts`: add `capability: 'capability'` to `ProjectionIds`.

- [ ] **Step 2: Add the snapshot field** — `src/tui/snapshot.ts` `RuntimeSnapshot`: add
```ts
  /** Per-capability runtime activity stats (CapabilityProjection). Null when the
   *  projection isn't registered (e.g. older collectors). */
  readonly capabilities: CapabilityProjectionSnapshot | null;
```
Add `import type { CapabilityProjectionSnapshot } from './runtime/capability-projection.js';`.

- [ ] **Step 3: Wire in `RuntimeCollectorImpl.sample()`** — in the `nextCache` assembly (the block with `trace`/`timeline`), add:
```ts
        capabilities: this.projectionRuntime.snapshotOf<CapabilityProjectionSnapshot>(ProjectionIds.capability) ?? null,
```
(Import `CapabilityProjectionSnapshot` type + `ProjectionIds` — `ProjectionIds` is already imported from Task 3 of Phase 7.)

- [ ] **Step 4: Register in `tui.ts`** — on the OUTER runtime collector's `createProjectionRuntime` tuple, add `[ProjectionIds.capability, new CapabilityProjection()]` after approval. Import `CapabilityProjection`.

- [ ] **Step 5: Add an assertion to the collector test** — `tests/tui/runtime/runtime-collector.vitest.ts`: after a sample with a capability invocation, assert `snapshot.capabilities` is populated (or `{ capabilities: {}, activeInvocations: 0 }` when none). Keep it minimal — the projection's own tests cover the semantics; this pins the field wiring.

- [ ] **Step 6: Run + typecheck**

Run: `npx vitest run tests/tui/runtime` (all green) and `npx tsc -p tsconfig.json --noEmit`. Do NOT run the full repo suite (pre-existing `tests/run/plan-approval.vitest.ts` vim-spawn hang).

- [ ] **Step 7: Verify the acceptance bar** — `git diff HEAD --stat` shows NO change to the collector's dispatch/checkpoint logic (only the snapshot assembly line) — the projection was added with zero orchestration changes.

- [ ] **Step 8: Commit**

```bash
git add src/tui/runtime/projection-ids.ts src/tui/runtime-collector.ts src/tui/snapshot.ts src/cli/commands/tui.ts tests/tui/runtime/runtime-collector.vitest.ts
git commit -m "feat(capabilities): register CapabilityProjection + expose RuntimeSnapshot.capabilities (Increment A)"
```

---
---

### Task 3: Capabilities-tab activity panel

**Files:**
- Modify: `src/tui/capabilities/capabilities-view.ts` (renderDetail — append Activity block)
- Modify: `tests/tui/capabilities/capabilities-view.vitest.ts` (if exists; otherwise a render test)

**Interfaces:**
- Consumes: `ctx.snap.runtime?.capabilities` (the outer collector's `RuntimeSnapshot.capabilities`, from Task 2) + the selected capability's `id` (`ctx.perTab.capabilitiesSelectedId`).
- Produces: the detail pane shows the selected capability's activity stats.

- [ ] **Step 1: Append the Activity block to `renderDetail`**

`renderDetail` (`src/tui/capabilities/capabilities-view.ts:74`) currently takes `(c, detail, x, y, w, h)` and is called from `render(ctx)` at line 69 with `(c, detail, listW + 1, 4, ...)`. It does NOT receive `ctx` — the minimal change is to thread the snapshot: change the signature to `renderDetail(c, detail, x, y, w, h, snap: DashboardSnapshot)` and pass `ctx.snap` at the call site. Then, after the existing metadata lines, add an Activity section when `detail.id` has a stat:
```ts
    const stat = snap.runtime?.capabilities?.capabilities?.[detail.id];
    if (stat) {
      lines.push('');
      lines.push(`activity: ${stat.invocationCount} invocations`);
      lines.push(`  succeeded: ${stat.invocationSucceeded}  failed: ${stat.invocationFailed}  cancelled: ${stat.invocationCancelled}`);
      lines.push(`  avg duration: ${stat.invocationCount ? Math.round(stat.invocationTotalDurationMs / stat.invocationCount) : '—'}ms`);
      lines.push(`  last: ${stat.lastInvocationAt ? new Date(stat.lastInvocationAt).toISOString() : '—'}`);
      lines.push(`  tool telemetry: ${stat.toolInvocationCount} uses, ${stat.toolFailureCount} failures, ${stat.toolDurationMs}ms`);
    }
```
> Note: `activeInvocations` is on the SNAPSHOT (top-level), NOT per-stat — show it as a tab-level header line in `render()` (Step 2), not per-capability.

- [ ] **Step 2: Render the active-invocations count** — in `render()`, after the header/search line, add a line showing `ctx.snap.runtime?.capabilities?.activeInvocations ?? 0`.

- [ ] **Step 3: Write/adjust a render test** — if `tests/tui/capabilities/capabilities-view.vitest.ts` exists, add a case: a view with a `capabilities` stat for the selected id renders the activity lines; without a service, still guards. If no test file exists, add a focused one verifying `renderDetail` with a stat produces the activity text.

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run tests/tui` (capabilities view tests) and `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/capabilities/capabilities-view.ts tests/tui/capabilities/capabilities-view.vitest.ts
git commit -m "feat(capabilities): Capabilities-tab activity panel for CapabilityProjection (Increment A)"
```

---
---

## Self-Review Checklist (controller runs before execution)

1. **Spec coverage** — every spec section has a task: lifecycle-reconciliation builder with two complementary streams (T1), keyed snapshot + activeInvocations (T1), durable state with lastSeq + strict single-pass + unknown-capabilities-appear + never-queries-registry (T1), registration + RuntimeSnapshot.capabilities typed field (T2), Capabilities-tab activity panel (T3), acceptance bar (T2 Step 7).
2. **Placeholder scan** — all steps carry real code; the Task-3 note tells the implementer the exact signature change (thread `snap` into `renderDetail`) and the `activeInvocations`-is-tab-level nuance.
3. **Type consistency** — `CapabilityProjectionSnapshot { capabilities: Readonly<Record<string, CapabilityStat>>, activeInvocations: number }` flows T1→T2→T3; `RuntimeSnapshot.capabilities` matches; `ProjectionIds.capability` used everywhere; `CapabilityStat` field names consistent across T1/T3 (invocationCount/invocationSucceeded/.../toolInvocationCount/toolFailureCount/toolDurationMs).
