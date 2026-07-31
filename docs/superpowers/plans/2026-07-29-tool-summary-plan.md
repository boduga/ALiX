# Tool Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional 2-5 word `summary` string to tool calls for operator context in TUI and event logs.

**Architecture:** Add `summary` as an optional parameter on every tool's JSON schema (provider layer). The model includes it in `function.arguments`. The dispatcher extracts it, lifts it to `ToolCallRequest.summary`, and strips it from `args`. The agent-view renders it as an indented second line. The event log captures it.

**Tech Stack:** TypeScript, TUI (TerminalCanvas), EventLog, OpenAI-compatible provider schema

## Global Constraints

- `summary` is optional everywhere — absent = identical to today's behavior
- Summary is NOT evidence — never written to outcome records or governance stores
- No new event types or log schema migrations
- Prompt instruction must use exact wording from spec

---
## File Structure

| File | Role | Change |
|---|---|---|
| `src/providers/specs/_openai-base.ts` | Provider tool-schema builder | Add `summary?: string` to every tool's JSON parameters |
| `src/providers/base.ts` | Provider response parser | Extract `summary` from parsed args, lift to `ToolCallRequest` |
| `src/providers/types.ts` | ToolDef / ToolCall types | Add `summary?: string` to `ToolCall` |
| `src/tools/types.ts` | `ToolCallRequest` | Add `summary?: string` |
| `src/run/task-loop.ts` | Tool dispatch + log emission | Thread summary through, include in `agent.decision` payload |
| `src/tui/views/agent-view.ts` | TUI scrollback | Render summary as indented second dim line |
| `src/agent/system-prompt.ts` | Base prompt | Add "include a 2-5 word summary" instruction |
| `src/tui/trace-detail.ts` | Event detail view | Show summary when present |

---

### Task 1: Add summary to provider tool schemas

**Files:**
- Modify: `src/providers/specs/_openai-base.ts`
- Modify: `src/providers/types.ts`

**Interfaces:**
- Consumes: `ToolDef` (existing type)
- Produces: `ToolDef` with optional `summary` parameter

The OpenAI-compatible tool schema builder assembles JSON Schema objects for each tool. Add an optional `summary` parameter to every tool definition sent to the model.

- [ ] **Step 1: Add summary to ToolCall type**

In `src/providers/types.ts`, add `summary?: string` to the `ToolCall` type:

```typescript
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;  // NEW — 2-5 word model-provided explanation
};
```

- [ ] **Step 2: Add summary to every tool's JSON schema**

In `src/providers/specs/_openai-base.ts`, after the tool parameters object is built, add an optional `summary` parameter:

```typescript
// Add optional summary parameter for operator-facing context
tool.function.parameters.properties = {
  ...tool.function.parameters.properties,
  summary: {
    type: "string",
    description: "2-5 word explanation of why this tool is being called. " +
      "Helps the operator follow progress at a glance. " +
      "Example: 'Locating config file' or 'Running typecheck'",
  },
};
```

- [ ] **Step 3: Build and verify no type errors**

```bash
npm run build
```

Expected: clean build. The `summary` field is emitted to the model in every tool's JSON schema.

---

### Task 2: Extract summary from model response

**Files:**
- Modify: `src/providers/base.ts`

**Interfaces:**
- Consumes: Parsed tool call args (from `JSON.parse(tc.function.arguments)`)
- Produces: `ToolCall` with `summary` extracted from args

When the provider parses the model's tool call response, the `summary` arrives inside `function.arguments` as a JSON field. Extract it from args and place it at the `ToolCall.summary` level, removing it from `args` so downstream code never sees it as a tool argument.

- [ ] **Step 1: Extract summary in the parse path**

In `src/providers/base.ts`, in the `parseModelJson` code path or the tool-call construction path:

```typescript
// After parsing tool call arguments
const args = parsedArgs as Record<string, unknown>;
const summary = typeof args.summary === "string" ? args.summary : undefined;
if (summary !== undefined) {
  delete args.summary;
}
const toolCall: ToolCall = {
  id: tc.id,
  name: actualName,
  args,
  summary,  // lifted out of args
};
```

Also update `_openai-base.ts` if it has its own parsing (the non-streaming path):

```typescript
// _openai-base.ts around line 46
const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
const summary = typeof args.summary === "string" ? args.summary : undefined;
if (summary !== undefined) {
  delete args.summary;
}
```

And the streaming path (around line 71 or `unified-complete.ts` line 131).

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: clean build. Summary is lifted from args to the ToolCall level for all provider paths.

---

### Task 3: Add summary to ToolCallRequest and thread through dispatch

**Files:**
- Modify: `src/tools/types.ts`

- [ ] **Step 1: Add summary to ToolCallRequest**

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;  // NEW
  agentId?: string;
  sessionId?: string;
};
```

- [ ] **Step 2: Thread summary in task-loop.ts**

In `src/run/task-loop.ts`, find where `toolCalls` from the provider are converted to `ToolCallRequest`. The loop currently uses `toolCall.name` and `toolCall.args` directly. Add `summary`:

```typescript
// Inside the for (const toolCall of toolCalls) loop, when constructing
// the ToolCallRequest for handleToolCall:
const toolCallRequest: ToolCallRequest = {
  toolCallId: toolCall.id,
  name: toolCall.name,
  args: toolCall.args,
  summary: toolCall.summary,  // pass through
};
```

If `handleToolCall` already receives the raw `toolCall`, it may need a signature update. Check the call site.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: clean build. Summary threads through to the executor.

---

### Task 4: Record summary in event log

**Files:**
- Modify: `src/run/task-loop.ts`

Every `agent.decision` event with `kind: "tool_selection"` currently logs `iteration`, `description`, and `outcome`. Add `summary` from the tool call when present.

- [ ] **Step 1: Add summary to tool_selection decision events**

Find the `agent.decision` emission at line 333 (initial decision before execution) and the ones inside the tool loop. For the tool-loop emission (after line 530), pass the summary:

```typescript
await log.append({
  ...session, actor: "agent", type: "agent.decision",
  payload: {
    kind: "tool_selection",
    iteration: i,
    description: `Called ${toolCalls.map(t => t.name).join(", ")}`,
    summary: toolCall.summary,  // NEW
    outcome: "executed",
  },
});
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: clean build.

---

### Task 5: Render summary in agent-view

**Files:**
- Modify: `src/tui/views/agent-view.ts`

**Interfaces:**
- Consumes: `ScrollbackLine` with tool entries
- Produces: Two-line rendering when summary present

- [ ] **Step 1: Extend ScrollbackLine for tool entries with summary**

The agent-view currently builds `turns` from submitted prompts and responses. Tool entries go through a different path. Find where tool calls are rendered (likely not in agent-view.ts — they become part of the response text). If tool calls are not individually rendered, add a tool-call section.

Check `agent-view.ts` to see how tool calls appear in the scrollback. They may be embedded in the agent response text (the model writes "I'm searching for X" then calls a tool). In that case, rendering happens through `renderResponse`. The summary would appear in the text naturally.

However, if we want a separate "tool log" in the scrollback, the view needs to render it differently. Since the spec says "tool marker + name on line 1, summary on line 2", add a new `ScrollbackLine.kind` value:

```typescript
interface ScrollbackLine {
  kind: 'user' | 'agent' | 'plan' | 'approval' | 'tool';  // add 'tool'
  text: string;
  isFirst: boolean;
  summary?: string;
}
```

Push tool entries from the `pendingToolCalls` or equivalent state after the turns. Render them:

```typescript
} else if (l.kind === 'tool') {
  // Tool name line
  c.write(0, rowY, `\x1b[90m→\x1b[0m \x1b[2m${l.text}\x1b[0m`);
  // Summary line — only if present
  if (l.summary) {
    rowY++;
    c.write(2, rowY, `\x1b[2m${l.summary}\x1b[0m`);
  }
}
```

- [ ] **Step 2: Verify rendering**

```bash
npm run build
npx vitest run tests/tui/app.vitest.ts
```

Expected: all tests pass.

---

### Task 6: Update system prompt

**Files:**
- Modify: `src/agent/system-prompt.ts`

- [ ] **Step 1: Add summary instruction to SYSTEM_PROMPT_BASE**

Add under the `## Tool Use` section:

```
When calling a tool, include a 2–5 word summary explaining why you are 
calling it. For example: "Locating config file" or "Running typecheck". 
This summary helps the operator follow your progress at a glance.
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 7: Update trace-detail view

**Files:**
- Modify: `src/tui/trace-detail.ts`

- [ ] **Step 1: Show summary in event detail**

Find where `agent.decision` events are rendered and add the summary line:

```typescript
if (event.summary) {
  lines.push(`  Summary: ${event.summary}`);
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: clean build.

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Verify null summary = no behavioral change**

Run the test suite. All existing tests should pass — the summary field is optional and never required.

```bash
npx vitest run --reporter=verbose
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(tool-summary): add optional summary field to tool calls

Adds a 2-5 word summary parameter to every tool's JSON schema so the
model can explain why it's calling each tool. The summary is extracted
from args at the provider layer, threaded through ToolCallRequest,
recorded in the event log, and rendered in the TUI agent-view as an
indented second line.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
