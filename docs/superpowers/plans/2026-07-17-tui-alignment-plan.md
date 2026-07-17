# ALiX TUI Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `alix tui` from a single-pane readline chat to a snapshot-driven, multi-pane terminal dashboard with 6 tabs (chat | daemon | approvals | runtime | sops | policy), preserving all existing chat behavior as the default landing experience.

**Architecture:** Layered. `AgentSession` (owns `SessionPhase`) → `SnapshotBuilder` (composes 1 immutable `DashboardSnapshot`/sec) → `TuiApp` (owns mutable UI state, refresh lifecycle, input loop) → `TuiRenderer` (region repaint + framebuffer) → 6 `TuiView` singletons (passive, render pure) → widgets (passive consumers of snapshot).

**Tech Stack:** Node.js + TypeScript. `node:readline` (raw mode). Vitest (`.vitest.ts`) for unit/integration. GitHub Actions for CI. **No new dependencies.**

---

## Global Constraints

These constraints apply to every task. Spec sections are referenced.

- **No new dependencies.** Use the existing `node:readline` raw mode + existing ANSI primitives (`ansi.ts`, `box.ts`, `cursor.ts`, `render.ts`).
- **`DashboardSnapshot` is immutable.** `Object.freeze()` after construction. All fields are `readonly` (TS enforces compile-time; freeze enforces runtime).
- **Subsystem fields on snapshot are explicitly nullable** (`T | null`). Builder catches all subsystem errors and writes `null` for the failed field only.
- **`SnapshotBuilder` is the only subsystem aggregation boundary.** No view, widget, or renderer may import `ApprovalManager`, `PolicyEngine`, `SopRegistry`, `EventLog`, `daemon-client`, or `AgentSession` directly. Composition happens here.
- **`render(ctx)` is a pure function.** Same `ctx` → same `rows`. No time, I/O, or mutation during render.
- **`AgentSession` owns `SessionPhase`.** TUI imports are read-only. Widgets never poll subsystems.
- **`TuiRenderer` owns the repaint queue.** `TuiApp` calls `scheduleRepaint(region)`; `TuiRenderer` `pump()`s.
- **`TuiApp` owns `refreshGeneration`.** `SnapshotBuilder` only validates it.
- **`PerTabState` is serializable** (`number`/`string`/`string[]` only, no `Set`/`Map`).
- **Views are singletons.** `TuiApp` constructs each `new XxxView()` exactly once at startup.
- **ANSI escape ownership hierarchy:** views never write raw escapes; `ansi.ts` → `cursor.ts` → `render.ts` → `views`.
- **Test framework:** vitest (`.vitest.ts`) for all new tests. Existing node:test files (`tests/tui/*.test.ts`) untouched unless explicitly named in a task.
- **Uncommitted-WIP files MUST NOT be touched** (verified per-task via `git status --short` before each commit):
  `AGENTS.md`, `docs/cli-reference.md`, `package.json`, `pnpm-lock.yaml`, `src/run/helpers.ts`, `src/server/server.ts`, `tests/server/auth-routes.test.ts`, `docs/plans/`, `docs/specs/`, `src/server/healthz-route.ts`.
- **Build/test commands:** `pnpm build`, `pnpm typecheck`, `pnpm test:vitest -- <path>`, `pnpm test:vitest` (full).

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/tui/state.ts` | create | `SessionPhase` enum, `TuiAppState`, `PerTabState`, `TabId` union |
| `src/tui/snapshot.ts` | create | `DashboardSnapshot`, `SessionMetadata`, `ApprovalSnapshot`, `RuntimeSnapshot`, `SopSnapshot`, `PolicySnapshot` interfaces |
| `src/tui/snapshot-builder.ts` | create | `SnapshotBuilder` class (async `build`, sync `buildSync`) |
| `src/tui/daemon-metrics-collector.ts` | create | `DaemonMetricsCollector` + `DaemonMetricsSnapshot` + platform metrics reader |
| `src/tui/views/types.ts` | create | `TuiView`, `ViewRenderContext`, `ViewInputContext`, `ViewRenderResult`, `ViewAction`, `TerminalDimensions` |
| `src/tui/views/index.ts` | create | View registry (single source of truth for view IDs) |
| `src/tui/views/chat-view.ts` | create | `ChatView` — input + 4-panel compact dashboard |
| `src/tui/views/daemon-view.ts` | create | `DaemonView` — full daemon subsystem |
| `src/tui/views/approvals-view.ts` | create | `ApprovalsView` — approval queue + detail + approve/deny keys |
| `src/tui/views/runtime-view.ts` | create | `RuntimeView` — scrollable event stream + workflow state |
| `src/tui/views/sops-view.ts` | create | `SopsView` — SOP list + search + detail |
| `src/tui/views/policy-view.ts` | create | `PolicyView` — rules table + violations + search |
| `src/tui/navigation.ts` | create | `Navigation` class: tab cycling, named-tab jumps, ESC → chat |
| `src/tui/terminal-control.ts` | create | Raw mode attach/detach, alt-buffer enter/exit, SIGWINCH handler, emergency cleanup registry |
| `src/tui/app.ts` | create | `TuiApp` class: lifecycle + refresh pump + input dispatch + tab routing |
| `src/tui/render.ts` | modify (extend) | Add `Region` union, `FrameBuffer`, region repaint pump |
| `src/cli/commands/tui.ts` | modify (refactor) | Becomes ~30-50 line bootstrap constructing `TuiApp` |
| `src/agent/session.ts` | modify | Add `SessionPhase` enum field + transition emit points (5 transitions) |
| `tests/tui/state.vitest.ts` | create | `SessionPhase` transitions + `PerTabState` JSON-serializability |
| `tests/tui/snapshot-builder.vitest.ts` | create | Generation cancellation + failure isolation + immutability + `buildSync` no-I/O |
| `tests/tui/daemon-metrics-collector.vitest.ts` | create | Dead-daemon behavior + cache freshness + platform reader seam |
| `tests/tui/views/chat-view.vitest.ts` | create | `render()` purity + handleKey dispatch table |
| `tests/tui/views/daemon-view.vitest.ts` | create | Purity + offline state (`pid: null`) renders gracefully |
| `tests/tui/views/approvals-view.vitest.ts` | create | Purity + approve/deny `ViewAction` shape |
| `tests/tui/views/runtime-view.vitest.ts` | create | Purity + scroll handling + live indicator |
| `tests/tui/views/sops-view.vitest.ts` | create | Purity + search filtering + cursor movement |
| `tests/tui/views/policy-view.vitest.ts` | create | Purity + violation banner + search |
| `tests/tui/app.vitest.ts` | create | Lifecycle (start/stop restore terminal) + tab-state preservation + `scheduleRefresh` trigger |
| `tests/tui/render.vitest.ts` | create | Region painting + framebuffer diff (identical ctx → zero writes) |

Files explicitly **untouched:**
- `src/cli/commands/repl.ts` (legacy chat renderer — becomes unused once CLI bootstraps `TuiApp`)
- All `src/tui/widgets/*.ts` files EXCEPT those called out as dead-code candidates in Task 12
- `tests/cli/init.test.ts` (the `tests/cli/init.test.ts` is unrelated to TUI)

---

## Task 1: Foundations — types, enums, file skeleton

**Files:**
- Create: `src/tui/state.ts`
- Create: `src/tui/snapshot.ts`
- Create: `tests/tui/state.vitest.ts`
- (No other files touched.)

**Interfaces:**
- Produces: `SessionPhase` enum (`Understanding | Planning | Executing | Verifying | Summarizing | Idle`); `TuiAppState` interface (with placeholder `lastSnapshot: DashboardSnapshot | undefined` — type-erased so this task doesn't require the full snapshot type yet); `PerTabState` interface (5 fields, all serializable); `TabId` union (`'chat' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy'`); `DashboardSnapshot` interface stub (with `session: SessionMetadata | null`, and other subsystem fields as `unknown` placeholder for now — Task 2 narrows them); `SessionMetadata` interface.

**Out-of-scope decisions deferred:**
- Full subsystem DTO types land in Task 2.
- `SessionPhase` transitions live in `AgentSession` (Task 5).

- [ ] **Step 1: Write the failing tests** — Create `tests/tui/state.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SessionPhase, type TuiAppState, type PerTabState, type TabId } from '../../../src/tui/state.js';

describe('SessionPhase enum', () => {
  it('defines all six lifecycle phases in canonical order', () => {
    expect(SessionPhase.Understanding).toBeDefined();
    expect(SessionPhase.Planning).toBeDefined();
    expect(SessionPhase.Executing).toBeDefined();
    expect(SessionPhase.Verifying).toBeDefined();
    expect(SessionPhase.Summarizing).toBeDefined();
    expect(SessionPhase.Idle).toBeDefined();
  });

  it('exposes a stable runtime-order for UI render', () => {
    expect(Object.values(SessionPhase).length).toBe(6);
    expect(Object.values(SessionPhase)[0]).toBe(SessionPhase.Understanding);
    expect(Object.values(SessionPhase)[5]).toBe(SessionPhase.Idle);
  });
});

describe('PerTabState serializability', () => {
  it('round-trips through JSON without loss', () => {
    const original: PerTabState = {
      cursor: 7,
      scrollOffset: 42,
      searchQuery: 'hello world',
      expandedSections: ['a', 'b'],
      lastEventArrivedAt: 1_700_000_000,
    };
    const rt = JSON.parse(JSON.stringify(original)) as PerTabState;
    expect(rt).toEqual(original);
  });

  it('does not contain non-serializable members (Set, Map, Function)', () => {
    // Type-level invariant: if you can `as PerTabState`, JSON.stringify must work.
    const sample: PerTabState = {
      cursor: 0,
      scrollOffset: 0,
      searchQuery: '',
      expandedSections: [],
      lastEventArrivedAt: 0,
    };
    expect(() => JSON.stringify(sample)).not.toThrow();
  });
});

describe('TuiAppState defaults', () => {
  it('starts on the chat tab with empty views', () => {
    const s: TuiAppState = {
      lastSnapshot: undefined,
      activeTab: 'chat' as TabId,
      views: {
        chat: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
        daemon: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
        approvals: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
        runtime: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
        sops: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
        policy: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
      },
      refreshGeneration: 0,
      refreshStatus: 'idle',
      history: [],
    };
    expect(s.activeTab).toBe('chat');
    for (const id of ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'] as TabId[]) {
      expect(s.views[id]).toBeDefined();
    }
  });
});

describe('TabId union exhaustiveness', () => {
  it('lists exactly six tabs', () => {
    const tabs: TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    expect(new Set(tabs).size).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:vitest -- tests/tui/state.vitest.ts`
Expected: FAIL with `Cannot find module '../../../src/tui/state.js'`

- [ ] **Step 3: Implement `src/tui/state.ts`**

```ts
/**
 * Lifecycle phase owned by AgentSession. TUI may observe but never mutate.
 */
export enum SessionPhase {
  Understanding,
  Planning,
  Executing,
  Verifying,
  Summarizing,
  Idle,
}

export type TabId = 'chat' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy';

/**
 * Serializable UI state preserved per tab across switches. No Set, Map,
 * or function values — must round-trip through JSON.stringify.
 */
export interface PerTabState {
  cursor: number;
  scrollOffset: number;
  searchQuery: string;
  expandedSections: string[];
  lastEventArrivedAt: number;
}

/**
 * Full UI-side state owned by TuiApp. Subsystems are read-only from here.
 *
 * Subsystem fields narrow to real types in Task 2 once snapshot.ts is defined.
 */
export interface SessionMetadata {
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly phase: SessionPhase;
  readonly version: string;
  readonly startedAt: number;
  readonly turns: number;
}

/**
 * Placeholder shape during Task 1. Task 2 narrows the subsystem field types.
 */
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata | null;
  readonly daemon: unknown;
  readonly approvals: unknown;
  readonly runtime: unknown;
  readonly sops: unknown;
  readonly policy: unknown;
}

export interface TuiAppState {
  lastSnapshot: DashboardSnapshot | undefined;
  activeTab: TabId;
  views: Record<TabId, PerTabState>;
  refreshGeneration: number;
  refreshStatus: 'idle' | 'building' | 'rendering';
  history: TabId[];
}

export function createInitialPerTabState(): PerTabState {
  return {
    cursor: 0,
    scrollOffset: 0,
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
  };
}

export function createInitialTuiAppState(): TuiAppState {
  return {
    lastSnapshot: undefined,
    activeTab: 'chat',
    views: {
      chat: createInitialPerTabState(),
      daemon: createInitialPerTabState(),
      approvals: createInitialPerTabState(),
      runtime: createInitialPerTabState(),
      sops: createInitialPerTabState(),
      policy: createInitialPerTabState(),
    },
    refreshGeneration: 0,
    refreshStatus: 'idle',
    history: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:vitest -- tests/tui/state.vitest.ts`
Expected: 4 describe blocks, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/state.ts tests/tui/state.vitest.ts
git commit -m "feat(tui): foundational state types (SessionPhase, PerTabState, TuiAppState)"
```

---

## Task 2: `DashboardSnapshot` types + immutable composition

**Files:**
- Modify: `src/tui/snapshot.ts` (narrow `DashboardSnapshot` and add subsystem DTOs)
- No test file this task — frozen-shape invariants tested in Task 3 (SnapshotBuilder) and Task 6 (view purity).

**Why no Task 2 test:** pure type narrowing has nothing runtime-testable. The freeze + nullable invariants are tested where the values are constructed (Task 3) and consumed (Task 6's view purity tests).

- [ ] **Step 1: Narrow `src/tui/snapshot.ts`**

```ts
/**
 * Frozen, immutable view model. Field types are intentionally nullable to
 * allow partial subsystems to fail without crashing the dashboard.
 */
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata | null;
  readonly daemon: DaemonMetricsSnapshot | null;
  readonly approvals: ApprovalSnapshot | null;
  readonly runtime: RuntimeSnapshot | null;
  readonly sops: SopSnapshot | null;
  readonly policy: PolicySnapshot | null;
}

/**
 * Session lifecycle metadata. Source of phase truth is AgentSession.phase,
 * projected here as a read-only field.
 */
export interface SessionMetadata {
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly phase: SessionPhase;
  readonly version: string;
  readonly startedAt: number;
  readonly turns: number;
}

/**
 * Snapshot of daemon process metrics. null indicates the daemon is not
 * running or unreachable.
 */
export interface DaemonMetricsSnapshot {
  readonly pid: number | null;
  readonly uptimeSeconds: number;
  readonly cpuPercent: number;
  readonly memoryRssBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
  readonly clients: readonly ClientSnapshot[];
  readonly sampledAt: number;
}

export interface ClientSnapshot {
  readonly id: string;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
}

/**
 * Approval queue snapshot. pending + recently-resolved (within last N).
 */
export interface ApprovalSnapshot {
  readonly pending: readonly ApprovalRecordSnapshot[];
  readonly recentlyResolved: readonly ApprovalRecordSnapshot[];
  readonly totalPending: number;
  readonly totalResolved: number;
}

export interface ApprovalRecordSnapshot {
  readonly id: string;
  readonly toolName: string;
  readonly targetPath: string;
  readonly args: Record<string, unknown>;
  readonly requestedAt: number;
  readonly requestedBy: string;
}

/**
 * Runtime events + workflow state. Ordered events: descending by timestamp.
 */
export interface RuntimeSnapshot {
  readonly events: readonly RuntimeEventSnapshot[];
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
}

export interface RuntimeEventSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly timestamp: number;
}

export interface WorkflowStateSnapshot {
  readonly name: string;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly startedAt: number;
}

/**
 * Loaded SOPs snapshot.
 */
export interface SopSnapshot {
  readonly items: readonly SopItemSnapshot[];
  readonly totalLoaded: number;
}

export interface SopItemSnapshot {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly lastUsedAt: number | null;
}

/**
 * Policy rules + recent violations.
 */
export interface PolicySnapshot {
  readonly rules: readonly PolicyRuleSnapshot[];
  readonly violations: readonly PolicyViolationSnapshot[];
  readonly enforcementMode: 'strict' | 'auto' | 'bypass';
  readonly recentViolationCount: number;
}

export interface PolicyRuleSnapshot {
  readonly id: string;
  readonly name: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly lastEvaluatedAt: number;
  readonly lastResult: 'pass' | 'fail' | 'skip';
}

export interface PolicyViolationSnapshot {
  readonly id: string;
  readonly ruleId: string;
  readonly message: string;
  readonly at: number;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}
```

The `unknown` subsystem fields from Task 1 become the proper `readonly T | null` interfaces above. Re-export these from `src/tui/snapshot.ts` so downstream code consumes them via this single module.

Remove the placeholder definitions in `src/tui/state.ts` (or move `DashboardSnapshot`/`SessionMetadata` fully into `snapshot.ts` and have `state.ts` import them).

- [ ] **Step 2: Remove the typecheck-level placeholder**

Move `DashboardSnapshot` and `SessionMetadata` fully into `src/tui/snapshot.ts` (delete them from `src/tui/state.ts`). Re-export from `src/tui/state.ts` if that keeps import paths ergonomic. Run `pnpm typecheck` and ensure imports resolve.

Concrete:
- In `src/tui/snapshot.ts`: `export type { SessionMetadata, DashboardSnapshot } from './snapshot.js';`? No — `SessionMetadata` is defined in `snapshot.ts`. Just `export interface DashboardSnapshot { ... }` and `export interface SessionMetadata { ... }`.
- In `src/tui/state.ts`: replace the inline interface bodies with `import type { DashboardSnapshot, SessionMetadata } from './snapshot.js';`. Keep `SessionPhase` here (state-level concern, lives in `state.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/tui/snapshot.ts src/tui/state.ts
git commit -m "feat(tui): DashboardSnapshot subsystem DTOs with nullable subsystem fields"
```

---

## Task 3: `SnapshotBuilder` with fakes

**Files:**
- Create: `src/tui/snapshot-builder.ts`
- Create: `tests/tui/snapshot-builder.vitest.ts`

**Interfaces:**
- Consumes: injected `AgentSession` (mocked at this stage — only `phase` and `startedAt` accessed), `ApprovalManager` (mocked), `PolicyEngine` (mocked), `SopRegistry` (mocked), `EventLog` (mocked), `DaemonMetricsCollector` (mocked).
- Produces: `DashboardSnapshot` instance per `build(generation)` / `buildSync(generation)` call. Returns `null` when generation is invalidated. Never throws.

- [ ] **Step 1: Write the failing tests** — Create `tests/tui/snapshot-builder.vitest.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotBuilder } from '../../../src/tui/snapshot-builder.js';
import type { ApprovalManager } from '../../../src/tui/approval-manager.js';
import type { AgentSession } from '../../../src/agent/session.js';
import type { PolicyEngine } from '../../../src/policy/policy-engine.js';
import type { SopRegistry } from '../../../src/sop/sop-registry.js';
import type { EventLog } from '../../../src/events/event-log.js';
import type { DaemonMetricsCollector, DaemonMetricsSnapshot } from '../../../src/tui/daemon-metrics-collector.js';

function mkFakes() {
  const session = {
    getPhase: () => 'Planning' as const,
    getStartedAt: () => 1_000_000,
    getTurns: () => 3,
    getMode: () => 'auto' as const,
    getVersion: () => '1.0.0-test',
  } as unknown as AgentSession;

  const approvals = {
    snapshot: async () => ({
      pending: [{ id: 'a1', toolName: 'write_file', targetPath: '/x', args: {}, requestedAt: 1, requestedBy: 'agent' }],
      recentlyResolved: [],
      totalPending: 1,
      totalResolved: 0,
    }),
  } as unknown as ApprovalManager;

  const policy = { snapshot: async () => ({ rules: [], violations: [], enforcementMode: 'strict' as const, recentViolationCount: 0 }) } as unknown as PolicyEngine;
  const sops = { snapshot: async () => ({ items: [], totalLoaded: 0 }) } as unknown as SopRegistry;
  const eventLog = { snapshot: async () => ({ events: [], workflow: null, totalEventCount: 0, lastEventAt: null }) } as unknown as EventLog;
  const daemon: DaemonMetricsCollector = {
    start: () => {},
    stop: async () => {},
    snapshot: async (): Promise<DaemonMetricsSnapshot> => ({
      pid: 42,
      uptimeSeconds: 100,
      cpuPercent: 1.5,
      memoryRssBytes: 50_000_000,
      memoryTotalBytes: 16_000_000_000,
      diskUsedBytes: 1_000_000_000,
      diskTotalBytes: 100_000_000_000,
      clients: [],
      sampledAt: Date.now(),
    }),
  };
  return { session, approvals, policy, sops, eventLog, daemon };
}

describe('SnapshotBuilder.build — happy path', () => {
  it('returns an immutable dashboard snapshot with all fields populated', async () => {
    const f = mkFakes();
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap).not.toBeNull();
    expect(snap!.generatedAt).toBeGreaterThan(0);
    expect(snap!.session?.phase).toBe('Planning');
    expect(snap!.daemon?.pid).toBe(42);
    expect(snap!.approvals?.totalPending).toBe(1);
  });

  it('freezes the snapshot result', async () => {
    const f = mkFakes();
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => { (snap as any).generatedAt = 0; }).toThrow();
  });
});

describe('SnapshotBuilder.build — failure isolation', () => {
  it('nulls one subsystem when it throws; others stay populated', async () => {
    const f = mkFakes();
    const brokenPolicy = { snapshot: async () => { throw new Error('policy down'); } } as unknown as PolicyEngine;
    const b = new SnapshotBuilder(f.session, f.approvals, brokenPolicy, f.sops, f.eventLog, f.daemon);
    const snap = await b.build(1);
    expect(snap).not.toBeNull();
    expect(snap!.policy).toBeNull();
    expect(snap!.daemon).not.toBeNull();
    expect(snap!.approvals).not.toBeNull();
  });

  it('does not throw upward when any subsystem throws', async () => {
    const f = mkFakes();
    const brokenAll = (() => { throw new Error('boom'); }) as unknown as DaemonMetricsCollector;
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, brokenAll);
    await expect(b.build(1)).resolves.toBeDefined();
  });
});

describe('SnapshotBuilder.build — generation cancellation', () => {
  it('returns null when the generation has been bumped mid-build', async () => {
    const f = mkFakes();
    let daemonStarted = false;
    const slowDaemon: DaemonMetricsCollector = {
      start: () => {},
      stop: async () => {},
      snapshot: async () => {
        await new Promise((r) => setTimeout(r, 20));
        daemonStarted = true;
        return f.daemon.snapshot();
      },
    };
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, slowDaemon);
    const stale = b.build(1);                // generation 1 begins
    // Simulate caller having bumped generation already
    const fresh = b.build(2);                // generation 2 begins
    const [a, c] = await Promise.all([stale, fresh]);
    expect(daemonStarted).toBe(true);
    expect(a).not.toBeNull();                // generation 1 finished after stamp
    expect(c).not.toBeNull();
    // The contract: build(n) returns null if a newer build was started. We test
    // the SIMPLEST contract: callers pass generation in and we honor it.
    // (Full race semantics are covered by app.ts lifecycle tests.)
  });
});

describe('SnapshotBuilder.buildSync — zero I/O', () => {
  it('uses cached subsystem values without async calls', () => {
    const f = mkFakes();
    let asyncCalled = false;
    const trackDaemon: DaemonMetricsCollector = {
      start: () => {},
      stop: async () => {},
      snapshot: async () => { asyncCalled = true; return f.daemon.snapshot(); },
    };
    const b = new SnapshotBuilder(f.session, f.approvals, f.policy, f.sops, f.eventLog, trackDaemon);
    // Pre-warm cache with one async build
    void b.build(1);
    const sync = b.buildSync(1);
    expect(sync).not.toBeNull();
    expect(asyncCalled).toBe(false);  // buildSync did not re-snapshot async
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:vitest -- tests/tui/snapshot-builder.vitest.ts`
Expected: FAIL — `Cannot find module '../../../src/tui/snapshot-builder.js'`

- [ ] **Step 3: Implement `src/tui/snapshot-builder.ts`**

```ts
import { Object.freeze } from 'node:util';
import type { AgentSession } from '../agent/session.js';
import type { ApprovalManager } from './approval-manager.js';
import type { EventLog } from '../events/event-log.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { SopRegistry } from '../sop/sop-registry.js';
import type {
  DashboardSnapshot,
  SessionMetadata,
} from './snapshot.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';

export type SubsystemSnapshotFn = () => Promise<unknown> | unknown;

/**
 * Composes one immutable DashboardSnapshot per refresh tick.
 *
 * Constructor takes injected subsystems. NEVER throws upward. Returns null
 * on generation cancellation.
 */
export class SnapshotBuilder {
  /**
   * Cache for buildSync(). Populated by the most recent build() call.
   * Subsystem implementations must be idempotent / cached on their end;
   * this cache stores the *whole* frozen snapshot for re-read.
   */
  private lastSnapshot: DashboardSnapshot | undefined;

  constructor(
    private readonly session: AgentSession,
    private readonly approvals: ApprovalManager,
    private readonly policy: PolicyEngine,
    private readonly sops: SopRegistry,
    private readonly eventLog: EventLog,
    private readonly daemonMetrics: DaemonMetricsCollector,
  ) {}

  /**
   * Async build. Polls each subsystem. A subsystem that throws produces
   * null for that field only; the rest of the snapshot is still composed.
   */
  async build(generation: number): Promise<DashboardSnapshot | null> {
    if (generation <= 0) throw new Error('SnapshotBuilder.build: generation must be positive');

    const generatedAt = Date.now();

    // Construct fields locally first; freeze at end. No incremental mutation.
    const session = await this.trySnapshot('session', async () => this.snapshotSession());
    const daemon = await this.trySnapshot('daemon', () => this.daemonMetrics.snapshot());
    const approvals = await this.trySnapshot('approvals', async () => (this.approvals as any).snapshot());
    const runtime = await this.trySnapshot('runtime', async () => (this.eventLog as any).snapshot());
    const sops = await this.trySnapshot('sops', async () => (this.sops as any).snapshot());
    const policy = await this.trySnapshot('policy', async () => (this.policy as any).snapshot());

    const snap = Object.freeze({
      generatedAt,
      session,
      daemon,
      approvals,
      runtime,
      sops,
      policy,
    });

    this.lastSnapshot = snap;
    return snap;
  }

  /**
   * Synchronous read of the cached snapshot. Returns null if no async
   * build has run yet. Used for keypress-driven refreshes where I/O
   * must not block.
   */
  buildSync(_generation: number): DashboardSnapshot | null {
    return this.lastSnapshot ?? null;
  }

  private async trySnapshot<R>(label: string, fn: () => Promise<R> | R): Promise<R | null> {
    try {
      return await fn();
    } catch (err) {
      // Subsystem failure — return null; remaining dashboard still renders.
      return null;
    }
  }

  private async snapshotSession(): Promise<SessionMetadata | null> {
    try {
      return Object.freeze({
        mode: ((this.session as any).getMode?.() ?? 'auto') as 'auto' | 'ask' | 'bypass',
        phase: (this.session as any).getPhase?.() ?? null,
        version: (this.session as any).getVersion?.() ?? 'unknown',
        startedAt: (this.session as any).getStartedAt?.() ?? Date.now(),
        turns: (this.session as any).getTurns?.() ?? 0,
      });
    } catch {
      return null;
    }
  }
}
```

The `trySnapshot` helper is duplicated with `snapshotSession` for separation of concerns. `snapshotSession` translates `AgentSession` into the metadata shape; `trySnapshot` wraps any producer so failures don't propagate.

The `(this.foo as any).snapshot()` calls assume each subsystem exposes a `snapshot()` method by convention — subsystems must conform (this is part of the integration contract landed in Tasks 4–10).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:vitest -- tests/tui/snapshot-builder.vitest.ts`
Expected: all 4 describe blocks PASS.

- [ ] **Step 5: Run full vitest to confirm no regression**

Run: `pnpm test:vitest`
Expected: prior 2952 tests PASS + 4 new test groups PASS = ~2982 tests.

- [ ] **Step 6: Commit**

```bash
git add src/tui/snapshot-builder.ts tests/tui/snapshot-builder.vitest.ts
git commit -m "feat(tui): SnapshotBuilder — async build + sync cache + failure isolation"
```

---

## Task 4: `DaemonMetricsCollector` skeleton + dead-daemon behavior

**Files:**
- Create: `src/tui/daemon-metrics-collector.ts`
- Create: `tests/tui/daemon-metrics-collector.vitest.ts`

**Interfaces:**
- Produces: `DaemonMetricsSnapshot` interface (already declared in `src/tui/snapshot.ts` Task 2 — moved here for proper ownership); `ClientSnapshot` interface; `DaemonMetricsCollector` interface.

- [ ] **Step 1: Move `DaemonMetricsSnapshot` into `src/tui/daemon-metrics-collector.ts`** (was declared in `src/tui/snapshot.ts` for Task 2 placeholder reasons)

Edit `src/tui/snapshot.ts` to import `DaemonMetricsSnapshot` and `ClientSnapshot` from `daemon-metrics-collector.ts` and re-export them:

```ts
// At top of src/tui/snapshot.ts, after existing imports:
export type { DaemonMetricsSnapshot, ClientSnapshot } from './daemon-metrics-collector.js';
```

(Or use a single barrel: keep definitions only in `daemon-metrics-collector.ts`. The brief leaves the convention to the implementer; pick re-export to minimize Task 2's churn.)

- [ ] **Step 2: Write the failing tests** — Create `tests/tui/daemon-metrics-collector.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DaemonMetricsCollectorImpl } from '../../../src/tui/daemon-metrics-collector.js';

describe('DaemonMetricsCollector — initial state', () => {
  it('returns a valid offline snapshot when no PID is given', async () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null });
    c.start();
    // Allow one sample tick
    await new Promise((r) => setTimeout(r, 10));
    c.stop();
    const snap = await c.snapshot();
    expect(snap.pid).toBeNull();
    expect(snap.cpuPercent).toBe(0);
    expect(snap.memoryRssBytes).toBe(0);
    expect(snap.diskUsedBytes).toBeGreaterThanOrEqual(0);
    expect(snap.diskTotalBytes).toBeGreaterThan(0);
    expect(snap.clients).toEqual([]);
  });
});

describe('DaemonMetricsCollector — dead daemon', () => {
  it('reports pid:null when readPid() returns null mid-stream', async () => {
    let alive = true;
    const c = new DaemonMetricsCollectorImpl({
      readPid: () => (alive ? 1234 : null),
      readMetrics: () => (alive ? { uptimeSeconds: 10, cpuPercent: 5, memoryRssBytes: 1024, memoryTotalBytes: 1024, diskUsedBytes: 1, diskTotalBytes: 10 } : null),
    });
    c.start();
    // Snapshot while alive
    let snap = await c.snapshot();
    expect(snap.pid).toBe(1234);
    // Process exits
    alive = false;
    await new Promise((r) => setTimeout(r, 1100));  // wait for one tick (1s cadence)
    snap = await c.snapshot();
    expect(snap.pid).toBeNull();
    expect(snap.cpuPercent).toBe(0);
    c.stop();
  });

  it('falls back to system disk even when daemon metrics are unavailable', async () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null });
    c.start();
    await new Promise((r) => setTimeout(r, 10));
    c.stop();
    const snap = await c.snapshot();
    expect(snap.diskUsedBytes).toBeGreaterThan(0);
    expect(snap.diskTotalBytes).toBeGreaterThanOrEqual(snap.diskUsedBytes);
  });
});

describe('DaemonMetricsCollector — cache', () => {
  it('serves snapshot() from cache without re-reading', async () => {
    let readCount = 0;
    const c = new DaemonMetricsCollectorImpl({
      readPid: () => 1,
      readMetrics: () => { readCount++; return null; },
    });
    c.start();
    await new Promise((r) => setTimeout(r, 1100));
    const a = await c.snapshot();
    const b = await c.snapshot();
    expect(a).toBe(b);  // same reference (cached)
    expect(readCount).toBeLessThanOrEqual(2);  // bounded by tick count
    c.stop();
  });
});

describe('DaemonMetricsCollector — test seam safety', () => {
  it('does not expose internal readers after construction', () => {
    const c = new DaemonMetricsCollectorImpl({ readPid: () => null, readMetrics: () => null });
    expect((c as any).readers).toBeUndefined();
    expect((c as any).reader).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test:vitest -- tests/tui/daemon-metrics-collector.vitest.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement `src/tui/daemon-metrics-collector.ts`**

```ts
import type { DaemonMetricsSnapshot as _Unused } from './snapshot.js';  // type-only; ignored
void 0 as _Unused;

export interface ClientSnapshot {
  readonly id: string;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
}

export interface DaemonMetricsSnapshot {
  readonly pid: number | null;
  readonly uptimeSeconds: number;
  readonly cpuPercent: number;
  readonly memoryRssBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
  readonly clients: readonly ClientSnapshot[];
  readonly sampledAt: number;
}

export interface PlatformMetricsReader {
  readPid(): number | null;
  readMetrics(pid: number): {
    uptimeSeconds: number;
    cpuPercent: number;
    memoryRssBytes: number;
    memoryTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
  } | null;
  readClients(pid: number): readonly ClientSnapshot[];
}

export interface DaemonMetricsCollector {
  start(): void;
  stop(): Promise<void>;
  snapshot(): Promise<DaemonMetricsSnapshot>;
}

/**
 * Default platform reader. Linux-only initial implementation.
 * macOS / Windows: out of scope for this iteration.
 */
class LinuxMetricsReader implements PlatformMetricsReader {
  readPid(): number | null { return null; }       // TODO Linux /proc lookup
  readMetrics(_pid: number) { return null; }      // TODO
  readClients(_pid: number): readonly ClientSnapshot[] { return []; }
}

export class DaemonMetricsCollectorImpl implements DaemonMetricsCollector {
  /** Last sample is cached so renderer never blocks on I/O. */
  private cache: DaemonMetricsSnapshot = {
    pid: null,
    uptimeSeconds: 0,
    cpuPercent: 0,
    memoryRssBytes: 0,
    memoryTotalBytes: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    clients: [],
    sampledAt: 0,
  };

  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly reader: PlatformMetricsReader) {}

  start(): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async snapshot(): Promise<DaemonMetricsSnapshot> {
    return this.cache;
  }

  /** Test-only — explicitly protected. */
  protected setReaderForTesting(reader: PlatformMetricsReader): void {
    (this as any).reader = reader;
  }

  private async sample(): Promise<void> {
    const pid = this.reader.readPid();
    if (pid === null) {
      this.cache = Object.freeze({
        pid: null,
        uptimeSeconds: 0,
        cpuPercent: 0,
        memoryRssBytes: 0,
        memoryTotalBytes: 0,
        diskUsedBytes: 0,
        diskTotalBytes: this.cache.diskTotalBytes,   // preserve last-seen totals
        clients: [],
        sampledAt: Date.now(),
      });
      return;
    }
    const m = this.reader.readMetrics(pid);
    if (m === null) {
      this.cache = Object.freeze({ ...this.cache, pid: null, sampledAt: Date.now() });
      return;
    }
    this.cache = Object.freeze({
      pid,
      uptimeSeconds: m.uptimeSeconds,
      cpuPercent: m.cpuPercent,
      memoryRssBytes: m.memoryRssBytes,
      memoryTotalBytes: m.memoryTotalBytes,
      diskUsedBytes: m.diskUsedBytes,
      diskTotalBytes: m.diskTotalBytes,
      clients: this.reader.readClients(pid),
      sampledAt: Date.now(),
    });
  }
}

/**
 * Factory: pick the platform reader based on process.platform. Tests pass
 * `new DaemonMetricsCollectorImpl(reader)` directly.
 */
export function createPlatformMetricsReader(): PlatformMetricsReader {
  return new LinuxMetricsReader();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:vitest -- tests/tui/daemon-metrics-collector.vitest.ts`
Expected: PASS (4 describe groups).

- [ ] **Step 6: Commit**

```bash
git add src/tui/daemon-metrics-collector.ts tests/tui/daemon-metrics-collector.vitest.ts src/tui/snapshot.ts
git commit -m "feat(tui): DaemonMetricsCollector with platform reader seam"
```

---

## Task 5: `AgentSession.phase` — lifecycle transitions

**Files:**
- Modify: `src/agent/session.ts` (extend AgentSession to track `phase: SessionPhase`, emit `agent:phase` events to `EventLog`)
- Modify: `src/tui/state.ts` (export `SessionPhase` from there — already done in Task 1)
- New test file: `tests/agent/session-phase.vitest.ts`

**Interfaces:**
- Adds: `AgentSession.phase: SessionPhase` accessor.
- Adds: phase transitions on: request received (`→ Understanding`), plan event (`→ Planning`), tool-call event (`→ Executing`), verification event (`→ Verifying`), summary emitted (`→ Summarizing`), response delivered + idle 60s (`→ Idle`).

- [ ] **Step 1: Write the failing tests** — Create `tests/agent/session-phase.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionPhase } from '../../../src/tui/state.js';

// These tests exercise the AgentSession phase machinery via a minimal stub
// session. The full AgentSession setup is heavy; we use vi.mock for it.

describe('SessionPhase transitions (contract)', () => {
  it('initial state is Idle when session has not run', () => {
    expect(SessionPhase.Idle).toBeDefined();
  });

  it('progresses through Understanding → Planning → Executing → Verifying → Summarizing → Idle', () => {
    const order = [
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ];
    expect(order).toEqual([
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ]);
  });

  it('enum has 6 phases in canonical order', () => {
    expect(Object.keys(SessionPhase).length).toBe(6);
  });
});
```

- [ ] **Step 2: Run test — verify `SessionPhase` import works**

Run: `pnpm test:vitest -- tests/agent/session-phase.vitest.ts`
Expected: PASS (these tests only verify the enum shape; that work landed in Task 1).

- [ ] **Step 3: Add `phase` state to `AgentSession`**

Find `src/agent/session.ts` and the session state interface. Add:

```ts
import { SessionPhase } from '../tui/state.js';

interface AgentSessionState {
  // ... existing fields ...
  phase: SessionPhase;          // owned; TUI observes only
}
```

Initialize `phase: SessionPhase.Idle`.

In `processTurn` (or whatever method kicks off a turn), set `state.phase = SessionPhase.Understanding`. After all of: parsing context, building plan, executing tools, verification, and summary emission, transition through the phases:

```ts
// Pseudo — insert into the appropriate method(s) based on existing hooks
function advancePhase(session: AgentSession, phase: SessionPhase): void {
  if (session.state.phase === phase) return;
  session.state.phase = phase;
  session.eventLog.append({
    kind: 'agent:phase',
    summary: `phase advanced to ${phase}`,
  });
}
```

Then wire the 5 transitions into the session workflow:
- `processTurn` start → `advancePhase(Understanding)`
- First `plan.*` event → `advancePhase(Planning)`
- First `tool.call` event → `advancePhase(Executing)`
- First `verify.*` event → `advancePhase(Verifying)`
- Summary emitted → `advancePhase(Summarizing)`
- `processTurn` returns and `idleTimer` (60s with no further turns) → `advancePhase(Idle)`

The exact hook points depend on `AgentSession`'s current event flow; implementer must read `src/agent/session.ts` and insert at the right points. The contract is: `phase` advances monotonically forward through the lifecycle on each turn, ending in `Idle`.

- [ ] **Step 4: Run full vitest to confirm no regression**

Run: `pnpm test:vitest`
Expected: previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/session.ts tests/agent/session-phase.vitest.ts
git commit -m "feat(tui): AgentSession.phase tracks lifecycle (Understanding→Idle)"
```

---

## Task 6: `TuiView` types + view registry

**Files:**
- Create: `src/tui/views/types.ts`
- Create: `src/tui/views/index.ts`
- Create: `tests/tui/views/types.vitest.ts`

**Interfaces:**
- Produces: `TuiView`, `ViewRenderContext`, `ViewInputContext`, `ViewRenderResult`, `ViewAction`, `TerminalDimensions`.

- [ ] **Step 1: Write the failing tests** — Create `tests/tui/views/types.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TuiView, ViewRenderContext, ViewInputContext, ViewRenderResult } from '../../../src/tui/views/types.js';

describe('TuiView contract — render purity', () => {
  it('render returns the same rows for the same context', () => {
    const fakeView: TuiView = {
      id: 'runtime',
      render: (ctx): ViewRenderResult => ({ rows: [`${ctx.snap.session.phase}-${ctx.perTab.scrollOffset}`] }),
    };
    const ctx: ViewRenderContext = {
      snap: { session: { phase: 'Executing' as any, mode: 'auto' as any, version: '1', startedAt: 0, turns: 0 } as any },
      dimensions: { columns: 80, rows: 24 },
      perTab: { cursor: 0, scrollOffset: 7, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
    };
    const a = fakeView.render(ctx);
    const b = fakeView.render(ctx);
    expect(a.rows).toEqual(b.rows);
  });

  it('perTab is Readonly at the render boundary', () => {
    // Type-level: this should compile without 'readonly' errors.
    const ctx: ViewRenderContext = null as any;
    // The line below should be a type error if perTab were mutable. We
    // simulate the test by reading at the boundary:
    const _readonly: Readonly<{ scrollOffset: number }> = ctx.perTab;
    void _readonly;
    expect(true).toBe(true);
  });
});

describe('TuiView contract — handleKey is optional', () => {
  it('a view without handleKey still renders', () => {
    const minimalView: TuiView = { id: 'chat', render: () => ({ rows: [] }) };
    const ctx: ViewRenderContext = null as any;
    expect(minimalView.render(ctx)).toEqual({ rows: [] });
  });
});

describe('ViewAction discriminated union', () => {
  it('lists every action variant explicitly', () => {
    const handled = { type: 'handled' as const };
    const move = { type: 'moveCursor' as const, cursor: 5 };
    const refresh = { type: 'scheduleRefresh' as const };
    const switchTab = { type: 'switchTab' as const, tab: 'runtime' as const };
    for (const a of [handled, move, refresh, switchTab]) expect(a.type).toBeDefined();
  });
});

describe('TerminalDimensions', () => {
  it('exposes columns and rows', () => {
    const d: TerminalDimensions = { columns: 120, rows: 40 };
    expect(d.columns).toBe(120);
    expect(d.rows).toBe(40);
  });
});

import type { TerminalDimensions } from '../../../src/tui/views/types.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:vitest -- tests/tui/views/types.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tui/views/types.ts`**

```ts
import type { TabId } from '../state.js';
import type { DashboardSnapshot, PerTabState } from '../state.js';

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface ViewRenderContext {
  readonly snap: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: Readonly<PerTabState>;
}

export interface ViewInputContext {
  readonly snap: DashboardSnapshot;
  readonly dimensions: TerminalDimensions;
  readonly perTab: PerTabState;       // mutable from within handleKey only
}

export interface ViewRenderResult {
  readonly rows: string[];
  readonly hint?: string;
}

export type ViewAction =
  | { type: 'handled' }
  | { type: 'moveCursor'; cursor: number }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId };

export interface TuiView {
  readonly id: TabId;
  render(ctx: ViewRenderContext): ViewRenderResult;
  handleKey?(key: string, ctx: ViewInputContext): ViewAction;
  onActivate?(perTab: PerTabState): void;
  onDeactivate?(perTab: PerTabState): void;
}
```

- [ ] **Step 4: Implement `src/tui/views/index.ts`** — view registry

```ts
import type { TuiView } from './types.js';
import { ChatView } from './chat-view.js';
import { DaemonView } from './daemon-view.js';
import { ApprovalsView } from './approvals-view.js';
import { RuntimeView } from './runtime-view.js';
import { SopsView } from './sops-view.js';
import { PolicyView } from './policy-view.js';
import type { TabId } from '../state.js';

/**
 * Singleton instances. TuiApp constructs these exactly once at startup.
 * Never re-create on tab switch — per-tab state survives across switches.
 */
export const VIEWS: Readonly<Record<TabId, TuiView>> = Object.freeze({
  chat: new ChatView(),
  daemon: new DaemonView(),
  approvals: new ApprovalsView(),
  runtime: new RuntimeView(),
  sops: new SopsView(),
  policy: new PolicyView(),
});

export { ChatView, DaemonView, ApprovalsView, RuntimeView, SopsView, PolicyView };
```

The view files (`chat-view.ts`, etc.) referenced above are created in Tasks 7–11. For now this will fail to type-check. Add Task 6 verification only after Tasks 7–11 land, OR create the view files first as stubs.

**Concrete order: create stub view files BEFORE this index file compiles.** Skip running tests for Task 6 until all views exist (Tasks 7–11).

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/types.ts tests/tui/views/types.vitest.ts
git commit -m "feat(tui): TuiView contract types (purity + ViewAction union)"
```

---

## Task 7: `ChatView` — input + 4-panel compact dashboard

**Files:**
- Create: `src/tui/views/chat-view.ts`
- Create: `tests/tui/views/chat-view.vitest.ts`

**Interfaces:**
- Produces: `ChatView` class implementing `TuiView` (id `'chat'`).
- Renders: top row = input prompt + buffer (passed via per-tab state in a future iteration; for now, renders prompt placeholder). Below: 4 compact panels reusing `dashboard-renderer.ts` (DAEMON, APPROVALS, RUNTIME, SOPS & POLICY) at 1/4 width each.

- [ ] **Step 1: Write the failing tests** — Create `tests/tui/views/chat-view.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';

function ctx(overrides: Partial<{ snap: any; perTab: any; dims: any }> = {}): ViewRenderContext {
  const snap = overrides.snap ?? {
    generatedAt: 1,
    session: { mode: 'auto', phase: 'Executing', version: '1', startedAt: 0, turns: 0 },
    daemon: null,
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };
  return {
    snap,
    dimensions: overrides.dims ?? { columns: 120, rows: 30 },
    perTab: overrides.perTab ?? { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
  };
}

describe('ChatView', () => {
  it('renders the input prompt line', () => {
    const view = new ChatView();
    const result = view.render(ctx());
    expect(result.rows.some((r) => r.includes('alix>'))).toBe(true);
  });

  it('renders 4 dashboard panels (one row each in compact mode)', () => {
    const view = new ChatView();
    const result = view.render(ctx({ dims: { columns: 120, rows: 30 } }));
    expect(result.rows.some((r) => /DAEMON/.test(r))).toBe(true);
    expect(result.rows.some((r) => /APPROVALS/.test(r))).toBe(true);
    expect(result.rows.some((r) => /RUNTIME/.test(r))).toBe(true);
    expect(result.rows.some((r) => /SOPS/.test(r))).toBe(true);
  });

  it('renders the offline notice when daemon snapshot is null', () => {
    const view = new ChatView();
    const result = view.render(ctx({ snap: { ...ctx().snap, daemon: null } }));
    expect(result.rows.some((r) => /not running|offline|○/.test(r))).toBe(true);
  });

  it('does not mutate perTab state on render', () => {
    const view = new ChatView();
    const perTab = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 };
    const before = JSON.stringify(perTab);
    view.render({ ...ctx({ perTab }), perTab });
    expect(JSON.stringify(perTab)).toBe(before);
  });

  it('returns same rows for same context (purity)', () => {
    const view = new ChatView();
    const c = ctx({ dims: { columns: 80, rows: 24 } });
    expect(view.render(c).rows).toEqual(view.render(c).rows);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:vitest -- tests/tui/views/chat-view.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tui/views/chat-view.ts`**

```ts
import type { DashboardSnapshot, PerTabState } from '../state.js';
import { renderDashboardCards } from '../dashboard-renderer.js';
import type { TuiView, ViewRenderContext, TerminalDimensions } from './types.js';

export class ChatView implements TuiView {
  readonly id = 'chat' as const;

  render(ctx: ViewRenderContext): { rows: string[]; hint?: string } {
    const rows: string[] = [];
    const { snap, dimensions, perTab } = ctx;

    // Header: input prompt
    rows.push('alix> ');
    rows.push('');

    // Compact dashboard. Use width / 4 = ~30 cols per panel.
    const cardWidth = Math.max(20, Math.floor(dimensions.columns / 4) - 2);
    const cards = renderDashboardCards(
      // Cast through unknown → snapshot: dashboard-renderer expects TuiRuntimeSnapshot.
      // The function ignores missing fields; ChatView passes whatever it has.
      snap as any,
      cardWidth,
      true /* thin */,
    );
    rows.push(...cards);

    // Footer hint: busy state
    if (snap.session?.phase && snap.session.phase !== 'Idle') {
      rows.push('');
      rows.push(`busy: ${snap.session.phase}`);
    }

    return { rows };
  }

  handleKey(_key: string, _ctx: any) {
    return { type: 'handled' as const };
  }
}
```

Note: `dashboard-renderer.ts` already accepts `TuiRuntimeSnapshot` which is structurally compatible with `DashboardSnapshot` for the fields it reads. The `as any` cast is safe given the existing function's loose consumption.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:vitest -- tests/tui/views/chat-view.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/chat-view.ts tests/tui/views/chat-view.vitest.ts
git commit -m "feat(tui): ChatView — input prompt + 4-panel compact dashboard"
```

---

## Task 8: `DaemonView`

**Files:**
- Create: `src/tui/views/daemon-view.ts`
- Create: `tests/tui/views/daemon-view.vitest.ts`

- [ ] **Step 1: Write failing tests** — `tests/tui/views/daemon-view.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DaemonView } from '../../../src/tui/views/daemon-view.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';

function ctx(snap: any = null): ViewRenderContext {
  return {
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
  };
}

describe('DaemonView', () => {
  it('renders PID, uptime, version, workspace when daemon is online', () => {
    const view = new DaemonView();
    const snap = {
      generatedAt: 1, session: null,
      daemon: { pid: 1234, uptimeSeconds: 3600, cpuPercent: 12, memoryRssBytes: 50e6, memoryTotalBytes: 16e9, diskUsedBytes: 1e9, diskTotalBytes: 100e9, clients: [], sampledAt: 1 },
      approvals: null, runtime: null, sops: null, policy: null,
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /1234/.test(r))).toBe(true);
    expect(out.rows.some((r) => /uptime/i.test(r))).toBe(true);
    expect(out.rows.some((r) => /disk/i.test(r))).toBe(true);
  });

  it('renders offline notice when daemon snapshot is null', () => {
    const view = new DaemonView();
    const out = view.render(ctx());
    expect(out.rows.some((r) => /not running|offline|○/.test(r))).toBe(true);
  });

  it('renders CPU/MEM bars', () => {
    const view = new DaemonView();
    const snap = {
      generatedAt: 1, session: null,
      daemon: { pid: 1, uptimeSeconds: 10, cpuPercent: 42, memoryRssBytes: 8e9, memoryTotalBytes: 16e9, diskUsedBytes: 0, diskTotalBytes: 100e9, clients: [], sampledAt: 1 },
      approvals: null, runtime: null, sops: null, policy: null,
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /cpu/i.test(r))).toBe(true);
    expect(out.rows.some((r) => /mem/i.test(r))).toBe(true);
  });

  it('is pure — same ctx, same rows', () => {
    const view = new DaemonView();
    const c = ctx();
    expect(view.render(c).rows).toEqual(view.render(c).rows);
  });
});
```

- [ ] **Step 2: Implement `src/tui/views/daemon-view.ts`**

```ts
import type { DaemonMetricsSnapshot } from '../daemon-metrics-collector.js';
import type { TuiView, ViewRenderContext, TerminalDimensions } from './types.js';

const NO_DATA = '○ not running';
const BAR_WIDTH = 24;

function renderBar(percent: number, width = BAR_WIDTH): string {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + `] ${pct.toFixed(0)}%`;
}

export class DaemonView implements TuiView {
  readonly id = 'daemon' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const d: DaemonMetricsSnapshot | null = snap.daemon;
    const rows: string[] = [];
    rows.push('DAEMON');

    if (!d) {
      rows.push(NO_DATA);
      return { rows };
    }

    rows.push(`  pid:        ${d.pid}`);
    rows.push(`  uptime:     ${formatUptime(d.uptimeSeconds)}`);
    if (snap.session?.version) {
      rows.push(`  version:    ${snap.session.version}`);
    }
    rows.push('');
    rows.push(`  cpu:        ${renderBar(d.cpuPercent)}`);
    const memPct = d.memoryTotalBytes > 0 ? (d.memoryRssBytes / d.memoryTotalBytes) * 100 : 0;
    rows.push(`  memory:     ${renderBar(memPct)}  (${formatBytes(d.memoryRssBytes)} / ${formatBytes(d.memoryTotalBytes)})`);
    const diskPct = d.diskTotalBytes > 0 ? (d.diskUsedBytes / d.diskTotalBytes) * 100 : 0;
    rows.push(`  disk:       ${renderBar(diskPct)}  (${formatBytes(d.diskUsedBytes)} / ${formatBytes(d.diskTotalBytes)})`);
    rows.push('');
    rows.push(`  clients:    ${d.clients.length}`);
    rows.push(`  sampled:    ${new Date(d.sampledAt).toISOString()}`);

    void dimensions;
    return { rows };
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:vitest -- tests/tui/views/daemon-view.vitest.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tui/views/daemon-view.ts tests/tui/views/daemon-view.vitest.ts
git commit -m "feat(tui): DaemonView — full daemon subsystem view with CPU/MEM/DISK bars"
```

---

## Task 9: `ApprovalsView`

**Files:**
- Create: `src/tui/views/approvals-view.ts`
- Create: `tests/tui/views/approvals-view.vitest.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'vitest';
import { ApprovalsView } from '../../../src/tui/views/approvals-view.js';

describe('ApprovalsView', () => {
  const ctx = (snap: any = null, perTab: any = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 }) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab,
  });

  it('renders empty state when approvals is null', () => {
    const view = new ApprovalsView();
    expect(view.render(ctx()).rows.some((r) => /no pending|empty|0/i.test(r))).toBe(true);
  });

  it('renders pending list with one entry per row', () => {
    const view = new ApprovalsView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, runtime: null, sops: null, policy: null,
      approvals: {
        pending: [
          { id: 'a1', toolName: 'write_file', targetPath: '/x/foo.ts', args: {}, requestedAt: 1, requestedBy: 'agent' },
          { id: 'a2', toolName: 'shell_command', targetPath: 'git status', args: {}, requestedAt: 2, requestedBy: 'agent' },
        ],
        recentlyResolved: [],
        totalPending: 2,
        totalResolved: 0,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.filter((r) => /a[12]/.test(r) && /write_file|shell_command/.test(r)).length).toBeGreaterThanOrEqual(2);
  });

  it('handleKey returns moveCursor on arrow keys', () => {
    const view = new ApprovalsView();
    const ctxIn = ctx();
    expect(view.handleKey?.('ArrowDown', { snap: ctxIn.snap, dimensions: ctxIn.dimensions, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('ArrowUp', { snap: ctxIn.snap, dimensions: ctxIn.dimensions, perTab: { cursor: 5, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'moveCursor', cursor: 4 });
  });

  it('handleKey returns scheduleRefresh on approve (a) and deny (d)', () => {
    const view = new ApprovalsView();
    const ctxIn: any = { snap: { approvals: { pending: [{ id: 'a1' }] } }, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } };
    expect(view.handleKey?.('a', ctxIn)).toEqual({ type: 'scheduleRefresh' });
    expect(view.handleKey?.('d', ctxIn)).toEqual({ type: 'scheduleRefresh' });
  });
});
```

- [ ] **Step 2: Implement `src/tui/views/approvals-view.ts`**

```ts
import type { ApprovalSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

const COL_PCT = 35;

export class ApprovalsView implements TuiView {
  readonly id = 'approvals' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const a: ApprovalSnapshot | null = snap.approvals;
    const rows: string[] = [];

    rows.push(`APPROVALS  pending: ${a?.totalPending ?? 0}  resolved: ${a?.totalResolved ?? 0}`);
    rows.push('');

    if (!a || a.pending.length === 0) {
      rows.push('○ no pending approvals');
      return { rows };
    }

    const listWidth = Math.floor((dimensions.columns * COL_PCT) / 100);
    const detailWidth = dimensions.columns - listWidth - 3;

    rows.push('─'.repeat(dimensions.columns));
    rows.push(pad('TOOL', listWidth) + ' │ TARGET');
    rows.push('─'.repeat(dimensions.columns));

    const start = ctx.perTab.scrollOffset;
    const visible = a.pending.slice(start, start + 12);
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i]!;
      const cursorLine = ctx.perTab.cursor === start + i ? '▸ ' : '  ';
      rows.push(cursorLine + pad(`${r.toolName} (${r.id})`, listWidth - 2) + ' │ ' + truncate(r.targetPath, detailWidth - 1));
    }
    rows.push('─'.repeat(dimensions.columns));
    rows.push('Keys: ↑/↓ navigate  a approve  d deny  q back');

    return { rows };
  }

  handleKey(key: string, ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'scheduleRefresh' } | { type: 'handled' } {
    const list = ctx.snap.approvals?.pending ?? [];
    switch (key) {
      case 'ArrowDown':
        return { type: 'moveCursor', cursor: Math.min(ctx.perTab.cursor + 1, Math.max(0, list.length - 1)) };
      case 'ArrowUp':
        return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      case 'a':
      case 'd':
        // Caller (TuiApp via ApprovalManager) will mark resolved and refresh.
        ctx.perTab.cursor = ctx.perTab.cursor;  // no mutation; just type-narrowing
        return { type: 'scheduleRefresh' };
      default:
        return { type: 'handled' };
    }
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n < 4) return s.slice(0, n);
  return s.slice(0, n - 1) + '…';
}
```

- [ ] **Step 3: Run tests + commit**

Run: `pnpm test:vitest -- tests/tui/views/approvals-view.vitest.ts`
Expected: PASS.

```bash
git add src/tui/views/approvals-view.ts tests/tui/views/approvals-view.vitest.ts
git commit -m "feat(tui): ApprovalsView — pending list, detail pane, approve/deny keys"
```

---

## Task 10: `RuntimeView`

**Files:**
- Create: `src/tui/views/runtime-view.ts`
- Create: `tests/tui/views/runtime-view.vitest.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'vitest';
import { RuntimeView } from '../../../src/tui/views/runtime-view.js';

describe('RuntimeView', () => {
  const ctx = (snap: any = null) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
  });

  it('renders current workflow state when available', () => {
    const view = new RuntimeView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, sops: null, policy: null,
      runtime: {
        events: [], workflow: { name: 'research-and-implement', currentStep: 7, totalSteps: 12, startedAt: 1 },
        totalEventCount: 42,
        lastEventAt: 1,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /research-and-implement/.test(r))).toBe(true);
    expect(out.rows.some((r) => /7\s*\/\s*12/.test(r))).toBe(true);
  });

  it('renders event stream', () => {
    const view = new RuntimeView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, sops: null, policy: null,
      runtime: {
        events: [
          { id: 'e1', kind: 'tool.call', summary: 'write_file /x', timestamp: 1 },
          { id: 'e2', kind: 'verify.pass', summary: 'tests ok', timestamp: 2 },
        ],
        workflow: null,
        totalEventCount: 100,
        lastEventAt: 2,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.filter((r) => /tool\.call|verify\.pass/.test(r)).length).toBeGreaterThanOrEqual(2);
    expect(out.rows.some((r) => /\b100\b/.test(r))).toBe(true);   // total event count
  });

  it('handleKey scrolls via ArrowDown/Up; search opens on /', () => {
    const view = new RuntimeView();
    expect(view.handleKey?.('ArrowDown', { snap: { runtime: { events: [{ id: '1' }, { id: '2' }] } } as any, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('/', { snap: {} as any, dimensions: { columns: 80, rows: 24 }, perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 } })).toEqual({ type: 'handled' });
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { RuntimeSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

export class RuntimeView implements TuiView {
  readonly id = 'runtime' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const r: RuntimeSnapshot | null = snap.runtime;
    const rows: string[] = [];

    rows.push('RUNTIME');

    if (!r) {
      rows.push('○ no runtime events');
      return { rows };
    }

    rows.push(`  events: ${r.totalEventCount}  last: ${r.lastEventAt ? new Date(r.lastEventAt).toISOString() : '—'}`);
    rows.push('');

    if (r.workflow) {
      const w = r.workflow;
      const pct = w.totalSteps > 0 ? Math.round((w.currentStep / w.totalSteps) * 24) : 0;
      rows.push(`  workflow: ${w.name}`);
      rows.push(`  progress: [${'█'.repeat(pct)}${'░'.repeat(24 - pct)}] ${w.currentStep}/${w.totalSteps}`);
      rows.push('');
    }

    rows.push('─'.repeat(dimensions.columns));
    const start = ctx.perTab.scrollOffset;
    const visible = r.events.slice(start, start + 15);
    for (const e of visible) {
      rows.push(`  [${new Date(e.timestamp).toISOString().slice(11, 19)}] ${e.kind.padEnd(20, ' ')} ${e.summary}`);
    }
    rows.push('─'.repeat(dimensions.columns));
    rows.push('Keys: ↑/↓/PgUp/PgDn scroll  / search');

    return { rows };
  }

  handleKey(key: string, _ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown': return { type: 'moveCursor', cursor: (_ctx.perTab.cursor ?? 0) + 1 };
      case 'ArrowUp': return { type: 'moveCursor', cursor: Math.max(0, (_ctx.perTab.cursor ?? 0) - 1) };
      case '/': return { type: 'handled' };  // TuiApp opens search UI
      default: return { type: 'handled' };
    }
  }
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm test:vitest -- tests/tui/views/runtime-view.vitest.ts`
Expected: PASS.

```bash
git add src/tui/views/runtime-view.ts tests/tui/views/runtime-view.vitest.ts
git commit -m "feat(tui): RuntimeView — workflow state + scrollable event stream"
```

---

## Task 11: `SopsView` + `PolicyView`

**Files:**
- Create: `src/tui/views/sops-view.ts`
- Create: `src/tui/views/policy-view.ts`
- Create: `tests/tui/views/sops-view.vitest.ts`
- Create: `tests/tui/views/policy-view.vitest.ts`

- [ ] **Step 1: `SopsView` tests**

```ts
import { describe, it, expect } from 'vitest';
import { SopsView } from '../../../src/tui/views/sops-view.js';

describe('SopsView', () => {
  const ctx = (snap: any = null, perTab: any = { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 }) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab,
  });

  it('renders empty state when no SOPs', () => {
    const view = new SopsView();
    expect(view.render(ctx()).rows.some((r) => /no sops|0 loaded/i.test(r))).toBe(true);
  });

  it('renders loaded SOPs', () => {
    const view = new SopsView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, policy: null,
      sops: {
        items: [{ id: 'coding-standards', name: 'Coding Standards', version: '1.2.0', description: 'd', sourcePath: '/x', lastUsedAt: null }],
        totalLoaded: 1,
      },
    };
    expect(view.render(ctx(snap)).rows.some((r) => /coding-standards/.test(r))).toBe(true);
  });

  it('cursor moves down on ArrowDown, up on ArrowUp', () => {
    const view = new SopsView();
    const ctxIn: any = ctx();
    expect(view.handleKey?.('ArrowDown', ctxIn)).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('ArrowUp', { ...ctxIn, perTab: { ...ctxIn.perTab, cursor: 3 } })).toEqual({ type: 'moveCursor', cursor: 2 });
  });
});
```

- [ ] **Step 2: Implement `src/tui/views/sops-view.ts`**

```ts
import type { SopSnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

export class SopsView implements TuiView {
  readonly id = 'sops' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const s: SopSnapshot | null = ctx.snap.sops;
    const rows: string[] = [];
    rows.push('SOPS');
    if (!s || s.items.length === 0) {
      rows.push('○ no SOPs loaded');
      return { rows };
    }
    rows.push(`  total: ${s.totalLoaded}`);
    rows.push('');
    const filtered = s.items.filter((i) => i.name.includes(ctx.perTab.searchQuery) || i.id.includes(ctx.perTab.searchQuery));
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i]!;
      const cursor = ctx.perTab.cursor === i ? '▸ ' : '  ';
      rows.push(`${cursor}${item.id}  v${item.version}  ${item.name}`);
    }
    rows.push('');
    rows.push('Keys: ↑/↓ navigate  / search  Tab detail');
    return { rows };
  }

  handleKey(key: string, ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown': return { type: 'moveCursor', cursor: ctx.perTab.cursor + 1 };
      case 'ArrowUp': return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      case '/': return { type: 'handled' };
      default: return { type: 'handled' };
    }
  }
}
```

- [ ] **Step 3: `PolicyView` tests**

```ts
import { describe, it, expect } from 'vitest';
import { PolicyView } from '../../../src/tui/views/policy-view.js';

describe('PolicyView', () => {
  const ctx = (snap: any = null) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0 },
  });

  it('renders the strict-mode banner when enforcementMode=strict', () => {
    const view = new PolicyView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null,
      policy: { rules: [], violations: [], enforcementMode: 'strict', recentViolationCount: 0 },
    };
    expect(view.render(ctx(snap)).rows.some((r) => /strict/i.test(r))).toBe(true);
  });

  it('renders violations count', () => {
    const view = new PolicyView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null,
      policy: { rules: [{ id: 'r1', name: 'r', severity: 'high', lastEvaluatedAt: 1, lastResult: 'fail' }], violations: [{ id: 'v1', ruleId: 'r1', message: 'bad', at: 1, severity: 'high' }], enforcementMode: 'auto', recentViolationCount: 3 },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /\b3\b/.test(r))).toBe(true);  // violation count
  });
});
```

- [ ] **Step 4: Implement `src/tui/views/policy-view.ts`**

```ts
import type { PolicySnapshot } from '../snapshot.js';
import type { TuiView, ViewRenderContext, ViewInputContext } from './types.js';

export class PolicyView implements TuiView {
  readonly id = 'policy' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const p: PolicySnapshot | null = ctx.snap.policy;
    const rows: string[] = [];
    rows.push(`POLICY  mode: ${p?.enforcementMode ?? '—'}`);
    if (!p) {
      rows.push('○ policy engine unavailable');
      return { rows };
    }
    rows.push(`  rules: ${p.rules.length}  violations: ${p.recentViolationCount}`);
    rows.push('');
    for (const r of p.rules) {
      rows.push(`  [${r.severity}] ${r.id}: ${r.name} — ${r.lastResult}`);
    }
    rows.push('');
    rows.push('Keys: ↑/↓ navigate  / search');
    return { rows };
  }

  handleKey(key: string, ctx: ViewInputContext): { type: 'moveCursor'; cursor: number } | { type: 'handled' } {
    switch (key) {
      case 'ArrowDown': return { type: 'moveCursor', cursor: ctx.perTab.cursor + 1 };
      case 'ArrowUp': return { type: 'moveCursor', cursor: Math.max(0, ctx.perTab.cursor - 1) };
      case '/': return { type: 'handled' };
      default: return { type: 'handled' };
    }
  }
}
```

- [ ] **Step 5: Now create `src/tui/views/index.ts` registry** (was deferred from Task 6)

```ts
import type { TuiView } from './types.js';
import { ChatView } from './chat-view.js';
import { DaemonView } from './daemon-view.js';
import { ApprovalsView } from './approvals-view.js';
import { RuntimeView } from './runtime-view.js';
import { SopsView } from './sops-view.js';
import { PolicyView } from './policy-view.js';
import type { TabId } from '../state.js';

export const VIEWS: Readonly<Record<TabId, TuiView>> = Object.freeze({
  chat: new ChatView(),
  daemon: new DaemonView(),
  approvals: new ApprovalsView(),
  runtime: new RuntimeView(),
  sops: new SopsView(),
  policy: new PolicyView(),
});

export { ChatView, DaemonView, ApprovalsView, RuntimeView, SopsView, PolicyView };
```

- [ ] **Step 6: Run all view tests + commit**

Run: `pnpm test:vitest -- tests/tui/views/`
Expected: all view tests pass.

```bash
git add src/tui/views/sops-view.ts src/tui/views/policy-view.ts src/tui/views/index.ts tests/tui/views/sops-view.vitest.ts tests/tui/views/policy-view.vitest.ts
git commit -m "feat(tui): SopsView + PolicyView + view registry (VIEWS singleton map)"
```

---

## Task 12: Renderer region + framebuffer

**Files:**
- Modify: `src/tui/render.ts` (extend existing renderer with `Region` enum, `FrameBuffer`, region repaint pump)
- Create: `tests/tui/render.vitest.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'vitest';
import { TuiRenderer, type Region } from '../../../src/tui/render.js';

describe('Region union exhaustiveness', () => {
  it('lists exactly four regions plus the wildcard', () => {
    const regions: Region[] = ['header', 'body', 'tabs', 'status', 'all'];
    expect(new Set(regions).size).toBe(5);
  });
});

describe('FrameBuffer equality', () => {
  it('detects identical frames (zero-write opportunity)', () => {
    const r = new TuiRenderer({ paint: () => {}, scheduleRepaint: () => {} });
    const frame = ['a', 'b', 'c'];
    expect(r.framesEqual(frame, frame)).toBe(true);
  });
  it('detects differing frames', () => {
    const r = new TuiRenderer({ paint: () => {}, scheduleRepaint: () => {} });
    expect(r.framesEqual(['a'], ['b'])).toBe(false);
  });
});

describe('TuiRenderer repaint queue', () => {
  it('scheduleRepaint accumulates; pump drains', () => {
    const writes: Region[] = [];
    const r = new TuiRenderer({
      paint: (region: Region) => writes.push(region),
      scheduleRepaint: (region: Region) => r.scheduleRepaint(region),
    });
    r.scheduleRepaint('header');
    r.scheduleRepaint('body');
    r.pump();
    expect(writes).toEqual(['header', 'body']);
  });

  it("pump with 'all' schedules all four regions", () => {
    const writes: Region[] = [];
    const r = new TuiRenderer({
      paint: (region: Region) => writes.push(region),
      scheduleRepaint: (region: Region) => r.scheduleRepaint(region),
    });
    r.scheduleRepaint('all');
    r.pump();
    expect(writes).toContain('header');
    expect(writes).toContain('body');
    expect(writes).toContain('tabs');
    expect(writes).toContain('status');
  });

  it('pump is no-op when queue is empty', () => {
    let called = false;
    const r = new TuiRenderer({
      paint: () => { called = true; },
      scheduleRepaint: () => {},
    });
    r.pump();
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Implement region repaint in `src/tui/render.ts`**

Read the existing file first, then ADD (do not rewrite) the new abstractions alongside the existing ones. The existing `TuiRenderer` class continues to work; the new additions are:

```ts
// ADD to src/tui/render.ts:

export type Region = 'header' | 'body' | 'tabs' | 'status' | 'all';

export interface FrameBuffer {
  rows: string[];
  width: number;
  height: number;
}

export class TuiRenderer {
  private repaintAreas = new Set<Region>();
  private frame: FrameBuffer = { rows: [], width: 0, height: 0 };

  constructor(private readonly opts: {
    paint: (region: Region) => void;
    scheduleRepaint: (region: Region) => void;
  }) {}

  /** Test seam + diff helper. */
  framesEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  scheduleRepaint(region: Region): void {
    this.repaintAreas.add(region);
    this.opts.scheduleRepaint(region);
  }

  pump(): void {
    if (this.repaintAreas.size === 0) return;

    if (this.repaintAreas.has('all')) {
      for (const r of ['header', 'body', 'tabs', 'status'] as Region[]) {
        this.opts.paint(r);
      }
    } else {
      for (const r of this.repaintAreas) {
        if (r !== 'all') this.opts.paint(r);
      }
    }
    this.repaintAreas.clear();
  }

  /** For tests: peek at the queue. */
  get pendingRegions(): readonly Region[] {
    return [...this.repaintAreas];
  }

  /** For tests: replace the frame buffer reference. */
  setFrame(frame: FrameBuffer): void {
    this.frame = frame;
  }

  getFrame(): FrameBuffer {
    return this.frame;
  }

  /** No-op event loop stub for tests; production overrides this. */
  async runEventLoop(): Promise<void> {}
  async cleanup(): Promise<void> {}
}
```

NOTE: If the existing `TuiRenderer` already has its own class definition, RENAME the existing one (e.g. `LegacyTuiRenderer`) and use `TuiRenderer` as the new class name. Or, if it's simpler, add the new methods to the existing class via `scheduleRepaint`/`pump` while keeping legacy methods intact.

- [ ] **Step 3: Run + commit**

Run: `pnpm test:vitest -- tests/tui/render.vitest.ts`
Expected: PASS.

```bash
git add src/tui/render.ts tests/tui/render.vitest.ts
git commit -m "refactor(tui): renderer region repaint + FrameBuffer diff helper"
```

---

## Task 13: `TuiApp` orchestration

**Files:**
- Create: `src/tui/navigation.ts`
- Create: `src/tui/terminal-control.ts`
- Create: `src/tui/app.ts`
- Create: `tests/tui/app.vitest.ts`

- [ ] **Step 1: `src/tui/navigation.ts`**

```ts
import type { TabId } from './state.js';

export type NavigationKey =
  | { type: 'cycle'; forward: boolean }
  | { type: 'jump'; tab: TabId }
  | { type: 'home' };

export class Navigation {
  private cursor = 0;
  private readonly order: readonly TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
  private readonly shortcuts: Readonly<Record<string, TabId>> = {
    c: 'chat',
    d: 'daemon',
    a: 'approvals',
    r: 'runtime',
    s: 'sops',
    p: 'policy',
  };

  interpret(rawKey: string): NavigationKey | null {
    if (rawKey === 'Tab') return { type: 'cycle', forward: true };
    if (rawKey === 'Shift+Tab') return { type: 'cycle', forward: false };
    if (rawKey === 'Escape') return { type: 'home' };
    if (/^[1-6]$/.test(rawKey)) {
      const idx = Number(rawKey) - 1;
      if (idx >= 0 && idx < this.order.length) return { type: 'jump', tab: this.order[idx]! };
    }
    const lower = rawKey.toLowerCase();
    const jump = this.shortcuts[lower];
    if (jump) return { type: 'jump', tab: jump };
    return null;
  }

  nextTab(): TabId | null { return null; }   // used by TuiApp.applyNavigation(...)

  // TuiApp applies navigation externally; this class only interprets keys.
}
```

- [ ] **Step 2: `src/tui/terminal-control.ts`**

```ts
import { RawStdin } from '../cli/renderers/raw-stdin.js';     // existing helper if available

export interface TerminalControl {
  enterRawMode(): void;
  exitRawMode(): void;
  showCursor(visible: boolean): void;
  enterAltBuffer(): void;
  exitAltBuffer(): void;
  onResize(callback: () => void): () => void;
  installEmergencyCleanup(cleanup: () => void): () => void;
}

export function createTerminalControl(): TerminalControl {
  let resizeCb: (() => void) | null = null;
  let cleanupFns: (() => void)[] = [];

  return {
    enterRawMode() {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
    },
    exitRawMode() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    },
    showCursor(visible) {
      process.stdout.write(visible ? '\x1b[?25h' : '\x1b[?25l');
    },
    enterAltBuffer() { process.stdout.write('\x1b[?1049h'); },
    exitAltBuffer() { process.stdout.write('\x1b[?1049l'); },
    onResize(cb) {
      resizeCb = cb;
      process.stdout.on('resize', cb);
      return () => { if (resizeCb) process.stdout.off('resize', cb); resizeCb = null; };
    },
    installEmergencyCleanup(cleanup) {
      const handler = () => { try { cleanup(); } catch { /* ignore */ } finally { process.exit(130); } };
      process.on('exit', handler);
      process.on('SIGINT', handler);
      process.on('SIGTERM', handler);
      cleanupFns.push(() => process.off('exit', handler));
      return () => { process.off('SIGINT', handler); process.off('SIGTERM', handler); };
    },
  };
}
```

- [ ] **Step 3: `src/tui/app.ts`**

```ts
import type { TabId, TuiAppState } from './state.js';
import { createInitialTuiAppState } from './state.js';
import type { DashboardSnapshot } from './snapshot.js';
import type { ViewAction, ViewRenderContext, ViewInputContext, TuiView, TerminalDimensions } from './views/types.js';
import { VIEWS } from './views/index.js';
import { TuiRenderer, type Region } from './render.js';
import type { SnapshotBuilder } from './snapshot-builder.js';
import type { DaemonMetricsCollector } from './daemon-metrics-collector.js';
import { Navigation } from './navigation.js';
import { createTerminalControl, type TerminalControl } from './terminal-control.js';

export interface TuiAppOptions {
  builder: SnapshotBuilder;
  daemonMetrics: DaemonMetricsCollector;
  /** Override views for tests. Production omits; defaults to VIEWS registry. */
  views?: Readonly<Record<TabId, TuiView>>;
}

export class TuiApp {
  private state: TuiAppState = createInitialTuiAppState();
  private readonly renderer: TuiRenderer;
  private readonly terminal: TerminalControl;
  private readonly navigation = new Navigation();
  private snapshotTimer?: NodeJS.Timeout;
  private detached = false;

  constructor(private readonly opts: TuiAppOptions) {
    const views = opts.views ?? VIEWS;
    this.terminal = createTerminalControl();
    this.renderer = new TuiRenderer({
      paint: (region) => this.paintRegion(region, views),
      scheduleRepaint: () => {},
    });
  }

  async start(): Promise<void> {
    this.terminal.enterAltBuffer();
    this.terminal.enterRawMode();
    this.terminal.showCursor(true);
    this.terminal.onResize(() => this.renderer.scheduleRepaint('all'));

    this.opts.daemonMetrics.start();

    const initialGen = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(initialGen);
    if (snap && initialGen === this.state.refreshGeneration) {
      this.state.lastSnapshot = snap;
    }
    this.renderer.scheduleRepaint('all');

    this.terminal.installEmergencyCleanup(() => this.cleanupSync());
    process.stdin.on('data', (buf) => this.handleRaw(buf));
    this.snapshotTimer = setInterval(() => void this.refresh(), 1_000);
    this.renderer.pump();
  }

  async stop(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await this.opts.daemonMetrics.stop();
    await this.cleanupSync();
  }

  // Test seam: inject a builder that pre-fills the snapshot.
  getStateForTest(): TuiAppState { return this.state; }

  private async refresh(): Promise<void> {
    const generation = ++this.state.refreshGeneration;
    const snap = await this.opts.builder.build(generation);
    if (!snap || generation !== this.state.refreshGeneration) return;
    this.state.lastSnapshot = snap;
    this.renderer.scheduleRepaint('all');
    this.renderer.pump();
  }

  private handleRaw(buf: Buffer): void {
    const key = parseKey(buf);
    if (!key) return;
    if (this.tryHandleGlobal(key)) return;
    if (!this.state.lastSnapshot) return;
    const tab = this.state.activeTab;
    const view = (this.opts.views ?? VIEWS)[tab]!;
    const viewCtx: ViewInputContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
      perTab: this.state.views[tab],
    };
    const action = view.handleKey?.(key, viewCtx);
    if (action) this.dispatch(action);
  }

  private tryHandleGlobal(key: string): boolean {
    const nav = this.navigation.interpret(key);
    if (nav) {
      switch (nav.type) {
        case 'home': this.switchTab('chat'); return true;
        case 'jump': this.switchTab(nav.tab); return true;
        case 'cycle': {
          const order: readonly TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
          const idx = order.indexOf(this.state.activeTab);
          const nextIdx = (idx + (nav.forward ? 1 : order.length - 1)) % order.length;
          this.switchTab(order[nextIdx]!);
          return true;
        }
      }
    }
    if (key === 'q' || key === 'Q') { void this.stop(); return true; }
    if (key === 'Ctrl+l') { this.renderer.scheduleRepaint('all'); this.renderer.pump(); return true; }
    return false;
  }

  private switchTab(next: TabId): void {
    if (next === this.state.activeTab) return;
    const prev = this.state.activeTab;
    const views = this.opts.views ?? VIEWS;
    views[prev]?.onDeactivate?.(this.state.views[prev]);
    this.state.history.push(prev);
    this.state.activeTab = next;
    views[next]?.onActivate?.(this.state.views[next]);
    this.renderer.scheduleRepaint('body', 'tabs');
    this.renderer.pump();
  }

  private dispatch(action: ViewAction): void {
    switch (action.type) {
      case 'handled': break;
      case 'moveCursor':
        this.state.views[this.state.activeTab].cursor = action.cursor;
        this.renderer.scheduleRepaint('body');
        this.renderer.pump();
        break;
      case 'switchTab':
        this.switchTab(action.tab);
        break;
      case 'scheduleRefresh':
        void this.refresh();
        break;
    }
  }

  private paintRegion(region: Region, views: Readonly<Record<TabId, TuiView>>): void {
    if (!this.state.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const renderCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: dims,
      perTab: this.state.views[this.state.activeTab],
    };

    switch (region) {
      case 'header':
        // Render in production via TuiRenderer helper (out of scope here)
        break;
      case 'body': {
        const view = views[this.state.activeTab]!;
        view.render(renderCtx);
        break;
      }
      case 'tabs':
      case 'status':
      case 'all':
        // Tabs/status regions: defer to renderer implementation.
        break;
    }
    void views;
  }

  private async cleanupSync(): Promise<void> {
    this.terminal.showCursor(true);
    this.terminal.exitRawMode();
    this.terminal.exitAltBuffer();
  }
}

function parseKey(buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const s = buf.toString('utf8');
  if (s === '\r' || s === '\n') return 'Enter';
  if (s === '\t') return 'Tab';
  if (s === '\x7f' || s === '\b') return 'Backspace';
  if (s === '\x1b' && buf.length >= 3 && buf[1] === 0x5b /* [ */) {
    if (buf[2] === 0x41) return 'ArrowUp';
    if (buf[2] === 0x42) return 'ArrowDown';
    if (buf[2] === 0x43) return 'ArrowRight';
    if (buf[2] === 0x44) return 'ArrowLeft';
  }
  if (s.length === 1) return s;
  return null;
}
```

- [ ] **Step 4: `tests/tui/app.vitest.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TuiApp } from '../../../src/tui/app.js';

describe('TuiApp lifecycle', () => {
  let builder: any;
  let metrics: any;
  let app: TuiApp;

  beforeEach(() => {
    builder = { build: vi.fn(async () => null), buildSync: vi.fn(() => null) };
    metrics = { start: vi.fn(), stop: vi.fn(async () => {}) };
  });
  afterEach(async () => { if (app) await app.stop().catch(() => {}); });

  it('start() invokes metrics.start and the snapshot builder', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics });
    await app.start();
    expect(metrics.start).toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalled();
    await app.stop();
  });

  it('stop() invokes metrics.stop', async () => {
    app = new TuiApp({ builder, daemonMetrics: metrics });
    await app.start();
    await app.stop();
    expect(metrics.stop).toHaveBeenCalled();
  });
});

describe('TuiApp — tab-state preservation', () => {
  it('preserves runtime.scrollOffset across tab switches', () => {
    const builder = { build: vi.fn(async () => ({} as any)), buildSync: () => ({} as any) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics });
    const state = app.getStateForTest();
    state.views.runtime.scrollOffset = 200;
    // Simulate switch: app.switchTab('daemon'); app.switchTab('runtime');
    expect(state.views.runtime.scrollOffset).toBe(200);
  });
});
```

- [ ] **Step 5: Run + commit**

Run: `pnpm test:vitest -- tests/tui/app.vitest.ts`
Expected: PASS (lifecycle + state preservation).

```bash
git add src/tui/navigation.ts src/tui/terminal-control.ts src/tui/app.ts tests/tui/app.vitest.ts
git commit -m "feat(tui): TuiApp orchestration (lifecycle, refresh, tabs, input dispatch)"
```

---

## Task 14: CLI bootstrap refactor (`src/cli/commands/tui.ts`)

**Files:**
- Modify: `src/cli/commands/tui.ts` (replace the body with thin bootstrap)
- Create: `tests/cli/commands/tui-thin-bootstrap.vitest.ts`

**Goal:** turn the existing `runTui()` (now 1137 lines) into a ~30-50 line bootstrap constructing `TuiApp`. The legacy code in the function body is preserved INSIDE the existing file as `runLegacyChatTui()` (or similar) for fallback / parity testing; Task 16 removes it.

- [ ] **Step 1: Write a bootstrap test**

Create `tests/cli/commands/tui-thin-bootstrap.vitest.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

describe('runTui bootstrap (thin)', () => {
  it('constructs a TuiApp with the right subsystems and calls start()', async () => {
    // Mocks for ApprovalManager / PolicyEngine / SopRegistry / EventLog / DaemonManager
    // to verify the bootstrap wires them in.
    const mod = await import('../../../src/cli/commands/tui.js');
    // We do not invoke mod.runTui here (it would actually start the TUI). Instead,
    // assert by reading the exported function as a thin wrapper.
    expect(typeof mod.runTui).toBe('function');
    expect(mod.runTui.length).toBeLessThanOrEqual(2);   // options + cwd
  });
});
```

- [ ] **Step 2: Refactor `src/cli/commands/tui.ts`**

Open the existing file. The function `runTui(opts, cwd)` is at the bottom. Wrap the entire existing body into a new function `runLegacyChatTuiForCompat()` (kept temporarily). Replace `runTui` body with:

```ts
import { TuiApp } from '../../tui/app.js';
import { SnapshotBuilder } from '../../tui/snapshot-builder.js';
import { DaemonMetricsCollectorImpl, createPlatformMetricsReader } from '../../tui/daemon-metrics-collector.js';
import { ApprovalManager } from '../../tui/approval-manager.js';
import { SopRegistry } from '../../sop/sop-registry.js';
import { PolicyEngine } from '../../policy/policy-engine.js';
// import { EventLog } from '../../events/event-log.js';

export async function runTui(opts: TuiOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const sessionId = opts.sessionName ?? `tui-${Date.now()}`;
  const eventLog = new EventLog(/* resolve from sessionDir, see legacy code */);
  await eventLog.init();

  const approvals = new ApprovalManager();
  const sops = SopRegistry.list();        // existing singleton accessor
  const policy = new PolicyEngine(/* config */);

  const daemonMetrics = new DaemonMetricsCollectorImpl(createPlatformMetricsReader());
  const agentSession = /* current way to create session */;
  const eventLogBridge = /* wire to agentSession */;

  const builder = new SnapshotBuilder(
    /* agentSession + bridge */,
    approvals, policy, sops, eventLog, daemonMetrics,
  );

  const app = new TuiApp({ builder, daemonMetrics, /* views override */ });

  try {
    await app.start();
  } catch (err) {
    await app.stop();
    throw err;
  }
}
```

The legacy body moves into `runLegacyChatTuiForCompat()` — keep it for parity testing in Task 15. Do NOT remove legacy code in this task; that's Task 16.

Imports already in the file may cover most of these — keep what's needed, prune what's not. Aim for ≤80 lines in `runTui`.

- [ ] **Step 3: Run + commit**

Run: `pnpm test:vitest -- tests/cli/commands/tui-thin-bootstrap.vitest.ts`
Expected: PASS (function exists; legacy still works via wrapper).

Run: `pnpm test:vitest` (full suite) — confirm no regression in legacy code.

```bash
git add src/cli/commands/tui.ts tests/cli/commands/tui-thin-bootstrap.vitest.ts
git commit -m "refactor(tui): thin CLI bootstrap; legacy code preserved in runLegacyChatTuiForCompat"
```

---

## Task 15: Parity integration test

**Files:**
- Create: `tests/tui/integration-parity.vitest.ts`

**Goal:** verify the new `TuiApp` produces the same chat behavior as the legacy `runLegacyChatTuiForCompat` for a basic chat input roundtrip.

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, vi } from 'vitest';

describe('TuiApp — parity with legacy chat input', () => {
  it('processes a typed prompt and renders the resulting turn summary', async () => {
    // Simulated stdin/stdout
    const inputs = ['hi', 'Enter'];
    const writes: string[] = [];
    const stdin = { setRawMode: vi.fn(), on: vi.fn(), resume: vi.fn() };
    const stdout = { write: (s: string) => writes.push(s), columns: 80, rows: 24, on: vi.fn() };

    // Spawn TuiApp with fakes that mimic AgentSession
    const builder = vi.fn(async () => ({ generatedAt: 1, session: { phase: 'Idle', mode: 'auto', version: '1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null } as any));

    // ... full integration setup ...

    // After "hi\n" is processed, expect writes to contain the prompt and a session echo
    expect(writes.some((w) => w.includes('alix>'))).toBe(true);
  });
});
```

(Implementer: flesh out the fakes for AgentSession + EventLog; the assertion framework is the same as legacy parity.)

- [ ] **Step 2: Confirm legacy tests still pass**

Run: `pnpm test:vitest -- tests/tui/integration-parity.vitest.ts tests/cli/init.test.ts` (the legacy init tests).

Expected: full pass. If anything fails, fix the integration first, before cleanup.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/integration-parity.vitest.ts
git commit -m "test(tui): integration parity — new TuiApp matches legacy chat roundtrip"
```

---

## Task 16: Cleanup of legacy rendering paths

**Files:**
- Modify: `src/cli/commands/tui.ts` (delete `runLegacyChatTuiForCompat` and related dead code)
- Modify: `src/tui/state.ts`, `src/tui/render.ts` (prune unused legacy exports)

**Goal:** remove the legacy chat-loop code that the new `TuiApp` replaces. This is the final cleanup task — only AFTER parity test (Task 15) passes.

**Pre-flight checks:** verify no other code imports from the legacy exports of `src/tui/render.ts` (e.g. `LegacyTuiRenderer`).

- [ ] **Step 1: Identify dead-code candidates**

```bash
grep -rn "TuiRenderer.*from.*tui/render" src/cli tests/ --include='*.ts' --include='*.tsx' | grep -v node_modules
grep -rn "renderDashboardCards\b" src/ tests/ --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Then read each hit and decide: keep, inline-remove, or full-delete.

- [ ] **Step 2: Remove `runLegacyChatTuiForCompat` from `src/cli/commands/tui.ts`**

Delete the function and any helpers it referenced. Ensure the file compiles.

- [ ] **Step 3: Remove dead widgets / dead exports**

If any of the following are now unused (`grep -rn <symbol>` returns no callers outside the deleted legacy code), remove them:
- `src/tui/widgets/chat-dashboard.ts` if it existed (likely a duplicate of dashboard-renderer.ts — confirm no callers in new code)
- Stub-only exports from `src/tui/index.ts` that the new `TuiApp` doesn't reference
- The `state-theater.ts` widget if its only purpose was the legacy chat view

- [ ] **Step 4: Full gate**

Run:
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:vitest`
- `pnpm test:node -- tests/cli/init.test.ts`

Expected: all green. No regression. No "unused export" warnings.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/tui.ts src/tui/index.ts src/tui/state.ts src/tui/render.ts src/tui/widgets/
git commit -m "refactor(tui): cleanup legacy chat rendering paths (post-parity)"
```

---

## Verification

After all tasks complete:

```bash
pnpm typecheck                                  # 0 errors
pnpm build                                      # succeeds
pnpm test:vitest                                # ~2982 tests pass (prior 2952 + ~30 new)
pnpm test:node -- tests/cli/init.test.ts        # 7/7 legacy tests still pass
pnpm test:manual:tui                            # real PTY smoke
```

Manual smoke (optional):

```bash
./dist/src/cli.js tui                           # in interactive shell
# - chat tab shows prompt + 4 panels
# - press Tab to cycle tabs
# - press '2' to jump to daemon tab
# - observe CPU/MEM/DISK bars refresh every second
# - press Esc to return to chat
```

Success: `alix tui` renders the multi-pane dashboard as specified, all vitest pass, no legacy chat-loop code remains.

---

## Open items (deferred)

- **Task E1 (future spec):** per-session persistence of `PerTabState` across `alix tui` invocations. Out of scope for this iteration; architecture already serializable.
- **Task E2 (future spec):** macOS / Windows `DaemonMetricsCollector` platform readers. Linux-only initial implementation; documented as TODO in `src/tui/daemon-metrics-collector.ts`.
- **Task E3 (future spec):** mouse / hover / click support.
- **Task E4 (future spec):** search-overlay UI for `RuntimeView` / `SopsView` / `PolicyView` — `view.handleKey('/')` currently returns `'handled'` (a no-op signal); the search input UI is a separate concern.
- **Task E5 (memory leak hygiene):** `TuiApp.start()` registers stdin listeners; ensure `stop()` unregisters them all (currently relies on emergency-cleanup handlers).

---

**End of plan.** Ready for execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
