# Agent Observability Implementation Plans

**Status:** ✅ Completed (M0.7) — Plan implemented and committed to main.

**6 features to match Claude Code Inspector / LangSmith level.**

## Current State

| Feature | Status |
|---------|--------|
| Event log (JSONL) | ✅ Captures tool calls, model usage, patch events |
| SSE stream | ✅ Streams tool events (filtered to `tool.*` only) |
| Web UI | ✅ Basic session replay, diff viewer |
| Agent reasoning | ❌ Not captured |
| Tool call args/results | ❌ Side-by-side not available in UI |
| Decision timeline | ❌ No "why did agent choose X" trail |
| Cost per step | ❌ Token counts exist in usage events but not formatted as cost |
| Real-time agent state | ❌ SSE only sends `tool.*` events — not `agent.*`, `context.*`, `state.*` |
| Subagent visibility | ❌ Filtered out of SSE stream |

---

## Plan 1: Agent Reasoning Trail

**Event types needed:**
- `agent.reasoning` — emitted when the model selects a tool or makes a decision

**Where to emit:** In `src/run/task-loop.ts` after each model response.

**Files:**
- Modify: `src/events/types.ts` — add `REASONING` constant to event type
- Modify: `src/run/task-loop.ts` — emit `agent.reasoning` after each model call with the model's reasoning text
- Modify: `src/server/server.ts` — add `agent.reasoning` to SSE filter
- Modify: `src/ui/app.js` — display reasoning in the event timeline
- Modify: `src/inspector/session-reader.ts` — include reasoning in session snapshot

**Payload:**
```typescript
{
  text: string;        // The model's raw reasoning output
  toolCall?: string;   // If this reasoning led to a tool call
  iteration: number;   // Loop iteration number
}
```

**Test:** Verify reasoning appears in the event log after a model response.

---

## Plan 2: Tool Call Visualization (Args/Results Side-by-Side)

**What the web UI shows now:**
```
[Tool requested: file.read]
[Tool output: "bla…"]
[Tool completed: file.read]
```

**What it should show:**
```
┌─ file.read ──────────────────────────────┐
│ Args:  { "path": "src/foo.ts" }          │
│ Result: "export function foo() {...}"     │
│ Duration: 12ms                           │
└──────────────────────────────────────────┘
```

**Files:**
- Modify: `src/ui/app.js` — render tool calls as collapsible cards with args/results/duration
- Modify: `src/ui/styles.css` — card styling with border, labels, monospace code blocks
- Modify: `src/events/types.ts` — ensure `tool.completed` payload includes `argsPreview` and `outputPreview` for display
- Modify: `src/inspector/session-reader.ts` — pair `tool.requested` + `tool.output` + `tool.completed` events into a single structured tool call object

**UI component (in `src/ui/app.js`):**

```javascript
function renderToolCall(requested, output, completed) {
  const args = JSON.stringify(requested.argsPreview, null, 2);
  const result = output?.outputPreview ?? completed?.status ?? "";
  const duration = completed?.durationMs ?? 0;
  return `<div class="tool-card">
    <div class="tool-header">${requested.toolName}</div>
    <div class="tool-args"><pre>${escapeHtml(args)}</pre></div>
    <div class="tool-result"><pre>${escapeHtml(result)}</pre></div>
    <div class="tool-meta">${duration}ms</div>
  </div>`;
}
```

**Test:** Open the inspector, run any task, verify tool calls render as cards.

---

## Plan 3: Decision Timeline

**What gets captured:**
- When the agent selects one tool over another, or changes strategy
- When scope is expanded or denied
- When verification triggers a repair loop

**New event type:** `agent.decision`

**Payload:**
```typescript
{
  kind: "tool_selection" | "scope_expansion" | "repair" | "strategy_change" | "completion";
  description: string;       // Human-readable: "Chose shell.run over file.read because..."
  iteration: number;
  alternatives?: string[];   // Other options considered
  outcome: "accepted" | "rejected" | "executed";
}
```

**Files:**
- Modify: `src/events/types.ts` — add `DECISION` event type
- Modify: `src/run/task-loop.ts` — emit `agent.decision` at key branch points (tool selection, scope check, repair entry)
- Modify: `src/ui/app.js` — render decisions as a vertical timeline with icons
- Modify: `src/ui/styles.css` — timeline styling
- Modify: `src/server/server.ts` — add `agent.decision` to SSE filter

**Key branch points to instrument:**
1. Line ~260 — after model responds, before tool execution: what tool was chosen?
2. Line ~430 — scope denial: decision to reject
3. Line ~510 — repair loop entry: decision to retry
4. Line 559 — max iterations: forced completion

**Test:** Run a task that triggers scope denial or repair loop, verify decisions appear in timeline.

---

## Plan 4: Cost Tracking Per Step

**Current state:** Token counts (`inputTokens`, `outputTokens`) are captured in `model.usage` events but not formatted as cost.

**New feature:** Compute and display running cost per model call + cumulative session cost.

**Cost computation (pure function):**
```typescript
// src/events/cost-calculator.ts
const PROVIDER_RATES: Record<string, { inputPerM: number; outputPerM: number }> = {
  "google":  { inputPerM: 0.15,  outputPerM: 0.60  },
  "deepseek": { inputPerM: 0.014, outputPerM: 0.028 },
  "openai":  { inputPerM: 2.50,  outputPerM: 10.00 },
  "anthropic": { inputPerM: 3.00, outputPerM: 15.00 },
  // (rates from provider pricing pages)
};

export function computeCost(provider: string, usage: { inputTokens: number; outputTokens: number }): {
  inputCost: number;
  outputCost: number;
  totalCost: number;
} {
  const rate = PROVIDER_RATES[provider] ?? { inputPerM: 0, outputPerM: 0 };
  return {
    inputCost: (usage.inputTokens / 1_000_000) * rate.inputPerM,
    outputCost: (usage.outputTokens / 1_000_000) * rate.outputPerM,
    totalCost: ((usage.inputTokens / 1_000_000) * rate.inputPerM) +
               ((usage.outputTokens / 1_000_000) * rate.outputPerM),
  };
}
```

**Files:**
- Create: `src/events/cost-calculator.ts` (~40 lines)
- Modify: `src/inspector/session-reader.ts` — include per-tool-call cost in snapshot
- Modify: `src/events/types.ts` — add `cost` field to `model.usage` event payload (optional)
- Modify: `src/ui/app.js` — display cost per tool call + cumulative in sidebar
- Modify: `src/events/event-log.ts` — annotate usage events with cost on write (optional; can compute on read)

**Test:** Run a task with DeepSeek, verify cost shows as `$0.0014` per call.

---

## Plan 5: Real-Time Agent State in SSE

**Current SSE stream only sends `tool.*` events:**
```typescript
const TOOL_EVENT_FILTER = [
  "tool.requested",
  "tool.started",
  "tool.output",
  "tool.completed",
  "tool.failed",
];
```

**What's missing:** `agent.*`, `context.*`, `session.*`, `subagent.*`, `file.*`, `patch.*` events.

**Fix:** Expand the filter or make it configurable:

```typescript
const VISIBLE_EVENTS = [
  // Tools
  "tool.requested", "tool.started", "tool.output", "tool.completed", "tool.failed",
  // Agent state
  "agent.message", "agent.reasoning", "agent.decision",
  // Context
  "context.repo_map_created", "context.bundle_compiled",
  // Sessions
  "session.started", "session.ended",
  // Subagents
  "subagent.started", "subagent.result",
  // Files
  "file.created",
  // Patches
  "patch.applied", "patch.rolled_back",
];
```

**Files:**
- Modify: `src/server/server.ts` — replace `TOOL_EVENT_FILTER` with expanded `VISIBLE_EVENTS`
- Modify: `src/ui/app.js` — handle new event types in the renderer

**Test:** Watch SSE stream during `alix run`, verify agent state changes and non-tool events appear.

---

## Plan 6: Subagent Activity in SSE Stream

**Current state:** Subagent events are captured in JSONL but filtered out of the SSE stream (not in `TOOL_EVENT_FILTER`).

**New events to expose:**
```typescript
"subagent.started": { role: string; taskId: string; prompt: string; sessionId: string }
"subagent.result":  { role: string; taskId: string; status: string; findings: string[]; sessionId: string }
```

**Files:**
- Modify: `src/events/types.ts` — add `SUBAGENT_STARTED`, `SUBAGENT_RESULT` to event types
- Modify: `src/agents/subagent-manager.ts` — emit `subagent.started` when spawning and `subagent.result` on completion
- Modify: `src/server/server.ts` — add both to SSE filter
- Modify: `src/ui/app.js` — render subagent events as nested cards within the parent agent's timeline

**UI rendering (in `src/ui/app.js`):**
```javascript
function renderSubagentEvent(event) {
  const { role, taskId, status } = event.payload;
  return `<div class="subagent-card ${status}">
    <span class="subagent-role">${role}</span>
    <span class="subagent-status">${status}</span>
    <code>${taskId.slice(0, 8)}</code>
  </div>`;
}
```

**Test:** Delegate a task to a subagent via `alix-delegate`, verify the subagent start/result appear in SSE stream and web UI.

---

## Implementation Order

| Priority | Plan | Effort | Value |
|----------|------|--------|-------|
| 1 | **Plan 5: Real-time agent state** | ~30 min | High — unlocks all other SSE-dependent features |
| 2 | **Plan 6: Subagent activity** | ~20 min | High — subagents invisible without this |
| 3 | **Plan 1: Agent reasoning** | ~30 min | High — main observability gap |
| 4 | **Plan 2: Tool call visualization** | ~1 hr | High — makes the inspector useful |
| 5 | **Plan 4: Cost tracking** | ~30 min | Medium — nice to have |
| 6 | **Plan 3: Decision timeline** | ~1 hr | Medium — informative but lower frequency |

---

## Self-Review

- [x] Plan 1: Agent reasoning trail — event type, emission points, payload, SSE filter
- [x] Plan 2: Tool call visualization — UI component, session pairing, styles
- [x] Plan 3: Decision timeline — event type, branch points, payload
- [x] Plan 4: Cost tracking — calculator module, per-step cost, cumulative display
- [x] Plan 5: Real-time agent state — expanded SSE filter, all event types
- [x] Plan 6: Subagent activity — start/result events, emitter, SSE, UI
- [x] Priority order: depends-on-first (Plan 5 enables 1,2,3,6)
- [x] No TBD or placeholder code
