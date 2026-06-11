# M0.26: Workspace Registry — Project Awareness Design Spec

**Status:** Draft
**Builds on:** M0.25 (universal daemon with global `~/.alix/` and per-request `cwd`)

---

## Problem

The universal daemon (M0.25) accepts per-request `cwd` and routes sessions correctly, but it has no **workspace memory**. There's nowhere to see:

- Which projects have used the daemon?
- When was each workspace last accessed?
- How many tasks has each workspace run?

The TUI daemon panel shows runtime state but not the workspace identity:

```
── Daemon ──────────────────────────────
Status:  ● running
Tasks:   run:0 queued:0 done:0 fail:0
Events:  0
```

No context like:

```
Workspace: ~/Projects/Monolith
```

## Solution

Introduce a **workspace registry** — `~/.alix/workspaces.json` — that the daemon auto-populates whenever it receives a run request. Each workspace entry records:

- `path` — the absolute cwd from the run request
- `name` — the last path segment (human-readable)
- `lastUsed` — ISO timestamp of the most recent run
- `taskCount` — total tasks submitted from this workspace
- `status` — `"active"` or `"idle"`

### Registry file format

```json
[
  {
    "path": "/home/user/Projects/Monolith",
    "name": "Monolith",
    "lastUsed": "2026-06-10T15:30:00.000Z",
    "taskCount": 42,
    "status": "active"
  },
  {
    "path": "/home/user/Projects/other-project",
    "name": "other-project",
    "lastUsed": "2026-06-09T10:00:00.000Z",
    "taskCount": 3,
    "status": "idle"
  }
]
```

Sorted by `lastUsed` descending — most recent first.

### Auto-registration

No manual `alix workspace add` needed. Every time the daemon processes a `run` command with a `cwd` field, it:

1. Loads `~/.alix/workspaces.json`
2. Upserts the entry for `cwd`: updates `lastUsed`, increments `taskCount`, sets `status` to `"active"`
3. Marks all other workspaces with `"active"` older than 24h as `"idle"`
4. Writes the file

This happens in `handleCommand()` in `daemon-server.ts`, alongside `registry.create()`:

```typescript
// After creating task record, auto-register workspace
recordWorkspaceActivity(requestCwd);
```

### Workspace activity function

```typescript
/** Auto-register workspace activity when a task is submitted. */
async function recordWorkspaceActivity(cwd: string): Promise<void> {
  const workspacesPath = join(globalDir, "workspaces.json");
  let workspaces: WorkspaceEntry[] = [];
  try {
    const raw = await readFile(workspacesPath, "utf-8");
    workspaces = JSON.parse(raw);
  } catch { /* file doesn't exist yet */ }

  const existing = workspaces.find(w => w.path === cwd);
  const now = new Date().toISOString();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  if (existing) {
    existing.lastUsed = now;
    existing.taskCount++;
    existing.status = "active";
  } else {
    workspaces.push({
      path: cwd,
      name: cwd.split("/").pop() ?? cwd,
      lastUsed: now,
      taskCount: 1,
      status: "active",
    });
  }

  // Mark stale actives as idle
  for (const w of workspaces) {
    if (w.status === "active" && new Date(w.lastUsed).getTime() < oneDayAgo) {
      w.status = "idle";
    }
  }

  // Sort by lastUsed descending
  workspaces.sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

  const tmp = workspacesPath + ".tmp";
  await writeFile(tmp, JSON.stringify(workspaces, null, 2), "utf-8");
  await rename(tmp, workspacesPath);
}
```

### TUI display

The TUI daemon panel gains a workspace header and the welcome banner shows workspace info:

```
── Daemon — Monolith ───────────────────
Workspace: ~/Projects/Monolith
Status:     ● running
Socket:     ~/.alix/alixd.sock
Tasks:      run:0 queued:0 done:42 fail:0
Events:     0
```

The welcome banner (in `tui.ts`) shows:

```
Workspace: alix-monolith-test-folder
Daemon:    global
Socket:    ~/.alix/alixd.sock
```

### RuntimeSnapshot changes

`buildRuntimeSnapshot()` also reads the workspace registry from `~/.alix/workspaces.json` (not project-local) and includes the current workspace info plus recent workspace history.

### Store changes

`TuiState` gains:

```typescript
workspaceName?: string;
workspacePath?: string;
recentWorkspaces?: WorkspaceEntry[];
```

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/daemon/workspace-registry.ts` | **Create** | `WorkspaceEntry` type, `recordWorkspaceActivity()`, `listWorkspaces()`, `getCurrentWorkspace()` |
| `src/daemon/daemon-server.ts` | **Modify** | Call `recordWorkspaceActivity()` after task creation |
| `src/tui/store.ts` | **Modify** | Add `workspaceName`, `workspacePath`, `recentWorkspaces` to `TuiState` |
| `src/tui/runtime-snapshot.ts` | **Modify** | Read workspace registry, populate workspace fields in snapshot |
| `src/tui/panel-renderer.ts` | **Modify** | Show workspace name + path in daemon panel |
| `src/cli/commands/tui.ts` | **Modify** | Show workspace info in welcome banner |
| `tests/daemon/workspace-registry.test.ts` | **Create** | Unit tests for workspace registry CRUD + auto-registration |
| `tests/daemon/daemon-server.test.ts` | **Modify** | One test verifying workspace registry is written on task |

## Testing

| Test | Description |
|------|-------------|
| Workspace created on first task | `recordWorkspaceActivity("/tmp/proj")` writes to workspace registry |
| taskCount increments on repeat tasks | Subsequent calls increment counter |
| lastUsed updates on each task | Timestamp refreshes |
| Stale active → idle after 24h | Workspaces older than 24h marked idle |
| Registry sorted by lastUsed | Most recent workspace first |
| Daemon integration: registry written | After `submitWithRoute()`, check `~/.alix/workspaces.json` exists |
| Empty registry returns empty list | No file → `[]` |
| TUI snapshot includes workspace | `buildRuntimeSnapshot()` returns workspace name |

## Non-goals

- **No workspace management commands** — no `alix workspace add/rm/rename` (Phase 2)
- **No workspace-scoped config** — each workspace still uses its own `.alix/config.json`
- **No workspace-level policy overrides** — that's a separate milestone
