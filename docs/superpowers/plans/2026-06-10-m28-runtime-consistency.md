# M0.28: Runtime State Consistency Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-10-m28-runtime-consistency-design.md`
**Builds on:** M0.27 (workspace switching UX)

**Goal:** Fix 7 state consistency bugs in the runtime/TUI/daemon pipeline — workspace switch affecting execution cwd, `/open` path resolution, grounded_chat tool enforcement, daemon session.ended dedup, registry write serialization.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/commands/tui.ts` | **Modify** | Mutable `activeCwd/activeSessionId/activeSessionDir/activeConfig`; update `softReinitWorkspace` to set all four; pass `getActiveCwd` to WorkspaceManager |
| `src/tui/workspace-manager.ts` | **Modify** | Add `getActiveCwd()` to deps; use it for relative path resolution in `handleOpen` |
| `src/daemon/daemon-server.ts` | **Modify** | Deduplicate `session.ended` via guard; enforce `allowedTools` in `executeGroundedChatRoute`; fix non-agent event ordering |
| `src/runtime/route-executor.ts` | **Modify** | Enforce `allowedTools` in `LocalRuntimeExecutor.executeGroundedChat` |
| `src/daemon/task-registry.ts` | **Modify** | Add `enqueueSave()` serialized write queue; log failures |
| `src/daemon/workspace-registry.ts` | **Modify** | Add `enqueueSave()` serialized write queue |
| `tests/tui/workspace-manager.test.ts` | **Modify** | Add `getActiveCwd` to mock deps in all tests |

---

### Task 1: Mutable runtime context in runTui()

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Replace immutable startup vars with mutable active* vars**

Find:
```typescript
  const cwd = process.cwd();

  const sessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();

  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const config = await loadConfig(cwd);
```

Replace with:
```typescript
  let activeCwd = process.cwd();
  let activeSessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();
  let activeSessionDir = join(activeCwd, ".alix", "sessions", activeSessionId);
  await mkdir(activeSessionDir, { recursive: true });
  let activeConfig = await loadConfig(activeCwd);
```

- [ ] **Step 2: Pass getActiveCwd to WorkspaceManager**

Find the WorkspaceManager initialization and add `getActiveCwd`:

```typescript
  const workspaceManager = new WorkspaceManager({
    listWorkspaces, recordWorkspaceActivity, getWorkspace,
    getActiveCwd: () => activeCwd,
  });
```

- [ ] **Step 3: Replace tuiLog initialization to use activeSessionDir**

```typescript
  let tuiLog = new EventLog(activeSessionDir);
```

- [ ] **Step 4: Update softReinitWorkspace to update all active* vars**

Replace the current `softReinitWorkspace` with:

```typescript
  async function softReinitWorkspace(nextCwd: string): Promise<void> {
    const { randomBytes } = await import("node:crypto");
    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    const { EventLog: EL } = await import("../../events/event-log.js");
    const { buildRuntimeSnapshot: bRS, applySnapshotToStore: aSTS } = await import("../../tui/runtime-snapshot.js");

    const newSessionId = `tui_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const newSessionDir = join(nextCwd, ".alix", "sessions", newSessionId);
    await mkdir(newSessionDir, { recursive: true });

    // Update all mutable state
    activeCwd = nextCwd;
    activeSessionId = newSessionId;
    activeSessionDir = newSessionDir;
    activeConfig = await loadConfig(nextCwd);
    tuiLog = new EL(newSessionDir);
    await tuiLog.init();

    const newSnapshot = await bRS(nextCwd);
    if (newSnapshot) aSTS(tuiStore, newSnapshot);

    tuiStore.setSessionId(newSessionId);
    tuiStore.setSessionDir(newSessionDir);
    rl!.setPrompt(promptLabel(nextCwd, newSnapshot?.workspaceName, newSnapshot?.workspacePath));
    rl!.prompt(true);
  }
```

- [ ] **Step 5: Replace all task execution paths to use active* vars**

Find daemon-mode block:
```typescript
        await submitTaskViaDaemon({
          cwd, task, route,
```
Replace `cwd` with `activeCwd`.

Find onDone callback:
```typescript
          onDone: async () => { const fresh = await buildRuntimeSnapshot(cwd); if (fresh) applySnapshotToStore(tuiStore, fresh); },
```
Replace `cwd` with `activeCwd`.

Find local-mode block:
```typescript
        const ctx: RuntimeContext = {
          cwd, sessionId, sessionDir,
```
Replace with:
```typescript
        const ctx: RuntimeContext = {
          cwd: activeCwd, sessionId: activeSessionId, sessionDir: activeSessionDir,
```

- [ ] **Step 6: Update refresh handler**

Find:
```typescript
      const fresh = await buildRuntimeSnapshot(cwd);
```
Replace `cwd` with `activeCwd`.

- [ ] **Step 7: Update prompt label after snapshot**

Find:
```typescript
  rl.setPrompt(promptLabel(cwd, snapshot?.workspaceName, snapshot?.workspacePath));
```
Replace `cwd` with `activeCwd`.

- [ ] **Step 8: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "fix(tui): use mutable active runtime context after workspace switch"
```

---

### Task 2: Fix /open relative path resolution

**Files:**
- Modify: `src/tui/workspace-manager.ts`
- Modify: `tests/tui/workspace-manager.test.ts`

- [ ] **Step 1: Add getActiveCwd to WorkspaceManagerDeps**

```typescript
export interface WorkspaceManagerDeps {
  listWorkspaces(): Promise<WorkspaceEntry[]>;
  recordWorkspaceActivity(cwd: string): Promise<void>;
  getWorkspace(path: string): Promise<WorkspaceEntry | undefined>;
  getActiveCwd(): string;  // NEW
}
```

- [ ] **Step 2: Update handleOpen to resolve relatives against active workspace**

Find the resolve line in `handleOpen`:
```typescript
    // Resolve against process cwd (handles relative paths)
    resolved = resolve(resolved);
```

Replace with:
```typescript
    // Resolve relative paths against the active workspace, not process cwd.
    // This ensures [Monolith] > /open ../other resolves relative to Monolith,
    // not to the original shell launch directory.
    if (!resolved.startsWith("/")) {
      const activeCwd = this.deps.getActiveCwd();
      resolved = resolve(activeCwd, resolved);
    }
```

- [ ] **Step 3: Update tests — add getActiveCwd to all mock deps**

Search for all `WorkspaceManagerDeps` mock objects in `tests/tui/workspace-manager.test.ts` and add `getActiveCwd: () => "/home/user/Projects/Monolith"` to each.

- [ ] **Step 4: Verify build and run tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/tui/workspace-manager.test.js 2>&1
```

Expected: 28 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/tui/workspace-manager.ts tests/tui/workspace-manager.test.ts
git commit -m "fix(tui): resolve /open relative paths against active workspace"
```

---

### Task 3: Enforce grounded_chat allowedTools

**Files:**
- Modify: `src/daemon/daemon-server.ts` (daemon-side grounded_chat)
- Modify: `src/runtime/route-executor.ts` (local grounded_chat)

- [ ] **Step 1: Add allowedTools check to daemon executeGroundedChatRoute**

Find the tool execution block in `executeGroundedChatRoute`:
```typescript
  if (response.toolCalls.length > 0 && response.toolCalls.length <= 1) {
    const tc = response.toolCalls[0];
    const toolResult = await executor.execute({
```

Replace with:
```typescript
  if (response.toolCalls.length > 0) {
    if (response.toolCalls.length > 1) {
      safeWrite(client, { type: "assistant.text" as const, sessionId, text: "Grounded chat supports only one tool call at a time." });
      return;
    }
    const tc = response.toolCalls[0];

    // Enforce allowedTools allowlist
    if (!route.allowedTools.includes(tc.name)) {
      safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Tool "${tc.name}" is not allowed for this query type.` });
      return;
    }

    const toolResult = await executor.execute({
```

- [ ] **Step 2: Add same check to LocalRuntimeExecutor.executeGroundedChat**

In `src/runtime/route-executor.ts`, find the same block and apply the same fix:

```typescript
  if (response.toolCalls.length > 0) {
    if (response.toolCalls.length > 1) {
      return "Grounded chat supports only one tool call at a time.";
    }
    const tc = response.toolCalls[0];

    if (!route.allowedTools.includes(tc.name)) {
      return `Tool "${tc.name}" is not allowed for this query type.`;
    }

    const toolResult = await executor.execute({
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/daemon-server.ts src/runtime/route-executor.ts
git commit -m "fix(runtime): enforce grounded_chat allowedTools allowlist"
```

---

### Task 4: Deduplicate daemon session.ended

**Files:**
- Modify: `src/daemon/daemon-server.ts`

- [ ] **Step 1: Restructure handleRun with finally guard**

Replace the end-of-handleRun `session.ended` logic. The key changes:

1. Add an `ended` flag and an `endSession()` inner helper at the top of handleRun
2. Remove the two explicit `session.ended` writes (one in non-agent early return, one at the end)
3. Use a `finally` block that calls `endSession()` after both success and catch

The full restructured handleRun:

```typescript
async function handleRun(task: string, taskId: string, client: Socket, requestCwd: string, route?: TaskRoute): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  currentSessionId = sessionId;

  registry.update(taskId, { status: "running", sessionId, startedAt: new Date().toISOString() });

  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  client.write(JSON.stringify({ type: "task.accepted", sessionId, task } satisfies DaemonResponse) + "\n");

  const eventLog = createDaemonEventLog(sessionId, client, requestCwd);
  await eventLog.init();

  await eventLog.append({
    actor: "system", type: "session.started", sessionId,
    payload: { task, source: "daemon" },
  });

  // Guard to ensure session.ended fires exactly once
  let ended = false;
  const endSession = async () => {
    if (ended) return;
    ended = true;
    currentSessionId = undefined;
    await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
    client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
  };

  // Resolve route: use pre-classified route, or classify from scratch
  if (!route) {
    const { taskRouter } = await import("../runtime/task-router.js");
    route = taskRouter(task);
  }

  try {
    // Route execution — tool/chat/grounded_chat complete here, agent falls through
    switch (route.kind) {
      case "tool":
        await executeToolRoute(route, taskId, sessionId, requestCwd, client, eventLog);
        break;
      case "chat":
        await executeChatRoute(route, taskId, sessionId, requestCwd, client, eventLog);
        break;
      case "grounded_chat":
        await executeGroundedChatRoute(route, sessionId, requestCwd, client, eventLog);
        break;
      case "agent":
        break; // fall through to runTask() below
    }

    if (route.kind !== "agent") {
      registry.update(taskId, { status: "completed", completedAt: new Date().toISOString() });
      safeWrite(client, { type: "task.completed" as const, sessionId, status: "completed" });
      await endSession();
      return;
    }

    // Agent route — runTask path
    const { loadConfig } = await import("../config/loader.js");
    const config = await loadConfig(requestCwd);
    const { runTask } = await import("../run.js");

    let streamedText = false;
    const result = await runTask(requestCwd, task, {
      planMode: false,
      streaming: true,
      sessionMode: "bypass",
      skipContext: true,
      sharedSession: {
        sessionId,
        sessionDir: join(requestCwd, ".alix", "sessions", sessionId),
        eventLog,
      },
    }, (chunk: any) => {
      if (chunk.type === "text" && typeof chunk.text === "string") {
        streamedText = true;
        client.write(JSON.stringify({ type: "assistant.text", sessionId, text: chunk.text } satisfies DaemonResponse) + "\n");
      }
    });

    if (!streamedText) {
      if (result.summary) {
        safeWrite(client, { type: "assistant.text" as const, sessionId, text: result.summary });
      } else {
        const fallback = extractFallbackOutput((eventLog as any)._events ?? []);
        if (fallback) {
          safeWrite(client, { type: "assistant.text" as const, sessionId, text: fallback });
        } else {
          safeWrite(client, { type: "assistant.text" as const, sessionId, text: "Task completed, but no textual output was produced." });
        }
      }
    }

    const current = registry.get(taskId);
    if (current?.status === "cancel_requested") {
      registry.update(taskId, { status: "cancelled", cancelledAt: new Date().toISOString() });
      client.write(JSON.stringify({ type: "task.cancelled", taskId } satisfies DaemonResponse) + "\n");
    } else if (!result.reason || result.reason === "completed") {
      registry.update(taskId, { status: "completed", completedAt: new Date().toISOString() });
      client.write(JSON.stringify({ type: "task.completed", sessionId, status: "completed" } satisfies DaemonResponse) + "\n");
    } else {
      registry.update(taskId, { status: "failed", error: result.reason });
      client.write(JSON.stringify({ type: "task.failed", sessionId, error: result.reason } satisfies DaemonResponse) + "\n");
    }
  } catch (err: any) {
    const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    registry.update(taskId, { status: "failed", error });
    safeWrite(client, { type: "task.failed" as const, sessionId, error });
  } finally {
    await endSession();
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Run daemon tests**

```bash
node --test dist/tests/daemon/daemon-server.test.js 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "fix(daemon): deduplicate session.ended via finally + guard"
```

---

### Task 5: Serialize registry writes

**Files:**
- Modify: `src/daemon/task-registry.ts`
- Modify: `src/daemon/workspace-registry.ts`

- [ ] **Step 1: Add enqueueSave to TaskRegistry**

Add to the TaskRegistry class:

```typescript
  private savePromise: Promise<void> = Promise.resolve();

  /** Serialized write — ensures concurrent saves don't race. */
  private enqueueSave(): void {
    this.savePromise = this.savePromise
      .then(() => this.save())
      .catch((err) => {
        console.error("[task-registry] save failed", err);
      });
  }
```

Replace all `this.save().catch(() => {});` with `this.enqueueSave();`.

There are 4 call sites:
- `create()` — line 63
- `update()` — line 72 (inside `update()`)
- `save()` in `pruneCompleted()` (called from `create()` — this already goes through `save()`)
- `reconcileOnStartup()` — line 116

The `save()` method stays as-is — it's the actual write. `enqueueSave()` is the serialized wrapper.

- [ ] **Step 2: Add enqueueSave to WorkspaceRegistry**

In `src/daemon/workspace-registry.ts`, add the same pattern:

```typescript
  private savePromise: Promise<void> = Promise.resolve();

  private enqueueSave(): void {
    this.savePromise = this.savePromise
      .then(() => this.save())
      .catch((err) => {
        console.error("[workspace-registry] save failed", err);
      });
  }
```

Extract the write logic into a `save()` method:

```typescript
  private async save(): Promise<void> {
    const tmp = WORKSPACES_PATH + ".tmp";
    await writeFile(tmp, JSON.stringify(this._workspaces, null, 2), "utf-8");
    await rename(tmp, WORKSPACES_PATH);
  }
```

Where `this._workspaces` is an in-memory copy. Actually, since `recordWorkspaceActivity` is the only mutation point, we can restructure it to use the queue:

Change `recordWorkspaceActivity` to work on a cached in-memory array that it serializes through the queue:

```typescript
export class WorkspaceRegistry {
  private workspaces: WorkspaceEntry[] = [];
  private savePromise: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    this.workspaces = await listWorkspacesRaw();
  }

  async recordWorkspaceActivity(cwd: string): Promise<void> {
    // ... mutation logic on this.workspaces ...
    this.enqueueSave();
  }

  list(): WorkspaceEntry[] {
    return [...this.workspaces];
  }

  private enqueueSave(): void {
    this.savePromise = this.savePromise
      .then(() => this.save())
      .catch((err) => console.error("[workspace-registry] save failed", err));
  }

  private async save(): Promise<void> {
    const tmp = WORKSPACES_PATH + ".tmp";
    await writeFile(tmp, JSON.stringify(this.workspaces, null, 2), "utf-8");
    await rename(tmp, WORKSPACES_PATH);
  }
}
```

But since the existing `recordWorkspaceActivity` is a standalone function (not a class method), keep it simple: add a module-level `savePromise` and enqueue the write:

```typescript
// At module level:
let savePromise: Promise<void> = Promise.resolve();

function enqueueSave(workspaces: WorkspaceEntry[]): void {
  savePromise = savePromise
    .then(() => save(workspaces))
    .catch((err) => console.error("[workspace-registry] save failed", err));
}

async function save(workspaces: WorkspaceEntry[]): Promise<void> {
  const tmp = WORKSPACES_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(workspaces, null, 2), "utf-8");
  await rename(tmp, WORKSPACES_PATH);
}
```

Then replace the inline write at the end of `recordWorkspaceActivity` with a call to `enqueueSave(workspaces)`.

- [ ] **Step 3: Verify build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/task-registry.test.js dist/tests/daemon/workspace-registry.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/task-registry.ts src/daemon/workspace-registry.ts
git commit -m "fix(daemon): serialize registry writes via enqueueSave pattern"
```

---

### Task 6: Full build, push, tag

- [ ] **Step 1: Build and run all tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/*.test.js dist/tests/runtime/*.test.js dist/tests/integration/smoke.test.js dist/tests/tui/workspace-manager.test.js 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 2: Verify diff**

```bash
git diff --stat HEAD~5..HEAD
```

Expected files:
- `src/cli/commands/tui.ts`
- `src/tui/workspace-manager.ts`
- `src/daemon/daemon-server.ts`
- `src/runtime/route-executor.ts`
- `src/daemon/task-registry.ts`
- `src/daemon/workspace-registry.ts`
- `tests/tui/workspace-manager.test.ts`

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.28-runtime-consistency -m "M0.28 runtime state consistency hardening: mutable context, allowedTools enforcement, session.ended dedup, serialized registry writes"
git push origin m0.28-runtime-consistency
```

---

## Verification checklist

| Check | Command | Expected |
|-------|---------|----------|
| `/switch` changes execution cwd | Switch workspace, run `pwd` | Returns new workspace path |
| `/open ../other` resolves correctly | `[Monolith] > /open ../other` | Opens correct parent-relative path |
| `grounded_chat` rejects wrong tool | Route with web.search only, model calls shell.run | "Tool not allowed" message |
| `session.ended` fires once in daemon | Examine daemon test output | No duplicate events |
| Registry save failures logged | Check console.error | Error message on write failure |
| All tests green | `npm run test:node:ci` | 134+ tests pass |
