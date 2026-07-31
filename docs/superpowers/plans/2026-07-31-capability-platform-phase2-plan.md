# ALiX Capability Platform Phase 2 — TUI Consumers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Command Palette (Ctrl+P launcher) and the Capabilities tab as the first consumers of the Phase-1 Capability Platform, with an in-process `CapabilityService` that owns the platform, wires the full working set, and routes every invocation through an `InvocationPresenter` into the chat timeline.

**Architecture:** A `src/tui/capabilities/` module is the single boundary. `CapabilityService` owns the process-local `CapabilityPlatform` instance (wired with `registerInitialCapabilities` + `registerSessionCapabilities` + a bootstrap-owned `ToolExecutor` passed in as a dependency), bridges `platform.events` → `toAlixEvent` → `EventLog`, and `invoke()` internally calls `presenter.present({ invocation, capabilityId, args })` so presentation is centralized. The palette (modal overlay) and Capabilities tab (9th view) are launchers only. The platform (`src/capability/*`) is **not modified**.

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing TUI canvas/view/key-dispatch system.

## Global Constraints

- **Phase 2 adds consumers only — `src/capability/*` is NOT modified.** (Phase-1 invariant 9: the platform has no UI assumptions.)
- NodeNext ESM (`import ... from "./x.js"`), strict TS, vitest.
- Palette behavior is capability-only this phase; UI actions use a separate `PaletteAction` interface (never `Capability`).
- `CapabilityService.invoke()` presents automatically via the owned `InvocationPresenter` — callers never call `presenter.present` themselves.
- **Invocation ownership invariant:** only `CapabilityService.invoke()` may create user-facing capability execution — views and palette entries never call `CapabilityRuntime` directly.
- **Infrastructure is bootstrap-owned:** the CLI bootstrap constructs the `ToolExecutor` (and session wiring) and passes it to the service via `CapabilityServiceOptions.toolExecutor`; the service wires it into the platform but does **not** construct infrastructure.
- Capabilities flow only `Registry → Runtime → Invocation`; the platform never imports from `src/tui/`.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

## Repository Layout

| File | Role |
|---|---|
| `src/tui/capabilities/capability-service.ts` | `CapabilityService` — owns platform + presenter; full wiring; invoke() presents; module singleton accessor |
| `src/tui/capabilities/invocation-presenter.ts` | `InvocationPresenter` interface + `ChatInvocationPresenter` |
| `src/tui/capabilities/palette.ts` | `PaletteProvider`, `CapabilityProvider`, `ActionProvider` (stub), `PaletteAction`, `PaletteModal` (UI state + key handling) |
| `src/tui/capabilities/capabilities-view.ts` | `CapabilitiesView` — the 9th tab (TuiView) |
| `src/tui/capabilities/index.ts` | Barrel |
| `src/tui/state.ts` | `TabId` + `'capabilities'`; `CapabilityInvocationEntry`; `PerTabState.capabilityInvocations`; initial state |
| `src/tui/views/chat-view.ts` | Render capability invocation entries in the chat timeline |
| `src/tui/app.ts` | `TuiAppOptions.capabilityService`; Ctrl+P binding; palette modal state + painting; `TAB_ORDER` += `capabilities` |
| `src/tui/views/index.ts` | Register `CapabilitiesView` |
| `src/cli/commands/tui.ts` | Construct `CapabilityService`, `setCapabilityService(...)` before building `TuiApp` |
| `tests/tui/capabilities/*.vitest.ts` | Tests per module |

---

### Task 1: State model — capability invocation entries + chat timeline rendering

**Files:**
- Modify: `src/tui/state.ts` (TabId union, `CapabilityInvocationEntry`, `PerTabState.capabilityInvocations`, `createInitialPerTabState`)
- Modify: `src/tui/views/chat-view.ts`
- Test: `tests/tui/capabilities/chat-invocations.vitest.ts`

**Interfaces:**
- Produces: `CapabilityInvocationEntry` (below); `PerTabState.capabilityInvocations: CapabilityInvocationEntry[]`; `TabId` includes `'capabilities'`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/chat-invocations.vitest.ts
import { describe, it, expect } from 'vitest';
import { createInitialTuiAppState, type CapabilityInvocationEntry } from '../../../src/tui/state.js';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

describe('capability invocation chat entries', () => {
  it('initializes capabilityInvocations empty for every tab', () => {
    const state = createInitialTuiAppState();
    for (const tab of Object.keys(state.views)) {
      expect(state.views[tab].capabilityInvocations).toEqual([]);
    }
  });

  it('chat view renders a completed invocation entry', () => {
    const state = createInitialTuiAppState();
    state.views.chat.capabilityInvocations.push({
      invocationId: 'inv_1', capabilityId: 'core.session.list', args: {},
      status: 'completed', output: '["s1"]', at: 1,
    });
    const canvas = new TerminalCanvas(60, 20);
    const ctx = {
      snap: state.snap,
      dimensions: { columns: 60, rows: 20 },
      perTab: state.views.chat,
      canvas,
    };
    const view = new ChatView();
    view.render(ctx as never);
    // The invocation entry should appear in the scrollback (written to the canvas).
    expect(canvas.renderFrame()).toContain('core.session.list');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/chat-invocations.vitest.ts --config vitest.config.mts`
Expected: FAIL — `capabilityInvocations` does not exist on PerTabState / `createInitialTuiAppState` / TabId.

- [ ] **Step 3: Add the state model**

In `src/tui/state.ts`:

```typescript
// Near the top, extend the TabId union:
export type TabId =
  | 'dashboard' | 'chat' | 'agent' | 'daemon' | 'approvals'
  | 'runtime' | 'sops' | 'policy' | 'capabilities';

// New export (place near PendingApproval):
/** A capability invocation surfaced in the chat timeline. */
export interface CapabilityInvocationEntry {
  invocationId: string;
  capabilityId: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  error?: string;
  at: number;
}
```

In `PerTabState` add the field:

```typescript
  /** Capability invocations surfaced in the chat timeline, oldest first. */
  capabilityInvocations: CapabilityInvocationEntry[];
  /** Selected capability in the Capabilities tab (per-tab view state). */
  capabilitiesSelectedId?: string;
```

Find `createInitialPerTabState` (or wherever the per-tab initial object literal is built — it initializes `pendingApprovals: []` etc.) and add:

```typescript
    capabilityInvocations: [],
```

`createInitialTuiAppState` builds `views` as `Record<TabId, PerTabState>`. Since `TabId` now includes `'capabilities'`, add the new tab to that map (next to `policy: createInitialPerTabState(),`):

```typescript
      capabilities: createInitialPerTabState(),
```

- [ ] **Step 4: Render the entries in the chat view**

In `src/tui/views/chat-view.ts`:

- Extend the `ScrollbackLine` kind union: `kind: 'user' | 'agent' | 'capability'`.
- After the turn loop (after line 78, before `const offset = ctx.perTab.scrollOffset;`), append the invocation lines:

```typescript
    // Capability invocations surface in the operator timeline after the
    // conversation turns — "⚡ core.session.list [completed ✓]".
    const invocations = ctx.perTab.capabilityInvocations;
    for (const inv of invocations) {
      let text = inv.capabilityId;
      if (inv.status === 'running') text += ' [running]';
      else if (inv.status === 'completed') text += ` [completed ✓] ${inv.output === undefined ? '' : JSON.stringify(inv.output)}`;
      else if (inv.status === 'failed') text += ` [failed ✗] ${inv.error ?? ''}`;
      else text += ' [cancelled]';
      allLines.push({ kind: 'capability', text: text.trim(), isFirst: true });
    }
```

- In the render loop (lines 86-97), handle the new kind — use a `⚡` marker:

```typescript
        const marker = l.kind === 'user' ? '\x1b[90m→ \x1b[0m'
          : l.kind === 'agent' ? '\x1b[36m← \x1b[0m'
          : '\x1b[35m⚡ \x1b[0m';
```

**Phase-2 limitation (document, do not fix here):** capability entries are appended *after* all conversational turns — a capability invoked mid-conversation appears at the bottom of the scrollback, not interleaved by time. A unified `TimelineEvent` union (chat + capability + tool entries in one ordered stream) is a Phase-3 concern; this phase appends after turns.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/chat-invocations.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Build + commit**

Run: `npx tsc -p tsconfig.json --noEmit`
```bash
git add src/tui/state.ts src/tui/views/chat-view.ts tests/tui/capabilities/chat-invocations.vitest.ts
git commit -m "feat(tui): capability invocation entries in state + chat timeline"
```

---

### Task 2: InvocationPresenter + ChatInvocationPresenter

**Files:**
- Create: `src/tui/capabilities/invocation-presenter.ts`
- Test: `tests/tui/capabilities/invocation-presenter.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityInvocationEntry` (Task 1), `PerTabState` from `src/tui/state.ts`, `Invocation` + `CapabilityEvent` from `src/capability/types.js`, `EventLog` from `src/events/event-log.js`.
- Produces: `InvocationPresenter` interface, `ChatInvocationPresenter` (below).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/invocation-presenter.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { ChatInvocationPresenter, type InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import type { Invocation, CapabilityEvent } from '../../../src/capability/types.js';

function makeInvocation(id = 'inv_1', capabilityId = 'core.session.list'): Invocation & { __push(e: CapabilityEvent): void } {
  const events: CapabilityEvent[] = [];
  const push = (e: CapabilityEvent) => { events.push(e); };
  return {
    id, status: 'running', cancel: () => {}, subscribe: () => () => {},
    wait: () => Promise.resolve({ invocationId: id, status: 'completed', startedAt: 0, completedAt: 1 }),
    result: () => undefined,
    events: () => ({ [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { if (i < events.length) return { value: events[i++]!, done: false }; return { value: undefined, done: true }; } };
    } }),
    __push: push,
  } as never;
}

describe('ChatInvocationPresenter', () => {
  it('appends a running entry then updates it to completed with output', async () => {
    const state = { capabilityInvocations: [] } as never;
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation();
    const p = presenter.present(inv);
    expect(state.capabilityInvocations).toHaveLength(1);
    expect(state.capabilityInvocations[0]!.status).toBe('running');
    inv.__push({ type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 });
    await p;
    const entry = state.capabilityInvocations[0]!;
    expect(entry.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/invocation-presenter.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the presenter**

```typescript
// src/tui/capabilities/invocation-presenter.ts
import type { PerTabState, CapabilityInvocationEntry } from '../state.js';
import type { Invocation, CapabilityEvent } from '../../capability/types.js';

export interface InvocationInput {
  invocation: Invocation;
  capabilityId: string;
  args: Record<string, unknown>;
}

export interface InvocationPresenter {
  /** Present an invocation. Default target is the chat operator timeline. */
  present(input: InvocationInput): Promise<void>;
}

/**
 * Routes capability invocations into the chat tab's timeline. The chat
 * tab is the operator's execution history — capabilities are execution
 * primitives, not a separate surface. Platform-independent.
 */
export class ChatInvocationPresenter implements InvocationPresenter {
  constructor(
    private readonly getChatState: () => PerTabState,
  ) {}

  async present({ invocation, capabilityId, args }: InvocationInput): Promise<void> {
    const state = this.getChatState();
    const entry: CapabilityInvocationEntry = {
      invocationId: invocation.id,
      capabilityId,
      args,
      status: 'running',
      at: Date.now(),
    };
    state.capabilityInvocations.push(entry);

    // Terminal events update the entry live from the invocation's own
    // event stream (Phase-1 fix delivers terminal events there). No race
    // with the runtime starting: `Invocation.events()` is backed by the
    // AsyncEventQueue, which buffers emitted events until consumed — a
    // subscriber attaching after the runtime began still receives the
    // full lifecycle.
    for await (const evt of invocation.events()) {
      this.applyEvent(entry, evt);
    }
    // Fallback: if the stream closed without a terminal event, use the
    // settled result.
    if (entry.status === 'running') {
      const result = await invocation.wait();
      entry.status = result.status === 'completed' ? 'completed'
        : result.status === 'cancelled' ? 'cancelled' : 'failed';
      if (entry.status === 'completed') entry.output = result.output;
      if (entry.status === 'failed') entry.error = result.error;
    }
  }

  private applyEvent(entry: CapabilityInvocationEntry, evt: CapabilityEvent): void {
    switch (evt.type) {
      case 'InvocationCompleted':
        entry.status = 'completed';
        break;
      case 'InvocationFailed':
        entry.status = 'failed';
        entry.error = evt.error;
        break;
      case 'InvocationCancelled':
        entry.status = 'cancelled';
        break;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/invocation-presenter.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/capabilities/invocation-presenter.ts tests/tui/capabilities/invocation-presenter.vitest.ts
git commit -m "feat(capabilities): InvocationPresenter routes invocations to the chat timeline"
```

---

### Task 3: CapabilityService

**Files:**
- Create: `src/tui/capabilities/capability-service.ts`
- Test: `tests/tui/capabilities/capability-service.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityPlatform` from `src/capability/platform.js`, `registerInitialCapabilities` from `src/capability/initial-capabilities.js`, `registerSessionCapabilities` from `src/integrations/session-capabilities.js`, `createToolExecutorAdapter` from `src/capability/tool-adapter.js`, `toAlixEvent` from `src/capability/event-bus.js`, `ToolExecutor` from `src/tools/executor.js`, `EventLog` from `src/events/event-log.js`, `InvocationPresenter` (Task 2).
- Produces: `CapabilityService` class + `getCapabilityService()` / `setCapabilityService()` / `clearCapabilityService()` module accessors.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/capability-service.vitest.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CapabilityService, setCapabilityService, getCapabilityService, clearCapabilityService,
} from '../../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from './invocation-presenter.js';

class FakeEventLog {
  events: Array<Record<string, unknown>> = [];
  async append(e: Record<string, unknown>) { this.events.push(e); return e as never; }
}

describe('CapabilityService', () => {
  let presenter: InvocationPresenter;
  let log: FakeEventLog;

  beforeEach(() => { presenter = { present: vi.fn() }; log = new FakeEventLog(); clearCapabilityService(); });
  afterEach(() => clearCapabilityService());

  it('wireInitialCapabilities registers core + tool definitions', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    expect(svc.find('core.session.list')).toBeDefined();
    expect(svc.find('tool.file.read')).toBeDefined();
    expect(svc.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(1);
  });

  it('invoke() presents automatically', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    const inv = svc.invoke('core.session.list', {});
    expect(inv).toBeDefined();
    expect(presenter.present).toHaveBeenCalledTimes(1);
    await inv.wait();
  });

  it('bridges capability events into the EventLog', async () => {
    const svc = new CapabilityService(presenter, { eventLog: log as never });
    await svc.ready();
    await svc.invoke('core.session.list', {}).wait();
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events[0]!.type).toMatch(/^capability\./);
  });

  it('getCapabilityService returns the shared instance after setCapabilityService', () => {
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    expect(getCapabilityService()).toBe(svc);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/capability-service.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the service**

```typescript
// src/tui/capabilities/capability-service.ts
import { CapabilityPlatform } from '../../capability/platform.js';
import { registerInitialCapabilities } from '../../capability/initial-capabilities.js';
import { createToolExecutorAdapter } from '../../capability/tool-adapter.js';
import { toAlixEvent } from '../../capability/event-bus.js';
import type { Capability, CapabilityStatus, Invocation } from '../../capability/types.js';
import type { CapabilityQuery } from '../../capability/registry.js';
import type { EventLog } from '../../events/event-log.js';
import type { ToolCallRequest } from '../../tools/types.js';
import type { ExecuteResult } from '../../tools/executor.js';
import type { InvocationPresenter } from './invocation-presenter.js';

/** The existing ToolExecutor's executable seam (bootstrap-owned). */
export interface ToolExecutorLike {
  execute(req: ToolCallRequest): Promise<ExecuteResult>;
}

export interface CapabilityServiceOptions {
  /** EventLog to bridge capability events into (observability, non-fatal). */
  eventLog?: EventLog;
  /** Resolve the current session id (empty string when none). */
  sessionId?: () => string;
  /** Actor label for invocations. */
  actor?: string;
  /** Working directory for invocations. */
  cwd?: string;
  /** Bootstrap-owned ToolExecutor for tool.* capabilities. */
  toolExecutor?: ToolExecutorLike;
}

/**
 * The TUI façade over the Capability Platform. Owns the platform instance
 * and the InvocationPresenter; wires the full working set (initial
 * capabilities + real session integration + tool executor); bridges
 * platform events into the EventLog. invoke() presents automatically so
 * every caller gets identical behavior without remembering the presenter.
 */
/** Placeholder until TuiApp binds a real presenter (it owns the chat state). */
const NOOP_PRESENTER: InvocationPresenter = { present: async () => {} };

export class CapabilityService {
  readonly platform: CapabilityPlatform;
  private presenter: InvocationPresenter;
  private readonly opts: Required<CapabilityServiceOptions>;
  private readonly initPromise: Promise<void>;

  constructor(presenter: InvocationPresenter = NOOP_PRESENTER, opts: CapabilityServiceOptions = {}) {
    this.presenter = presenter;
    this.opts = {
      eventLog: undefined,
      sessionId: () => '',
      actor: 'operator',
      cwd: process.cwd(),
      toolExecutor: undefined,
      ...opts,
    };
    this.platform = new CapabilityPlatform();
    registerInitialCapabilities(this.platform.registry, this.platform.native);
    this.wireEventBridge();
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    // Session integration (core.session.* → real session API).
    try {
      const { registerSessionCapabilities } = await import('../../integrations/session-capabilities.js');
      await registerSessionCapabilities(this.platform.registry, this.platform.native);
    } catch (err) {
      console.error('[capabilities] session integration unavailable:', err);
    }
    // Tool executor (tool.* → bootstrap-owned ToolExecutor). Tool
    // capabilities show as unavailable rather than crashing when the
    // executor is missing.
    if (this.opts.toolExecutor) {
      this.platform.registerExecutor('tool', createToolExecutorAdapter(this.opts.toolExecutor));
    }
  }

  /** Resolves once the async wiring (session/tool) has settled. */
  async ready(): Promise<void> { await this.initPromise; }

  private wireEventBridge(): void {
    const log = this.opts.eventLog;
    if (!log) return;
    this.platform.events.subscribe((evt) => {
      try { void log.append(toAlixEvent(evt, this.opts.sessionId())); } catch { /* non-fatal */ }
    });
  }

  query(q: CapabilityQuery = {}): Capability[] { return this.platform.query(q); }
  find(id: string): Capability | undefined { return this.platform.find(id); }
  getStatus(id: string): CapabilityStatus | undefined { return this.platform.registry.getStatus(id); }

  /**
   * Bind the presenter. The TUI owns the chat state, so TuiApp supplies
   * a ChatInvocationPresenter bound to its own state after construction.
   */
  setPresenter(presenter: InvocationPresenter): void { this.presenter = presenter; }

  /** Single invocation path — every invocation is presented automatically. */
  invoke(id: string, args: Record<string, unknown> = {}): Invocation {
    const invocation = this.platform.invoke(id, args, {
      actor: this.opts.actor,
      cwd: this.opts.cwd,
      workspace: this.opts.cwd,
      sessionId: this.opts.sessionId(),
    });
    void this.presenter.present({ invocation, capabilityId: id, args });
    return invocation;
  }
}

// Module-level shared instance — views are module singletons, so they
// resolve the service through this accessor (set at bootstrap).
let shared: CapabilityService | undefined;
export function setCapabilityService(service: CapabilityService): void { shared = service; }
export function getCapabilityService(): CapabilityService {
  if (!shared) throw new Error('CapabilityService not initialized');
  return shared;
}
export function clearCapabilityService(): void { shared = undefined; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/capability-service.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/capabilities/capability-service.ts tests/tui/capabilities/capability-service.vitest.ts
git commit -m "feat(capabilities): CapabilityService — in-process platform + presenter wiring"
```

---

### Task 4: Command Palette — providers + modal + Ctrl+P binding

**Files:**
- Create: `src/tui/capabilities/palette.ts`
- Modify: `src/tui/app.ts` (TuiAppOptions, parseKey, key routing, modal painting)
- Test: `tests/tui/capabilities/palette.vitest.ts`

**Interfaces:**
- Consumes: `getCapabilityService` (Task 3), `Capability` type.
- Produces: `PaletteProvider`, `PaletteEntry`, `PaletteAction`, `CapabilityProvider`, `ActionProvider`, `PaletteModal`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/palette.vitest.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityProvider, PaletteModal, type PaletteEntry } from '../../../src/tui/capabilities/palette.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from './invocation-presenter.js';

function makeService(): CapabilityService {
  const presenter: InvocationPresenter = { present: vi.fn() };
  return new CapabilityService(presenter);
}

describe('CapabilityProvider', () => {
  beforeEach(() => { clearCapabilityService(); });

  it('lists all capabilities on empty query', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const provider = new CapabilityProvider();
    const entries = provider.search('');
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(entries.every(e => e.title.length > 0)).toBe(true);
  });

  it('subsequence-fuzzy-filters by title and id', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const provider = new CapabilityProvider();
    expect(provider.search('session').some(e => e.subtitle?.includes('core.session'))).toBe(true);
    // Subsequence match: 'cslist' → core.session.list.
    expect(provider.search('cslist').some(e => e.subtitle === 'core.session.list')).toBe(true);
    expect(provider.search('zzznomatch')).toEqual([]);
  });

  it('entry invoke() calls service.invoke', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const spy = vi.spyOn(svc, 'invoke');
    const provider = new CapabilityProvider();
    const entries = provider.search('core.session.list');
    entries[0]!.invoke();
    expect(spy).toHaveBeenCalledWith('core.session.list', {});
  });
});

describe('PaletteModal', () => {
  it('navigates and selects entries', () => {
    const modal = new PaletteModal();
    modal.setEntries([
      { id: 'a', title: 'Alpha', invoke: () => {} },
      { id: 'b', title: 'Beta', invoke: () => {} },
    ]);
    expect(modal.selected().id).toBe('a');
    modal.move(1);
    expect(modal.selected().id).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/palette.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the palette module**

```typescript
// src/tui/capabilities/palette.ts
import { getCapabilityService } from './capability-service.js';
import type { Capability } from '../../capability/types.js';

/** A UI action in the palette — NOT a capability. View concerns only. */
export interface PaletteAction {
  id: string;
  title: string;
  run(): void;
}

export interface PaletteEntry {
  id: string;
  title: string;
  subtitle?: string;
  invoke(): void;
}

/** Supplies entries to the palette. Capabilities and UI actions are distinct. */
export interface PaletteProvider {
  readonly id: string;
  readonly title: string;
  search(query: string): PaletteEntry[];
}

/** Subsequence fuzzy match — 'cslist' matches 'core.session.list'. No deps. */
function subsequenceMatches(q: string, s: string): boolean {
  const needle = q.toLowerCase();
  const hay = s.toLowerCase();
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function matches(cap: Capability, query: string): boolean {
  if (!query) return true;
  return subsequenceMatches(query, cap.title) || subsequenceMatches(query, cap.id);
}

/** Phase-2 enabled provider: capabilities flow Registry → Runtime → Invocation. */
export class CapabilityProvider implements PaletteProvider {
  readonly id = 'capabilities';
  readonly title = 'Capabilities';

  search(query: string): PaletteEntry[] {
    const service = getCapabilityService();
    return service.query().filter((cap) => matches(cap, query)).map((cap) => ({
      id: cap.id,
      title: cap.title,
      subtitle: cap.id,
      invoke: () => { service.invoke(cap.id, {}); },
    }));
  }
}

/** Stubbed empty — UI actions are registered here in a later phase. */
export class ActionProvider implements PaletteProvider {
  readonly id = 'actions';
  readonly title = 'Actions';
  search(): PaletteEntry[] { return []; }
}

/** Pure modal state: entries + cursor. Rendered by TuiApp. */
export class PaletteModal {
  private entries: PaletteEntry[] = [];
  private cursor = 0;
  private providers: PaletteProvider[];

  constructor(providers: PaletteProvider[] = [new CapabilityProvider(), new ActionProvider()]) {
    this.providers = providers;
  }

  refresh(query: string): void {
    const entries = this.providers.flatMap((p) => p.search(query));
    this.entries = entries;
    this.cursor = Math.min(this.cursor, Math.max(0, entries.length - 1));
  }

  get list(): PaletteEntry[] { return this.entries; }
  get empty(): boolean { return this.entries.length === 0; }
  selected(): PaletteEntry { return this.entries[this.cursor]!; }
  move(delta: number): void {
    if (this.entries.length === 0) return;
    this.cursor = (this.cursor + delta + this.entries.length) % this.entries.length;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/palette.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Wire the palette into TuiApp**

In `src/tui/app.ts`:

1. Import: `import { PaletteModal } from './capabilities/palette.js'; import { getCapabilityService } from './capabilities/capability-service.js';`

2. Add to `TuiAppOptions`: `capabilityService?: import('./capabilities/capability-service.js').CapabilityService;` (optional — the palette only activates when a service is available).

3. Add instance fields:
```typescript
  private readonly palette = new PaletteModal();
  private paletteOpen = false;
  private paletteQuery = '';
```

4. In `parseKey`, add the Ctrl+P case before the single-byte pass-through (after the Ctrl+l case):
```typescript
  if (s === '\x10') return 'Ctrl+p';   // Ctrl+P — command palette
```

5. In `handleRaw`, before the tab-input handling (after `parseKey`), route to the palette when open:
```typescript
    if (this.paletteOpen) {
      this.handlePaletteKey(key);
      return;
    }
```

6. In `tryHandleGlobal`, add palette opening (before the `inputTabs` quit check):
```typescript
    // Command palette (Ctrl+P, or '/' on an empty chat/agent input).
    if (key === 'Ctrl+p' || (key === '/' && this.state.activeTab === 'chat' && this.state.views.chat.inputBuffer.length === 0)) {
      if (this.opts.capabilityService || this.hasCapabilityService()) {
        this.paletteOpen = true;
        this.paletteQuery = '';
        this.palette.refresh('');
        return true;
      }
      return false;
    }
```
(Add helper `private hasCapabilityService(): boolean { try { getCapabilityService(); return true; } catch { return false; } }`.)

7. Add the palette key handler + painting (place near `paintPlanApprovalCard`):

```typescript
  private handlePaletteKey(key: string): void {
    if (key === 'Escape') { this.paletteOpen = false; return; }
    if (key === 'Enter') {
      if (!this.palette.empty) {
        const entry = this.palette.selected();
        this.paletteOpen = false;
        entry.invoke();
      }
      return;
    }
    if (key === 'ArrowUp') { this.palette.move(-1); return; }
    if (key === 'ArrowDown') { this.palette.move(1); return; }
    if (key === 'Backspace') { this.paletteQuery = this.paletteQuery.slice(0, -1); }
    else if (key && key.length === 1) { this.paletteQuery += key; }
    this.palette.refresh(this.paletteQuery);
  }

  private paintPalette(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void {
    if (!this.paletteOpen) return;
    const PALETTE_H = 12;
    const y = Math.max(headerH + 1, Math.floor(height / 2) - Math.floor(PALETTE_H / 2));
    const innerW = Math.max(0, width - 4);
    canvas.drawBox(1, y, innerW, PALETTE_H, ' Command Palette (Ctrl+P) ', 5);
    canvas.write(3, y + 1, `\x1b[7m ${this.paletteQuery} \x1b[0m`);
    const list = this.palette.list;
    const rows = Math.max(0, PALETTE_H - 3);
    const start = Math.max(0, Math.min(this.palette.selectedIndex(), list.length - rows));
    for (let i = 0; i < Math.min(list.length, rows); i++) {
      const entry = list[start + i]!;
      const sel = start + i === this.palette.selectedIndex();
      const line = `${sel ? '› ' : '  '}${entry.title}${entry.subtitle ? `  \x1b[90m${entry.subtitle}\x1b[0m` : ''}`;
      canvas.write(3, y + 2 + i, (sel ? '\x1b[36m' : '') + line.slice(0, innerW - 4) + (sel ? '\x1b[0m' : ''));
    }
    if (list.length === 0) canvas.write(3, y + 2, '\x1b[90mNo capabilities found\x1b[0m');
  }
```

8. In `paintFullFrame`, after `this.paintPlanApprovalCard(...)`, call `this.paintPalette(viewCanvas, dims.columns, dims.rows, HEADER_H, FOOTER_H);`

9. Add `selectedIndex()` to `PaletteModal`:
```typescript
  selectedIndex(): number { return this.cursor; }
```

- [ ] **Step 6: Build + test + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui/capabilities --config vitest.config.mts`
```bash
git add src/tui/capabilities/palette.ts src/tui/app.ts tests/tui/capabilities/palette.vitest.ts
git commit -m "feat(capabilities): Command Palette over the capability registry"
```

---

### Task 5: Capabilities tab

**Files:**
- Create: `src/tui/capabilities/capabilities-view.ts`
- Modify: `src/tui/app.ts` (TAB_ORDER)
- Modify: `src/tui/views/index.ts` (register view)
- Test: `tests/tui/capabilities/capabilities-view.vitest.ts`

**Interfaces:**
- Consumes: `getCapabilityService` (Task 3), `TuiView`/`ViewRenderContext`/`ViewInputContext`/`ViewAction` from `src/tui/views/types.js`, `Capability` type.
- Produces: `CapabilitiesView` (TuiView).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/capabilities-view.vitest.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilitiesView } from '../../../src/tui/capabilities/capabilities-view.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { createInitialTuiAppState } from '../../../src/tui/state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { InvocationPresenter } from './invocation-presenter.js';

function setup() {
  clearCapabilityService();
  const presenter: InvocationPresenter = { present: vi.fn() };
  const svc = new CapabilityService(presenter);
  setCapabilityService(svc);
  return { svc };
}

describe('CapabilitiesView', () => {
  it('renders the catalog into the canvas', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState({});
    const canvas = new TerminalCanvas(80, 24);
    const ctx = { snap: state.snap, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    expect(out).toContain('core.session.list');
    expect(out).toContain('tool.file.read');
  });

  it('filters by query via ArrowUp/type', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState({});
    // Simulate the view's own search query state by calling handleKey.
    const ctx = { snap: state.snap, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities };
    view.handleKey('c', ctx as never);
    view.handleKey('o', ctx as never);
    const canvas = new TerminalCanvas(80, 24);
    view.render({ ...ctx, canvas } as never);
    expect(canvas.renderFrame()).toContain('core.session');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/capabilities-view.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found / `views.capabilities` missing.

- [ ] **Step 3: Create the view**

```typescript
// src/tui/capabilities/capabilities-view.ts
import type { TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from '../views/types.js';
import type { TerminalCanvas } from '../canvas.js';
import { getCapabilityService } from './capability-service.js';
import type { Capability } from '../../capability/types.js';

/** Search state is carried in PerTabState.searchQuery (already present). */

export class CapabilitiesView implements TuiView {
  readonly id: TabId = 'capabilities';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;
    const service = getCapabilityService();
    const query = (ctx.perTab.searchQuery ?? '').toLowerCase();
    const all = service.query();
    // Search is subsequence fuzzy, mirroring the palette.
    const subsequence = (q: string, s: string): boolean => {
      let i = 0;
      const hay = s.toLowerCase();
      for (let j = 0; j < hay.length && i < q.length; j++) if (hay[j] === q[i]) i++;
      return i === q.length;
    };
    const caps = query
      ? all.filter((cap) => subsequence(query, cap.title) || subsequence(query, cap.id))
      : all;

    if (ctx.perTab.capabilitiesSelectedId === undefined && caps.length > 0) {
      ctx.perTab.capabilitiesSelectedId = caps[0]!.id;
    }
    const selectedId = ctx.perTab.capabilitiesSelectedId;

    // Left: list.
    c.write(0, 4, `\x1b[1mCapabilities\x1b[0m  \x1b[90m${caps.length} of ${all.length}\x1b[0m`);
    c.write(0, 5, `\x1b[33msearch>\x1b[0m ${query}`);
    const listTop = 6;
    const listW = Math.floor(ctx.dimensions.columns / 2) - 1;
    for (let i = 0; i < Math.min(caps.length, ctx.dimensions.rows - listTop - 3); i++) {
      const cap = caps[i]!;
      const status = service.getStatus(cap.id);
      const dot = status?.availability === 'available' || !status ? '\x1b[32m●\x1b[0m'
        : status?.availability === 'degraded' ? '\x1b[33m●\x1b[0m' : '\x1b[31m●\x1b[0m';
      const sel = cap.id === selectedId;
      const line = `${sel ? '\x1b[36m' : ''}${dot} ${cap.title}  \x1b[90m${cap.id}\x1b[0m${sel ? '\x1b[0m' : ''}`;
      c.write(0, listTop + i, line.slice(0, listW));
    }

    // Right: detail of the selected capability.
    const detail = caps.find((cap) => cap.id === selectedId) ?? caps[0];
    if (detail) this.renderDetail(c, detail, listW + 1, 4, ctx.dimensions.columns - listW - 2, ctx.dimensions.rows - 7);

    return { rows: [] };
  }

  private renderDetail(c: TerminalCanvas, detail: Capability, x: number, y: number, w: number, h: number): void {
    c.write(x, y, `\x1b[1m${detail.title}\x1b[0m  \x1b[90m${detail.id} v${detail.version}\x1b[0m`);
    const lines: string[] = [];
    lines.push(detail.description);
    lines.push(`category: ${detail.category}   risk: ${detail.risk}`);
    lines.push(`kind: ${detail.kind}   tags: ${(detail.tags ?? []).join(', ')}`);
    lines.push(`permissions: ${(detail.requiredPermissions ?? []).join(', ')}`);
    const ex = detail.execution;
    lines.push(`strategy: ${ex.strategy}   timeout: ${ex.timeout ?? '—'}   cancellable: ${ex.cancellable ?? false}`);
    if (detail.argsSchema) lines.push(`args: ${JSON.stringify(detail.argsSchema)}`);
    if (detail.examples?.length) lines.push(`examples: ${detail.examples.join(' · ')}`);
    if (detail.dependencies?.length) lines.push(`depends on: ${detail.dependencies.join(', ')}`);
    for (let i = 0; i < Math.min(lines.length, h); i++) {
      const text = lines[i]!.slice(0, w);
      c.write(x, y + 1 + i, `\x1b[90m${text}\x1b[0m`);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // handleKey is permitted to mutate ctx.perTab (ViewInputContext is
    // "mutable from within handleKey only") — render stays pure.
    const service = getCapabilityService();
    const caps = service.query();
    const idx = caps.findIndex((cap) => cap.id === ctx.perTab.capabilitiesSelectedId);
    switch (key) {
      case 'ArrowDown':
      case 'j': {
        const next = caps[(idx + 1) % caps.length];
        if (next) ctx.perTab.capabilitiesSelectedId = next.id;
        return { type: 'handled' };
      }
      case 'ArrowUp':
      case 'k': {
        const next = caps[(idx - 1 + caps.length) % caps.length];
        if (next) ctx.perTab.capabilitiesSelectedId = next.id;
        return { type: 'handled' };
      }
      case 'Enter': {
        const cap = caps[idx];
        if (cap) service.invoke(cap.id, {});
        return { type: 'handled' };
      }
      case 'Backspace': {
        ctx.perTab.searchQuery = (ctx.perTab.searchQuery ?? '').slice(0, -1);
        return { type: 'handled' };
      }
      default: {
        if (key && key.length === 1) {
          ctx.perTab.searchQuery = (ctx.perTab.searchQuery ?? '') + key;
          return { type: 'handled' };
        }
        return { type: 'handled' };
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/capabilities-view.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Register the tab**

In `src/tui/app.ts`: add `'capabilities'` to `TAB_ORDER` (after `'policy'`).
In `src/tui/views/index.ts`: import `CapabilitiesView` and add it to the module-singleton map (`capabilities: new CapabilitiesView()`), plus export it.

- [ ] **Step 6: Build + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui/capabilities --config vitest.config.mts`
```bash
git add src/tui/capabilities/capabilities-view.ts src/tui/app.ts src/tui/views/index.ts tests/tui/capabilities/capabilities-view.vitest.ts
git commit -m "feat(capabilities): Capabilities tab catalog view"
```

---

### Task 6: Bootstrap wiring + end-to-end integration

**Files:**
- Modify: `src/cli/commands/tui.ts`
- Modify: `src/tui/app.ts` (`TuiAppOptions.capabilityService` already added in Task 4 — verify)
- Test: `tests/tui/capabilities/integration.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityService`, `setCapabilityService` (Task 3), `ChatInvocationPresenter` (Task 2), `loadConfig`, `EventLog` (already in tui.ts).
- Produces: wired `CapabilityService` at TUI bootstrap.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/capabilities/integration.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import { CapabilityProvider, PaletteModal } from '../../../src/tui/capabilities/palette.js';
import { createInitialTuiAppState } from '../../../src/tui/state.js';

describe('capabilities integration', () => {
  it('query → palette → invoke → chat timeline end-to-end', async () => {
    clearCapabilityService();
    const state = createInitialTuiAppState({});
    const presenter = new ChatInvocationPresenter(() => state.views.chat);
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    await svc.ready();

    // Palette search + invoke.
    const modal = new PaletteModal([new CapabilityProvider()]);
    modal.refresh('session');
    expect(modal.list.length).toBeGreaterThan(0);
    const entry = modal.list.find((e) => e.subtitle === 'core.session.list')!;
    entry.invoke();

    // The invocation presented into the chat timeline.
    expect(state.views.chat.capabilityInvocations.length).toBe(1);
    expect(state.views.chat.capabilityInvocations[0]!.capabilityId).toBe('core.session.list');
    // Wait for the invocation to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(['completed', 'failed']).toContain(state.views.chat.capabilityInvocations[0]!.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/integration.vitest.ts --config vitest.config.mts`
Expected: FAIL — `core.session.list` not found via the palette (session integration not awaited, or service not ready).

- [ ] **Step 3: Wire the bootstrap**

In `src/cli/commands/tui.ts`, inside the `runTui`/bootstrap function, after `config` and `eventLog` are created and BEFORE constructing `TuiApp`:

```typescript
  // Capability Platform consumer wiring — in-process service owns the
  // platform; the bootstrap owns infrastructure construction (ToolExecutor
  // here); TuiApp binds the chat-timeline presenter (it owns the state).
  const { CapabilityService, setCapabilityService } = await import('../../tui/capabilities/capability-service.js');
  const { ToolExecutor } = await import('../../tools/executor.js');
  const toolExecutor = new ToolExecutor(config, eventLog, process.cwd());
  const capabilityService = new CapabilityService(undefined, {
    eventLog,
    sessionId: currentSessionId,
    actor: 'operator',
    cwd: process.cwd(),
    toolExecutor,
  });
  setCapabilityService(capabilityService);
  await capabilityService.ready();
```

Note: `currentSessionId` and `config` already exist in `tui.ts`. Pass `capabilityService` into the `TuiAppOptions` as `capabilityService` (the option was added in Task 4).

Then bind the chat presenter in `src/tui/app.ts` (TuiApp owns the state; `this.state` is a field initializer so it is available in the constructor body):

```typescript
// Static import at the top of src/tui/app.ts:
import { ChatInvocationPresenter } from './capabilities/invocation-presenter.js';

// In the TuiApp constructor, after `this.renderer = new TuiRenderer();`:
    // Bind the capability service's presenter to this TUI's chat state so
    // every invocation surfaces in the operator timeline.
    if (this.opts.capabilityService) {
      const svc = this.opts.capabilityService;
      const presenter = new ChatInvocationPresenter(() => this.state.views.chat);
      svc.setPresenter(presenter);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/capabilities/integration.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/cli/commands/tui.ts tests/tui/capabilities/integration.vitest.ts
git commit -m "feat(capabilities): wire CapabilityService into TUI bootstrap"
```

---

### Task 7: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase2-design.md` (status → implemented)
- Create: `docs/capability-platform-phase2.md` (consumer note)

- [ ] **Step 1: Full build + full capability + TUI suites**

Run: `npm run build` and `npx vitest run tests/capability tests/tui --config vitest.config.mts`
Expected: clean, all pass.

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved Design` → `**Status:** Implemented (Phase 2)` in the Phase-2 spec.

- [ ] **Step 3: Write the consumer doc** (concise):

```markdown
# ALiX Capability Platform — Phase 2 (TUI)

Ctrl+P opens the command palette: type to fuzzy-search capabilities, Enter
to invoke. The Capabilities tab (9th tab) browses the catalog — docs,
schemas, permissions, availability — and Enter invokes from there too.

Every invocation runs through `CapabilityService.invoke()` (src/tui/
capabilities/), which routes the lifecycle into the chat timeline (the
operator's execution history) and bridges events into the EventLog via
toAlixEvent. The platform itself is UI-unaware.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-2 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ Ctrl+P opens the palette; fuzzy search finds capabilities; Enter invokes and the result appears in the chat timeline.
- ✅ Capabilities tab lists all capabilities with live availability + full metadata; Enter invokes.
- ✅ `CapabilityService.invoke()` presents automatically (centralized presentation policy).
- ✅ Platform events bridge to EventLog (`capability.*` types).
- ✅ `src/capability/*` is unmodified; platform keeps its own 46-test suite.
- ✅ Full working set wired (initial defs + session integration + tool executor).
- ✅ Palette architecture supports future `ActionProvider` (UI actions ≠ capabilities).
- ✅ Vitest green (new + existing), `tsc --noEmit` clean.
