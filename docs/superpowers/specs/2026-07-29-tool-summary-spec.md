# Tool Summary Field — Design Spec

**Status:** Draft  
**Date:** 2026-07-29  
**Prerequisite:** None (standalone change)

---

## 1. Problem

The operator sees tool calls in the TUI agent-view as bare names:

```
→ file.read
→ shell.run
```

There is no context on *why* the tool was called. This makes it hard to follow the agent's intent at a glance, especially during multi-tool batches or long-running tasks.

## 2. Solution

Add an optional `summary: string` field to every tool call. The model includes a 2–5 word explanation when it calls a tool. The runtime records it as metadata and renders it in the TUI scrollback and event log.

The runtime functions identically whether or not `summary` is provided. It is purely operator context, never evidence.

## 3. Type Changes

### 3.1 ToolCallRequest (`src/tools/types.ts`)

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;       // NEW — 2–5 word operator-facing summary
  agentId?: string;
  sessionId?: string;
};
```

### 3.2 Provider-level ToolCall (where applicable)

Each provider's tool-call type gains the same optional `summary` field so the provider schema advertises it to the model. The summary is a top-level field, not part of `args`.

**OpenAI-compatible (`_openai-base.ts`):** no schema change needed — `toolCall.function.arguments` is a JSON string; the summary comes alongside the tool call ID at the provider-return level. The summary is appended as a separate property on the parsed tool-call object.

**Deepseek (same code path):** identical.

### 3.3 Event-log entry

The `agent.decision` event payload gains a `summary` field:

```typescript
payload: {
  kind: "tool_selection",
  iteration: number,
  description: string,
  summary?: string,       // NEW
  outcome: "executed",
}
```

## 4. System Prompt Change

Add an instruction to `SYSTEM_PROMPT_BASE` under the tool-use section:

```
When calling a tool, include a 2–5 word summary explaining why you are 
calling it. For example: "Locating config file" or "Running typecheck". 
This summary helps the operator follow your progress at a glance.
```

## 5. TUI Rendering

### Agent-view scrollback (`src/tui/views/agent-view.ts`)

Each tool entry renders as two lines when a summary is present:

```
→  grep_search
   Searching for auth middleware
```

- Line 1: tool marker (`→`) + tool name — unchanged
- Line 2: 2-space indent + summary text — dim style (`\x1b[2m`)
- If summary is absent, line 2 is omitted (single-line as today)

### Runtime event log

The `agent.decision` event payload includes `summary`. Existing event rendering (trace-detail views) will display it when present. No new event type is needed.

## 6. Implementation Order

1. Add `summary?: string` to `ToolCallRequest` and provider `ToolCall` types
2. Add the system-prompt instruction
3. Thread `summary` through `handleToolCall` in `task-loop.ts` (it already receives `ToolCallRequest`, just needs to forward `summary`)
4. Record summary in the `agent.decision` log event
5. Update `agent-view.ts` to render the second line
6. Update `trace-detail.ts` (or equivalent) to show summary in event detail
7. Verify: null summary = no behavioral change; present summary = renders in TUI + log

## 7. Non-goals

- Summary is NOT used for routing, filtering, or governance decisions
- Summary is NOT required — absent is identical to today's behavior
- Summary is NOT evidence — it lives on ToolCallRequest metadata, not in outcome records
- No new event types or log schema migrations
