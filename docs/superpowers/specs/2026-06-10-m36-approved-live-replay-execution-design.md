# M0.36 — Approved-Live Replay Execution Design

**Status:** ✅ Completed (M0.36) — Design implemented and committed to main.

> **One-liner:** M0.36 enables real replay execution only through fresh PolicyGate checks, explicit approvals, and fully linked replay audit events.

> **Safety contract:** Approved-live replay must not mean "trust the old trace." Every step goes through current PolicyGate. Side-effecting steps require fresh approval. Replay audit events link every decision back to its `replayId`.

---

## 1. Safety Contract (read this first)

Approved-live replay is the most powerful replay mode — and the most dangerous. These rules are **not negotiable**:

1. **Every tool step re-checks PolicyGate.** The old trace's policy decision is irrelevant. Current policy applies.
2. **Side-effecting steps require fresh approval.** File writes, shell commands, network tools, and patch applications each create a pending approval in the ApprovalStore. No approval = no execution.
3. **Read-only steps execute after PolicyGate "allow".** `file.read`, `file.exists`, `dir.search` run directly if PolicyGate allows. No approval needed.
4. **Replay stops on first denied or failed critical step.** If approval is denied or a tool fails, the remaining steps are skipped.
5. **Every event links to a unique `replayId`.** Every event emitted during a replay session carries `replayId` in its payload. You can trace the full chain from `replay.plan.created` through `policy.decision`, `approval.created`, `approval.resolved`, `tool.started`, `tool.completed`, `replay.step.completed`.
6. **Replay-originated tool calls are marked.** Tool executor events emitted during approved-live replay include `replayId` so they can be distinguished from original execution.
7. **No silent mutations.** Every file write, shell command, patch apply, or network call is preceded by an explicit approval step visible in the trace.

---

## 2. Goals

1. **Approved-live replay mode** — `ReplayMode = "dry-run" | "sandbox" | "approved-live"`
2. **ReplayExecutionContext** — unique `replayId`, source session, mode, cwd, timestamp
3. **Fresh PolicyGate check per step** — current policy, not cached from trace
4. **Fresh approval for side-effecting steps** — file writes, shell (non-safe), network, patch require approval
5. **Read-only steps pass through after PolicyGate** — file reads, exists, dir.search, safe shell
6. **ReplayId linkage** — every replay event carries `replayId`, tool events from replay carry `replayId`
7. **Replay stop on first critical failure** — denied approval or failed tool blocks remaining steps
8. **Events** — `replay.*` events with `replayId` payload, linked `tool.*` events with `replayId`
9. **TUI** — `/replay selected --approved-live` command, confirmation with explicit warning
10. **Tests** — approved live replay approval flow, denied replay step blocks, file write only after approval

---

## 3. Non-goals

- **Scheduled replay** — deferred
- **Batch replay across sessions** — deferred
- **Remote approval users** — deferred
- **Replay diff/rollback engine** — deferred
- **Autonomous replay repair** — deferred

---

## 4. ReplayExecutionContext

Every approved-live replay session has an identity that propagates through all events:

```typescript
export type ReplayExecutionContext = {
  replayId: string;
  sourceSessionId: string;
  selectedTraceId: string;
  mode: "approved-live";
  cwd: string;
  startedAt: string;
};
```

The `replayId` is generated at plan-building time (before execution starts) using the same pattern as approval IDs:

```typescript
const replayId = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
```

This `replayId` is:
- Added to every `replay.*` event payload
- Added to every `tool.*` event emitted during replay execution
- Returned as part of `ReplayResult`
- Visible in the Trace timeline so users can filter by it

---

## 5. ReplayMode extension

```typescript
// Current: src/runtime/replay-plan.ts
export type ReplayMode = "dry-run" | "sandbox" | "approved-live";
```

The mode matrix extends to:

| Replay mode | PolicyGate | State mutation | Network | Shell execution | Requires approval |
|---|---|---|---|---|---|
| dry-run | re-checked | simulated only | blocked | simulated only | no |
| sandbox | re-checked | temp-isolated | blocked | real execution | no |
| **approved-live** | **re-checked** | **real** | **requires approval** | **requires approval** | **yes, for side effects** |

---

## 6. Side-effect classification

To determine whether a tool step needs approval:

```typescript
export type SideEffectLevel = "read-only" | "side-effect" | "network";

export function classifySideEffect(toolName: string): SideEffectLevel {
  if (["file.read", "file.exists", "dir.search"].includes(toolName)) return "read-only";
  if (toolName.startsWith("mcp.")) return "network";
  if (["web_search", "web_fetch", "delegate"].includes(toolName)) return "network";
  return "side-effect"; // shell.run, file.create, file.delete, patch.apply
}
```

---

## 7. Approved-live execution flow

```
User: "x" or /replay selected --approved-live
  │
  ▼
buildReplayPlan(preview, events, "approved-live")
  │
  ├── replayId = generateId()
  ├── emit replay.plan.created { replayId, mode, ... }
  │
  ▼
ReplayExecutor.execute(plan, { approvalStore, eventLog, config })
  │
  ├── emit replay.started { replayId, mode }
  │
  ▼
For each step:
  │
  ├── 1. classifySideEffect(toolName)
  │     ├── read-only → go to step 3
  │     └── side-effect/network → go to step 2
  │
  ├── 2. PolicyGate check
  │     ├── deny → emit replay.step.blocked { replayId }, stop
  │     ├── ask → create ApprovalStore pending approval
  │     │        emit approval.created { replayId, approvalId }
  │     │        → user approves via /approve <id>
  │     │        → emit approval.resolved { replayId, approvalId }
  │     │        → denied? → emit replay.step.blocked, stop
  │     └── allow (prior approval) → continue
  │
  ├── 3. Execute tool via real ToolRouter
  │     ├── emit replay.step.started { replayId }
  │     ├── emit tool.started { replayId }   ← marked with replayId
  │     ├── execute
  │     ├── emit tool.completed { replayId } ← marked with replayId
  │     └── emit replay.step.completed { replayId }
  │
  ▼
emit replay.completed { replayId, summary }
  │
  ▼
Return ReplayResult { mode: "approved-live", replayId }
```

### Read-only shortcut

For `file.read`, `file.exists`, `dir.search`:
1. PolicyGate check (with `source: "replay"` — no bypass)
2. If PolicyGate says allow → execute directly, no approval step
3. If PolicyGate says deny → block step

This matches M0.35's behavior for read-only tools but without the `[DRY-RUN]` prefix — real data is returned.

### Side-effect approval flow

For `shell.run`, `file.create`, `file.delete`, `patch.apply`, `mcp.*`, `web_search`, `web_fetch`:
1. PolicyGate check
2. If PolicyGate says allow → proceed to approval
3. Create ApprovalStore pending approval with `capability` and `replayId`
4. Emit `approval.created { replayId, approvalId }`
5. Wait for user to `/approve` or `/deny`
6. If approved → execute. If denied → block step, stop chain

### Network tool handling

Network tools (`mcp.*`, `web_search`, `web_fetch`, `delegate`) require BOTH:
- PolicyGate allow
- Approval from user
- The tool's server must be available (same as normal execution)

---

## 8. ReplayId event linkage

Every event emitted during approved-live replay carries `replayId` in its payload:

```typescript
// Event payload pattern:
{
  replayId: "replay_1718000000_abc123",
  replayMode: "approved-live",
  // ... existing event-specific fields
}
```

This applies to:
- All `replay.*` events (already have mode, add `replayId`)
- `policy.decision` events emitted during replay
- `approval.created`, `approval.resolved` events emitted during replay
- `tool.*` events emitted during replay (`tool.started`, `tool.completed`, etc.)

The TraceEvent type gets an optional `replayId` field so users can see the linkage:

```typescript
// In TraceEvent type — already has sessionId, approvalId, toolCallId, etc.
// New field:
replayId?: string;
```

### Event chain example

```
replay.plan.created      { replayId: "r1", mode: "approved-live" }
replay.started            { replayId: "r1" }
policy.decision           { replayId: "r1", toolCallId: "tc1", decision: "allow" }
approval.created          { replayId: "r1", approvalId: "app1", capability: "shell.run" }
approval.resolved         { replayId: "r1", approvalId: "app1", status: "approved" }
replay.step.started       { replayId: "r1", stepIndex: 1 }
tool.started              { replayId: "r1", toolCallId: "tc1", toolName: "shell.run" }
tool.completed            { replayId: "r1", toolCallId: "tc1" }
replay.step.completed     { replayId: "r1", stepIndex: 1 }
replay.completed          { replayId: "r1", summary: "3 steps, 2 ok, 0 fail" }
```

---

## 9. ToolExecutor replay marking

When ToolExecutor executes a tool call originated from replay, its events need `replayId`. The ToolExecutor already accepts arbitrary `request` objects. The replay executor calls it with a modified request that includes `replayId` in metadata:

ToolExecutor's execute method already emits `tool.*` events with payloads. We add `replayId` to those payloads when present.

Two approaches:

**A. ToolExecutor checks for replayId on the request** — simplest. The replay executor adds `replayId` to the request args:

```typescript
// In ReplayExecutor:
const replayArgs = { ...step.args, __replayId: replayContext.replayId };
const toolRequest = { toolCallId, name, args: replayArgs };
```

Then ToolExecutor strips `__replayId` from args before hashing/policy, but includes it in events.

**B. Add optional replayId to ToolCallRequest** — cleaner but modifies the type.

Approach A is simpler and doesn't modify ToolExecutor's public interface. But it's hacky. Let me go with **Approach B** since it's clean and the type already exists:

```typescript
// In executor.ts:
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  replayId?: string;  // NEW — set when originating from replay
};
```

Then in `execute()`, when emitting tool.* events:
```typescript
const replayPayload = request.replayId ? { replayId: request.replayId } : {};

await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
  toolCallId, toolName: name, argumentHash, ...replayPayload,
});
```

---

## 10. ApprovalManager replay awareness

The ApprovalManager currently works with fixed prefixes (`/approvals`, `/approve`, `/deny`). No changes needed to its parsing — it already handles resolving by ID. The key is that approved-live replay creates ApprovalStore entries with `replayId` in their metadata, and the existing TUI approval commands can resolve them.

However, the approval's `reason` field should include `replayId` so users can see which replay triggered it:

```typescript
// In ReplayExecutor when creating approval:
await approvalStore.request({
  reason: `Replay ${replayId}: ${capability}`,
  capability,
  sessionId: this.sessionId(),  // current session, not source session
  toolId: toolName,             // e.g. "shell.run"
});
```

---

## 11. TUI UX

### New command

```
/replay selected --approved-live
```

With explicit confirmation:

```
WARNING: Approved-live replay will execute tool calls with REAL side effects.
Type: replay yes --approved-live
```

### Keyboard shortcut

When trace detail is open and mode is "replay", pressing `x` cycles through confirmation types. For M0.36, keep it simple: `/replay selected --approved-live` command or cycle with a mode indicator.

### Replay result display

The existing `renderReplayResult()` already shows mode, step outcomes, durations. With `replayId` added to the result:

```
── Replay Result ─────────────────────
  Mode: approved-live
  ReplayId: replay_1718000000_abc123
  Steps: 3 total, 2 completed, 0 blocked, 0 failed
  Duration: 2340ms

  Chain:
  ✔ 1. would-check-policy   policy: shell.run   5ms
  ✔ 2. would-require-approval approval: shell.run   1200ms
  ✔ 3. would-run-tool       shell.run started   1135ms
       ls -la

  Keys: s=summary  esc=close
```

---

## 12. Event model additions

In `src/events/types.ts`, add `replayId` to existing payload types where needed, or add it as an optional field on the event meta.

The simplest approach: add `replayId` to the `EventMeta` type so it's available on every event that has meta:

```typescript
export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
  replayId?: string;  // NEW
};
```

And in the replay executor, when logging tool events, set the meta:

```typescript
await this.log.append({
  sessionId: this.sessionId(),
  actor: "system",
  type: "tool.started",
  payload: { toolCallId, toolName, argumentHash },
  meta: { replayId: context.replayId },
});
```

This means the EventLog's `AlixEvent` type already supports `meta?: EventMeta` — so this is backward compatible.

---

## 13. Files

| File | Action | Purpose |
|------|--------|---------|
| `src/runtime/replay-plan.ts` | MODIFY | Add `"approved-live"` to ReplayMode, add `replayId` to ReplayPlan |
| `src/runtime/replay-executor.ts` | MODIFY | Add approved-live mode execution, PolicyGate + ApprovalStore integration, replayId linkage |
| `src/runtime/replay-preview.ts` | — | No changes needed |
| `src/events/types.ts` | MODIFY | Add `replayId` to EventMeta |
| `src/tools/executor.ts` | MODIFY | Add optional `replayId` to ToolCallRequest, propagate to tool events |
| `src/policy/policy-gate.ts` | — | No changes needed (already supports `"replay"` source) |
| `src/tui/store.ts` | MODIFY | Add `replayId` to state |
| `src/tui/trace-detail.ts` | MODIFY | Show replayId in renderReplayResult |
| `src/cli/commands/tui.ts` | MODIFY | Add `--approved-live` flag handling, confirmation warning |
| `src/runtime/trace-events.ts` | MODIFY | Add `replayId` field to TraceEvent |
| `tests/runtime/replay-executor.test.ts` | MODIFY | Add approved-live tests |
| `tests/runtime/replay-plan.test.ts` | MODIFY | Add approved-live mode plan building tests |
| `tests/tui/replay-execution-detail.test.ts` | MODIFY | Add replayId rendering test |

---

## 14. Acceptance criteria

1. `/replay selected --approved-live` creates a pending approval for each side-effecting step
2. Read-only steps (`file.read`, `file.exists`, `dir.search`) execute after PolicyGate allow without approval
3. File writes, shell commands, patch.apply, and network tools require approval before executing
4. Denied approval blocks that step and stops the chain
5. Every event emitted during replay carries `replayId` in its meta
6. ToolExecutor events include `replayId` when originating from replay
7. Replay result shows `replayId`, mode, and per-step outcomes
8. ApprovalManager can resolve replay-created approvals normally
9. PolicyGate re-check with `source: "replay"` — no bypass
10. All existing tests continue to pass (123+ replay tests, no regressions)
