# ALiX Capability Platform Phase 3 — Unified Operator Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat transcript's parallel-array conversation state with a single `timelineEvents[]` primitive — user prompts, agent responses, and capability invocations interleaved by time — so a capability invoked mid-conversation renders in its chronological position instead of appending after all turns.

**Architecture:** `PerTabState` gains `timelineEvents: TimelineEvent[]` (`{ id, timestamp, sequence, source }` + `kind`). A single `appendTimelineEvent(state, {...})` helper is the only writer path (it stamps id/timestamp/sequence/source); `getOrderedTimeline` sorts by timestamp then sequence. ChatView renders all three kinds interleaved; AgentView filters to user/agent (a projection, not another source); copy-scrollback uses a shared `formatTimelineEvent`. Incremental replace: add alongside → migrate writers → migrate views → migrate copy → delete legacy arrays only after zero production references remain.

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing TUI canvas/view system.

## Global Constraints

- **`src/capability/*` is NOT modified.** (Phase-1 invariant 9: the platform has no UI assumptions.)
- NodeNext ESM (`import ... from "./x.js"`), strict TS, vitest.
- **Direct `state.timelineEvents.push(...)` is banned outside `state.ts`** — enforced by `rg "timelineEvents\.push" src/tui` → `src/tui/state.ts` only. Writers route through `appendTimelineEvent`.
- **`appendTimelineEvent` returns the actual stored object, never a clone** — the capability presenter mutates it in place. Identity test: `expect(state.timelineEvents[0]).toBe(event)`.
- **`sequence` is a monotonic per-runtime counter** — the ordering tiebreak for same-millisecond events. Never use `Date.now()` alone for ordering.
- **AgentView is a projection of the same timeline, not another source** — never create a second `agentTimelineEvents[]`.
- **Capability entries render on the chat tab only** — never on the agent tab.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

---

### Task 1: State model + timeline helpers

**Files:**
- Modify: `src/tui/state.ts`
- Test: `tests/tui/timeline.vitest.ts` (new)
- Test fixtures (add `timelineEvents: []` to every inline `PerTabState` literal): `tests/agent-view-formatting.vitest.ts`, `tests/response-blocks-smoke.vitest.ts`, `tests/tui/state.vitest.ts`, `tests/tui/views/approvals-view.vitest.ts`, `tests/tui/views/chat-view.vitest.ts`, `tests/tui/views/daemon-view.vitest.ts`, `tests/tui/views/dashboard-view.vitest.ts`, `tests/tui/views/policy-view.vitest.ts`, `tests/tui/views/runtime-view.vitest.ts`, `tests/tui/views/sops-view.vitest.ts`, `tests/tui/views/types.vitest.ts`

**Interfaces:**
- Produces: `TimelineSource`, `TimelineEventBase`, `TimelineEvent`, `TimelineEventInput`, `PerTabState.timelineEvents`, `nextTimelineSequence()`, `appendTimelineEvent()`, `getOrderedTimeline()`, `capabilityStatusText()`, `formatTimelineEvent()` (all below).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/timeline.vitest.ts
import { describe, it, expect } from 'vitest';
import {
  createInitialPerTabState, appendTimelineEvent, getOrderedTimeline,
  capabilityStatusText, formatTimelineEvent,
  type TimelineEvent,
} from '../../src/tui/state.js';

describe('appendTimelineEvent', () => {
  it('stamps id/timestamp/sequence/source and returns the stored object', () => {
    const state = createInitialPerTabState();
    const event = appendTimelineEvent(state, { kind: 'user', text: 'hi' });
    expect(state.timelineEvents[0]).toBe(event);          // identity — no clone
    expect(event.id).toBe(`tl-${event.sequence}`);
    expect(typeof event.timestamp).toBe('number');
    expect(event.source).toBe('operator');
  });

  it('maps source from kind', () => {
    const state = createInitialPerTabState();
    expect(appendTimelineEvent(state, { kind: 'agent', text: 'ok' }).source).toBe('agent');
    expect(appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'c', status: 'running' }).source).toBe('capability');
  });

  it('sequence is monotonic across appends', () => {
    const state = createInitialPerTabState();
    const a = appendTimelineEvent(state, { kind: 'user', text: 'a' });
    const b = appendTimelineEvent(state, { kind: 'user', text: 'b' });
    const c = appendTimelineEvent(state, { kind: 'user', text: 'c' });
    expect(a.sequence).toBeLessThan(b.sequence);
    expect(b.sequence).toBeLessThan(c.sequence);
  });
});

describe('getOrderedTimeline', () => {
  it('sorts by timestamp then sequence — stored order differs from display order', () => {
    const state = createInitialPerTabState();
    const user = appendTimelineEvent(state, { kind: 'user', text: 'hello' });
    const agent = appendTimelineEvent(state, { kind: 'agent', text: 'done' });
    const cap = appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'running' });
    // Capability ran between user and agent.
    user.timestamp = 100;
    cap.timestamp = 150;
    agent.timestamp = 200;
    // Stored order (append order) vs display order (time order).
    expect(state.timelineEvents.map(e => e.kind)).toEqual(['user', 'agent', 'capability']);
    expect(getOrderedTimeline(state.timelineEvents).map(e => e.kind)).toEqual(['user', 'capability', 'agent']);
  });

  it('does not mutate the input array', () => {
    const state = createInitialPerTabState();
    appendTimelineEvent(state, { kind: 'user', text: 'a' });
    appendTimelineEvent(state, { kind: 'user', text: 'b' });
    const before = state.timelineEvents.map(e => e.kind);
    getOrderedTimeline(state.timelineEvents);
    expect(state.timelineEvents.map(e => e.kind)).toEqual(before);
  });
});

describe('capabilityStatusText + formatTimelineEvent', () => {
  it('formats all capability statuses', () => {
    const state = createInitialPerTabState();
    const cap = appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'running' }) as Extract<TimelineEvent, { kind: 'capability' }>;
    expect(capabilityStatusText(cap)).toBe('core.session.list [running]');
    cap.status = 'completed'; cap.output = '["s1"]';
    expect(capabilityStatusText(cap)).toBe('core.session.list [completed ✓] ["s1"]');
    cap.status = 'failed'; cap.error = 'boom';
    expect(capabilityStatusText(cap)).toBe('core.session.list [failed ✗] boom');
    cap.status = 'cancelled';
    expect(capabilityStatusText(cap)).toBe('core.session.list [cancelled]');
  });

  it('formatTimelineEvent produces one-liners', () => {
    const state = createInitialPerTabState();
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'user', text: 'hi' }))).toBe('→ hi');
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'agent', text: 'ok' }))).toBe('← ok');
    expect(formatTimelineEvent(appendTimelineEvent(state, { kind: 'capability', invocationId: 'i', capabilityId: 'c', status: 'completed' }))).toBe('⚡ c [completed ✓]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/timeline.vitest.ts --config vitest.config.mts`
Expected: FAIL — `TimelineEvent` / `appendTimelineEvent` / `timelineEvents` do not exist.

- [ ] **Step 3: Add the timeline model to `src/tui/state.ts`**

Add near `CapabilityInvocationEntry` (which is deleted in Task 6 — keep it for now):

```typescript
/** Who produced a timeline event. Add `'system'` when the first system event exists (YAGNI). */
export type TimelineSource = 'operator' | 'agent' | 'capability';

export interface TimelineEventBase {
  /** Runtime-local deterministic id: `tl-${sequence}`. Unique within one TUI
   *  runtime instance; NOT globally unique across sessions. If persistence
   *  arrives, introduce `timelineId = sessionId + sequence` without changing
   *  this model. */
  id: string;
  /** Date.now() at append. */
  timestamp: number;
  /** Monotonic per-runtime counter — the ordering tiebreak. */
  sequence: number;
  /** Who produced the event — orthogonal to `kind`. Stamped by appendTimelineEvent; writers never set it. */
  source: TimelineSource;
}

/** A conversation-turn / capability event in the operator timeline. */
export type TimelineEvent =
  | (TimelineEventBase & { kind: 'user'; text: string })
  | (TimelineEventBase & { kind: 'agent'; text: string })
  | (TimelineEventBase & { kind: 'capability';
      invocationId: string; capabilityId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      output?: unknown; error?: string });
```

In `PerTabState`, add the field (near `capabilityInvocations`):

```typescript
  /** Unified operator timeline — user prompts, agent responses, capability
   *  invocations, ordered by (timestamp, sequence). Single source of truth
   *  for conversation; the chat/agent/copy views are projections of this. */
  timelineEvents: TimelineEvent[];
```

In `createInitialPerTabState`, add `timelineEvents: [],`.

- [ ] **Step 4: Add the helpers to `src/tui/state.ts`**

Add after `createInitialPerTabState`:

```typescript
/** Writer-facing timeline input: a TimelineEvent minus the stamped base fields. */
export type TimelineEventInput =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'capability'; invocationId: string; capabilityId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      output?: unknown; error?: string };

let timelineSequence = 0;
export function nextTimelineSequence(): number { return ++timelineSequence; }

/**
 * The ONLY writer path into the timeline. Stamps id/timestamp/sequence/source,
 * pushes, and returns the actual stored object (never a clone) so the caller
 * can hold it for in-place mutation (the capability presenter does this).
 */
export function appendTimelineEvent(state: PerTabState, event: TimelineEventInput): TimelineEvent {
  const sequence = nextTimelineSequence();
  const source: TimelineSource = event.kind === 'user' ? 'operator'
    : event.kind === 'agent' ? 'agent' : 'capability';
  const created = {
    ...event,
    id: `tl-${sequence}`,
    timestamp: Date.now(),
    sequence,
    source,
  } as TimelineEvent;
  state.timelineEvents.push(created);
  return created;
}

/** Ordered view of the timeline: by timestamp, then sequence (deterministic same-ms). Does not mutate input. */
export function getOrderedTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
}

/** Status suffix for a capability event — "core.session.list [completed ✓]". Shared by ChatView + copy. */
export function capabilityStatusText(event: Extract<TimelineEvent, { kind: 'capability' }>): string {
  let text = event.capabilityId;
  if (event.status === 'running') text += ' [running]';
  else if (event.status === 'completed') {
    text += ' [completed ✓]';
    if (event.output !== undefined) text += ` ${JSON.stringify(event.output)}`;
  } else if (event.status === 'failed') text += ` [failed ✗] ${event.error ?? ''}`;
  else text += ' [cancelled]';
  return text.trim();
}

/** One-line rendering of a timeline event — shared by copy-scrollback so copy matches the chat view. */
export function formatTimelineEvent(event: TimelineEvent): string {
  switch (event.kind) {
    case 'user': return `→ ${event.text}`;
    case 'agent': return `← ${event.text}`;
    case 'capability': return `⚡ ${capabilityStatusText(event)}`;
  }
}
```

- [ ] **Step 5: Add `timelineEvents: []` to every inline `PerTabState` literal in the fixture files listed above** (the same mechanical pattern used for `capabilityInvocations: []` in Phase 2). Files that construct `PerTabState` inline: `tests/agent-view-formatting.vitest.ts` (`makePerTab`), `tests/response-blocks-smoke.vitest.ts` (inline `perTab`), `tests/tui/state.vitest.ts` (serializability fixtures + defaults), `tests/tui/views/{approvals,chat,daemon,dashboard,policy,runtime,sops,types}.vitest.ts`. Files that use `createInitialTuiAppState()` / `createInitialPerTabState()` (already covered) do NOT need the edit.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/tui/timeline.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 7: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/state.ts tests/tui/timeline.vitest.ts tests/agent-view-formatting.vitest.ts tests/response-blocks-smoke.vitest.ts tests/tui/state.vitest.ts tests/tui/views/approvals-view.vitest.ts tests/tui/views/chat-view.vitest.ts tests/tui/views/daemon-view.vitest.ts tests/tui/views/dashboard-view.vitest.ts tests/tui/views/policy-view.vitest.ts tests/tui/views/runtime-view.vitest.ts tests/tui/views/sops-view.vitest.ts tests/tui/views/types.vitest.ts
git commit -m "feat(tui): unified operator timeline — state model + append/sort/format helpers"
```

---

### Task 2: Migrate the writers to `appendTimelineEvent`

**Files:**
- Modify: `src/tui/app.ts` (chat submit ~L316, agent submit ~L357, dispatchToSession perTab type + agent-response push ~L474-530, appendAgentMessage ~L817-824)
- Modify: `src/tui/capabilities/invocation-presenter.ts`
- Test: `tests/tui/capabilities/invocation-presenter.vitest.ts` (rewrite to timelineEvents)
- Test: `tests/tui/capabilities/integration.vitest.ts` (read `timelineEvents` instead of `capabilityInvocations`)
- Test: `tests/tui/app.vitest.ts` (writer-behavior assertions read `timelineEvents` instead of `submittedPrompts`/`agentResponses`)

**Interfaces:**
- Consumes: `appendTimelineEvent`, `TimelineEvent`, `PerTabState` (Task 1).
- Produces: all production writes to `submittedPrompts`/`agentResponses`/`capabilityInvocations` become `appendTimelineEvent` calls. New writes go to the timeline only; legacy arrays stop receiving.

- [ ] **Step 1: Write the failing test**

Update `tests/tui/capabilities/invocation-presenter.vitest.ts` — relocate the Phase-2 assertions from `capabilityInvocations` to `timelineEvents`, and drive the event path (the final-review fix-wave test shape):

```typescript
// tests/tui/capabilities/invocation-presenter.vitest.ts
import { describe, it, expect } from 'vitest';
import { ChatInvocationPresenter, type InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import { createInitialPerTabState, type TimelineEvent } from '../../../src/tui/state.js';
import type { Invocation, CapabilityEvent } from '../../../src/capability/types.js';

function makeInvocation(id = 'inv_1', capabilityId = 'core.session.list'): Invocation & { __push(e: CapabilityEvent): void } {
  const events: CapabilityEvent[] = [];
  const push = (e: CapabilityEvent) => { events.push(e); };
  return {
    id, status: 'running', cancel: () => {}, subscribe: () => () => {},
    wait: () => Promise.resolve({ invocationId: id, status: 'completed', startedAt: 0, completedAt: 1, output: '["s1"]' }),
    result: () => undefined,
    events: () => ({ [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { if (i < events.length) return { value: events[i++]!, done: false }; return { value: undefined, done: true }; } };
    } }),
    __push: push,
  } as never;
}

function capEvent(state: { timelineEvents: TimelineEvent[] }): Extract<TimelineEvent, { kind: 'capability' }> {
  const evt = state.timelineEvents.find((e) => e.kind === 'capability');
  if (!evt) throw new Error('no capability event');
  return evt as Extract<TimelineEvent, { kind: 'capability' }>;
}

describe('ChatInvocationPresenter', () => {
  it('appends a running capability event, then updates it to completed with output', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    const inv = makeInvocation();
    const p = presenter.present({ invocation: inv, capabilityId: 'core.session.list', args: {} });
    expect(state.timelineEvents).toHaveLength(1);
    expect(capEvent(state).status).toBe('running');
    inv.__push({ type: 'InvocationCompleted', invocationId: 'inv_1', at: 2 });
    await p;
    expect(capEvent(state).status).toBe('completed');
    expect(capEvent(state).output).toBe('["s1"]');
  });

  it('falls back to wait() output when the stream closes without a terminal event', async () => {
    const state = createInitialPerTabState();
    const presenter = new ChatInvocationPresenter(() => state);
    await presenter.present({ invocation: makeInvocation(), capabilityId: 'core.session.list', args: {} });
    expect(capEvent(state).status).toBe('completed');
    expect(capEvent(state).output).toBe('["s1"]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/invocation-presenter.vitest.ts --config vitest.config.mts`
Expected: FAIL — the presenter still writes `capabilityInvocations`, so `state.timelineEvents` is empty.

- [ ] **Step 3: Migrate `src/tui/app.ts` writers**

1. Add `appendTimelineEvent` to the value import from `./state.js` and `PerTabState` to the type import (line 1-2):

```typescript
import type { PanelFocusId, PanelScrollOffsets, PerTabState, TabId, TuiAppState } from './state.js';
import { appendTimelineEvent, createInitialTuiAppState, SessionPhase } from './state.js';
```

2. Chat-tab submit (was `perTab.submittedPrompts.push(perTab.inputBuffer);`):

```typescript
          appendTimelineEvent(perTab, { kind: 'user', text: perTab.inputBuffer });
```

3. Agent-tab submit (same replacement at the agent submit site).

4. `dispatchToSession` — widen the `perTab` parameter to a narrow writable view (it currently narrows to `{ agentResponses: string[]; scrollOffset: number; planContent?: string; planTasks?: readonly PlanTask[] }`). Define the narrow type in `src/tui/app.ts` (or import a `TimelineWritableState` from `state.ts` if you prefer it co-located) so the function stays honest about what it writes — it only needs the timeline, not the whole `PerTabState`:

```typescript
type TimelineWritableState = Pick<PerTabState, 'timelineEvents'>;
```
```typescript
  private async dispatchToSession(
    text: string,
    kind: 'chat' | 'agent',
    perTab: TimelineWritableState,
    candidates: Array<((text: string) => Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }>) | undefined>,
    fallbackPrefix: string,
    timeoutMs = 5_000,
  ): Promise<void> {
```
The function also assigns `perTab.planContent`/`perTab.planTasks`/`perTab.scrollOffset` — verify those fields exist on the actual `PerTabState` passed in (they do), and either keep them on the writable type or use a wider type that includes them (e.g. `Pick<PerTabState, 'timelineEvents' | 'planContent' | 'planTasks' | 'scrollOffset'>`). Callers pass `this.state.views.chat` / `this.state.views.agent`, which satisfy either. Inside, replace the response push:
```typescript
    appendTimelineEvent(perTab, { kind: 'agent', text: summary });
```

5. `appendAgentMessage` (was `state.agentResponses.push(text);`) — update the doc comment and the body:

```typescript
  /**
   * Append a one-liner to the active view's operator timeline so the
   * resolution message shows in the scrollback.
   */
  private appendAgentMessage(
    tab: TabId,
    text: string,
  ): void {
    const state = this.state.views[tab];
    if (!state) return;
    appendTimelineEvent(state, { kind: 'agent', text });
  }
```

- [ ] **Step 4: Migrate `src/tui/capabilities/invocation-presenter.ts`**

Replace the whole file body (imports + class):

```typescript
import type { PerTabState } from '../state.js';
import { appendTimelineEvent } from '../state.js';
import type { TimelineEvent } from '../state.js';
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

  async present({ invocation, capabilityId }: InvocationInput): Promise<void> {
    const state = this.getChatState();
    // appendTimelineEvent returns the actual stored object (never a clone),
    // so mutating `event` below updates the entry in the timeline.
    const event = appendTimelineEvent(state, {
      kind: 'capability',
      invocationId: invocation.id,
      capabilityId,
      status: 'running',
    }) as Extract<TimelineEvent, { kind: 'capability' }>;

    // Terminal events update the entry live from the invocation's own
    // event stream. No race with the runtime starting: Invocation.events()
    // is backed by the AsyncEventQueue, which buffers until consumed.
    for await (const evt of invocation.events()) {
      this.applyEvent(event, evt);
    }
    // InvocationCompleted carries NO output — output lives only on the
    // wait() result. Always resolve the settled result and merge
    // output/error; wait() resolves immediately once settled.
    const result = await invocation.wait();
    if (event.status === 'running') {
      event.status = result.status === 'completed' ? 'completed'
        : result.status === 'cancelled' ? 'cancelled' : 'failed';
    }
    if (result.status === 'completed') event.output = result.output;
    if (result.status === 'failed') event.error = result.error;
  }

  private applyEvent(event: Extract<TimelineEvent, { kind: 'capability' }>, evt: CapabilityEvent): void {
    switch (evt.type) {
      case 'InvocationCompleted':
        event.status = 'completed';
        break;
      case 'InvocationFailed':
        event.status = 'failed';
        event.error = evt.error;
        break;
      case 'InvocationCancelled':
        event.status = 'cancelled';
        break;
    }
  }
}
```

- [ ] **Step 5: Update `tests/tui/capabilities/integration.vitest.ts`**

Replace the two reads of `state.views.chat.capabilityInvocations` with `timelineEvents` (filtered to capability kind):

```typescript
    // The invocation presented into the chat timeline.
    const caps = state.views.chat.timelineEvents.filter((e) => e.kind === 'capability');
    expect(caps.length).toBe(1);
    expect(caps[0]!.capabilityId).toBe('core.session.list');
    // Wait for the invocation to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(['completed', 'failed']).toContain(caps[0]!.status);
```

- [ ] **Step 6: Migrate the writer-behavior assertions in `tests/tui/app.vitest.ts`**

The `makeApp`/`makeCopyApp` harness types its state as
`views: { chat: { submittedPrompts: string[]; agentResponses: string[] }; agent: {...} }`
(~L63-66) and ~15 tests assert on those arrays (Enter records prompts, submit
appends responses, agent echo, error responses — ~L126-250). After the writer
migration these arrays stop receiving data, so update the harness type and the
assertions to read the timeline. Add a helper near `makeApp`:

```typescript
function timelineTexts(view: { timelineEvents: Array<{ kind: string; text?: string }> }, kind: string): string[] {
  return view.timelineEvents.filter((e) => e.kind === kind).map((e) => e.text ?? '');
}
```

Change the harness type to:

```typescript
        views: {
          chat: { inputBuffer: string; timelineEvents: Array<{ kind: string; text?: string }> };
          agent: { inputBuffer: string; timelineEvents: Array<{ kind: string; text?: string }> };
        };
```

and replace the `submittedPrompts`/`agentResponses` assertions, e.g.:

```typescript
    // before: expect(internal.getStateForTest().views.chat.submittedPrompts).toEqual(['fix it']);
    expect(timelineTexts(internal.getStateForTest().views.chat, 'user')).toEqual(['fix it']);
    // before: expect(internal.getStateForTest().views.chat.agentResponses).toEqual(['reply to: fix it']);
    expect(timelineTexts(internal.getStateForTest().views.chat, 'agent')).toEqual(['reply to: fix it']);
```

Apply the same `timelineTexts(view, 'user')` / `'agent'` transformation to every
assertion at lines ~126-250 (chat + agent tabs). The `makeCopyApp` harness at
~L418-424 is migrated in Task 5.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/tui/capabilities --config vitest.config.mts` and `npx vitest run tests/tui/app.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 8: Verify the push-banned invariant + full suite + commit**

Run: `rg "timelineEvents\.push" src/tui` → only `src/tui/state.ts`. Then `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`.
```bash
git add src/tui/app.ts src/tui/capabilities/invocation-presenter.ts tests/tui/capabilities/invocation-presenter.vitest.ts tests/tui/capabilities/integration.vitest.ts tests/tui/app.vitest.ts
git commit -m "feat(capabilities): migrate timeline writers to appendTimelineEvent"
```

---

### Task 3: ChatView — interleaved timeline rendering

**Files:**
- Modify: `src/tui/views/chat-view.ts`
- Test: `tests/tui/capabilities/chat-invocations.vitest.ts` (rewrite — add the mid-conversation interleaving test)
- Test: `tests/tui/views/chat-view.vitest.ts` (seed `timelineEvents` instead of `submittedPrompts`/`agentResponses`)
- Test: `tests/response-blocks-smoke.vitest.ts` (seed `timelineEvents` instead of `submittedPrompts`/`agentResponses`)

**Interfaces:**
- Consumes: `getOrderedTimeline`, `capabilityStatusText`, `TimelineEvent` (Task 1).
- Produces: the chat tab renders the full operator timeline interleaved by time.

- [ ] **Step 1: Write the failing test**

Rewrite `tests/tui/capabilities/chat-invocations.vitest.ts`:

```typescript
// tests/tui/capabilities/chat-invocations.vitest.ts
import { describe, it, expect } from 'vitest';
import { createInitialTuiAppState, appendTimelineEvent, type TabId } from '../../../src/tui/state.js';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';

describe('capability invocation chat entries', () => {
  it('initializes timelineEvents empty for every tab', () => {
    const state = createInitialTuiAppState();
    for (const tab of Object.keys(state.views) as TabId[]) {
      expect(state.views[tab].timelineEvents).toEqual([]);
    }
  });

  it('chat view renders a completed invocation entry', () => {
    const state = createInitialTuiAppState();
    appendTimelineEvent(state.views.chat, {
      kind: 'capability', invocationId: 'inv_1', capabilityId: 'core.session.list',
      status: 'completed', output: '["s1"]',
    });
    const canvas = new TerminalCanvas(60, 20);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 60, rows: 20 }, perTab: state.views.chat, canvas };
    const view = new ChatView();
    view.render(ctx as never);
    expect(canvas.renderFrame()).toContain('core.session.list');
  });

  it('interleaves a mid-conversation capability by time (Phase-3 goal)', () => {
    const state = createInitialTuiAppState();
    const user = appendTimelineEvent(state.views.chat, { kind: 'user', text: 'first' });
    const agent = appendTimelineEvent(state.views.chat, { kind: 'agent', text: 'second' });
    const cap = appendTimelineEvent(state.views.chat, { kind: 'capability', invocationId: 'inv_1', capabilityId: 'core.session.list', status: 'completed', output: '["s1"]' });
    // Capability actually ran between the user prompt and the agent response.
    user.timestamp = 100; cap.timestamp = 150; agent.timestamp = 200;
    const canvas = new TerminalCanvas(60, 20);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 60, rows: 20 }, perTab: state.views.chat, canvas };
    const view = new ChatView();
    view.render(ctx as never);
    const frame = canvas.renderFrame();
    // Row order in the scrollback: user prompt, then the capability (which
    // ran mid-conversation), then the agent response.
    expect(frame).toContain('first');
    expect(frame.indexOf('first')).toBeLessThan(frame.indexOf('core.session.list'));
    expect(frame.indexOf('core.session.list')).toBeLessThan(frame.indexOf('second'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/capabilities/chat-invocations.vitest.ts --config vitest.config.mts`
Expected: FAIL — the capability renders after the turns (append-after-turns), so `capIdx` is not between `firstIdx` and `secondIdx`.

- [ ] **Step 3: Migrate `src/tui/views/chat-view.ts` render**

1. Update the import:

```typescript
import type { PerTabState, TabId } from '../state.js';
import { capabilityStatusText, getOrderedTimeline } from '../state.js';
```

2. Replace the turn-flattening block (currently reads `submitted`/`responses` from `ctx.perTab` and appends `capabilityInvocations` after the loop) with the unified timeline loop:

```typescript
    // Unified operator timeline — user prompts, agent responses, and
    // capability invocations interleaved by (timestamp, sequence). This is
    // the Phase-3 payoff: a capability invoked mid-conversation renders in
    // its chronological position, not appended after all turns.
    const events = getOrderedTimeline(ctx.perTab.timelineEvents);
    let firstUserSeen = false;
    for (const event of events) {
      // Blank-line separator between turns so each query breathes away
      // from the previous response. Skip the very first user turn so we
      // don't push a leading empty line.
      if (event.kind === 'user') {
        if (firstUserSeen) allLines.push({ kind: 'user', text: '', isFirst: false });
        firstUserSeen = true;
      }
      switch (event.kind) {
        case 'user': {
          const wrapped = wrapText(event.text, textWidth);
          wrapped.forEach((line, j) => {
            allLines.push({ kind: 'user', text: line, isFirst: j === 0 });
          });
          break;
        }
        case 'agent': {
          renderResponse(event.text, textWidth, ctx.themeName ? getTheme(ctx.themeName) : undefined).forEach((row, j) => {
            allLines.push({ kind: 'agent', text: row.text, isFirst: j === 0 });
          });
          break;
        }
        case 'capability': {
          allLines.push({ kind: 'capability', text: capabilityStatusText(event), isFirst: true });
          break;
        }
      }
    }
```

The marker ternary in the render loop (already handles `'capability'` with the `⚡` marker) stays unchanged.

- [ ] **Step 4: Update `tests/tui/views/chat-view.vitest.ts` and `tests/response-blocks-smoke.vitest.ts`**

These render ChatView from a `PerTabState` seeded with `submittedPrompts`/`agentResponses`. Replace those seeds with `timelineEvents`.

In `tests/tui/views/chat-view.vitest.ts`, the render ctx helper builds `perTab` inline (with `submittedPrompts: []` / `agentResponses: []` / `capabilityInvocations: []`). Change the inline literal to `timelineEvents: []`, and for the tests that seed conversation (e.g. the one with `submittedPrompts: ['show me a function']` / `agentResponses: ['```python\ndef f(): pass\n```']`), seed `timelineEvents` instead:

```typescript
timelineEvents: [
  { id: 'tl-1', timestamp: 1, sequence: 1, source: 'operator', kind: 'user', text: 'show me a function' },
  { id: 'tl-2', timestamp: 2, sequence: 2, source: 'agent', kind: 'agent', text: '```python\ndef f(): pass\n```' },
]
```

In `tests/response-blocks-smoke.vitest.ts`, the inline `perTab` sets `submittedPrompts: [...], agentResponses: [SAMPLE]` — replace with the equivalent two `timelineEvents` entries (user prompt + agent SAMPLE). (Either `appendTimelineEvent(perTab, ...)` on the built object, or a direct full-object `timelineEvents` array, is fine — the fields must satisfy `TimelineEvent`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tui/capabilities tests/tui/views/chat-view.vitest.ts --config vitest.config.mts` and `npx vitest run tests/response-blocks-smoke.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/views/chat-view.ts tests/tui/capabilities/chat-invocations.vitest.ts tests/tui/views/chat-view.vitest.ts tests/response-blocks-smoke.vitest.ts
git commit -m "feat(tui): ChatView renders the unified timeline interleaved by time"
```

---

### Task 4: AgentView — filtered projection

**Files:**
- Modify: `src/tui/views/agent-view.ts`
- Test: `tests/agent-view-formatting.vitest.ts` (seed `timelineEvents` instead of `submittedPrompts`/`agentResponses`)

**Interfaces:**
- Consumes: `TimelineEvent` (Task 1).
- Produces: the agent tab's conversation scrollback reads `timelineEvents` filtered to `user`/`agent` — a projection, never a second array.

- [ ] **Step 1: Write the failing test**

Update `tests/agent-view-formatting.vitest.ts`. Its `makePerTab(overrides)` currently supports `submittedPrompts`/`agentResponses` — migrate the fixture seeds to `timelineEvents` (the test helper `renderOnCanvas(W, H, perTab)` stays unchanged):

```typescript
// In the tests that seed a conversation, replace e.g.:
//   const perTab = makePerTab({ submittedPrompts: ['...'], agentResponses: ['...'] });
// with:
    const perTab = makePerTab({});
    perTab.timelineEvents = [
      { id: 'tl-1', timestamp: 1, sequence: 1, source: 'operator', kind: 'user', text: 'what is the meaning of life?' },
      { id: 'tl-2', timestamp: 2, sequence: 2, source: 'agent', kind: 'agent', text: '42' },
    ];

// New test — capability entries never appear on the agent tab:
it('does not render capability events on the agent tab', () => {
  const perTab = makePerTab({});
  perTab.timelineEvents = [
    { id: 'tl-1', timestamp: 1, sequence: 1, source: 'operator', kind: 'user', text: 'task' },
    { id: 'tl-2', timestamp: 2, sequence: 2, source: 'capability', kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'completed' },
  ];
  const c = renderOnCanvas(W, COMPACT, perTab);
  const frame = c.renderFrame();
  expect(frame).toContain('task');
  expect(frame).not.toContain('core.session.list');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts --config vitest.config.mts`
Expected: FAIL — the agent view still reads `submittedPrompts`/`agentResponses`, so the seeded `timelineEvents` are ignored.

- [ ] **Step 3: Migrate `src/tui/views/agent-view.ts`**

1. Add the type import:

```typescript
import type { PerTabState, TabId } from '../state.js';
import type { TimelineEvent } from '../state.js';
```

2. Replace the turns-building block (currently reads `submitted`/`responses`):

```typescript
    // Conversation turns from the unified operator timeline. The agent
    // view is a PROJECTION of the same timeline — filtered to user/agent
    // only. Capability entries never appear here (the agent tab is the
    // execution workspace; the chat tab is the operator narrative).
    const turns: { kind: 'user' | 'agent'; text: string }[] = ctx.perTab.timelineEvents
      .filter((e): e is Extract<TimelineEvent, { kind: 'user' | 'agent' }> => e.kind === 'user' || e.kind === 'agent')
      .map((e) => ({ kind: e.kind, text: e.text }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agent-view-formatting.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/views/agent-view.ts tests/agent-view-formatting.vitest.ts
git commit -m "feat(tui): AgentView reads the timeline as a user/agent projection"
```

---

### Task 5: Copy-scrollback — shared formatter

**Files:**
- Modify: `src/tui/app.ts` (`collectVisibleTranscript` ~L906-913)
- Test: `tests/tui/app.vitest.ts` (update the copy test ~L416-424 to seed `timelineEvents` + assert capability lines)

**Interfaces:**
- Consumes: `getOrderedTimeline`, `formatTimelineEvent` (Task 1).
- Produces: copy output is a projection of the same timeline (capability entries included).

- [ ] **Step 1: Write the failing test**

Update the copy test in `tests/tui/app.vitest.ts`:

```typescript
  it('copies the operator timeline (prompts, responses, capabilities)', () => {
    const { internal } = makeCopyApp();
    const chat = internal.getStateForTest().views.chat;
    appendTimelineEvent(chat, { kind: 'user', text: 'q1' });
    appendTimelineEvent(chat, { kind: 'user', text: 'q2' });
    appendTimelineEvent(chat, { kind: 'agent', text: 'a1' });
    appendTimelineEvent(chat, { kind: 'agent', text: 'a2' });
    appendTimelineEvent(chat, { kind: 'capability', invocationId: 'i', capabilityId: 'core.session.list', status: 'completed' });
    const text = (internal as any).collectVisibleTranscript('chat');
    expect(text).toContain('→ q1');
    expect(text).toContain('← a1');
    expect(text).toContain('← a2');
    expect(text).toContain('⚡ core.session.list [completed ✓]');
  });
```
(Add `appendTimelineEvent` to the `./state.js` import in the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/app.vitest.ts --config vitest.config.mts`
Expected: FAIL — the transcript builder still reads `submittedPrompts`/`agentResponses`.

- [ ] **Step 3: Migrate `collectVisibleTranscript`**

```typescript
  /**
   * Collect the operator timeline for a tab — user prompts, agent
   * responses, and capability invocations in chronological order — as a
   * plain-text transcript. Uses the same formatTimelineEvent as the views
   * so a copied transcript always matches what the chat tab shows.
   */
  private collectVisibleTranscript(tab: TabId): string {
    const v = this.state.views[tab];
    return getOrderedTimeline(v.timelineEvents).map(formatTimelineEvent).join('\n');
  }
```
Add `getOrderedTimeline` and `formatTimelineEvent` to the `./state.js` value import in `src/tui/app.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/app.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/app.ts tests/tui/app.vitest.ts
git commit -m "feat(tui): copy-scrollback projects the unified timeline via formatTimelineEvent"
```

---

### Task 6: Delete the legacy arrays

**Files:**
- Modify: `src/tui/state.ts` (remove `CapabilityInvocationEntry`, `submittedPrompts`, `agentResponses`, `capabilityInvocations` from `PerTabState` + `createInitialPerTabState`)
- Test fixtures (remove the three legacy fields from the remaining `PerTabState` literals — `chat-view.vitest`, `response-blocks-smoke`, `agent-view-formatting`, and `app.vitest` were already migrated in Tasks 2-4): `tests/tui/state.vitest.ts`, `tests/tui/views/{approvals,daemon,dashboard,policy,runtime,sops,types}.vitest.ts`

**Interfaces:**
- Consumes: nothing new — every production reader/writer already migrated in Tasks 1-5.
- Produces: zero production references to `submittedPrompts` / `agentResponses` / `capabilityInvocations`.

- [ ] **Step 1: Verify zero production references**

Run: `rg "submittedPrompts|agentResponses|capabilityInvocations" src/`
Expected: only `src/tui/state.ts` (the definitions still to be deleted).

- [ ] **Step 2: Delete from `src/tui/state.ts`**

1. Remove the `CapabilityInvocationEntry` interface.
2. Remove `submittedPrompts`, `agentResponses`, `capabilityInvocations` from `PerTabState`.
3. Remove them from `createInitialPerTabState`.

- [ ] **Step 3: Let the compiler find the remaining fixtures**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: tsc flags every `PerTabState` literal that still carries the removed fields (excess-property errors). Remove those fields from each flagged file — `tests/tui/state.vitest.ts` and `tests/tui/views/{approvals,daemon,dashboard,policy,runtime,sops,types}.vitest.ts`. The `timelineEvents` field (added in Task 1) is the replacement. Iterate until tsc is clean.

- [ ] **Step 4: Verify zero references + build + commit**

Run: `rg "submittedPrompts|agentResponses|capabilityInvocations" src/ tests/` → zero. Then `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`.
```bash
git add src/tui/state.ts tests/tui/state.vitest.ts tests/tui/views/approvals-view.vitest.ts tests/tui/views/daemon-view.vitest.ts tests/tui/views/dashboard-view.vitest.ts tests/tui/views/policy-view.vitest.ts tests/tui/views/runtime-view.vitest.ts tests/tui/views/sops-view.vitest.ts tests/tui/views/types.vitest.ts
git commit -m "refactor(tui): remove legacy parallel conversation arrays"
```

---

### Task 7: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase3-design.md` (status → implemented)
- Create: `docs/capability-platform-phase3.md` (consumer note)

- [ ] **Step 1: Full build + full capability + TUI suites**

Run: `npm run build` and `npx vitest run tests/capability tests/tui --config vitest.config.mts`
Expected: clean, all pass.

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved Design — Ready for Implementation` → `**Status:** Implemented (Phase 3)` in the Phase-3 spec.

- [ ] **Step 3: Write the consumer doc**

```markdown
# ALiX Capability Platform — Phase 3 (Unified Operator Timeline)

The chat tab now renders a single `timelineEvents[]` stream — user prompts,
agent responses, and capability invocations interleaved by time. A capability
invoked mid-conversation appears in its chronological position (⚡ marker)
instead of after all turns.

One source of truth: ChatView (full timeline), AgentView (user/agent only),
and copy-scrollback all project `timelineEvents`, so they can never diverge.
Every write goes through `appendTimelineEvent()` in src/tui/state.ts, which
stamps id/timestamp/sequence/source; ordering is by timestamp with a
monotonic sequence tiebreak for same-millisecond events.

Tool calls remain on the agent tab as execution telemetry — they are not
timeline events. The platform itself (src/capability/) is unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-3 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ A capability invoked mid-conversation renders interleaved by time in the
  chat timeline, not appended after all turns.
- ✅ ChatView, AgentView, and copy-scrollback read conversation from one
  `timelineEvents[]` source — zero production references to
  `submittedPrompts` / `agentResponses` / `capabilityInvocations`.
- ✅ Capability entries render on the chat tab only; agent tab remains an
  execution workspace (plans/approvals/tools untouched).
- ✅ `appendTimelineEvent` is the only writer path (`rg "timelineEvents\.push"
  src/tui` → `src/tui/state.ts` only); it returns the actual stored object
  (identity test green).
- ✅ Same-millisecond events render deterministically (timestamp, then
  sequence).
- ✅ Existing chat user/agent visuals preserved; vitest green (new + existing),
  `tsc --noEmit` clean.
