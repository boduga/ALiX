# M0.25: Universal Daemon — Workspace Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-10-m25-universal-daemon-design.md`
**Builds on:** M0.24 (shared task router)

**Goal:** Move daemon runtime state (socket, PID, status, task registry) from project-local `<cwd>/.alix/` to user-global `~/.alix/`. Each run request carries a `cwd` field so the daemon executes in the requesting project's context. Session event logs remain per-project.

**Design at a glance:**
- DaemonManager → global paths (`~/.alix/daemon.pid`, `~/.alix/daemon.json`, `~/.alix/alixd.sock`)
- TaskRegistry → global `~/.alix/daemon-tasks.json`, records gain `cwd` field
- DaemonServer → accepts `cwd` per run request, writes sessions to `<cwd>/.alix/sessions/`
- DaemonClient → connects to global socket, sends `cwd` with every run command
- CLI submit → uses global daemon paths

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/daemon/daemon-manager.ts` | **Modify** | Global paths for PID/status/socket |
| `src/daemon/daemon-server.ts` | **Modify** | Accept `cwd` per request, route sessions to project dir |
| `src/daemon/daemon-types.ts` | **Modify** | Add `cwd` to `DaemonCommand.run` |
| `src/daemon/task-registry.ts` | **Modify** | Global file path, `cwd` field in records |
| `src/tui/daemon-client.ts` | **Modify** | Connect to global socket, send `cwd` |
| `src/cli.ts` | **Modify** | Use global daemon paths for submit/status commands |
| `src/cli/commands/tui.ts` | **Modify** | Minor: already passes `cwd` — verify |
| `tests/daemon/daemon-manager.test.ts` | **Modify** | Update for global paths |
| `tests/daemon/daemon-server.test.ts` | **Modify** | Update for cwd-per-request protocol |
| `tests/daemon/daemon-universal.test.ts` | **Create** | Cross-workspace integration test |
| `tests/daemon/task-registry.test.ts` | **Modify** | Update for global path + cwd field |

---

### Task 1: Move task registry to global dir, add cwd field

**Files:**
- Modify: `src/daemon/task-registry.ts`

- [ ] **Step 1: Change file path to ~/.alix/ and add cwd**

```typescript
import { homedir } from "node:os";

// In DaemonTaskRecord, add:
export type DaemonTaskRecord = {
  id: string;
  task: string;
  cwd: string;             // ← NEW: project directory where task was submitted
  status: DaemonTaskStatus;
  sessionId?: string;
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
  error?: string;
};
```

Change constructor:

```typescript
constructor() {
  this.filePath = join(homedir(), ".alix", "daemon-tasks.json");
}
```

The `cwd` parameter is removed from the constructor. All paths are now global.

- [ ] **Step 2: Update create() to accept and store cwd**

```typescript
create(task: string, cwd: string): DaemonTaskRecord {
  const record: DaemonTaskRecord = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    task, cwd, status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // ...
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors. Update callers in daemon-server.ts if needed.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/task-registry.ts
git commit -m "feat(daemon): move task registry to ~/.alix/, add cwd field to records"
```

---

### Task 2: Move daemon manager to global paths

**Files:**
- Modify: `src/daemon/daemon-manager.ts`

- [ ] **Step 1: Change paths from project-local to global**

```typescript
import { homedir } from "node:os";

export class DaemonManager {
  constructor(private cwd: string) {}

  private globalDir(): string {
    return join(homedir(), ".alix");
  }

  private pidPath(): string {
    return join(this.globalDir(), "daemon.pid");
  }

  private statusPath(): string {
    return join(this.globalDir(), "daemon.json");
  }

  socketPath(): string {
    return join(this.globalDir(), "alixd.sock");
  }

  private ensureDir(): Promise<void> {
    return mkdir(this.globalDir(), { recursive: true }) as any;
  }
}
```

Note: `socketPath()` becomes public (was private) so `daemon-client.ts` can read it without needing a running daemon instance.

- [ ] **Step 2: Update start() to use global socket**

The spawn command changes to use the global socket path:

```typescript
async start(): Promise<DaemonStatus> {
  // ... stale state check unchanged ...

  await this.ensureDir();
  const socketPath = this.socketPath();

  // Remove stale socket before spawn
  await rm(socketPath, { force: true }).catch(() => {});

  const child = spawn(process.execPath, [
    join(daemonManagerDir, "daemon-server.js"),
    "--socket", socketPath,
    "--cwd", this.cwd,    // default workspace
  ], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/daemon-manager.ts
git commit -m "feat(daemon): move daemon manager paths to ~/.alix/ global dir"
```

---

### Task 3: Update daemon protocol types

**Files:**
- Modify: `src/daemon/daemon-types.ts`

- [ ] **Step 1: Add cwd to DaemonCommand.run**

```typescript
/** Commands a client can send to the daemon. */
export type DaemonCommand =
  | { command: "run"; task: string; cwd: string; route?: import("../runtime/task-router.js").TaskRoute; sessionMode?: string; planMode?: boolean }
  | { command: "ping" }
  | { command: "status" }
  | { command: "cancel"; taskId: string };
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/daemon-types.ts
git commit -m "feat(daemon): add cwd to DaemonCommand.run protocol"
```

---

### Task 4: Update daemon server for per-request cwd

**Files:**
- Modify: `src/daemon/daemon-server.ts`

This is the largest change. The server currently uses a single startup `cwd` for everything. Now it needs to:

1. Keep startup `--cwd` as the DEFAULT workspace fallback
2. Accept per-request `cwd` from the run command
3. Use request `cwd` for session dirs, config loading, tool execution
4. Write status/heartbeat to global `~/.alix/daemon.json` instead of `<cwd>/.alix/daemon.json`
5. Use global `TaskRegistry` (no `cwd` constructor arg)

- [ ] **Step 1: Change global paths in daemon-server.ts**

Replace `join(cwd, ".alix", "daemon.json")` with `join(homedir(), ".alix", "daemon.json")` in `startHeartbeat()` and the listen callback.

```typescript
import { homedir } from "node:os";

const globalDir = join(homedir(), ".alix");

// In startHeartbeat:
const statusPath = join(globalDir, "daemon.json");

// In the listen callback:
const statusPath = join(globalDir, "daemon.json");
```

- [ ] **Step 2: Change TaskRegistry to global (no cwd arg)**

```typescript
const registry = new TaskRegistry();  // no cwd argument — uses ~/.alix/
```

- [ ] **Step 3: Accept cwd from command and update handleCommand**

```typescript
async function handleCommand(cmd: Record<string, unknown>, client: Socket): Promise<void> {
  if (cmd.command === "run") {
    const task = String(cmd.task || "");
    const requestCwd = String(cmd.cwd || defaultCwd);  // ← use request cwd or fallback
    const record = registry.create(task, requestCwd);
    taskQueue.push({ task, taskId: record.id, cwd: requestCwd, route: cmd.route as TaskRoute | undefined, client });
    // ...
  }
}
```

- [ ] **Step 4: Update queue type and processQueue to pass cwd**

```typescript
const taskQueue: Array<{ task: string; taskId: string; cwd: string; route?: TaskRoute; client: Socket }> = [];

async function processQueue(): Promise<void> {
  // ...
  const { task, taskId, cwd, route, client } = taskQueue.shift()!;
  await handleRun(task, taskId, client, cwd, route);
  // ...
}
```

- [ ] **Step 5: Update handleRun to accept cwd and use it for sessions**

```typescript
async function handleRun(task: string, taskId: string, client: Socket, requestCwd: string, route?: TaskRoute): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  currentSessionId = sessionId;

  registry.update(taskId, { status: "running", sessionId, startedAt: new Date().toISOString() });

  // Use request cwd for session dirs
  const sessionDir = join(requestCwd, ".alix", "sessions", sessionId);

  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  client.write(JSON.stringify({ type: "task.accepted", sessionId, task } satisfies DaemonResponse) + "\n");

  const eventLog = createDaemonEventLog(sessionId, client, requestCwd);
  await eventLog.init();
  // ...
}
```

- [ ] **Step 6: Update createDaemonEventLog to accept project cwd**

```typescript
function createDaemonEventLog(sessionId: string, client: Socket, projectCwd: string): EventLog {
  const events: any[] = [];
  const log = new EventLog(join(projectCwd, ".alix", "sessions", sessionId));
  // ... rest unchanged ...
}
```

- [ ] **Step 7: Replace all hardcoded `cwd` references in route executors with requestCwd**

All the `executeToolRoute`, `executeChatRoute`, `executeGroundedChatRoute` functions already take `cwd` as a parameter — they now receive `requestCwd` from the caller. No signature changes needed there.

The agent fallthrough path needs updating to use `requestCwd`:

```typescript
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
    }, (chunk: any) => { ... });
```

- [ ] **Step 8: Store `defaultCwd` from startup args**

```typescript
const defaultCwd = args[args.indexOf("--cwd") + 1];
```

- [ ] **Step 9: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors. If `homedir()` import creates issues, check it's available from `node:os`.

- [ ] **Step 10: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "feat(daemon): accept per-request cwd, route sessions to project dirs, use global status"
```

---

### Task 5: Update daemon client for global socket

**Files:**
- Modify: `src/tui/daemon-client.ts`

- [ ] **Step 1: Connect to global socket and pass cwd**

Replace the current socket path resolution with global path:

```typescript
export async function submitTaskViaDaemon(opts: DaemonClientOptions): Promise<void> {
  const { homedir } = await import("node:os");
  const socketPath = join(homedir(), ".alix", "alixd.sock");

  // Check if socket exists — quick liveness test
  const { existsSync } = await import("node:fs");
  if (!existsSync(socketPath)) {
    opts.onError("Daemon is not running (no socket at ~/.alix/alixd.sock). Start it with: alix daemon start");
    return;
  }

  const { connect } = await import("node:net");

  return new Promise<void>((resolve) => {
    const client = connect(socketPath, () => {
      client.write(JSON.stringify({
        command: "run",
        task: opts.task,
        cwd: opts.cwd,     // ← always send the requesting project
        route: opts.route,
      }) + "\n");
    });
    // ... rest unchanged ...
  });
}
```

Remove the old `DaemonManager` import and the socket path validation block. The global socket path replaces both.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tui/daemon-client.ts
git commit -m "feat(tui): connect to global daemon socket, send cwd with run request"
```

---

### Task 6: Update CLI daemon/submit commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Find the daemon command handler**

Search for the `daemon start`/`stop`/`status`/`submit` handlers in `cli.ts`. Ensure they:
- Use `DaemonManager` (already does — paths become global automatically)
- For `submit`: connect to global socket and send `cwd`

The `submit` handler currently uses `DaemonManager` to resolve the socket path. Since `DaemonManager.socketPath()` now returns the global path, this should work automatically. But verify it sends `cwd` in the run command.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit if changes needed**

```bash
git add src/cli.ts
git commit -m "fix(cli): ensure daemon submit sends cwd with run command"
```

---

### Task 7: Update daemon-manager tests

**Files:**
- Modify: `tests/daemon/daemon-manager.test.ts`

- [ ] **Step 1: Rewrite tests for global paths**

Tests need to verify:
- Status file is written to `~/.alix/daemon.json` (or a test-homedir equivalent)
- Socket path is `~/.alix/alixd.sock`
- Starts correctly regardless of test tmpdir

Use a homedir override for test isolation. Add at the top:

```typescript
import { homedir } from "node:os";

// Use a tmpdir as fake homedir for test isolation
const origHomedir = process.env.HOME;
```

For each test, set `HOME` to a tmpdir and clean up after.

- [ ] **Step 2: Add test for global path resolution**

```typescript
it("socket path is in global ~/.alix dir", () => {
  const mgr = new DaemonManager("/tmp/project-a");
  assert.ok(mgr.socketPath().includes(".alix/alixd.sock"));
  assert.ok(mgr.socketPath().startsWith(homedir()));
});
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/daemon-manager.test.js 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add tests/daemon/daemon-manager.test.ts
git commit -m "test(daemon): update daemon manager tests for global ~/.alix paths"
```

---

### Task 8: Update daemon-server integration tests

**Files:**
- Modify: `tests/daemon/daemon-server.test.ts`

- [ ] **Step 1: Update tests to send cwd with every run request**

Find all `submitWithRoute` and `submitTask` calls and add `cwd: tmpDir` to the command:

```typescript
client.write(JSON.stringify({
  command: "run", task: "echo hello", cwd: tmpDir, route: {...},
}) + "\n");
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/daemon-server.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/daemon/daemon-server.test.ts
git commit -m "test(daemon): update server tests to pass cwd with run requests"
```

---

### Task 9: Cross-workspace integration test

**Files:**
- Create: `tests/daemon/daemon-universal.test.ts`

- [ ] **Step 1: Write cross-workspace test**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Cross-workspace integration test.
 *
 * Starts a single daemon, then submits tasks from two different
 * project directories. Verifies that:
 * 1. The global socket is at ~/.alix/alixd.sock
 * 2. Tasks from project A write sessions to project A's .alix/
 * 3. Tasks from project B write sessions to project B's .alix/
 * 4. Both use the same daemon (same task registry)
 */
describe("Universal daemon cross-workspace", { timeout: 60000 }, () => {
  const homeDir = mkdtempSync(join(tmpdir(), "daemon-home-"));
  const projectA = mkdtempSync(join(tmpdir(), "daemon-proj-a-"));
  const projectB = mkdtempSync(join(tmpdir(), "daemon-proj-b-"));
  const globalAlix = join(homeDir, ".alix");
  const socketPath = join(globalAlix, "alixd.sock");
  let serverProcess: any = null;

  before(() => {
    // Set up project dirs
    for (const dir of [projectA, projectB]) {
      mkdirSync(join(dir, ".alix", "sessions"), { recursive: true });
      writeFileSync(join(dir, ".alix", "config.json"), JSON.stringify({
        model: { provider: "mock", name: "mock" },
      }));
    }
  });

  after(() => {
    if (serverProcess) try { serverProcess.kill(); } catch { /* ignore */ }
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverJs = join(__dirname, "..", "..", "src", "daemon", "daemon-server.js");
      serverProcess = spawn(process.execPath, [serverJs, "--socket", socketPath, "--cwd", projectA], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: homeDir },
      });
      serverProcess.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      serverProcess.on("error", reject);
      setTimeout(() => reject(new Error("Daemon did not start within 5s")), 5000);
    });
  }

  function submitTask(projectDir: string, task: string, route?: any): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const messages: string[] = [];
      const client = connect(socketPath, () => {
        client.write(JSON.stringify({ command: "run", task, cwd: projectDir, route }) + "\n");
      });
      client.on("data", (data: Buffer) => {
        for (const line of data.toString("utf8").split("\n")) {
          if (!line.trim()) continue;
          messages.push(line);
          try { const m = JSON.parse(line); if (m.type === "session.ended") client.end(); } catch {}
        }
      });
      client.on("error", reject);
      client.on("close", () => resolve(messages));
    });
  }

  it("global socket exists at ~/.alix/alixd.sock", async () => {
    await startDaemon();
    assert.ok(existsSync(socketPath), `socket should exist at ${socketPath}`);
  });

  it("task from project A writes session to project A's .alix/sessions", async () => {
    await submitTask(projectA, "echo hello-a", { kind: "tool", tool: "shell.run", args: { command: "echo hello-a" } });
    const sessionDirs = join(projectA, ".alix", "sessions");
    const dirs = await import("node:fs/promises").then(fs => fs.readdir(sessionDirs));
    assert.ok(dirs.length > 0, "project A should have session dirs");
  });

  it("task from project B writes session to project B's .alix/sessions", async () => {
    await submitTask(projectB, "echo hello-b", { kind: "tool", tool: "shell.run", args: { command: "echo hello-b" } });
    const sessionDirs = join(projectB, ".alix", "sessions");
    const dirs = await import("node:fs/promises").then(fs => fs.readdir(sessionDirs));
    assert.ok(dirs.length > 0, "project B should have session dirs");
  });

  it("task registry is global at ~/.alix/daemon-tasks.json", async () => {
    const registryPath = join(globalAlix, "daemon-tasks.json");
    assert.ok(existsSync(registryPath), `task registry should exist at ${registryPath}`);
    const raw = await import("node:fs/promises").then(fs => fs.readFile(registryPath, "utf-8"));
    const records = JSON.parse(raw);
    assert.ok(Array.isArray(records), "task registry should be an array");
    assert.ok(records.length >= 2, "should have at least 2 task records from both projects");
    // Verify cwd field
    const cwds = records.map((r: any) => r.cwd);
    assert.ok(cwds.includes(projectA), "should include project A cwd");
    assert.ok(cwds.includes(projectB), "should include project B cwd");
  });
});
```

- [ ] **Step 2: Build and run test**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/daemon-universal.test.js 2>&1
```

Expected: 4 tests pass (socket exists, project A sessions, project B sessions, global registry with both cwds).

- [ ] **Step 3: Commit**

```bash
git add tests/daemon/daemon-universal.test.ts
git commit -m "test(daemon): add cross-workspace universal daemon integration test"
```

---

### Task 10: Full build, push, tag

- [ ] **Step 1: Build and run all daemon tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/*.test.js 2>&1
```

Expected: all daemon tests pass (manager, protocol, task-registry, server, universal).

- [ ] **Step 2: Run runtime tests too**

```bash
node --test dist/tests/runtime/*.test.js 2>&1
```

- [ ] **Step 3: Verify detect_changes shows expected files only**

```bash
git diff --stat HEAD
```

Expected files:
- `src/daemon/daemon-manager.ts` (modified)
- `src/daemon/daemon-server.ts` (modified)
- `src/daemon/daemon-types.ts` (modified)
- `src/daemon/task-registry.ts` (modified)
- `src/tui/daemon-client.ts` (modified)
- `src/cli.ts` (maybe)
- `tests/daemon/daemon-manager.test.ts` (modified)
- `tests/daemon/daemon-server.test.ts` (modified)
- `tests/daemon/task-registry.test.ts` (modified)
- `tests/daemon/daemon-universal.test.ts` (new)

- [ ] **Step 4: Push and tag**

```bash
git push
git tag -a m0.25-universal-daemon -m "M0.25 universal daemon: global socket, per-request workspace routing"
git push origin m0.25-universal-daemon
```

---

## Verification checklist

| Check | Command | Expected |
|-------|---------|----------|
| Daemon starts with global socket | `HOME=/tmp/test-home alix daemon start` | `~/.alix/alixd.sock` exists |
| Daemon status in global dir | `cat ~/.alix/daemon.json` | JSON with pid, status |
| Task from any directory works | `cd /any/dir && alix submit "pwd"` | Runs in /any/dir |
| Session logs in project dir | `ls .alix/sessions/` | session directory exists |
| Same daemon, any workspace | Start in project A, `alix tui --daemon` in project B | Connects and runs |
| Task registry global | `cat ~/.alix/daemon-tasks.json` | Records from all projects |
| Older daemon-clients fail gracefully | Connect without `cwd` | Falls back to startup `--cwd` |
| `daemonShellAlias()` still absent | `grep -rn daemonShellAlias src/` | no matches |
