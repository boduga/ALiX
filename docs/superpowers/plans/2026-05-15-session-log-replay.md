# Session Log Replay + Consolidated State Messages

> **Status: COMPLETED** — All tasks implemented in the MCP Tool Deferral branch (2026-05-15).

**Goal:** Fix two weaknesses in the truncation strategy:
1. **Consolidated `[State]` messages** — synthesize a single rolling summary instead of injecting one per iteration
2. **Session log replay** — pull a "session digest" from the JSONL session log to re-anchor tool effects that would otherwise be lost

Both features were implemented as part of the MCP Tool Deferral work, which touched `run.ts` and created `src/utils/session-digest.ts`.

---

## Task 1: Consolidate [State] messages into rolling summary

**Files:**
- Modify: `src/run.ts` — `SessionState` type + `buildStateSummary()` + tracking in tool call loop + removal on truncation

- [x] **Step 1: Track session state in run.ts**

Implemented `SessionState` type with `created`, `deleted`, `changed`, `fatalErrors` fields. Populated from tool call results each iteration:

```typescript
// src/run.ts:230-235
const sessionState = {
  created: new Set<string>(),
  deleted: new Set<string>(),
  changed: new Set<string>(),
  fatalErrors: [] as string[],
};
```

Populated on each tool round (lines 383-393):
```typescript
if (execName === "file.create") sessionState.created.add(toolCall.args.path as string);
if (execName === "file.delete") sessionState.deleted.add(toolCall.args.path as string);
if (execName === "file.write" || execName === "file.patch_apply") sessionState.changed.add(toolCall.args.path as string);
sessionState.fatalErrors.push(...fatalToolErrors);
```

- [x] **Step 2: Synthesize rolling summary on truncation**

Implemented `buildStateSummary()` (line 79) and called it in the truncation block (line 276). All prior `[Session Digest]` messages are removed and replaced with one consolidated summary:

```typescript
function buildStateSummary(state: SessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[Session Digest] ${parts.join(". ")}.` : "";
}
```

---

## Task 2: Session log replay (last resort re-anchor)

**Files:**
- Create: `src/utils/session-digest.ts` — reads events.jsonl, synthesizes digest
- Modify: `src/run.ts` — call `buildSessionDigest()` before final truncation

- [x] **Step 1: Create session-digest.ts**

Created `src/utils/session-digest.ts` with `buildSessionDigest(sessionDir: string): Promise<string | null>`. Reads events.jsonl, extracts `tool.started`, `tool.completed`, `tool.failed`, `hook.pre_task`, `hook.post_task`, `context.truncated` events, and synthesizes a one-paragraph digest.

- [x] **Step 2: Wire into run.ts truncation block**

At truncation time (line 270-278), `buildSessionDigest()` is called as the primary source of truth. If it returns null, falls back to `buildStateSummary()`:

```typescript
const logDir = log.path.replace(/\/events\.jsonl$/, "");
const digest = await buildSessionDigest(logDir);
if (digest) {
  messages.push({ role: "user", content: digest });
} else {
  const summary = buildStateSummary(sessionState);
  if (summary) messages.push({ role: "user", content: summary });
}
```

---

## Self-Review

- [x] **Spec coverage:** Both tasks fully implemented
- [x] **No placeholders:** All code is complete and committed
- [x] **Digest format:** Uses `[Session Digest]` prefix, covers created/changed/deleted/fatal errors
- [x] **Graceful degradation:** `buildSessionDigest()` returns null on empty/parseable log; `buildStateSummary()` is the fallback