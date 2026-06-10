# M0.27: Workspace Switching UX — Design Spec

**Status:** Draft
**Builds on:** M0.25 (universal daemon), M0.26 (workspace registry)

---

## Problem

The TUI shows the current workspace in the daemon panel and welcome banner (M0.26), but the user is locked to the `cwd` they started the TUI from. There's no way to switch workspaces without restarting the TUI.

```
Starting TUI in ~/Projects/Monolith/
  → cwd is fixed to Monolith
  → To work in ~/Projects/other/, restart TUI

Starting TUI in ~/Projects/other/
  → cwd is fixed to other
  → No workspace switching at all
```

## Solution

Add workspace switching commands to the TUI: `/workspaces`, `/switch <arg>`, `/open <path>`. A `WorkspaceManager` class resolves workspace references and returns structured results. The TUI loop performs a **soft re-init** on switch: new session, fresh snapshot, updated prompt, no process restart.

## Architecture

```
TUI input loop (runTui)
    ↓
workspaceManager.tryHandleCommand(input)
    ↓
┌─ handled=false ──────────────────────────────────┐
│    submit task normally (taskRouter → executor)   │
└───────────────────────────────────────────────────┘
│
└─ handled=true
     ├─ appendSystemMessage(result.message)
     ├─ if changedWorkspace:
     │    ├─ update active cwd (normalized)
     │    ├─ create fresh sessionId/sessionDir/eventLog
     │    ├─ buildRuntimeSnapshot(newCwd)
     │    ├─ refresh workspace registry
     │    ├─ update TuiState (workspaceName, workspacePath, recentWorkspaces)
     │    └─ setPrompt(`[name] > `)
     └─ runTui() redraws layout
```

### Separation of concerns

| Component | Responsibility |
|-----------|---------------|
| `WorkspaceManager` | Command parsing + workspace resolution |
| `runTui()` | Lifecycle orchestration + render loop |
| `softReinitWorkspace()` | State/session/snapshot refresh |

## Components

### WorkspaceManager

```typescript
type WorkspaceMatch =
  | { status: "unique"; workspace: WorkspaceEntry }
  | { status: "ambiguous"; matches: WorkspaceEntry[]; partial: string }
  | { status: "not_found" };

type WorkspaceCommandResult =
  | { handled: false }
  | { handled: true; changedWorkspace: false; message: string }
  | { handled: true; changedWorkspace: true; message: string; nextCwd: string };

class WorkspaceManager {
  private lastAmbiguity?: { partial: string; matches: WorkspaceEntry[] };

  constructor(private deps: {
    listWorkspaces(): Promise<WorkspaceEntry[]>;
    recordWorkspaceActivity(cwd: string): Promise<void>;
    getWorkspace(path: string): Promise<WorkspaceEntry | undefined>;
  }) {}

  async tryHandleCommand(input: string): Promise<WorkspaceCommandResult>
  private async resolveWorkspace(arg: string): Promise<WorkspaceMatch>
}
```

### Resolution order

```
1. Numeric selection from last ambiguity
   /switch 1 → matches[0] from lastAmbiguity cache
   /switch 2 → matches[1]
   (clears cache after successful match)

2. Exact path match
   /switch /home/user/Projects/Foo → find by WorkspaceEntry.path

3. Exact name match (unique)
   /switch Foo → find by WorkspaceEntry.name, must be unique

4. Unique path suffix
   /switch client-a/Foo → match path ending in "client-a/Foo"

5. Ambiguous → cache + show choices
   Two entries named "Foo" → lastAmbiguity = { partial: "Foo", matches }
   Return message listing choices with [1], [2], ...

6. Not found
   No match → return informative message
```

### Command reference

| Command | Aliases | Behavior |
|---------|---------|----------|
| `/workspaces` | `/workspace`, `/ws` | List all registered workspaces with name, status, task count, last used |
| `/switch <arg>` | `/sw <arg>` | Resolve arg → switch workspace or show ambiguity |
| `/open <path>` | — | Expand path, validate directory exists, record activity, switch |

### Path resolution for `/open`

```
~/Projects/foo      → expandTilde → homedir()/Projects/foo
./foo               → resolve(cwd, "foo")
../foo              → resolve(parent(cwd), "foo")
/abs/path           → /abs/path
```

After resolution, validate the path is an existing directory. If valid, call `recordWorkspaceActivity(path)` (which creates/upserts the registry entry), then switch to it.

### Soft re-init

```typescript
async function softReinitWorkspace(cwd: string): Promise<void> {
  // 0. Normalize and update active workspace first
  const nextCwd = resolve(cwd);

  // 1. Fresh session
  const sessionId = `tui_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const sessionDir = join(nextCwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  // 2. Fresh event log
  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  // 3. Fresh snapshot — reads new workspace's .alix/
  const snapshot = await buildRuntimeSnapshot(nextCwd);
  if (snapshot) applySnapshotToStore(tuiStore, snapshot);

  // 4. Update prompt
  rl.setPrompt(promptLabel(nextCwd));

  // 5. Redraw prompt immediately
  rl.prompt(true);
}
```

### Prompt

The prompt changes from `> ` to `[workspaceName] > `:

```typescript
function promptLabel(cwd: string, state?: TuiState): string {
  const raw = state?.workspaceName?.trim()
    ?? basename(state?.workspacePath || cwd);
  return `[${truncate(raw, 28)}] >`;
}
```

Truncated to 28 characters to stay compact on laptop terminals.

| Before | After |
|--------|-------|
| `> list files` | `[Monolith] > list files` |
| `> pwd` | `[alix-test] > pwd` |
| `> exit` | `[client-nas-deploy] > exit` |

### What changes on switch

| Aspect | Changes? | Detail |
|--------|----------|--------|
| `activeWorkspacePath` | ✅ | Updated to resolved path |
| `activeWorkspaceName` | ✅ | Updated to basename or registry name |
| `sessionId` | ✅ | New `tui_`-prefixed ID |
| `sessionDir` | ✅ | New workspace's `.alix/sessions/<id>` |
| `eventLog` | ✅ | Fresh EventLog for new session |
| `runtimeSnapshot` | ✅ | Reloaded from new workspace |
| `config` | ✅ | Reloaded from new workspace (with global fallback) |
| `recentWorkspaces` | ✅ | Refreshed from registry |
| `prompt` | ✅ | Updated to `[name] > ` |
| TUI process | ❌ | Stays alive |
| Daemon socket | ❌ | Global `~/.alix/alixd.sock` unchanged |
| Global daemon state | ❌ | `~/.alix/` unchanged |
| Provider registry | ❌ | Model providers cached globally |
| Theme/layout | ❌ | TUI display settings unchanged |

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tui/workspace-manager.ts` | **Create** | `WorkspaceManager` class, `WorkspaceMatch`, `WorkspaceCommandResult` types, command parsing, workspace resolution |
| `src/cli/commands/tui.ts` | **Modify** | Wire `WorkspaceManager` into input loop, add `softReinitWorkspace()`, replace prompt with `[name] > ` |
| `src/tui/store.ts` | **Modify** | Add `sessionDir` to `TuiState` (optional) for re-init access |
| `tests/tui/workspace-manager.test.ts` | **Create** | Unit tests for command parsing, resolution, ambiguity |

## Testing

| Test | Description |
|------|-------------|
| `/workspaces` returns formatted list | Happy path: 2+ entries |
| `/switch <exact-name>` unique match | Switches immediately |
| `/switch <exact-path>` match | Switches on full path |
| `/switch <path-suffix>` unique | Switches on `client-a/Foo` |
| `/switch <name>` ambiguous | Shows choices, caches ambiguity |
| `/switch 1` numeric from cache | Selects first cached match |
| `/switch 1` expired cache | Returns not_found |
| `/switch <name>` not found | Returns not_found |
| `/open <existing-dir>` | Records activity, switches |
| `/open <nonexistent>` | Returns error message |
| `/open ~/foo` | Expands tilde correctly |
| `handled: false` for non-command input | Passes through to task submission |
| Prompt shows `[name] > ` after switch | Verified via promptLabel() |

## Non-goals

- **No standalone CLI commands** — `alix workspace list/switch/open` deferred to M0.28+
- **No daemon-side workspace switching** — daemon processes per-request `cwd` already (M0.25)
- **No persistent active workspace** — TUI starts in its `cwd` every time
- **No GUI workspace picker** — text commands only
