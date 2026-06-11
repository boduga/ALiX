# M0.25: Universal Daemon — Workspace Routing Design Spec

**Status:** ✅ Completed (M0.25)
**Builds on:** M0.20 (daemon manager), M0.21 (daemon execution), M0.22 (task control), M0.23 (reliability), M0.24 (shared task router)

---

## Problem

The ALiX daemon is **project-local** — socket, PID, status, and task registry all live under `<cwd>/.alix/`:

```
~/Projects/Monolith/.alix/alixd.sock      ← socket
~/Projects/Monolith/.alix/daemon.json      ← status
~/Projects/Monolith/.alix/daemon.pid       ← PID
~/Projects/Monolith/.alix/daemon-tasks.json ← task registry
```

Moving to another project and running `alix tui --daemon` fails because the TUI looks for a daemon in the new project's `.alix/`:

```
~/Projects/other-project/.alix/alixd.sock  ← doesn't exist → "Daemon not running"
```

| Issue | Impact |
|-------|--------|
| One daemon per project | Must start/stop per project |
| No cross-project task queue | Cannot queue tasks across workspaces |
| No universal status | Inspector can't show daemon status globally |
| Breaks Agent OS principle | Daemon should be OS-level, not directory-scoped |

## Solution

Move the daemon's runtime state to the **user's home directory** (`~/.alix/`), keeping only session event logs per-project. Every run request carries a `cwd` field that tells the daemon which project to operate in.

### Before (project-local)

```
~/Projects/Monolith/.alix/
  alixd.sock
  daemon.json
  daemon.pid
  daemon-tasks.json
  sessions/<sessionId>/events.jsonl

~/Projects/other/.alix/
  alixd.sock          ← different daemon
  daemon.json
  daemon.pid
  daemon-tasks.json
```

### After (universal daemon, project sessions)

```
~/.alix/
  alixd.sock            ← ONE global socket
  daemon.json           ← ONE global status
  daemon.pid            ← ONE global PID
  daemon-tasks.json     ← ONE global task registry

~/Projects/Monolith/.alix/
  sessions/<sessionId>/events.jsonl   ← project-local session logs

~/Projects/other/.alix/
  sessions/<sessionId>/events.jsonl   ← project-local session logs
```

### Protocol change

Every `run` command now includes the requesting project's `cwd`:

```typescript
// Before
{ command: "run", task: "list files", route: {...} }

// After
{ command: "run", task: "list files", cwd: "/home/user/project", route: {...} }
```

The daemon uses `cwd` from the request for:
- Loading project config (`<cwd>/.alix/config.json`)
- Writing session events (`<cwd>/.alix/sessions/<sessionId>/`)
- Executing `runTask()` (which loads config from `cwd`)
- Tool execution root (file paths, shell cwd)

## Architecture

```
alix daemon start
    ↓
DaemonManager writes to ~/.alix/ (not <cwd>/.alix/)
    ↓
daemon-server listens on ~/.alix/alixd.sock
    ↓
                              ┌──────────────────────┐
TUI (any directory) ─────────→│ socket: run {cwd,    │
                              │         task, route}  │
                              └──────────┬───────────┘
                                         ↓
                              resolve project cwd
                                         ↓
                              loadConfig(cwd)  ← project config
                              EventLog(<cwd>/.alix/sessions/)
                              runTask(cwd, ...)
                              ToolExecutor(config, cwd)
```

### What stays project-local

| Artifact | Location | Reason |
|----------|----------|--------|
| Session event logs | `<cwd>/.alix/sessions/<id>/` | Per-project audit trail |
| Project config | `<cwd>/.alix/config.json` | Project-specific model/tool settings |
| Session messages | `<cwd>/.alix/sessions/<id>/messages.jsonl` | Conversation history |

### What moves to global

| Artifact | New Location | Reason |
|----------|-------------|--------|
| PID file | `~/.alix/daemon.pid` | One daemon, one PID |
| Status file | `~/.alix/daemon.json` | Global liveness check |
| Socket | `~/.alix/alixd.sock` | Single connection point |
| Task registry | `~/.alix/daemon-tasks.json` | Global queue owned by daemon |

### Task registry records gain a `cwd` field

```typescript
export type DaemonTaskRecord = {
  id: string;
  task: string;
  cwd: string;             // ← NEW: project where this task was submitted
  status: DaemonTaskStatus;
  sessionId?: string;
  // ... rest unchanged
};
```

This lets the Inspector filter tasks by project and show cross-project history.

### DaemonManager changes

```typescript
// Before (project-local)
private pidPath()    { return join(this.cwd, ".alix", "daemon.pid"); }
private statusPath() { return join(this.cwd, ".alix", "daemon.json"); }
private socketPath() { return join(this.cwd, ".alix", "alixd.sock"); }

// After (global)
private globalDir = join(homedir(), ".alix");
private pidPath()    { return join(this.globalDir, "daemon.pid"); }
private statusPath() { return join(this.globalDir, "daemon.json"); }
private socketPath() { return join(this.globalDir, "alixd.sock"); }
```

### Daemon client changes

The `daemon-client.ts` no longer validates socket path against project `.alix/`. Instead it always connects to `~/.alix/alixd.sock` and sends the request's `cwd`:

```typescript
// Before: validate socket is in project .alix/
const expectedSocket = join(opts.cwd, ".alix", "alixd.sock");
if (socketPath !== expectedSocket) { opts.onError(...); return; }

// After: connect to global socket, pass cwd
const socketPath = join(homedir(), ".alix", "alixd.sock");
client.write(JSON.stringify({ command: "run", task: opts.task, cwd: opts.cwd, route: opts.route }) + "\n");
```

### Backward compatibility

- `DaemonManager` still accepts `cwd` in constructor (used for session paths passed via run requests)
- If a `run` command arrives without `cwd`, the daemon falls back to its startup `--cwd`
- The `--cwd` CLI arg on daemon-server startup is still accepted but becomes the *default workspace* rather than the fixed workspace

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/daemon/daemon-manager.ts` | **Modify** | Move socket/pid/status paths to `~/.alix/` |
| `src/daemon/daemon-server.ts` | **Modify** | Accept `cwd` per run request, write sessions to project dir |
| `src/daemon/daemon-types.ts` | **Modify** | Add `cwd` to `DaemonCommand.run` |
| `src/daemon/task-registry.ts` | **Modify** | Add `cwd` field to `DaemonTaskRecord` |
| `src/tui/daemon-client.ts` | **Modify** | Connect to global socket, send `cwd` with request |
| `src/cli.ts` | **Modify** | Update `submit` command to use global daemon paths |
| `tests/daemon/daemon-manager.test.ts` | **Modify** | Update for global paths |
| `tests/daemon/daemon-server.test.ts` | **Modify** | Update for cwd-per-request protocol |
| `tests/daemon/daemon-universal.test.ts` | **Create** | Cross-workspace integration test |

## Testing

| Test | Description |
|------|-------------|
| Daemon starts with global socket | `~/.alix/alixd.sock` exists after start |
| Daemon status reads from global dir | `daemon.json` is in `~/.alix/` |
| Run task from project A succeeds | Submit task with `cwd: "/tmp/project-a"` |
| Run task from project B succeeds | Submit task with `cwd: "/tmp/project-b"` |
| Session events written to project A dir | `<project-a>/.alix/sessions/<id>/` has events |
| Session events written to project B dir | `<project-b>/.alix/sessions/<id>/` has events |
| Task registry has `cwd` field | Record includes requesting project path |
| TUI from project B connects to global daemon started in project A | Cross-workspace works |
| Backward compat: no `cwd` in request | Falls back to daemon startup `--cwd` |

## Non-goals

- **Not removing `--cwd` from daemon-server startup** — kept as default fallback
- **Not changing session event format** — events stay the same, only the directory changes
- **Not changing the task router** — classification is unaffected
- **Not adding multi-daemon support** — one daemon, one socket, many workspaces
