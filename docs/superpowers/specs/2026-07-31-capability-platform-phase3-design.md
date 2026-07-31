# ALiX Capability Platform — Phase 3 Design (Unified Operator Timeline)

**Status:** Approved Design — Ready for Implementation
**Date:** 2026-07-31
**Depends on:** Phase 2 (`docs/superpowers/specs/2026-07-31-capability-platform-phase2-design.md`) — merged 2026-07-31 (`0fe4ed71`)

> Replaces the chat transcript's parallel-array conversation state with a single
> `timelineEvents[]` primitive — an actual operator timeline. Fixes the Phase-2
> limitation where capability invocations append *after* all conversation turns
> instead of interleaving by time.

## Goal

Turn the chat view from a transcript renderer into an operator timeline: one
ordered stream of `TimelineEvent`s — user prompts, agent responses, and
capability invocations — interleaved by time, consumed by ChatView, AgentView,
and copy-scrollback from a single source of truth.

The current model holds three parallel arrays per tab:

```ts
submittedPrompts: string[]
agentResponses: string[]
capabilityInvocations: CapabilityInvocationEntry[]
```

with an implicit assumption that "conversation order" is reconstructible from
array positions. That breaks under async capability execution, streaming
responses, future interrupts, background capability events, and retries. Phase 3
eliminates the parallel state entirely.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **Single `timelineEvents[]` per tab** replaces `submittedPrompts` + `agentResponses` + `capabilityInvocations`. One canonical representation consumed by ChatView, AgentView, and copy-scrollback. |
| D2 | **Timeline scope = chat + capabilities only.** Tool calls, plans, approvals, runtime status remain on the agent tab as execution observability, NOT timeline events. Operator narrative (chat) and execution telemetry (agent) stay separate. |
| D3 | **Ordering by `timestamp`, tiebreak `sequence`.** `sequence` is a monotonic per-runtime counter so same-millisecond events render deterministically. |
| D4 | **Event contract is frozen as a compatibility boundary.** `kind` (what happened) and `source` (who produced it) are orthogonal axes. `source` is stamped internally by the append helper — writers never specify it. |
| D5 | **Writers route through a single `appendTimelineEvent(state, event)` helper.** Direct `state.timelineEvents.push(...)` is banned outside `state.ts` (grep-enforced: `rg "timelineEvents\.push" src/tui` → `src/tui/state.ts` only). The helper owns id/timestamp/sequence/source generation and returns the **actual stored object** (never a clone) for the capability presenter to mutate in place. |
| D6 | **Incremental replace.** Add `timelineEvents[]` alongside the legacy arrays → migrate writers → migrate views → migrate copy → delete legacy arrays only after zero production references remain. The TUI suite stays green at every intermediate commit. |
| D7 | **Capability events are the only mutable events.** Pushed as `running`, updated in place by the presenter. `timestamp` stays at invocation time so the event holds its interleaved position while status text updates. |

## Architecture

### Timeline event model (`src/tui/state.ts`)

```ts
export type TimelineSource = 'operator' | 'agent' | 'capability' | 'system';

export interface TimelineEventBase {
  /** Runtime-local deterministic id: `tl-${sequence}`. Unique within one TUI
   *  runtime instance; NOT globally unique across sessions (two runtimes both
   *  produce `tl-1`). If persistence arrives, introduce `timelineId =
   *  sessionId + sequence` without changing the event model. */
  id: string;
  timestamp: number;   // Date.now() at append
  sequence: number;    // monotonic per-runtime counter — ordering tiebreak
  source: TimelineSource;
}

export type TimelineEvent =
  | (TimelineEventBase & { kind: 'user';        text: string })
  | (TimelineEventBase & { kind: 'agent';       text: string })
  | (TimelineEventBase & { kind: 'capability';
      invocationId: string; capabilityId: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      output?: unknown; error?: string });
```

All events serialize through JSON (no Set/Map/function) — satisfies the
`PerTabState` round-trip invariant.

### Timeline helpers (`src/tui/state.ts`)

```ts
let timelineSequence = 0;
export function nextTimelineSequence(): number { return ++timelineSequence; }

/** Writer-facing signature: supply kind + payload; id/timestamp/sequence/source are stamped by the helper. */
export function appendTimelineEvent(state: PerTabState, event: Omit<TimelineEvent, 'id' | 'timestamp' | 'sequence' | 'source'>): TimelineEvent;
```

`appendTimelineEvent`:
1. Stamps `sequence = nextTimelineSequence()`.
2. Stamps `id = 'tl-' + sequence`.
3. Stamps `timestamp = Date.now()`.
4. Stamps `source` from `kind` (`user` → `'operator'`, `agent` → `'agent'`, `capability` → `'capability'`).
5. Pushes onto `state.timelineEvents` and returns the **actual created object** — never a clone (`return event`, never `return {...event}`). The capability presenter holds this exact reference and mutates it in place; a clone would detach the presenter's writes from the stored event.

**Invariant — direct pushes banned outside `state.ts`:** no `state.timelineEvents.push(...)` anywhere except inside `appendTimelineEvent`. Enforced by grep in the tasks:
```bash
rg "timelineEvents\.push" src/tui
```
Expected: `src/tui/state.ts` only.

**Identity test (mandatory):** the state tests assert the helper returns the stored object:
```ts
const event = appendTimelineEvent(state, { kind: 'user', text: 'hi' });
expect(state.timelineEvents[0]).toBe(event);
```

Ordering helper:

```ts
export function getOrderedTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) =>
    a.timestamp - b.timestamp || a.sequence - b.sequence);
}
```

The array is naturally near-sorted (append order ≈ timestamp order), so this is
a cheap, robust read-time sort.

### Renderers

**ChatView** — the Phase-3 payoff. Replaces the three-loop flatten (prompts +
responses + appended invocations) with:

```ts
const events = getOrderedTimeline(ctx.perTab.timelineEvents);
for (const event of events) {
  switch (event.kind) {
    case 'user':       // → marker, plain text
    case 'agent':      // ← marker, rich renderer
    case 'capability': // ⚡ marker, status text
  }
}
```

Preserves current visuals: `→`/`←` markers, rich agent rendering, blank-line
separation between turns, `⚡` for capability.

**AgentView** — filters the timeline to conversation only:

```ts
const events = ctx.perTab.timelineEvents
  .filter(e => e.kind === 'user' || e.kind === 'agent');
```

The agent view is a **projection of the same timeline, not another source** —
never introduce a second `agentTimelineEvents[]` array. Capability entries never
appear on the agent tab. Agent-specific state (plans, approvals, tool
executions, runtime) stays in its existing separate fields.

**Copy-scrollback** — `collectVisibleTranscript` uses a shared
`formatTimelineEvent(event)` utility so ChatView/AgentView/copy never
reconstruct conversation ordering independently. Copy output now includes
capability entries (`⚡ cap.id [completed ✓]`) so a copied transcript matches
what the chat tab shows.

### `CapabilityInvocationEntry` is superseded

The Phase-2 `CapabilityInvocationEntry` interface (`src/tui/state.ts`) is
replaced by the capability `TimelineEvent` variant. Its `at` field becomes the
event's `timestamp`; `invocationId`/`capabilityId`/`status`/`output`/`error`
carry over. The interface is deleted in Task 6 alongside the legacy arrays.

### The presenter (`src/tui/capabilities/invocation-presenter.ts`)

`ChatInvocationPresenter.present()`:
1. `const event = appendTimelineEvent(getChatState(), { kind: 'capability', invocationId, capabilityId, status: 'running' })`.
2. Drives the invocation event stream; `applyEvent` mutates the held `event`
   (status/output/error) — same Phase-2 semantics, relocated.
3. `wait()` fallback merges output/error as today.

## Data Flow

```
[chat submit]  → appendTimelineEvent(chat, {kind:'user',  text})          → timelineEvents
[agent submit] → appendTimelineEvent(agent, {kind:'user',  text})         → timelineEvents
[agent resp]   → appendTimelineEvent(perTab, {kind:'agent', text})        → timelineEvents
[capability]   → appendTimelineEvent(chat, {kind:'capability', ...})      → timelineEvents
                  └─ presenter mutates held event in place (running→terminal)

ChatView       → getOrderedTimeline(chat.timelineEvents)   → ⚡ interleaved
AgentView      → timelineEvents.filter(user|agent)          → conversation only
copy-scrollback→ formatTimelineEvent(chat.timelineEvents)   → ⚡ included
```

## Error Handling

- **Capability presenter** — unchanged semantics: terminal events update the
  entry live; `wait()` fallback merges output/error; `.catch` on `present()`
  logs and swallows (Phase-2 hardening).
- **Empty timeline** — ChatView/AgentView render an empty scrollback (current
  behavior).
- **Malformed/dropped terminal event** — presenter's `wait()` fallback settles
  the status; event never stays `running` forever.

## Testing Strategy

- **State:** `appendTimelineEvent` stamps id/timestamp/sequence/source
  correctly; sequence monotonic; `getOrderedTimeline` sorts by timestamp then
  sequence; `PerTabState` still round-trips JSON; **identity test** —
  `expect(state.timelineEvents[0]).toBe(event)` (the helper returns the actual
  stored object, never a clone).
- **Ordering regression (the Phase-3 goal):** append `user`, then `capability`,
  then `agent`; then a separate scenario with intentionally manipulated
  timestamps whose **stored order differs from display order** (e.g. stored
  `[user, agent, capability]` but display `[user, capability, agent]` after
  `getOrderedTimeline()`). Asserts the actual interleaving, not just that the
  sort is stable.
- **Presenters:** capability event pushed as `running`, updated to
  `completed`/`failed`/`cancelled` with output/error merged (existing tests
  relocated to `timelineEvents`).
- **ChatView:** interleaving — a capability invoked mid-conversation renders
  between the user prompt and a later agent response (the Phase-2 limitation
  now covered by a test). Existing user/agent rendering unchanged.
- **AgentView:** capability entries filtered out.
- **Copy:** `collectVisibleTranscript` matches the chat timeline, capability
  entries included.
- **Fixture migration:** every test that builds a `PerTabState` literal moves
  to `timelineEvents`; the serializability test updated.
- **Verification gate:** `npx tsc -p tsconfig.json --noEmit` + `npx vitest run tests/tui --config vitest.config.mts` green.

## Success Criteria

- ✅ A capability invoked mid-conversation appears interleaved by time in the
  chat timeline, not appended after all turns.
- ✅ ChatView, AgentView, and copy-scrollback read conversation from one
  `timelineEvents[]` source — zero production references to
  `submittedPrompts` / `agentResponses` / `capabilityInvocations`.
- ✅ Capability entries render on the chat tab only; agent tab remains an
  execution workspace (plans/approvals/tools untouched).
- ✅ `appendTimelineEvent` is the only writer path; `sequence` tiebreak makes
  same-millisecond events deterministic.
- ✅ Existing chat user/agent visuals preserved; TUI suite + tsc green.

## Non-Goals (Phase 3)

- **Tool calls in the timeline.** They remain agent-tab execution telemetry
  (a future "debug mode" can add a second execution-trace stream — see Future
  Direction).
- **Streaming agent responses.** Agent responses are appended once complete
  (current behavior); incremental token streaming is a separate concern.
- **Persistence / session resume of the timeline.** `TuiAppState` is
  runtime-only; no disk schema change.
- **Interrupts / retries / background capability events.** The event contract
  accommodates them; the runtime behavior is not built in Phase 3.
- **`source` values beyond the three active kinds.** `'system'` exists in the
  union for future ALiX-native events (governance decisions, policy
  evaluations, daemon observations) but is unused this phase.

## Future Direction

- **Execution trace as a second stream.** A "debug mode" can add
  `ExecutionTrace[]` (tool, policy check, approval, runtime transition) beside
  the operator timeline — preserving the conversation/telemetry split.
- **Richer event kinds.** `kind: 'approval' | 'observation' | 'execution'`
  with orthogonal `source` (policy-engine, governance, scheduler) as those
  surfaces arrive.
- **Timeline persistence / replay** when a session-resume path needs the
  operator narrative.
