# ALiX Capability Platform Phase 4 — Execution Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Runtime tab from a flat `actor:type` event list into a structured, lifecycle-aware Execution Trace — a projection over the append-only `EventLog` grouped into operator-meaningful lifecycle units (tool runs, policy verdicts, capability invocations, runtime transitions), with client-side filtering.

**Architecture:** A pure `ExecutionTraceBuilder` converts `AlixEvent[]` into immutable `ExecutionTraceEntry[]` lifecycle units; an `ExecutionTraceWindow` applies retention (running entries never evicted; terminal keep-last-50, terminal-oldest→newest then running appended); `RuntimeCollectorImpl` orchestrates the pipeline into `RuntimeSnapshot.trace`; `RuntimeView` renders the DTOs with a view-local filter. The operator timeline (`timelineEvents[]`) is untouched.

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing TUI collector/snapshot/view system.

## Global Constraints

- **`src/capability/*` is NOT modified.** (Phase-1 invariant 9.)
- **`timelineEvents[]` and its views are untouched** — the operator narrative stays on its own stream (Phase-3 boundary, D3).
- **`RuntimeView` never calls `EventLog` and never interprets raw events** — dependency chain is `EventLog → RuntimeCollector → RuntimeSnapshot → RuntimeView`.
- **`ExecutionTraceBuilder` consumes EventLog facts only** — never reads `timelineEvents[]` or capability presenters (D10).
- **Trace entries are immutable, detached DTOs** — `readonly` fields; the builder never mutates `AlixEvent`s and never returns references into `EventLog` payloads. `RuntimeView` never mutates entries (D8).
- **Running entries are never evicted; retention is by lifecycle units, never raw events** (D4/D5).
- NodeNext ESM (`import ... from "./x.js"`), strict TS, vitest.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

## Event-type inventory (ground truth for the builder)

The builder groups these `AlixEvent.type` strings (already flowing into the EventLog):

| Kind | Event types |
|---|---|
| **tool** | `tool.requested`, `tool.started`, `tool.output`, `tool.completed`, `tool.failed` (TOOL_EVENT_TYPES) |
| **policy** | `policy.decision`, `approval.requested`, `approval.resolved` (POLICY_EVENT_TYPES); `patch.checkpoint_created`, `patch.rollback_started`, `patch.rollback_completed`, `patch.rollback_failed` |
| **capability** | `capability.InvocationStarted`, `capability.InvocationProgress`, `capability.InvocationOutput`, `capability.InvocationCompleted`, `capability.InvocationFailed`, `capability.InvocationCancelled` (from the `toAlixEvent` bridge) |
| **runtime** | `runtime.phase.started`, `runtime.phase.completed`, `agent.session.phase_changed`, `workflow.created`, `workflow.completed` |

Payload fields of interest (all defensive reads): tool events carry `toolCallId`, `toolName`, `status`, `durationMs`, `outputPreview`, `outputSize`, `error`; capability events carry `invocationId`, `capabilityId`, `error`; policy `policy.decision` carries an allow/deny verdict field; runtime phase events carry a phase name.

---

### Task 1: Trace contracts

**Files:**
- Create: `src/tui/runtime/execution-trace.ts`
- Test: `tests/tui/runtime/execution-trace.vitest.ts`

**Interfaces:**
- Produces: `ExecutionTraceKind`, `ExecutionTraceStatus`, `ExecutionTraceEntry`, `ExecutionTraceWindow` (all below). Tasks 2-6 consume these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/runtime/execution-trace.vitest.ts
import { describe, it, expect } from 'vitest';
import type { ExecutionTraceEntry, ExecutionTraceWindow } from '../../src/tui/runtime/execution-trace.js';

describe('ExecutionTraceEntry contract', () => {
  it('is a readonly DTO (type-level: assigning a readonly field must fail to compile)', () => {
    const e: ExecutionTraceEntry = {
      id: 'tr-1', kind: 'tool', status: 'completed',
      title: 'tool.search', startedAt: 1000, durationMs: 183,
      sourceEvents: { firstSequence: 1, lastSequence: 4 },
    };
    expect(e.id).toBe('tr-1');
    expect(e.kind).toBe('tool');
    expect(e.sourceEvents.firstSequence).toBe(1);
  });

  it('allows optional fields to be omitted', () => {
    const e: ExecutionTraceEntry = {
      id: 'tr-2', kind: 'runtime', status: 'running',
      title: 'workflow', startedAt: 2000,
      sourceEvents: { firstSequence: 10 },
    };
    expect(e.completedAt).toBeUndefined();
    expect(e.sourceEvents.lastSequence).toBeUndefined();
  });
});

describe('ExecutionTraceWindow interface', () => {
  it('declares apply(entries) → readonly entries', () => {
    const w: ExecutionTraceWindow = { apply: (es) => es };
    const input: ExecutionTraceEntry[] = [];
    const out = w.apply(input);
    expect(out).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/execution-trace.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the contracts file**

```typescript
// src/tui/runtime/execution-trace.ts

/** What kind of execution a trace entry represents. */
export type ExecutionTraceKind = 'tool' | 'policy' | 'capability' | 'runtime';

/** Lifecycle state of an execution trace entry. */
export type ExecutionTraceStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * One lifecycle unit of execution telemetry. Immutable, detached DTO: the
 * builder copies fields out of the raw EventLog events; nothing here holds a
 * reference into an AlixEvent payload. `RuntimeView` renders these and never
 * mutates them.
 */
export interface ExecutionTraceEntry {
  /** Runtime-local deterministic id (e.g. `tr-${seq}`). NOT durable across
   *  sessions; if replay/persistence arrives, `sessionId + sequence` becomes
   *  the durable identity. */
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

/**
 * Retention policy over lifecycle entries. No builder logic, no EventLog
 * knowledge, no timestamp interpretation — only retention:
 *   - open (`running`) entries are NEVER evicted;
 *   - terminal entries render oldest→newest, then open entries appended after;
 *   - at most `maxTerminal` terminal entries are kept (default 50).
 */
export interface ExecutionTraceWindow {
  apply(entries: readonly ExecutionTraceEntry[]): readonly ExecutionTraceEntry[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/execution-trace.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/runtime/execution-trace.ts tests/tui/runtime/execution-trace.vitest.ts
git commit -m "feat(capabilities): execution trace contracts — kind/status/entry/window"
```

---

### Task 2: Pure builder + window implementation

**Files:**
- Create: `src/tui/runtime/execution-trace-builder.ts`
- Test: `tests/tui/runtime/execution-trace-builder.vitest.ts`

**Interfaces:**
- Consumes: `ExecutionTraceEntry`, `ExecutionTraceKind`, `ExecutionTraceStatus`, `ExecutionTraceWindow` (Task 1); `AlixEvent` from `src/events/types.js`.
- Produces: `buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[]`, `createExecutionTraceWindow(maxTerminal?: number): ExecutionTraceWindow`, `computeExecutionTrace(events, window): ExecutionTraceEntry[]` (the builder+window composition the collector calls).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/runtime/execution-trace-builder.vitest.ts
import { describe, it, expect } from 'vitest';
import {
  buildExecutionTrace, createExecutionTraceWindow, computeExecutionTrace,
} from '../../src/tui/runtime/execution-trace-builder.js';
import type { AlixEvent } from '../../src/events/types.js';

let seq = 0;
function evt(type: string, payload: Record<string, unknown> = {}): AlixEvent {
  return {
    id: `e${++seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(),
    type, actor: 'system', payload,
  };
}

describe('buildExecutionTrace', () => {
  it('collapses a tool lifecycle into ONE completed entry with duration + sourceEvents range', () => {
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.output', { toolCallId: 'tc1', outputPreview: 'state.ts', outputSize: 9 }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 183 }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.kind).toBe('tool');
    expect(e.status).toBe('completed');
    expect(e.title).toBe('tool.search');
    expect(e.durationMs).toBe(183);
    expect(e.sourceEvents.firstSequence).toBe(1);
    expect(e.sourceEvents.lastSequence).toBe(3);
  });

  it('marks a tool with no terminal event as running (open lifecycle)', () => {
    const entries = buildExecutionTrace([evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('running');
    expect(entries[0]!.sourceEvents.lastSequence).toBeUndefined();
  });

  it('collapses policy.decision into one verdict entry', () => {
    const entries = buildExecutionTrace([evt('policy.decision', { allowed: true, rule: 'r1' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('policy');
    expect(entries[0]!.status).toBe('completed');
  });

  it('tracks capability lifecycle open→terminal', () => {
    const events = [
      evt('capability.InvocationStarted', { invocationId: 'inv1', capabilityId: 'core.session.list' }),
      evt('capability.InvocationCompleted', { invocationId: 'inv1', at: 2 }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('capability');
    expect(entries[0]!.status).toBe('completed');
    expect(entries[0]!.title).toBe('core.session.list');
  });

  it('turns runtime.phase.started/completed into one runtime entry', () => {
    const events = [
      evt('runtime.phase.started', { phase: 'planning' }),
      evt('runtime.phase.completed', { phase: 'planning' }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('runtime');
    expect(entries[0]!.status).toBe('completed');
  });

  it('outputs detached DTOs — mutating an entry does not touch the source events', () => {
    const events = [evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })];
    const entries = buildExecutionTrace(events);
    (entries[0] as { title: string }).title = 'mutated';
    expect(events[0]!.payload.toolName).toBe('search');
  });
});

describe('createExecutionTraceWindow', () => {
  function entry(id: string, status: 'running' | 'completed', first: number): { id: string; status: string; kind: string; title: string; startedAt: number; sourceEvents: { firstSequence: number } } {
    return { id, kind: 'tool', title: 't', startedAt: first, status, sourceEvents: { firstSequence: first } } as never;
  }

  it('never evicts running entries and bounds terminal to maxTerminal', () => {
    const w = createExecutionTraceWindow(2);
    const out = w.apply([
      entry('c1', 'completed', 1), entry('c2', 'completed', 2), entry('c3', 'completed', 3),
      entry('r1', 'running', 4),
    ] as never);
    expect(out.map(e => (e as { id: string }).id)).toEqual(['c2', 'c3', 'r1']);
  });

  it('orders terminal oldest→newest then running appended after', () => {
    const w = createExecutionTraceWindow(50);
    const out = w.apply([
      entry('r1', 'running', 5), entry('c2', 'completed', 2), entry('c1', 'completed', 1),
    ] as never);
    expect(out.map(e => (e as { id: string }).id)).toEqual(['c1', 'c2', 'r1']);
  });
});

describe('computeExecutionTrace', () => {
  it('runs build then window', () => {
    const w = createExecutionTraceWindow(50);
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const out = computeExecutionTrace(events, w);
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the builder**

```typescript
// src/tui/runtime/execution-trace-builder.ts
import type { AlixEvent } from '../events/types.js';
import type { ExecutionTraceEntry, ExecutionTraceKind, ExecutionTraceWindow } from './execution-trace.js';

let traceSeq = 0;
function nextTraceId(): string { return `tr-${++traceSeq}`; }

const TOOL_TYPES = new Set(['tool.requested', 'tool.started', 'tool.output', 'tool.completed', 'tool.failed']);
const POLICY_TYPES = new Set(['policy.decision', 'approval.requested', 'approval.resolved', 'patch.checkpoint_created', 'patch.rollback_started', 'patch.rollback_completed', 'patch.rollback_failed']);
const CAPABILITY_TYPES = new Set(['capability.InvocationStarted', 'capability.InvocationProgress', 'capability.InvocationOutput', 'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled']);
const RUNTIME_TYPES = new Set(['runtime.phase.started', 'runtime.phase.completed', 'agent.session.phase_changed', 'workflow.created', 'workflow.completed']);

// Terminal event types terminate an open lifecycle. NOTE: capability bridge
// events are PascalCase after the dot (capability.InvocationCompleted), so
// string-suffix matching must not assume lowercase.
const TERMINAL_TYPES = new Set([
  'tool.completed', 'tool.failed',
  'policy.decision', 'approval.resolved', 'patch.rollback_completed', 'patch.rollback_failed',
  'capability.InvocationCompleted', 'capability.InvocationFailed', 'capability.InvocationCancelled',
  'runtime.phase.completed', 'workflow.completed',
]);

const STATUS_BY_TYPE: Record<string, ExecutionTraceEntry['status']> = {
  'tool.failed': 'failed',
  'capability.InvocationFailed': 'failed',
  'capability.InvocationCancelled': 'cancelled',
  'policy.decision': 'completed',
  'approval.resolved': 'completed',
  'patch.rollback_completed': 'completed',
  'patch.rollback_failed': 'failed',
  'tool.completed': 'completed',
  'capability.InvocationCompleted': 'completed',
  'runtime.phase.completed': 'completed',
  'workflow.completed': 'completed',
};

interface OpenLifecycle {
  kind: ExecutionTraceKind;
  key: string;              // toolCallId / invocationId / phase / workflowId
  title: string;
  startedAt: number;
  firstSequence: number;
  lastSequence: number;
}

function kindOf(type: string): ExecutionTraceKind | null {
  if (TOOL_TYPES.has(type)) return 'tool';
  if (POLICY_TYPES.has(type)) return 'policy';
  if (CAPABILITY_TYPES.has(type)) return 'capability';
  if (RUNTIME_TYPES.has(type)) return 'runtime';
  return null;
}

/** Extract a stable grouping key for an event of a given kind. */
function keyOf(type: string, payload: Record<string, unknown>): string {
  if (type.startsWith('capability.')) return String(payload.invocationId ?? payload.capabilityId ?? '?');
  if (type.startsWith('tool.')) return String(payload.toolCallId ?? '?');
  if (type.startsWith('runtime.phase')) return String(payload.phase ?? '?');
  if (type === 'agent.session.phase_changed') return 'phase';
  if (type === 'workflow.created' || type === 'workflow.completed') return 'workflow';
  return String(payload.proposalId ?? payload.rule ?? '?');
}

/** Build a one-line title for a lifecycle unit from its first (open) event. */
function titleOf(kind: ExecutionTraceKind, type: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'tool': return `tool.${payload.toolName ?? payload.toolCallId ?? '?'}`;
    case 'capability': return String(payload.capabilityId ?? payload.invocationId ?? '?');
    case 'policy': return type === 'policy.decision' ? 'Policy decision' : 'Approval';
    case 'runtime': return String(payload.phase ?? payload.workflowId ?? 'phase');
  }
}

/**
 * Pure: group AlixEvents into lifecycle units. Groups over the complete
 * known history (the collector passes readAll()). Does NOT mutate AlixEvents
 * and does NOT return references into their payloads — fields are copied.
 * Entries are assembled oldest→newest by first event; open lifecycles get
 * status 'running' when no terminal event is present.
 */
export function buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[] {
  const open = new Map<string, OpenLifecycle>();
  const done: ExecutionTraceEntry[] = [];

  for (const e of events) {
    const kind = kindOf(e.type);
    if (!kind) continue;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const key = keyOf(e.type, payload);
    const seqNum = e.seq ?? 0;
    const ts = Date.parse(e.timestamp) || 0;

    const isTerminal = TERMINAL_TYPES.has(e.type);

    if (!isTerminal) {
      // Open the lifecycle (or keep the earliest open on repeat start events).
      if (!open.has(`${kind}:${key}`)) {
        open.set(`${kind}:${key}`, {
          kind, key, title: titleOf(kind, e.type, payload),
          startedAt: ts, firstSequence: seqNum, lastSequence: seqNum,
        });
      } else {
        const o = open.get(`${kind}:${key}`)!;
        o.lastSequence = Math.max(o.lastSequence, seqNum);
      }
      continue;
    }

    const o = open.get(`${kind}:${key}`);
    const status: ExecutionTraceEntry['status'] = STATUS_BY_TYPE[e.type] ?? 'completed';
    if (o) {
      const detail = typeof payload.outputPreview === 'string' ? payload.outputPreview
        : typeof payload.error === 'string' ? payload.error
          : typeof payload.phase === 'string' ? payload.phase : undefined;
      done.push({
        id: nextTraceId(), kind, status, title: o.title, detail,
        startedAt: o.startedAt, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : Math.max(0, ts - o.startedAt),
        sourceEvents: { firstSequence: o.firstSequence, lastSequence: Math.max(o.lastSequence, seqNum) },
      });
      open.delete(`${kind}:${key}`);
    } else {
      // A terminal event without a recorded open — synthesize a completed entry.
      done.push({
        id: nextTraceId(), kind, status, title: titleOf(kind, e.type, payload),
        startedAt: ts, completedAt: ts, durationMs: 0,
        sourceEvents: { firstSequence: seqNum, lastSequence: seqNum },
      });
    }
  }

  // Any remaining open lifecycles become 'running' entries, oldest first.
  for (const o of [...open.values()].sort((a, b) => a.firstSequence - b.firstSequence)) {
    done.push({
      id: nextTraceId(), kind: o.kind, status: 'running', title: o.title,
      startedAt: o.startedAt,
      sourceEvents: { firstSequence: o.firstSequence, lastSequence: o.lastSequence },
    });
  }

  return done;
}

/** Retention policy: running never evicted; terminal oldest→newest then running appended; maxTerminal bound. */
export function createExecutionTraceWindow(maxTerminal = 50): ExecutionTraceWindow {
  return {
    apply(entries) {
      const terminal = entries.filter((e) => e.status !== 'running');
      const running = entries.filter((e) => e.status === 'running');
      const keptTerminal = terminal.slice(-Math.max(0, maxTerminal));
      return [...keptTerminal, ...running];
    },
  };
}

/** Compose builder + window — the collector's entry point. */
export function computeExecutionTrace(
  events: readonly AlixEvent[],
  window: ExecutionTraceWindow = createExecutionTraceWindow(),
): ExecutionTraceEntry[] {
  return window.apply(buildExecutionTrace(events));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

Run: `npx tsc -p tsconfig.json --noEmit`
```bash
git add src/tui/runtime/execution-trace-builder.ts tests/tui/runtime/execution-trace-builder.vitest.ts
git commit -m "feat(capabilities): pure execution-trace builder + window"
```

---

### Task 3: RuntimeCollector integration + snapshot trace

**Files:**
- Modify: `src/tui/snapshot.ts` (add `trace` to `RuntimeSnapshot`)
- Modify: `src/tui/runtime-collector.ts` (compute `trace` via `computeExecutionTrace`)
- Test: `tests/tui/runtime-collector.vitest.ts` (new — snapshot contains trace; poll failure preserves old snapshot)

**Interfaces:**
- Consumes: `computeExecutionTrace` (Task 2), `ExecutionTraceEntry` (Task 1).
- Produces: `RuntimeSnapshot.trace: readonly ExecutionTraceEntry[]` (added; `events` marked deprecated during migration).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/runtime-collector.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../src/tui/runtime-collector.js';
import type { EventLog } from '../../src/events/event-log.js';

function makeEventLog(readAll: () => Promise<unknown[]>): EventLog {
  return { readAll } as unknown as EventLog;
}

describe('RuntimeCollectorImpl trace integration', () => {
  it('populates snapshot.trace from the EventLog via the builder', async () => {
    const events = [
      { id: 'e1', seq: 1, version: 1, sessionId: 's', timestamp: new Date(1000).toISOString(), type: 'tool.started', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search' } },
      { id: 'e2', seq: 2, version: 1, sessionId: 's', timestamp: new Date(2000).toISOString(), type: 'tool.completed', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 100 } },
    ];
    const log = makeEventLog(async () => events);
    const collector = new RuntimeCollectorImpl(log);
    await (collector as unknown as { sample(): Promise<void> }).sample();
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('tool');
    expect(snap?.trace[0]!.status).toBe('completed');
  });

  it('keeps the previous snapshot on readAll failure', async () => {
    const log = makeEventLog(async () => [{ id: 'e1', seq: 1, version: 1, sessionId: 's', timestamp: new Date(1000).toISOString(), type: 'tool.started', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search' } }]);
    const collector = new RuntimeCollectorImpl(log);
    await (collector as unknown as { sample(): Promise<void> }).sample();
    const before = await collector.snapshot();
    expect(before?.trace).toHaveLength(1);

    const failing = makeEventLog(async () => { throw new Error('io'); });
    const collector2 = new RuntimeCollectorImpl(failing);
    await (collector2 as unknown as { sample(): Promise<void> }).sample();
    const after = await collector2.snapshot();
    expect(after).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: FAIL — `trace` does not exist on `RuntimeSnapshot` / module issues.

- [ ] **Step 3: Add `trace` to `RuntimeSnapshot` in `src/tui/snapshot.ts`**

```typescript
export interface RuntimeSnapshot {
  /** Deprecated during migration — consumers move to `trace`. Deleted after migration. */
  readonly events?: readonly RuntimeEventSnapshot[];
  /** Execution-trace lifecycle units, built from the EventLog. Immutable DTOs. */
  readonly trace: readonly ExecutionTraceEntry[];
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
}
```
Add the type import: `import type { ExecutionTraceEntry } from './runtime/execution-trace.js';`

- [ ] **Step 4: Compute `trace` in `src/tui/runtime-collector.ts`**

Update the import line to add `computeExecutionTrace`:
```typescript
import { computeExecutionTrace } from './runtime/execution-trace-builder.js';
```
Update the cache initializer and `sample()`:
```typescript
  private cache: RuntimeSnapshot = {
    trace: [],
    workflow: null,
    totalEventCount: 0,
    lastEventAt: null,
  };
```
```typescript
      const trace = computeExecutionTrace(events);
      this.cache = {
        events: mapped,            // deprecated during migration
        trace,
        workflow: computeWorkflow(events),
        totalEventCount: events.length,
        lastEventAt: mapped.length > 0 ? mapped[0].timestamp : null,
      };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts` (any test asserting `RuntimeSnapshot` equality may need `trace` added — fix those literals).
```bash
git add src/tui/snapshot.ts src/tui/runtime-collector.ts tests/tui/runtime-collector.vitest.ts
git commit -m "feat(capabilities): RuntimeCollector computes snapshot.trace"
```

---

### Task 4: RuntimeView migration + filter

**Files:**
- Modify: `src/tui/views/runtime-view.ts`
- Modify: `src/tui/state.ts` (add `runtimeTraceFilter` to `PerTabState` + `createInitialPerTabState`)
- Test: `tests/tui/views/runtime-view.vitest.ts` (new — filter renders subsets; summary intact)
- Test: `tests/tui/state.vitest.ts` (default filter + serializability)

**Interfaces:**
- Consumes: `RuntimeSnapshot.trace`, `ExecutionTraceEntry`, `ExecutionTraceKind` (Task 1/3).
- Produces: `RuntimeTraceFilter` type + `PerTabState.runtimeTraceFilter: RuntimeTraceFilter`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/views/runtime-view.vitest.ts
import { describe, it, expect } from 'vitest';
import { RuntimeView } from '../../../src/tui/views/runtime-view.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { ExecutionTraceEntry } from '../../../src/tui/runtime/execution-trace.js';

function makeTrace(): ExecutionTraceEntry[] {
  return [
    { id: 'tr-1', kind: 'tool', status: 'completed', title: 'tool.search', startedAt: 1, durationMs: 5, sourceEvents: { firstSequence: 1 } },
    { id: 'tr-2', kind: 'capability', status: 'completed', title: 'core.session.list', startedAt: 2, sourceEvents: { firstSequence: 2 } },
    { id: 'tr-3', kind: 'policy', status: 'completed', title: 'Policy decision', startedAt: 3, sourceEvents: { firstSequence: 3 } },
  ];
}

function render(perTab: ReturnType<typeof createInitialPerTabState>, trace: ExecutionTraceEntry[]): string {
  const canvas = new TerminalCanvas(80, 24);
  const view = new RuntimeView();
  const ctx = {
    snap: { runtime: { trace, workflow: null, totalEventCount: 3, lastEventAt: 3 } },
    dimensions: { columns: 80, rows: 24 },
    perTab,
    canvas,
  };
  view.render(ctx as never);
  return canvas.renderFrame();
}

describe('RuntimeView execution trace', () => {
  it('renders trace rows (not raw actor:type) with filter=all', () => {
    const perTab = createInitialPerTabState();
    const frame = render(perTab, makeTrace());
    expect(frame).toContain('tool.search');
    expect(frame).toContain('core.session.list');
    expect(frame).toContain('Policy decision');
  });

  it('filters to tool entries when runtimeTraceFilter=tool', () => {
    const perTab = createInitialPerTabState();
    perTab.runtimeTraceFilter = 'tool';
    const frame = render(perTab, makeTrace());
    expect(frame).toContain('tool.search');
    expect(frame).not.toContain('core.session.list');
    expect(frame).not.toContain('Policy decision');
  });

  it('keeps the summary header intact', () => {
    const perTab = createInitialPerTabState();
    const frame = render(perTab, makeTrace());
    expect(frame).toContain('RUNTIME');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/views/runtime-view.vitest.ts --config vitest.config.mts`
Expected: FAIL — `runtimeTraceFilter` missing / view still renders old flat list.

- [ ] **Step 3: Add the filter to `src/tui/state.ts`**

```typescript
/** Client-side filter for the Runtime tab's execution trace (view-local presentation state). */
export type RuntimeTraceFilter = 'all' | 'tool' | 'capability' | 'policy' | 'runtime';
```
Add to `PerTabState`:
```typescript
  /** Active execution-trace filter on the Runtime tab. Default 'all'. */
  runtimeTraceFilter: RuntimeTraceFilter;
```
Add to `createInitialPerTabState`: `runtimeTraceFilter: 'all',`.

- [ ] **Step 4: Migrate `src/tui/views/runtime-view.ts`**

Replace the `r.events` render block with a `r.trace` render block filtered by `ctx.perTab.runtimeTraceFilter`. The summary header (events count, workflow) stays. The scroll/pin logic carries over but over the filtered trace:

```typescript
    const filter = ctx.perTab.runtimeTraceFilter ?? 'all';
    const trace = r.trace.filter((e) => filter === 'all' || e.kind === filter);
    const pinned = ctx.perTab.pinnedBottom ?? true;
    const eventCount = trace.length;
    const reserved = r.workflow ? 4 : 1;
    const winSize = Math.max(3, dimensions.rows - reserved - 9);
    const maxStart = Math.max(0, eventCount - winSize);
    let start = ctx.perTab.scrollOffset;
    if (pinned) {
      start = maxStart;
    } else if (start > maxStart) {
      start = maxStart;
    }
    const visible = trace.slice(start, start + winSize);
    for (const e of visible) {
      const t = new Date(e.startedAt).toISOString().slice(11, 19);
      const statusIcon = e.status === 'completed' ? '✔'
        : e.status === 'failed' ? '✗'
          : e.status === 'cancelled' ? '◼' : '▶';
      const duration = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : '';
      rows.push(`  [${t}] ${statusIcon} ${e.title.padEnd(24, ' ')} ${e.status}${duration}${e.detail ? ` — ${e.detail}` : ''}`);
    }
```
Keep the canvas write (`writeRowsToCanvas(ctx.canvas, rows, 0, 4)`) and the `handleKey` scroll logic unchanged.

- [ ] **Step 5: Update `tests/tui/state.vitest.ts`**

The serializability + defaults fixtures that build `PerTabState` literals need `runtimeTraceFilter: 'all'` added (same mechanical pattern as `timelineEvents` in Phase 3).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/tui/views/runtime-view.vitest.ts tests/tui/state.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 7: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/views/runtime-view.ts src/tui/state.ts tests/tui/views/runtime-view.vitest.ts tests/tui/state.vitest.ts
git commit -m "feat(capabilities): RuntimeView renders execution trace with client-side filter"
```

---

### Task 5: Remove the deprecated flat event rendering

**Files:**
- Modify: `src/tui/snapshot.ts` (delete `RuntimeEventSnapshot`, remove `events?` from `RuntimeSnapshot`)
- Modify: `src/tui/runtime-collector.ts` (drop the `mapped`/`RuntimeEventSnapshot` code and the `events` cache field)
- Test: `tests/tui/runtime-collector.vitest.ts` (update — snapshot no longer has `events`)
- Test: any test that asserted on `snap.runtime.events` (fix to `trace` or drop)

**Interfaces:**
- Consumes: nothing new.
- Produces: zero references to `RuntimeEventSnapshot` / `RuntimeSnapshot.events` in `src/tui`.

- [ ] **Step 1: Verify zero non-deprecated consumers**

Run: `rg "RuntimeEventSnapshot|\.runtime\.events|r\.events" src/tui`
Expected: only `src/tui/snapshot.ts` (definitions), `src/tui/runtime-collector.ts` (producer), `src/tui/views/runtime-view.ts` (already migrated in Task 4 — confirm it no longer reads `r.events`).

- [ ] **Step 2: Remove from `src/tui/snapshot.ts`**

Delete `RuntimeEventSnapshot` and the deprecated `events?` field from `RuntimeSnapshot` (keep `trace`).

- [ ] **Step 3: Remove from `src/tui/runtime-collector.ts`**

Drop the `mapped`/`RuntimeEventSnapshot` mapping code, the `recent` slice, the `RuntimeEventSnapshot` import, and the `events` field from the cache + `sample()` assignment. The snapshot becomes:
```typescript
      this.cache = {
        trace,
        workflow: computeWorkflow(events),
        totalEventCount: events.length,
        lastEventAt: events.length > 0 ? Date.parse(events[events.length - 1]!.timestamp) || Date.now() : null,
      };
```
(Note: `lastEventAt` now derives from the last raw event, not the mapped flat list.)

- [ ] **Step 4: Update tests**

`tests/tui/runtime-collector.vitest.ts` — remove any assertion on `snap.events`; the trace + failure tests carry over. `tests/tui/views/runtime-view.vitest.ts` — already trace-based. Run `npx tsc -p tsconfig.json --noEmit` and fix any test fixture still referencing the removed field.

- [ ] **Step 5: Verify zero references + build + commit**

Run: `rg "RuntimeEventSnapshot|\.runtime\.events|r\.events" src/ tests/` → zero. Then `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`.
```bash
git add src/tui/snapshot.ts src/tui/runtime-collector.ts tests/tui/runtime-collector.vitest.ts tests/tui/views/runtime-view.vitest.ts
git commit -m "refactor(capabilities): remove deprecated flat runtime event rendering"
```

---

### Task 6: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase4-execution-trace-design.md` (status → implemented)
- Create: `docs/capability-platform-phase4.md` (consumer note)

- [ ] **Step 1: Full build + full capability + TUI suites**

Run: `npm run build` and `npx vitest run tests/capability tests/tui --config vitest.config.mts`
Expected: clean, all pass.

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved — Ready for Implementation` → `**Status:** Implemented (Phase 4)`.

- [ ] **Step 3: Write the consumer doc**

```markdown
# ALiX Capability Platform — Phase 4 (Execution Trace)

The Runtime tab now renders a structured **Execution Trace**: lifecycle-grouped
rows over the append-only EventLog — a tool run collapses to one row
(`▶ tool.search … ✔ completed (183ms)`), policy verdicts, capability
invocations, and runtime phase transitions each render as one unit.

Client-side filtering (All / Tool / Capability / Policy / Runtime) is view-local
state on the Runtime tab. The pipeline is `EventLog → RuntimeCollector →
ExecutionTraceBuilder (pure) → ExecutionTraceWindow → RuntimeSnapshot.trace →
RuntimeView`; the view never touches the EventLog directly. Running entries are
never evicted; terminal entries are bounded to the last 50.

The operator timeline (chat) is unchanged — it stays the curated narrative on
its own `timelineEvents[]` stream. The platform (src/capability/) is untouched.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-4 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ The Runtime tab renders lifecycle-grouped execution entries (one row per tool run, not four raw events).
- ✅ Running entries never disappear mid-run; terminal entries bounded (keep-last-50, terminal-oldest→newest then running appended).
- ✅ All / Tool / Capability / Policy / Runtime filtering works entirely client-side over `RuntimeSnapshot.trace`.
- ✅ `RuntimeView` never calls `EventLog` and never interprets raw events — dependency chain `EventLog → RuntimeCollector → RuntimeSnapshot → RuntimeView` holds.
- ✅ `timelineEvents[]` and its views untouched; `src/capability/*` unmodified.
- ✅ `ExecutionTraceBuilder` is pure, consumes EventLog facts only, and returns immutable detached DTOs with `sourceEvents` provenance; `RuntimeEventSnapshot`/`RuntimeSnapshot.events` removed.
- ✅ Vitest green (new + existing), `tsc --noEmit` clean.
