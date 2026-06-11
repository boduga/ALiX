# M0.28: Runtime State Consistency Hardening — Design Spec

**Status:** ✅ Completed (M0.28)
**Builds on:** M0.24 (shared task router), M0.25 (universal daemon), M0.26 (workspace registry), M0.27 (workspace switching)

---

## Problem

The M0.24−M0.27 milestones added powerful features (task router, universal daemon, workspace registry, workspace switching), but introduced several state consistency bugs:

| # | Bug | Impact |
|---|-----|--------|
| P0 | `runTui()` uses immutable `cwd`/`sessionId`/`sessionDir`/`config` — workspace switch changes the display but not execution context | Tasks run in the wrong directory after `/switch` |
| P0 | `/open` resolves relative paths against `process.cwd()` not active workspace | `[Monolith] > /open ../other` resolves against shell launch dir |
| P0 | `grounded_chat` doesn't enforce `allowedTools` | Model could execute unapproved tools |
| P1 | Daemon emits duplicate `session.ended` on agent errors | Confusing event logs |
| P1 | Non-agent daemon routes write `session.ended` to client before appending to event log | Race between client notification and log finalization |
| P1 | Task registry writes are fire-and-forget with `.catch(() => {})` | Can silently lose state on crash |
| P1 | Workspace registry has read-modify-write race with concurrent writers | Two overlapping `/open` calls can lose one entry |

## Solution

### Fix 1: Mutable runtime context in runTui()

Replace the immutable startup constants with a mutable context object that `softReinitWorkspace()` updates:

```typescript
// Before (immutable):
const cwd = process.cwd();
const sessionId = randomUUID();
const sessionDir = join(cwd, ".alix", "sessions", sessionId);
const config = await loadConfig(cwd);

// After (mutable):
let activeCwd = process.cwd();
let activeSessionId = opts.sessionName ?? randomUUID();
let activeSessionDir = join(activeCwd, ".alix", "sessions", activeSessionId);
let activeConfig = await loadConfig(activeCwd);
```

Then `softReinitWorkspace(nextCwd)` updates all four plus the event log:

```typescript
async function softReinitWorkspace(nextCwd: string): Promise<void> {
  const newSessionId = `tui_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const newSessionDir = join(nextCwd, ".alix", "sessions", newSessionId);
  await mkdir(newSessionDir, { recursive: true });

  activeCwd = nextCwd;
  activeSessionId = newSessionId;
  activeSessionDir = newSessionDir;
  activeConfig = await loadConfig(nextCwd);
  tuiLog = new EventLog(newSessionDir);
  await tuiLog.init();

  const snapshot = await buildRuntimeSnapshot(nextCwd);
  if (snapshot) applySnapshotToStore(tuiStore, snapshot);
  tuiStore.setSessionId(newSessionId);
  tuiStore.setSessionDir(newSessionDir);
  rl!.setPrompt(promptLabel(nextCwd, snapshot?.workspaceName, snapshot?.workspacePath));
  rl!.prompt(true);
}
```

All execution paths switch from `cwd` → `activeCwd`, `sessionId` → `activeSessionId`, `sessionDir` → `activeSessionDir`, `config` → `activeConfig`:

```typescript
// Daemon mode:
await submitTaskViaDaemon({ cwd: activeCwd, task, route, ... });
onDone: async () => { const fresh = await buildRuntimeSnapshot(activeCwd); ... }

// Local mode:
const ctx: RuntimeContext = { cwd: activeCwd, sessionId: activeSessionId, sessionDir: activeSessionDir, eventLog: tuiLog, config: activeConfig, ... };

// Refresh:
const fresh = await buildRuntimeSnapshot(activeCwd);
```

### Fix 2: /open resolves relative paths against active workspace

Inject `getActiveCwd()` into `WorkspaceManagerDeps`:

```typescript
export interface WorkspaceManagerDeps {
  listWorkspaces(): Promise<WorkspaceEntry[]>;
  recordWorkspaceActivity(cwd: string): Promise<void>;
  getWorkspace(path: string): Promise<WorkspaceEntry | undefined>;
  getActiveCwd(): string;  // NEW
}
```

Then in `handleOpen`:

```typescript
// Resolve relative paths against active workspace, not process.cwd()
const activeCwd = this.deps.getActiveCwd();
resolved = resolve(activeCwd, resolved);
```

The TUI passes `() => activeCwd` on construction:

```typescript
const workspaceManager = new WorkspaceManager({
  listWorkspaces, recordWorkspaceActivity, getWorkspace,
  getActiveCwd: () => activeCwd,
});
```

### Fix 3: Enforce grounded_chat allowedTools

In both `executeGroundedChatRoute` (daemon) and `LocalRuntimeExecutor.executeGroundedChat` (local), validate the tool name against `route.allowedTools` before execution:

```typescript
if (response.toolCalls.length > 0) {
  if (response.toolCalls.length > 1) {
    // Reject multi-tool requests for grounded chat (too complex)
    safeWrite(client, { type: "assistant.text", sessionId, text: "Grounded chat supports only one tool call at a time." });
    return;
  }
  const tc = response.toolCalls[0];

  // Enforce allowedTools allowlist
  if (!route.allowedTools.includes(tc.name)) {
    safeWrite(client, { type: "assistant.text", sessionId, text: `Tool "${tc.name}" is not allowed for this query type.` });
    return;
  }

  // ... execute tool ...
}
```

### Fix 4: Deduplicate session.ended in daemon

Replace the current `handleRun` structure (two `session.ended` paths + one in catch) with a single `finally` block guarded by an `ended` flag:

```typescript
let ended = false;
async function endSession() {
  if (ended) return;
  ended = true;
  currentSessionId = undefined;
  await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
  client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
}

try {
  // ... execution ...
  // agent route task.completed is already emitted inside the try block
} catch (err) {
  registry.update(taskId, { status: "failed", error });
  safeWrite(client, { type: "task.failed", sessionId, error });
} finally {
  await endSession();
}
```

### Fix 5: Serialize registry writes

Add a `saveQueue` promise chain to both `TaskRegistry` and `WorkspaceRegistry`:

```typescript
// TaskRegistry
private savePromise: Promise<void> = Promise.resolve();

private enqueueSave(): void {
  this.savePromise = this.savePromise
    .then(() => this.save())
    .catch((err) => console.error("[task-registry] save failed", err));
}

// Replace this.save().catch(() => {}) with this.enqueueSave()
```

Same pattern for `WorkspaceRegistry.recordWorkspaceActivity()`.

## What stays unchanged

| Aspect | Stays? |
|--------|--------|
| Runtime context types (`RuntimeContext`, `TaskRoute`) | ✅ Unchanged |
| WorkspaceManager resolution logic | ✅ Unchanged |
| Task router (`taskRouter()`) | ✅ Unchanged |
| Route executor interface (`RuntimeExecutor`) | ✅ Unchanged |
| Universal daemon socket protocol | ✅ Unchanged |
| Workspace registry format | ✅ Unchanged |
| Tests | ✅ Updated for new signatures |

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/commands/tui.ts` | **Modify** | Replace immutable `cwd`/`sessionId`/`sessionDir`/`config` with mutable `active*` vars; update `softReinitWorkspace` to update all four; pass `getActiveCwd` to WorkspaceManager |
| `src/tui/workspace-manager.ts` | **Modify** | Add `getActiveCwd()` to `WorkspaceManagerDeps`; use it for relative path resolution in `handleOpen` |
| `src/daemon/daemon-server.ts` | **Modify** | Deduplicate `session.ended` via `finally` + guard; enforce `allowedTools` in `executeGroundedChatRoute`; fix non-agent route event ordering |
| `src/daemon/daemon-server.ts` (grounded_chat) | **Modify** | Same `allowedTools` enforcement in daemon variant |
| `src/runtime/route-executor.ts` | **Modify** | Enforce `allowedTools` in `LocalRuntimeExecutor.executeGroundedChat` |
| `src/daemon/task-registry.ts` | **Modify** | Add `enqueueSave()` with serialized promise chain; log failures |
| `src/daemon/workspace-registry.ts` | **Modify** | Add `enqueueSave()` with serialized promise chain |
| `tests/tui/workspace-manager.test.ts` | **Modify** | Update `WorkspaceManagerDeps` mock to include `getActiveCwd` |
| `tests/runtime/route-executor.test.ts` | **Modify** | No changes needed (mock executor) |

## Testing

| Test | Description |
|------|-------------|
| `/switch` changes execution cwd | After switch, daemon task uses new cwd |
| `/switch` changes session/snapshot/config | After switch, local task uses new session |
| `/open` resolves relative to active workspace | `getActiveCwd()` returned path |
| `grounded_chat` rejects disallowed tool | `allowedTools` check produces error message |
| `grounded_chat` rejects multi-tool call | Model with 2+ tool calls gets single-tool error |
| Daemon `session.ended` fires exactly once | Agent error path doesn't produce duplicate |
| Task registry save failure is logged | `console.error` called on write failure |
| Workspace registry serialized writes | Concurrent calls don't race |
