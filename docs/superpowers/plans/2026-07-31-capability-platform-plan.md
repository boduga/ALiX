# ALiX Capability Platform — Phase 1 Implementation Plan

**Status:** Approved Implementation Plan (with refinements)  
**Date:** 2026-07-31  
**Spec:** `docs/superpowers/specs/2026-07-31-capability-platform-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Build the Capability Platform — a reusable execution substrate (Registry / Resolver / Runtime / Executors / EventBus) with no TUI assumptions — and migrate existing ALiX functionality behind declarative capability definitions.

## Architecture

Five components plus a bootstrap. `Capability` is pure data. `CapabilityRegistry` owns metadata + discovery. `ExecutionResolver` turns (capability, context) into `ExecutionPlan[]`. `CapabilityRuntime` creates `Invocation`s and coordinates execution — it owns no invocation registry or lifecycle history. `ExecutorRegistry` holds pluggable executors. `EventBus` publishes system-wide events. `CapabilityPlatform` composes the five for consumers.

```
Capability Definitions (registerCapability / META)
        │
        ▼
CapabilityRegistry      ← what exists?       metadata + discovery
        │
        ▼
ExecutionResolver       ← how should this run?  routing → ExecutionPlan[]
        │
        ▼
CapabilityRuntime       ← how is it run?     creates Invocation, no registry/history
        │
        ▼
ExecutorRegistry        ← who executes?      pluggable backends
        │
        ▼
EventBus                ← who observes?      system events → AlixEvent adapter
```

**Domain integrations live OUTSIDE the capability package** (`src/integrations/`), so the platform core stays reusable and dependency-free.

## Global Invariants

1. **`Capability` is pure data** — fully serializable, no functions, no hooks, no runtime state. `registry.export()` must reproduce the complete manifest without stripping.
2. **Hooks are never embedded in Capability metadata.** They register separately in a `HookRegistry`, keyed by capability id.
3. **`CapabilityRuntime` owns no invocation registry or lifecycle history.** Invocation state is encapsulated by the returned `Invocation` handles; the runtime creates state but does not retain it. History/persistence belongs to a future `InvocationStore`, out of scope.
4. **Phase 1 models single-step plans internally but exposes multi-step structure** — `ExecutionPlan = { capabilityId, steps }` — to preserve future workflow composition without API migration.
5. **No competing event ecosystem.** `CapabilityEvent` is the platform-internal surface; an adapter maps it onto the existing `AlixEvent`/`EventLog` pipeline.
6. **Capability IDs are validated** against `^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$` at registration — rejects `SessionList`, `foo`, `../../bad`.
7. **Permissions are normalized** — a single `Permission` union used consistently: capability `requiredPermissions`, context `permissions`, plan step `permissions`.
8. **Errors are typed** — `src/capability/errors.ts` defines capability-domain errors (not bare `Error`).
9. **Phase 1 is a library with no UI assumptions.** No Explorer, Palette, plugin discovery, remote execution, workflow composition, or invocation persistence.
10. Follow existing codebase conventions: NodeNext ESM (`import ... from "./x.js"`), strict mode, vitest. Platform files under `src/capability/`; domain integrations under `src/integrations/`; tests under `tests/capability/`.
11. Every task ends green: `npm run build` passes and the task's tests pass.

## Repository Layout

| File | Role |
|---|---|
| `src/capability/types.ts` | `Capability`, `CapabilityStatus`, `CapabilityContext`, `Invocation`, `InvocationResult`, `InvocationStatus`, `Permission`, `CapabilityEvent`, `AsyncEventQueue` |
| `src/capability/errors.ts` | Typed capability errors |
| `src/capability/registry.ts` | `CapabilityRegistry` — metadata only, ID validation |
| `src/capability/hook-registry.ts` | `HookRegistry` — lifecycle hooks, separate from metadata |
| `src/capability/execution-resolver.ts` | `ExecutionResolver`, `ExecutionPlan` (with `capabilityId`), `ExecutionPlanStep` |
| `src/capability/executors.ts` | `ExecutorRegistry`, `CapabilityExecutor`, `NativeExecutor`, `ToolExecutorAdapter` |
| `src/capability/event-bus.ts` | `EventBus` + `toAlixEvent` adapter seam |
| `src/capability/runtime.ts` | `CapabilityRuntime` — no invocation registry, cancellation-safe, status getter |
| `src/capability/platform.ts` | `CapabilityPlatform` — composes the five services |
| `src/capability/initial-capabilities.ts` | Pure capability definitions (no domain deps) |
| `src/capability/tool-adapter.ts` | Existing `ToolExecutor` → `tool` strategy adapter |
| `src/integrations/session-capabilities.ts` | Domain wiring: session impl behind `core.session.*` |
| `src/capability/index.ts` | Public barrel (does NOT export integrations) |
| `tests/capability/*.vitest.ts` | Tests per module |

---

### Task 1: Capability contracts + errors

**Files:**
- Create: `src/capability/types.ts`
- Create: `src/capability/errors.ts`
- Test: `tests/capability/types.vitest.ts`

**Interfaces:**
- Produces: `Capability`, `CapabilityStatus`, `CapabilityContext`, `Invocation`, `InvocationResult`, `InvocationStatus`, `Permission`, `CapabilityEvent`, `EventBusLike`, `AsyncEventQueue`, and typed errors. `Invocation.status` is a **read-only getter**, not a frozen value.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/types.vitest.ts
import { describe, it, expect } from 'vitest';
import { AsyncEventQueue } from '../../src/capability/types.js';
import type { Capability } from '../../src/capability/types.js';

describe('Capability type contract', () => {
  it('is structurally typed for a minimal core capability', () => {
    const cap: Capability = {
      id: 'core.session.list', version: '1.0', kind: 'core',
      title: 'List sessions', description: 'List all sessions',
      tags: ['session'], category: 'session', risk: 'low',
      requiredPermissions: ['operator'],
      execution: { strategy: 'native' },
    };
    expect(cap.id).toBe('core.session.list');
    expect(cap.execution.strategy).toBe('native');
  });

  it('accepts multiple required permissions, schemas, examples, deps', () => {
    const cap: Capability = {
      id: 'tool.file.read', version: '1.0', kind: 'tool',
      title: 'Read file', description: 'Read a file',
      tags: ['file'], category: 'file', risk: 'low',
      requiredPermissions: ['developer', 'operator'],
      argsSchema: { type: 'object', properties: { path: { type: 'string' } } },
      resultSchema: { type: 'string' },
      examples: ['/tool.file.read path="a.ts"'],
      execution: { strategy: 'tool', timeout: 10_000, cancellable: false },
      dependencies: ['core.cwd'],
      extensions: { source: 'builtin' },
    };
    expect(cap.requiredPermissions).toContain('developer');
  });
});

describe('AsyncEventQueue', () => {
  it('buffers events and drains them as an async iterable', async () => {
    const q = new AsyncEventQueue<number>();
    q.push(1); q.push(2); q.close();
    const seen: number[] = [];
    for await (const n of q) seen.push(n);
    expect(seen).toEqual([1, 2]);
  });

  it('delivers events pushed after iteration starts', async () => {
    const q = new AsyncEventQueue<number>();
    const seen: number[] = [];
    const iter = (async () => {
      for await (const n of q) { seen.push(n); if (seen.length === 2) break; }
    })();
    q.push(10); q.push(20);
    await iter;
    expect(seen).toEqual([10, 20]);
  });

  it('preserves ordering with a delayed consumer (slow pull)', async () => {
    const q = new AsyncEventQueue<number>();
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const n of q) {
        seen.push(n);
        await new Promise((r) => setTimeout(r, 5)); // consumer is slower than producer
      }
    })();
    // Producer fires several events while the consumer is mid-await.
    q.push(1); q.push(2); q.push(3); q.push(4);
    q.close();
    await consumer;
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/types.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the type + error modules**

```typescript
// src/capability/types.ts
export type Permission = "operator" | "admin" | "developer" | "internal";

/** Pure-data capability definition. Fully serializable — no functions. */
export interface Capability {
  id: string;                       // namespaced: "core.session.list"
  version: string;
  kind: "core" | "tool" | "skill" | "custom" | "workflow" | "plugin";
  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: "low" | "medium" | "high" | "critical";
  requiredPermissions: Permission[];
  argsSchema?: Record<string, unknown>;   // JSON Schema object
  resultSchema?: Record<string, unknown>; // JSON Schema object
  examples?: string[];
  execution: {
    strategy: string;               // "native" | "tool" | "daemon" | "agent" | "cli" | ...
    timeout?: number;               // ms
    cancellable?: boolean;
  };
  dependencies?: string[];
  extensions?: Record<string, unknown>;
}

/** Dynamic runtime state — separated from Capability metadata.
 *  Phase 1 co-locates status storage with the registry; a future
 *  CapabilityStatusStore may extract it. */
export interface CapabilityStatus {
  capabilityId: string;
  availability: "available" | "unavailable" | "degraded";
  health: "healthy" | "warning" | "error";
  lastChecked: number;
}

export type InvocationStatus =
  | "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";

export interface InvocationResult {
  invocationId: string;
  status: InvocationStatus;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

export interface Invocation {
  id: string;
  /** Read-only getter — reflects live state, not a frozen snapshot. */
  readonly status: InvocationStatus;
  startedAt?: number;
  completedAt?: number;
  cancel(): void;
  subscribe(handler: (evt: CapabilityEvent) => void): () => void;
  wait(): Promise<InvocationResult>;
  result(): InvocationResult | undefined;
  events(): AsyncIterable<CapabilityEvent>;
}

export type CapabilityEvent =
  | { type: "CapabilityRegistered"; capabilityId: string; at: number }
  | { type: "CapabilityRemoved"; capabilityId: string; at: number }
  | { type: "InvocationStarted"; invocationId: string; capabilityId: string; at: number }
  | { type: "InvocationProgress"; invocationId: string; progress: number; at: number }
  | { type: "InvocationOutput"; invocationId: string; chunk: string; at: number }
  | { type: "InvocationCompleted"; invocationId: string; at: number }
  | { type: "InvocationFailed"; invocationId: string; error: string; at: number }
  | { type: "InvocationCancelled"; invocationId: string; at: number }
  | { type: "PermissionDenied"; capabilityId: string; actor: string; at: number }
  | { type: "AvailabilityChanged"; capabilityId: string; status: CapabilityStatus; at: number };

/** Context passed to every invocation. */
export interface CapabilityContext {
  invocationId: string;
  requestId: string;
  actor: string;
  permissions: Permission[];
  cwd: string;
  workspace: string;
  sessionId: string;
  cancellationToken: AbortSignal;
  eventBus: EventBusLike;
}

export interface EventBusLike {
  emit(event: CapabilityEvent): void;
}

export interface ExecutorRunResult {
  output?: unknown;
  error?: string;
}

/** In-memory FIFO async event queue. No persistence, no history.
 *  Drives Invocation.events(). Ordering is preserved for slow consumers. */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.buffer.push(item);
    this.waiters.shift()?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters) w();
    this.waiters = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
```

```typescript
// src/capability/errors.ts
/** Typed capability-domain errors. Consumers (TUI, Web, MCP) map these
 *  onto their own error surfaces without string-parsing messages. */
export class CapabilityNotFoundError extends Error {
  constructor(capabilityId: string) {
    super(`Unknown capability: ${capabilityId}`);
    this.name = "CapabilityNotFoundError";
  }
}

export class CapabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityValidationError";
  }
}

export class ExecutorNotFoundError extends Error {
  constructor(strategy: string) {
    super(`No executor for strategy: ${strategy}`);
    this.name = "ExecutorNotFoundError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(capabilityId: string, actor: string) {
    super(`Permission denied for ${actor} invoking ${capabilityId}`);
    this.name = "PermissionDeniedError";
  }
}

export class InvocationCancelledError extends Error {
  constructor(invocationId: string) {
    super(`Invocation cancelled: ${invocationId}`);
    this.name = "InvocationCancelledError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/types.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/types.ts src/capability/errors.ts tests/capability/types.vitest.ts
git commit -m "feat(capability): add pure-data contracts, typed errors, AsyncEventQueue"
```

---

### Task 2: CapabilityRegistry + HookRegistry

**Files:**
- Create: `src/capability/registry.ts`
- Create: `src/capability/hook-registry.ts`
- Test: `tests/capability/registry.vitest.ts`

**Interfaces:**
- Consumes: `Capability`, `CapabilityStatus`, `CapabilityContext`, `InvocationResult`, `CapabilityValidationError` from Task 1.
- Produces: `CapabilityRegistry` (metadata only, with **ID validation**) and `HookRegistry`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/registry.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { CapabilityValidationError } from '../../src/capability/errors.js';
import type { Capability } from '../../src/capability/types.js';

function makeCap(over: Partial<Capability> = {}): Capability {
  return {
    id: 'core.session.list', version: '1.0', kind: 'core', title: 'List sessions',
    description: 'List all sessions', tags: ['session'], category: 'session',
    risk: 'low', requiredPermissions: ['operator'], execution: { strategy: 'native' },
    ...over,
  };
}

describe('CapabilityRegistry', () => {
  it('registers, finds, unregisters', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    expect(r.find('core.session.list')?.title).toBe('List sessions');
    r.unregister('core.session.list');
    expect(r.find('core.session.list')).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    expect(() => r.register(makeCap())).toThrow(/already registered/);
  });

  it('rejects invalid capability IDs', () => {
    const r = new CapabilityRegistry();
    for (const bad of ['SessionList', 'foo', '../../bad', 'noDotAtAll']) {
      expect(() => r.register(makeCap({ id: bad }))).toThrow(CapabilityValidationError);
    }
    // Valid namespaced IDs pass.
    for (const good of ['core.session.list', 'tool.file.read', 'mcp.github.issue.create']) {
      expect(() => r.register(makeCap({ id: good }))).not.toThrow();
    }
  });

  it('query filters by tags, category, risk, permissions, kinds, namespaces', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap({ id: 'core.session.list', tags: ['session'], category: 'session', risk: 'low' }));
    r.register(makeCap({ id: 'tool.file.read', tags: ['file'], category: 'file', risk: 'medium' }));
    r.register(makeCap({ id: 'tool.file.write', tags: ['file'], category: 'file', risk: 'high' }));
    expect(r.query({ tags: ['file'] }).map(c => c.id)).toEqual(['tool.file.read', 'tool.file.write']);
    expect(r.query({ category: 'file', risk: 'high' }).map(c => c.id)).toEqual(['tool.file.write']);
    expect(r.query({ kinds: ['tool'] }).length).toBe(2);
    expect(r.query({ text: 'session' }).map(c => c.id)).toEqual(['core.session.list']);
  });

  it('query supports namespace prefix filtering', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap({ id: 'tool.file.read' }));
    r.register(makeCap({ id: 'tool.shell.run' }));
    r.register(makeCap({ id: 'core.session.list' }));
    expect(r.query({ namespaces: ['tool'] }).map(c => c.id)).toEqual(['tool.file.read', 'tool.shell.run']);
  });

  it('export is JSON-serializable round-trip', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    const round = JSON.parse(JSON.stringify(r.export()));
    expect(round.version).toBe(1);
    expect(round.functions).toHaveLength(1);
    expect(round.functions[0].id).toBe('core.session.list');
  });

  it('watch fires on register', () => {
    const r = new CapabilityRegistry();
    const cb = vi.fn();
    r.watch(cb);
    r.register(makeCap());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setStatus/getStatus keep runtime state separate from metadata', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    r.setStatus('core.session.list', { availability: 'degraded', health: 'warning' });
    expect(r.getStatus('core.session.list')?.availability).toBe('degraded');
    expect(r.find('core.session.list')?.execution.strategy).toBe('native'); // metadata untouched
  });
});

describe('HookRegistry', () => {
  it('stores hooks per capability id, separate from metadata', () => {
    const h = new HookRegistry();
    const hooks = { canInvoke: () => true };
    h.set('core.session.list', hooks);
    expect(h.get('core.session.list')).toBe(hooks);
    expect(h.get('other.x')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/registry.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the registry + hook registry**

```typescript
// src/capability/registry.ts
import { CapabilityValidationError } from "./errors.js";
import type { Capability, CapabilityStatus } from "./types.js";

export interface CapabilityQuery {
  text?: string;
  tags?: string[];
  category?: string;
  risk?: string;
  permissions?: string;
  kinds?: string[];
  namespaces?: string[];
}

export interface CapabilityManifest {
  version: 1;
  generatedAt: string;
  functions: Capability[];
}

/** Rejects invalid IDs. Allowed: core.session.list, tool.file.read,
 *  mcp.github.issue.create. Rejected: SessionList, foo, ../../bad. */
const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

export class CapabilityRegistry {
  private byId = new Map<string, Capability>();
  private status = new Map<string, CapabilityStatus>();
  private watchers = new Set<(evt: { type: "registered" | "removed"; capabilityId: string }) => void>();

  register(capability: Capability): void {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new CapabilityValidationError(`Invalid capability id: ${capability.id} (must match ${CAPABILITY_ID.source})`);
    }
    if (this.byId.has(capability.id)) {
      throw new CapabilityValidationError(`Capability already registered: ${capability.id}`);
    }
    this.byId.set(capability.id, capability);
    for (const w of this.watchers) w({ type: "registered", capabilityId: capability.id });
  }

  unregister(id: string): void {
    if (!this.byId.delete(id)) return;
    this.status.delete(id);
    for (const w of this.watchers) w({ type: "removed", capabilityId: id });
  }

  find(id: string): Capability | undefined { return this.byId.get(id); }
  list(): Capability[] { return [...this.byId.values()]; }
  describe(id: string): Capability | undefined { return this.byId.get(id); }

  query(q: CapabilityQuery = {}): Capability[] {
    let results = this.list();
    if (q.text) {
      const t = q.text.toLowerCase();
      results = results.filter(c =>
        c.id.toLowerCase().includes(t) ||
        c.title.toLowerCase().includes(t) ||
        c.description.toLowerCase().includes(t) ||
        (c.aliases ?? []).some(a => a.toLowerCase().includes(t)));
    }
    if (q.tags?.length) results = results.filter(c => q.tags!.some(t => c.tags.includes(t)));
    if (q.category) results = results.filter(c => c.category === q.category);
    if (q.risk) results = results.filter(c => c.risk === q.risk);
    if (q.permissions) results = results.filter(c => c.requiredPermissions.includes(q.permissions as Capability["requiredPermissions"][number]));
    if (q.kinds?.length) results = results.filter(c => q.kinds!.includes(c.kind));
    if (q.namespaces?.length) results = results.filter(c => q.namespaces!.some(ns => c.id.startsWith(`${ns}.`)));
    return results;
  }

  setStatus(id: string, s: { availability?: CapabilityStatus["availability"]; health?: CapabilityStatus["health"] }): void {
    const prev = this.status.get(id);
    const next: CapabilityStatus = {
      capabilityId: id,
      availability: s.availability ?? prev?.availability ?? "available",
      health: s.health ?? prev?.health ?? "healthy",
      lastChecked: Date.now(),
    };
    this.status.set(id, next);
  }

  getStatus(id: string): CapabilityStatus | undefined { return this.status.get(id); }

  reload(): void {
    // No-op in Phase 1. Plugin loader hooks here later to re-scan/re-register.
  }

  watch(cb: (evt: { type: "registered" | "removed"; capabilityId: string }) => void): () => void {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  }

  export(): CapabilityManifest {
    return { version: 1, generatedAt: new Date().toISOString(), functions: this.list() };
  }
}
```

```typescript
// src/capability/hook-registry.ts
import type { CapabilityContext, InvocationResult } from "./types.js";

export type CapabilityHooks = {
  validate?: (args: Record<string, unknown>, ctx: CapabilityContext) => string | undefined;
  canInvoke?: (ctx: CapabilityContext) => boolean;
  beforeInvoke?: (ctx: CapabilityContext) => void | Promise<void>;
  afterInvoke?: (result: InvocationResult, ctx: CapabilityContext) => void | Promise<void>;
};

/** Hooks live OUTSIDE Capability metadata. Approvals, policy, audit,
 *  metrics, and evidence plug in here without special cases. */
export class HookRegistry {
  private hooks = new Map<string, CapabilityHooks>();

  set(capabilityId: string, hooks: CapabilityHooks): void {
    this.hooks.set(capabilityId, hooks);
  }

  get(capabilityId: string): CapabilityHooks | undefined {
    return this.hooks.get(capabilityId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/registry.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/registry.ts src/capability/hook-registry.ts tests/capability/registry.vitest.ts
git commit -m "feat(capability): add CapabilityRegistry (ID validation) + HookRegistry"
```

---

### Task 3: ExecutionResolver + ExecutionPlan

**Files:**
- Create: `src/capability/execution-resolver.ts`
- Test: `tests/capability/execution-resolver.vitest.ts`

**Interfaces:**
- Consumes: `Capability` (Task 1), `CapabilityRegistry` (Task 2), `CapabilityNotFoundError` (Task 1).
- Produces: `ExecutionPlan` (**includes `capabilityId`**), `ExecutionPlanStep`, `ExecutionResolver.resolve(capabilityId, ctx) → ExecutionPlan[]`.

**Shape note:** Phase 1 models single-step plans internally but exposes a multi-step structure (`{ capabilityId, steps }`) to preserve future workflow composition without API migration.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/execution-resolver.vitest.ts
import { describe, it, expect } from 'vitest';
import { ExecutionResolver } from '../../src/capability/execution-resolver.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';

function ctx(): CapabilityContext {
  return {
    invocationId: 'inv-1', requestId: 'req-1', actor: 'operator',
    permissions: ['operator'], cwd: '/', workspace: '/', sessionId: 's1',
    cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} },
  };
}

describe('ExecutionResolver', () => {
  it('resolves a native capability to a single-step native plan with capabilityId', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      id: 'core.session.list', version: '1.0', kind: 'core', title: 'List', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    const plans = new ExecutionResolver(reg).resolve('core.session.list', ctx());
    expect(plans).toHaveLength(1);
    expect(plans[0]!.capabilityId).toBe('core.session.list');
    expect(plans[0]!.steps).toHaveLength(1);
    expect(plans[0]!.steps[0]!.executor).toBe('native');
    expect(plans[0]!.steps[0]!.timeout).toBe(5000);
  });

  it('applies the strategy default timeout when absent', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      id: 'git.commit', version: '1.0', kind: 'core', title: 'Commit', description: 'x',
      tags: [], category: 'git', risk: 'high', requiredPermissions: ['developer'],
      execution: { strategy: 'cli' },
    });
    const plans = new ExecutionResolver(reg).resolve('git.commit', ctx());
    expect(plans[0]!.steps[0]!.timeout).toBe(30_000);
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    const resolver = new ExecutionResolver(new CapabilityRegistry());
    expect(() => resolver.resolve('nope.missing', ctx())).toThrow(CapabilityNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/execution-resolver.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the resolver**

```typescript
// src/capability/execution-resolver.ts
import { CapabilityNotFoundError } from "./errors.js";
import type { Capability, CapabilityContext, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";

export type HookName = keyof CapabilityHooks;

export interface ExecutionPlanStep {
  executor: string;
  timeout: number;
  hooks: HookName[];
  permissions: Permission[];
}

export interface ExecutionPlan {
  capabilityId: string;
  steps: ExecutionPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;

export class ExecutionResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Resolve a capability into execution plans. Returns an array to leave
   * room for composition (a capability resolving to multiple plans) without
   * changing this API. Phase 1 produces single-step plans; the multi-step
   * structure with capabilityId is the forward-compatible shape.
   */
  resolve(capabilityId: string, _ctx: CapabilityContext): ExecutionPlan[] {
    const cap = this.registry.find(capabilityId);
    if (!cap) throw new CapabilityNotFoundError(capabilityId);
    const step: ExecutionPlanStep = {
      executor: cap.execution.strategy,
      timeout: cap.execution.timeout ?? DEFAULT_TIMEOUT,
      hooks: [],                     // hooks live in HookRegistry, not the plan
      permissions: [...cap.requiredPermissions],
    };
    return [{ capabilityId, steps: [step] }];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/execution-resolver.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/execution-resolver.ts tests/capability/execution-resolver.vitest.ts
git commit -m "feat(capability): add ExecutionResolver with capabilityId-bearing ExecutionPlan"
```

---

### Task 4: Executors + ExecutorRegistry

**Files:**
- Create: `src/capability/executors.ts`
- Test: `tests/capability/executors.vitest.ts`

**Interfaces:**
- Consumes: `Capability`, `CapabilityContext`, `ExecutorRunResult` from Task 1.
- Produces: `CapabilityExecutor` interface, `ExecutorRegistry`, `NativeExecutor`, `ToolExecutorAdapter`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/executors.vitest.ts
import { describe, it, expect } from 'vitest';
import { ExecutorRegistry, NativeExecutor } from '../../src/capability/executors.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';

function cap(strategy: string): Capability {
  return {
    id: 'core.echo', version: '1.0', kind: 'core', title: 'Echo', description: 'echo',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy },
  };
}

function ctx(): CapabilityContext {
  return {
    invocationId: 'inv-1', requestId: 'req-1', actor: 'operator',
    permissions: ['operator'], cwd: '/', workspace: '/', sessionId: 's1',
    cancellationToken: new AbortController().signal, eventBus: { emit: () => {} },
  };
}

describe('ExecutorRegistry', () => {
  it('registers and retrieves executors by strategy', () => {
    const er = new ExecutorRegistry();
    er.register('native', new NativeExecutor());
    expect(er.get('native')).toBeInstanceOf(NativeExecutor);
    expect(er.get('missing')).toBeUndefined();
  });
});

describe('NativeExecutor', () => {
  it('runs a registered handler and returns its output', async () => {
    const native = new NativeExecutor();
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const out = await native.run(cap('native'), ctx(), { msg: 'hi' });
    expect(out.output).toEqual({ msg: 'hi' });
  });

  it('returns an error for an unregistered handler', async () => {
    const out = await new NativeExecutor().run(cap('native'), ctx(), {});
    expect(out.error).toMatch(/No handler/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/executors.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the executors module**

```typescript
// src/capability/executors.ts
import type { Capability, CapabilityContext, ExecutorRunResult } from "./types.js";

export interface CapabilityExecutor {
  run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult>;
}

export class ExecutorRegistry {
  private byStrategy = new Map<string, CapabilityExecutor>();

  register(strategy: string, executor: CapabilityExecutor): void {
    this.byStrategy.set(strategy, executor);
  }

  get(strategy: string): CapabilityExecutor | undefined {
    return this.byStrategy.get(strategy);
  }
}

export type NativeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult> | ExecutorRunResult;

export class NativeExecutor implements CapabilityExecutor {
  private handlers = new Map<string, NativeHandler>();

  registerHandler(capabilityId: string, handler: NativeHandler): void {
    this.handlers.set(capabilityId, handler);
  }

  async run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult> {
    const handler = this.handlers.get(capability.id);
    if (!handler) return { error: `No native handler registered for ${capability.id}` };
    return handler(args, ctx);
  }
}

export class ToolExecutorAdapter implements CapabilityExecutor {
  constructor(private readonly runTool: (name: string, args: Record<string, unknown>) => Promise<{ output?: unknown; error?: string }>) {}

  async run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult> {
    const toolName = capability.extensions?.toolName as string | undefined ?? capability.id;
    return this.runTool(toolName, args);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/executors.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/executors.ts tests/capability/executors.vitest.ts
git commit -m "feat(capability): add ExecutorRegistry, NativeExecutor, ToolExecutorAdapter"
```

---

### Task 5: EventBus + AlixEvent adapter

**Files:**
- Create: `src/capability/event-bus.ts`
- Test: `tests/capability/event-bus.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityEvent` from Task 1.
- Produces: `EventBus` class and `toAlixEvent` adapter seam.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/event-bus.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus, toAlixEvent } from '../../src/capability/event-bus.js';
import type { CapabilityEvent } from '../../src/capability/types.js';

describe('EventBus', () => {
  it('delivers emitted events to subscribers in order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.emit({ type: 'InvocationStarted', invocationId: 'i1', capabilityId: 'c1', at: 1 });
    bus.emit({ type: 'InvocationOutput', invocationId: 'i1', chunk: 'x', at: 2 });
    expect(seen).toEqual(['InvocationStarted', 'InvocationOutput']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    off();
    bus.emit({ type: 'CapabilityRegistered', capabilityId: 'c1', at: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('AlixEvent adapter', () => {
  it('maps a CapabilityEvent to an AlixEvent-shaped record', () => {
    const evt: CapabilityEvent = { type: 'InvocationCompleted', invocationId: 'i1', at: 123 };
    const adapted = toAlixEvent(evt, 'sess-1');
    expect(adapted.type).toBe('capability.InvocationCompleted');
    expect(adapted.sessionId).toBe('sess-1');
    expect(adapted.payload).toEqual({ invocationId: 'i1', at: 123 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/event-bus.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the EventBus + adapter seam**

```typescript
// src/capability/event-bus.ts
import type { CapabilityEvent } from "./types.js";

export type EventHandler = (event: CapabilityEvent) => void;

export class EventBus {
  private handlers = new Set<EventHandler>();

  emit(event: CapabilityEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* a subscriber must never break delivery */ }
    }
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** Adapter seam: maps a platform CapabilityEvent onto the shape the
 *  existing EventLog/observability pipeline expects. A consumer wires this
 *  into EventLog.append; the platform core stays decoupled from EventLog. */
export function toAlixEvent(event: CapabilityEvent, sessionId: string): {
  type: string;
  sessionId: string;
  timestamp: string;
  actor: "system";
  payload: Record<string, unknown>;
} {
  const { type, at, ...payload } = event;
  return {
    type: `capability.${type}`,
    sessionId,
    timestamp: new Date(at).toISOString(),
    actor: "system",
    payload: { ...payload, at },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/event-bus.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/event-bus.ts tests/capability/event-bus.vitest.ts
git commit -m "feat(capability): add EventBus + AlixEvent adapter seam"
```

---

### Task 6: CapabilityRuntime (no registry/history, cancellation-safe, status getter)

**Files:**
- Create: `src/capability/runtime.ts`
- Test: `tests/capability/runtime.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityRegistry` (Task 2), `HookRegistry` (Task 2), `ExecutionResolver` (Task 3), `ExecutorRegistry` (Task 4), `EventBus` (Task 5), `AsyncEventQueue` + types (Task 1), typed errors (Task 1).
- Produces: `CapabilityRuntime.invoke` → `Invocation`. **Owns no invocation registry or lifecycle history.** Cancellation flows through the `Invocation`; the runtime checks the abort signal **before** starting execution (no race).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/runtime.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRuntime } from '../../src/capability/runtime.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { ExecutionResolver } from '../../src/capability/execution-resolver.js';
import { ExecutorRegistry, NativeExecutor } from '../../src/capability/executors.js';
import { EventBus } from '../../src/capability/event-bus.js';
import { CapabilityNotFoundError, ExecutorNotFoundError } from '../../src/capability/errors.js';

function setup() {
  const reg = new CapabilityRegistry();
  const hooks = new HookRegistry();
  const executors = new ExecutorRegistry();
  const native = new NativeExecutor();
  executors.register('native', native);
  const bus = new EventBus();
  const runtime = new CapabilityRuntime(reg, hooks, new ExecutionResolver(reg), executors, bus);
  return { reg, runtime, native, bus, hooks };
}

function registerEcho(reg: CapabilityRegistry) {
  reg.register({
    id: 'core.echo', version: '1.0', kind: 'core', title: 'Echo', description: 'echo',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy: 'native', timeout: 5000, cancellable: true },
  });
}

describe('CapabilityRuntime', () => {
  it('invokes a native capability and resolves with output', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const inv = runtime.invoke('core.echo', { msg: 'hi' }, { actor: 'operator', cwd: '/', workspace: '/' });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ msg: 'hi' });
  });

  it('status getter reflects live state', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let started = false;
    native.registerHandler('core.echo', async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 10));
      return { output: 'ok' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    expect(inv.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 20));
    expect(inv.status).toBe('completed');  // getter, not frozen snapshot
  });

  it('publishes start then completed in order', async () => {
    const { reg, runtime, native, bus } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));
    await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    const startIdx = events.indexOf('InvocationStarted');
    const endIdx = events.indexOf('InvocationCompleted');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
  });

  it('emits InvocationFailed when the executor errors', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async () => ({ error: 'boom' }));
    const result = await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('cancel before execution starts prevents the executor from running', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let executed = false;
    native.registerHandler('core.echo', async () => {
      executed = true;
      return { output: 'ran' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv.cancel();                      // cancel immediately, before async body runs
    await new Promise((r) => setTimeout(r, 20));
    const result = inv.result();
    expect(result?.status).toBe('cancelled');
    expect(executed).toBe(false);      // no race: executor never started
  });

  it('cancel marks an in-flight invocation cancelled', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let released: () => void = () => {};
    native.registerHandler('core.echo', async () => {
      await new Promise<void>((r) => { released = r; });
      return { output: 'done' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv.cancel();
    released();
    const result = await inv.wait();
    expect(result.status).toBe('cancelled');
  });

  it('runs hooks in order: validate, canInvoke, beforeInvoke, executor, afterInvoke', async () => {
    const { reg, runtime, native, hooks } = setup();
    registerEcho(reg);
    const order: string[] = [];
    native.registerHandler('core.echo', async () => { order.push('executor'); return { output: 'ok' }; });
    hooks.set('core.echo', {
      validate: () => { order.push('validate'); return undefined; },
      canInvoke: () => { order.push('canInvoke'); return true; },
      beforeInvoke: async () => { order.push('beforeInvoke'); },
      afterInvoke: async () => { order.push('afterInvoke'); },
    });
    await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(order).toEqual(['validate', 'canInvoke', 'beforeInvoke', 'executor', 'afterInvoke']);
  });

  it('validate hook failure blocks execution', async () => {
    const { reg, runtime, native, hooks } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    hooks.set('core.echo', { validate: (args) => (args.msg ? undefined : 'msg required') });
    const bad = await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(bad.status).toBe('failed');
    expect(bad.error).toBe('msg required');
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    const { runtime } = setup();
    expect(() => runtime.invoke('nope.x', {}, { actor: 'op', cwd: '/', workspace: '/' })).toThrow(CapabilityNotFoundError);
  });

  it('throws ExecutorNotFoundError when the strategy has no executor', () => {
    const { reg, runtime } = setup();
    reg.register({
      id: 'core.missing', version: '1.0', kind: 'core', title: 'X', description: 'x',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'does-not-exist' },
    });
    expect(() => runtime.invoke('core.missing', {}, { actor: 'op', cwd: '/', workspace: '/' })).toThrow(ExecutorNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/runtime.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the runtime**

```typescript
// src/capability/runtime.ts
import { randomUUID } from "node:crypto";
import { CapabilityNotFoundError, ExecutorNotFoundError } from "./errors.js";
import { AsyncEventQueue, type CapabilityContext, type CapabilityEvent, type EventBusLike, type ExecutorRunResult, type Invocation, type InvocationResult, type InvocationStatus, type Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { HookRegistry } from "./hook-registry.js";
import type { ExecutionResolver } from "./execution-resolver.js";
import type { ExecutorRegistry } from "./executors.js";
import type { EventBus } from "./event-bus.js";

interface InternalState {
  status: InvocationStatus;
  result?: InvocationResult;
  queue: AsyncEventQueue<CapabilityEvent>;
  resolve: (r: InvocationResult) => void;
  abort: AbortController;
  settled: boolean;
}

/** Owns no invocation registry and no lifecycle history. Invocation state
 *  is encapsulated by the returned handles; the runtime creates state but
 *  does not retain it. Cancellation flows through the Invocation object. */
export class CapabilityRuntime {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly hooks: HookRegistry,
    private readonly resolver: ExecutionResolver,
    private readonly executors: ExecutorRegistry,
    private readonly bus: EventBus,
  ) {}

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    const capability = this.registry.find(capabilityId);
    if (!capability) throw new CapabilityNotFoundError(capabilityId);
    const plans = this.resolver.resolve(capabilityId, this.makeContext(capabilityId, overrides));
    const plan = plans[0];
    const step = plan?.steps[0];
    if (!step) throw new CapabilityNotFoundError(capabilityId);
    const executor = this.executors.get(step.executor);
    if (!executor) throw new ExecutorNotFoundError(step.executor);

    const invocationId = `inv_${randomUUID().slice(0, 8)}`;
    const startedAt = Date.now();
    const abort = new AbortController();
    const queue = new AsyncEventQueue<CapabilityEvent>();
    const st: InternalState = {
      status: "queued",
      queue,
      resolve: () => {},
      abort,
      settled: false,
    };

    const finish = (status: InvocationStatus, extra: Partial<InvocationResult> = {}): InvocationResult => {
      if (st.settled) return st.result!;
      st.settled = true;
      st.status = status;
      const r: InvocationResult = {
        invocationId, status, startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt, ...extra,
      };
      st.result = r;
      queue.close();
      st.resolve(r);
      return r;
    };

    const inv: Invocation = {
      id: invocationId,
      get status() { return st.status; },   // live getter, not a frozen value
      startedAt,
      cancel: () => {
        if (st.status !== "running" && st.status !== "queued") return;
        st.abort.abort();
        const r = finish("cancelled");
        queue.push({ type: "InvocationCancelled", invocationId, at: Date.now() });
        this.bus.emit({ type: "InvocationCancelled", invocationId, at: Date.now() });
        st.resolve(r);
      },
      subscribe: (h) => this.bus.subscribe(h),
      wait: () => new Promise<InvocationResult>((resolve) => {
        if (st.result) resolve(st.result);
        else st.resolve = resolve;
      }),
      result: () => st.result,
      events: () => queue,
    };

    void (async () => {
      const ctx = this.makeContext(capabilityId, overrides, invocationId, abort.signal);
      const hooks = this.hooks.get(capabilityId);

      const fail = (error: string): void => {
        const r = finish("failed", { error });
        queue.push({ type: "InvocationFailed", invocationId, error, at: Date.now() });
        this.bus.emit({ type: "InvocationFailed", invocationId, error, at: Date.now() });
      };

      try {
        // Cancellation race guard: if cancelled before the async body
        // started (invoke() → cancel() immediately), do NOT run the executor.
        if (abort.signal.aborted) { inv.cancel(); return; }

        if (hooks?.validate) {
          const problem = hooks.validate(args, ctx);
          if (problem) return fail(problem);
        }
        if (hooks?.canInvoke && !hooks.canInvoke(ctx)) {
          this.bus.emit({ type: "PermissionDenied", capabilityId, actor: ctx.actor, at: Date.now() });
          return fail("Permission denied");
        }
        st.status = "running";
        this.bus.emit({ type: "InvocationStarted", invocationId, capabilityId, at: Date.now() });
        queue.push({ type: "InvocationStarted", invocationId, capabilityId, at: Date.now() });
        await hooks?.beforeInvoke?.(ctx);
        let runResult: ExecutorRunResult;
        try {
          runResult = await executor.run(capability, ctx, args);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        if (abort.signal.aborted) { inv.cancel(); return; }
        if (runResult.error) return fail(runResult.error);
        const r = finish("completed", { output: runResult.output });
        queue.push({ type: "InvocationCompleted", invocationId, at: Date.now() });
        this.bus.emit({ type: "InvocationCompleted", invocationId, at: Date.now() });
        await hooks?.afterInvoke?.(r, ctx);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    })();

    return inv;
  }

  private makeContext(
    capabilityId: string,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
    invocationId = `inv_${randomUUID().slice(0, 8)}`,
    signal?: AbortSignal,
  ): CapabilityContext {
    return {
      invocationId,
      requestId: `req_${randomUUID().slice(0, 8)}`,
      actor: overrides.actor ?? "operator",
      permissions: overrides.permissions ?? ["operator"],
      cwd: overrides.cwd ?? process.cwd(),
      workspace: overrides.workspace ?? process.cwd(),
      sessionId: overrides.sessionId ?? "",
      cancellationToken: signal ?? new AbortController().signal,
      eventBus: this.bus as EventBusLike,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/runtime.vitest.ts`
Expected: PASS. Key behaviors: status getter is live; cancel-before-start prevents the executor running; events stream from a real `AsyncEventQueue`; hooks run in order.

- [ ] **Step 5: Commit**

```bash
git add src/capability/runtime.ts tests/capability/runtime.vitest.ts
git commit -m "feat(capability): add cancellation-safe, history-free CapabilityRuntime"
```

---

### Task 7: CapabilityPlatform bootstrap

**Files:**
- Create: `src/capability/platform.ts`
- Test: `tests/capability/platform.vitest.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `CapabilityPlatform` composing the five services; convenience `register`, `query`, `invoke`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/platform.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { registerSessionCapabilities } from '../../src/integrations/session-capabilities.js';

describe('CapabilityPlatform bootstrap', () => {
  it('composes all five services and invokes end-to-end', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    await registerSessionCapabilities(platform.registry, platform.native);
    const inv = platform.invoke('core.session.list', {}, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBeDefined();
  });

  it('exposes query for discovery', () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    expect(platform.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/platform.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the platform bootstrap**

```typescript
// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ExecutionResolver } from "./execution-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { ExecutorRegistry, NativeExecutor, type CapabilityExecutor } from "./executors.js";
import { EventBus } from "./event-bus.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";

/** Composes the five platform services for consumers. No UI assumptions. */
export class CapabilityPlatform {
  readonly registry = new CapabilityRegistry();
  readonly hooks = new HookRegistry();
  readonly executors = new ExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ExecutionResolver;
  private readonly runtime: CapabilityRuntime;

  constructor() {
    this.executors.register("native", this.native);
    this.resolver = new ExecutionResolver(this.registry);
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.executors, this.events);
  }

  register(capability: Capability): void { this.registry.register(capability); }
  find(id: string): Capability | undefined { return this.registry.find(id); }
  query(q: CapabilityQuery = {}): Capability[] { return this.registry.query(q); }

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    return this.runtime.invoke(capabilityId, args, overrides);
  }

  registerExecutor(strategy: string, executor: CapabilityExecutor): void {
    this.executors.register(strategy, executor);
  }
}
```

- [ ] **Step 4: Commit the platform bootstrap alone**

```bash
git add src/capability/platform.ts
git commit -m "feat(capability): add CapabilityPlatform bootstrap composition"
```

(The test finishes green in Tasks 8/9 once migration + integrations land.)

---

### Task 8: Initial capability definitions (pure, platform-internal)

**Files:**
- Create: `src/capability/initial-capabilities.ts`
- Modify: `src/capability/index.ts` (barrel)
- Test: `tests/capability/initial-capabilities.vitest.ts`

**Interfaces:**
- Produces: `registerInitialCapabilities(reg, native)` — **pure capability definitions only**, no domain dependencies. Handlers are wired by integrations (Task 10).

**Migration pattern (the contract for all future migrations):**

```
Existing ALiX Function
        │  wrapped as a handler in src/integrations/
        ▼
Capability Definition     (src/capability/initial-capabilities.ts — declarative)
        │  bound to a handler
        ▼
Executor Adapter          (NativeExecutor.registerHandler / tool adapter)
        │
        ▼
Invocation                (consumers invoke by id, never see the executor)
```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/initial-capabilities.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';

describe('initial capabilities', () => {
  it('registers core session + tool capabilities', () => {
    const reg = new CapabilityRegistry();
    const native = new NativeExecutor();
    registerInitialCapabilities(reg, native);
    expect(reg.find('core.session.list')).toBeDefined();
    expect(reg.find('core.session.show')).toBeDefined();
    expect(reg.find('tool.file.read')).toBeDefined();
    expect(reg.find('tool.shell.run')).toBeDefined();
    expect(reg.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(2);
    expect(reg.query({ kinds: ['tool'] }).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/initial-capabilities.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the pure definitions module**

```typescript
// src/capability/initial-capabilities.ts
import type { Capability } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { NativeExecutor } from "./executors.js";

/** Pure capability definitions — NO domain dependencies. Existing ALiX
 *  functionality migrates behind these; handlers are wired separately in
 *  src/integrations/ (see session-capabilities.ts, tool-adapter.ts). */
export function registerInitialCapabilities(reg: CapabilityRegistry, _native: NativeExecutor): void {
  const caps: Capability[] = [
    {
      id: "core.session.list", version: "1.0", kind: "core",
      title: "List sessions", description: "List all ALiX sessions",
      tags: ["session", "list"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
    {
      id: "core.session.show", version: "1.0", kind: "core",
      title: "Show session", description: "Show details for one session",
      tags: ["session", "show"], category: "session", risk: "low",
      requiredPermissions: ["operator"],
      argsSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      execution: { strategy: "native", timeout: 5_000, cancellable: true },
    },
    {
      id: "tool.file.read", version: "1.0", kind: "tool",
      title: "Read file", description: "Read the contents of a file",
      tags: ["file", "read"], category: "file", risk: "low",
      requiredPermissions: ["developer"],
      argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execution: { strategy: "tool", timeout: 10_000, cancellable: false },
      extensions: { toolName: "file.read" },
    },
    {
      id: "tool.shell.run", version: "1.0", kind: "tool",
      title: "Run shell command", description: "Execute a shell command",
      tags: ["shell", "run"], category: "shell", risk: "high",
      requiredPermissions: ["admin"],
      argsSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      execution: { strategy: "tool", timeout: 30_000, cancellable: true },
      extensions: { toolName: "shell.run" },
    },
  ];
  for (const cap of caps) reg.register(cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/initial-capabilities.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Update the barrel**

In `src/capability/index.ts`:
```typescript
export * from "./types.js";
export * from "./errors.js";
export * from "./registry.js";
export * from "./hook-registry.js";
export * from "./execution-resolver.js";
export * from "./executors.js";
export * from "./event-bus.js";
export * from "./runtime.js";
export * from "./platform.js";
export * from "./initial-capabilities.js";
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: clean.

```bash
git add src/capability/ tests/capability/
git commit -m "feat(capability): add pure initial capability definitions"
```

---

### Task 9: Existing tool integration (adapter)

**Files:**
- Create: `src/capability/tool-adapter.ts`
- Test: `tests/capability/tool-adapter.vitest.ts`

**Interfaces:**
- Consumes: `ToolExecutorAdapter` (Task 4), `CapabilityPlatform` (Task 7), initial tool capabilities (Task 8), and the existing `ToolExecutor` from `src/tools/executor.ts`.
- Produces: `createToolExecutorAdapter(executor)`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capability/tool-adapter.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { createToolExecutorAdapter } from '../../src/capability/tool-adapter.js';
import type { ToolCallRequest, ToolResult } from '../../src/tools/types.js';

describe('tool executor adapter', () => {
  it('runs tool.file.read through the existing ToolExecutor contract', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    platform.registerExecutor('tool', createToolExecutorAdapter({
      execute: async (req: ToolCallRequest): Promise<ToolResult> => {
        if (req.name === 'file.read') return { kind: 'success', content: 'file contents' };
        return { kind: 'error', message: 'unknown' };
      },
    }));
    const inv = platform.invoke('tool.file.read', { path: 'a.ts' }, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('file contents');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capability/tool-adapter.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the adapter**

```typescript
// src/capability/tool-adapter.ts
import { ToolExecutorAdapter } from "./executors.js";
import type { ToolCallRequest, ToolResult } from "../tools/types.js";

type ToolExecutorLike = { execute(req: ToolCallRequest): Promise<ToolResult> };

/** Adapts the existing ToolExecutor.execute() to the capability executor seam. */
export function createToolExecutorAdapter(executor: ToolExecutorLike): ToolExecutorAdapter {
  return new ToolExecutorAdapter(async (name, args) => {
    const req: ToolCallRequest = { toolCallId: `cap_${Date.now()}`, name, args };
    const result = await executor.execute(req);
    if (result.kind === "error") return { error: result.message };
    return { output: result.content ?? result.output ?? result.value };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capability/tool-adapter.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Wire the real ToolExecutor (consumer-owned, documented)**

The adapter is the tested seam. A consumer wiring the real executor:
```typescript
import { ToolExecutor } from "../tools/executor.js";
import { createToolExecutorAdapter } from "./tool-adapter.js";
// platform.registerExecutor('tool', createToolExecutorAdapter(new ToolExecutor(...)));
```

- [ ] **Step 6: Build + full capability suite + commit**

Run: `npm run build && npx vitest run tests/capability/`
Expected: build clean, all tests pass.

```bash
git add src/capability/ tests/capability/
git commit -m "feat(capability): adapt existing ToolExecutor behind tool strategy"
```

---

### Task 10: Domain integration (session) OUTSIDE the capability package

**Files:**
- Create: `src/integrations/session-capabilities.ts`
- Modify: `tests/capability/platform.vitest.ts` (already imports from integrations)
- Test: `tests/capability/platform.vitest.ts` (platform end-to-end via integration)

**Interfaces:**
- Consumes: `CapabilityRegistry`, `NativeExecutor`, `CapabilityPlatform` (Tasks 2, 4, 7), `core.session.*` definitions (Task 8), the real session API from `src/session/resume.js`.
- Produces: `registerSessionCapabilities(reg, native)` in `src/integrations/` — the domain wiring lives OUTSIDE the capability package so the platform core stays reusable.

- [ ] **Step 1: Verify the real session API surface**

```bash
grep -n "export" src/session/resume.ts | head -20
```

Confirm the actual export names. If `listSessions`/`sessionInfo` differ, use the real names.

- [ ] **Step 2: Create the integration**

```typescript
// src/integrations/session-capabilities.ts
import type { CapabilityRegistry } from "../capability/registry.js";
import type { NativeExecutor } from "../capability/executors.js";

/** Wires the real session implementation behind core.session.*.
 *  Lives in src/integrations/ — NOT the capability package — so the
 *  platform core stays free of domain dependencies. */
export async function registerSessionCapabilities(reg: CapabilityRegistry, native: NativeExecutor): Promise<void> {
  const { listSessions, sessionInfo } = await import("../session/resume.js");

  native.registerHandler("core.session.list", async (_args, ctx) => {
    const sessions = await listSessions(ctx.cwd);
    return { output: sessions };
  });

  native.registerHandler("core.session.show", async (args, ctx) => {
    const sessionId = args.sessionId as string | undefined;
    if (!sessionId) return { error: "sessionId argument required" };
    const info = await sessionInfo(ctx.cwd, sessionId);
    if (!info) return { error: `Session not found: ${sessionId}` };
    return { output: info };
  });
}
```

- [ ] **Step 3: Run the platform end-to-end test**

Run: `npx vitest run tests/capability/platform.vitest.ts`
Expected: PASS — the platform test now passes because the integration wires `core.session.list` behind a real implementation.

- [ ] **Step 4: Build + full suite + commit**

Run: `npm run build && npx vitest run tests/capability/`
Expected: clean build, all tests pass.

```bash
git add src/integrations/ tests/capability/
git commit -m "feat(capability): add session integration outside the capability package"
```

---

### Task 11: Verification + documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-design.md` (status → implemented)
- Create: `docs/capability-platform.md` (consumer usage guide)

- [ ] **Step 1: Full build + full capability suite**

Run: `npm run build && npx vitest run tests/capability/`
Expected: clean build, all capability tests pass.

- [ ] **Step 2: Write the consumer-facing doc**

```markdown
# ALiX Capability Platform (Phase 1)

## What it is

A reusable execution substrate: Registry (what exists), Resolver (how it runs),
Runtime (invocation lifecycle), Executors (who executes), EventBus (who observes).

Domain integrations live in `src/integrations/`; the platform core is dependency-free.

## Consumer example

```typescript
import { CapabilityPlatform } from "./capability/index.js";
import { registerInitialCapabilities } from "./capability/initial-capabilities.js";
import { registerSessionCapabilities } from "./integrations/session-capabilities.js";

const platform = new CapabilityPlatform();
registerInitialCapabilities(platform.registry, platform.native);
await registerSessionCapabilities(platform.registry, platform.native);

// Invoke — consumers never see the executor
const inv = platform.invoke("core.session.list", {}, { actor: "operator", cwd: "/" });
const result = await inv.wait();   // { status: "completed", output: [...] }

// Discover
const sessionCaps = platform.query({ kinds: ["core"], category: "session" });
```

## Migration pattern

Existing function → Capability definition (`src/capability/initial-capabilities.ts`)
→ Executor adapter (`src/integrations/` or `tool-adapter.ts`) → Invocation.
```

- [ ] **Step 3: Update spec status + commit**

```bash
git add docs/
git commit -m "docs(capability): Phase-1 usage guide + spec status to implemented"
```

---

## Phase Completion Criteria

### Phase 1 complete means:

- ✅ Declarative capability registry exists (`CapabilityRegistry` with ID validation + `HookRegistry`)
- ✅ Resolver produces forward-compatible multi-step `ExecutionPlan[]` carrying `capabilityId`
- ✅ Runtime owns no registry/history; creates `Invocation`s with live status getters and real event streaming
- ✅ Executors are pluggable (`ExecutorRegistry`); `native` + `tool` adapters work
- ✅ EventBus publishes platform events with an `AlixEvent` adapter seam
- ✅ `CapabilityPlatform` composes the five services for consumers
- ✅ Errors are typed (not bare `Error`)
- ✅ Permissions are normalized (`Permission[]` everywhere)
- ✅ Existing functionality migrates behind capabilities; domain integrations live outside the package
- ✅ CLI/TUI/Web/MCP can consume the same runtime
- ✅ Execution is observable
- ✅ No UI dependency exists

### Not included (explicit Phase-1 non-goals):

- ❌ Capability Explorer
- ❌ Command Palette
- ❌ Plugin discovery / loading
- ❌ Remote / Docker / Kubernetes execution
- ❌ Workflow composition engine
- ❌ Invocation persistence (`InvocationStore`)
