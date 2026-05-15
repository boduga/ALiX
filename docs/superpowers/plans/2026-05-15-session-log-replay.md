# Session Log Replay + Consolidated State Messages Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Fix two weaknesses in the current truncation strategy:
1. **Consolidated `[State]` messages** — instead of injecting a new `[State]` every iteration (which accumulates), synthesize a single rolling summary that replaces all prior `[State]` messages at each truncation event
2. **Session log replay** — before truncating, pull a "session digest" from the JSONL session log to re-anchor tool effects that would otherwise be lost

**Problem being solved:**
- Current: each tool round injects a new `[State]` message. Multiple `[State]` messages accumulate and compete with real conversation for context budget.
- Current: truncation drops oldest messages, including `[State]` messages. If a file was created 5 iterations ago, its `[State]` entry could be gone before the model needs to know about it.
- The session log (`.alix/sessions/<uuid>/events.jsonl`) has every tool call recorded. It's a persistent store that survives truncation.

---

### Task 1: Consolidate [State] messages into rolling summary

**Files:**
- Modify: `src/run.ts` — track `[State]` messages differently, synthesize on truncation
- Modify: `src/run.ts` — replace multiple `[State]` messages with one rolling summary

**Current behavior:**
```typescript
// Every iteration, pushes a new [State] message
messages.push({ role: "user", content: `[State] Created: foo.ts, Deleted: bar.js.` });
```

Over 10 iterations: 10 `[State]` messages = ~500-1000 tokens of noise that all compete with real conversation.

**New behavior:**
Track state deltas in a `sessionState` variable. When truncating, synthesize one `[State]` that covers all accumulated changes:

```typescript
// Track all changes across the session
const sessionState = {
  created: new Set<string>(),
  deleted: new Set<string>(),
  changed: new Set<string>(),
  fatalErrors: new string[],
};

// After each tool round:
for (const tc of toolCalls) {
  if (tc.name === "file.create") sessionState.created.add(tc.args.path);
  if (tc.name === "file.delete") sessionState.deleted.add(tc.args.path);
  if (tc.name === "file.write" || tc.name === "file.edit") sessionState.changed.add(tc.args.path);
}
if (fatalToolErrors.length) sessionState.fatalErrors.push(...fatalToolErrors);
```

On truncation, replace all prior `[State]` messages with one:

```typescript
function buildStateSummary(state: typeof sessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[State] ${parts.join(". ")}.` : "";
}
```

In the truncation block:
```typescript
// Remove all prior [State] messages
messages = messages.filter(m => !m.content.toString().startsWith("[State]"));
// Inject one consolidated summary
const summary = buildStateSummary(sessionState);
if (summary) messages.push({ role: "user", content: summary });
```

This way:
- `[State]` is always the single most recent message after truncation
- It covers all changes across the entire session, not just the last iteration
- The model knows the full picture of file changes without re-reading the log

**Implementation steps:**

1. Read `src/run.ts` to find the current `[State]` injection (around line 339-354)
2. Replace the per-iteration `push` with `sessionState` tracking
3. Replace the truncation block to remove all `[State]` messages and inject one consolidated summary

---

### Task 2: Session log replay (last resort re-anchor)

**Files:**
- Modify: `src/run.ts` — add `replaySessionDigest()` function
- Modify: `src/run.ts` — call digest before final truncation
- Create: `src/utils/session-digest.ts` — reads events.jsonl, synthesizes digest

**The problem:** If truncation fires before `[State]` has been injected for this iteration, the tool effects from this round are lost. Session log replay is the backstop.

**Architecture:**
```typescript
// src/utils/session-digest.ts
export async function buildSessionDigest(sessionDir: string): Promise<string | null> {
  // Read events.jsonl
  // Extract all tool.started, tool.completed, tool.failed events
  // Synthesize a digest: "Files created: foo.ts, bar.ts. Changed: src/app.js. Errors: ..."
  // Return null if no events found
}
```

**In run.ts**, before truncating:
```typescript
const sessionDir = log.filePath.replace("/events.jsonl", "");
const digest = await buildSessionDigest(sessionDir);

// If we don't have a [State] for this round yet, try the log
if (!digest) {
  const freshDigest = await buildSessionDigest(sessionDir);
  if (freshDigest) {
    messages = messages.filter(m => !m.content.toString().startsWith("[State]"));
    messages.push({ role: "user", content: freshDigest });
  }
}
```

Actually, simpler: always build digest from log as the primary source. The `[State]` tracking becomes the "fast path" for the current iteration, and the log replay is the "authoritative" source for the full picture:

```typescript
// On truncation:
const digest = await buildSessionDigest(sessionDir);
messages = messages.filter(m => !m.content.toString().startsWith("[State]"));
if (digest) messages.push({ role: "user", content: digest });
```

The `sessionState` tracking becomes unnecessary — the log is the source of truth.

**Implementation steps:**

1. Create `src/utils/session-digest.ts` with `buildSessionDigest(sessionDir: string): Promise<string | null>`
2. Read the session log (JSONL), parse events
3. For each tool event, extract: `toolName`, `args.path` (or equivalent), `status` (completed/failed)
4. Synthesize a one-paragraph digest
5. Update `src/run.ts` truncation block to call `buildSessionDigest()` instead of `buildStateSummary()`
6. Remove `sessionState` tracking (simplifies the code)

**Digest format:**
```
[Session Digest] Files created: src/auth/middleware.ts, src/auth/tokens.ts.
Files deleted: src/legacy/auth.js.
Files changed: package.json, tsconfig.json.
Errors encountered: file.edit on src/cli.ts (timeout, retry successful).
```

Keep it under 500 tokens. If the log is empty, return null.

---

### Notes

- **JSONL parsing:** Session events are already written to `.alix/sessions/<uuid>/events.jsonl`. Each line is a JSON object. Parse with line-by-line reading (don't `JSON.parse` the whole file — it could be large).
- **Graceful degradation:** If `buildSessionDigest()` throws or returns null, fall back to no digest. Never block truncation.
- **Encoding awareness:** The digest should be counted against the token budget too. Keep it under 500 tokens (~2000 chars).
- **Event types to include:** `tool.started`, `tool.completed`, `tool.failed`, `hook.pre_task`, `hook.post_task`, `context.truncated`. Skip `agent.*` and `user.*` events.
- **Test:** Add a test that reads a sample events.jsonl and verifies the digest includes expected file names.