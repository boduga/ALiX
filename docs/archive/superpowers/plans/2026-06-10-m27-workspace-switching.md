# M0.27: Workspace Switching UX — Implementation Plan

**Status:** ✅ Completed (M0.27) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-10-m27-workspace-switching-design.md`
**Builds on:** M0.25 (universal daemon), M0.26 (workspace registry)

**Goal:** Add workspace switching commands to the TUI — `/workspaces`, `/switch <arg>`, `/open <path>`. WorkspaceManager class handles parsing and resolution. TUI loop performs soft re-init on switch.

**Architecture:** WorkspaceManager parses commands and resolves workspace references. The TUI loop delegates to it: if handled, runTui() performs soft re-init (new session, fresh snapshot, updated prompt). The prompt changes from `> ` to `[name] > ` to show active workspace.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tui/workspace-manager.ts` | **Create** | `WorkspaceManager` class, resolution logic, `WorkspaceCommandResult`/`WorkspaceMatch` types |
| `src/tui/store.ts` | **Modify** | Add `sessionDir` to `TuiState` |
| `src/cli/commands/tui.ts` | **Modify** | Wire WorkspaceManager into input loop, add `softReinitWorkspace()`, update prompt to `[name] > ` |
| `tests/tui/workspace-manager.test.ts` | **Create** | 13+ unit tests for parsing, resolution, ambiguity |

---

### Task 1: Create WorkspaceManager

**Files:**
- Create: `src/tui/workspace-manager.ts`

- [ ] **Step 1: Write the WorkspaceManager class**

```typescript
/**
 * workspace-manager.ts — TUI workspace command parsing and resolution.
 *
 * Handles /workspaces, /switch <arg>, /open <path> commands.
 * Delegates resolution to WorkspaceManager; the TUI loop owns
 * the soft re-init lifecycle.
 */

import type { WorkspaceEntry } from "../daemon/workspace-registry.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";

export type WorkspaceMatch =
  | { status: "unique"; workspace: WorkspaceEntry }
  | { status: "ambiguous"; matches: WorkspaceEntry[]; partial: string }
  | { status: "not_found" };

export type WorkspaceCommandResult =
  | { handled: false }
  | { handled: true; changedWorkspace: false; message: string }
  | { handled: true; changedWorkspace: true; message: string; nextCwd: string };

export interface WorkspaceManagerDeps {
  listWorkspaces: () => Promise<WorkspaceEntry[]>;
  recordWorkspaceActivity: (cwd: string) => Promise<void>;
  getWorkspace: (path: string) => Promise<WorkspaceEntry | undefined>;
}

const COMMAND_PREFIXES = ["/workspaces", "/workspace", "/ws"];
const SWITCH_PREFIXES = ["/switch", "/sw"];

/** Parse the command prefix from input. Returns the prefix and arg, or null. */
function parseCommand(input: string): { cmd: string; arg: string } | null {
  const trimmed = input.trim();
  for (const prefix of COMMAND_PREFIXES) {
    if (trimmed === prefix) return { cmd: prefix, arg: "" };
  }
  for (const prefix of SWITCH_PREFIXES) {
    if (trimmed.startsWith(prefix + " ")) return { cmd: prefix, arg: trimmed.slice(prefix.length + 1).trim() };
    if (trimmed === prefix) return { cmd: prefix, arg: "" };
  }
  if (trimmed.startsWith("/open ")) return { cmd: "/open", arg: trimmed.slice(6).trim() };
  return null;
}

/** Resolve a tilde path to the user's home directory. */
function expandTilde(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

/** Check if a string is a positive integer. */
function isNumeric(s: string): boolean {
  return /^\d+$/.test(s);
}

export class WorkspaceManager {
  private lastAmbiguity: { partial: string; matches: WorkspaceEntry[] } | null = null;

  constructor(private readonly deps: WorkspaceManagerDeps) {}

  /** Try to handle input as a workspace command. Returns a result or handled:false. */
  async tryHandleCommand(input: string): Promise<WorkspaceCommandResult> {
    const parsed = parseCommand(input);
    if (!parsed) return { handled: false };

    // /workspaces — list all
    if (COMMAND_PREFIXES.includes(parsed.cmd)) {
      return await this.handleList();
    }

    // /switch <arg>
    if (SWITCH_PREFIXES.includes(parsed.cmd)) {
      if (!parsed.arg) {
        return { handled: true, changedWorkspace: false, message: "Usage: /switch <name|path|number>" };
      }
      return await this.handleSwitch(parsed.arg);
    }

    // /open <path>
    if (parsed.cmd === "/open") {
      if (!parsed.arg) {
        return { handled: true, changedWorkspace: false, message: "Usage: /open <path>" };
      }
      return await this.handleOpen(parsed.arg);
    }

    return { handled: false };
  }

  private async handleList(): Promise<WorkspaceCommandResult> {
    const workspaces = await this.deps.listWorkspaces();
    if (workspaces.length === 0) {
      return { handled: true, changedWorkspace: false, message: "No workspaces registered yet. Submit a task from a project directory to register it." };
    }

    const lines = workspaces.map((w, i) => {
      const icon = w.status === "active" ? "●" : "○";
      const tasks = w.taskCount === 1 ? "1 task" : `${w.taskCount} tasks`;
      return `${i + 1}. ${icon} ${w.name}  ${w.path}  (${tasks})`;
    });

    return {
      handled: true,
      changedWorkspace: false,
      message: `Registered workspaces:\n${lines.join("\n")}`,
    };
  }

  private async handleSwitch(arg: string): Promise<WorkspaceCommandResult> {
    // 1. Numeric selection from last ambiguity
    if (isNumeric(arg) && this.lastAmbiguity) {
      const idx = parseInt(arg, 10) - 1;
      if (idx >= 0 && idx < this.lastAmbiguity.matches.length) {
        const ws = this.lastAmbiguity.matches[idx];
        this.lastAmbiguity = null;
        return {
          handled: true,
          changedWorkspace: true,
          message: `Switched to ${ws.name}  ${ws.path}`,
          nextCwd: ws.path,
        };
      }
      this.lastAmbiguity = null;
      return { handled: true, changedWorkspace: false, message: `Invalid selection: ${arg}. No ambiguity cache matches.` };
    }

    // 2. Resolve the argument against registry
    const match = await this.resolveWorkspace(arg);

    if (match.status === "unique") {
      this.lastAmbiguity = null;
      return {
        handled: true,
        changedWorkspace: true,
        message: `Switched to ${match.workspace.name}  ${match.workspace.path}`,
        nextCwd: match.workspace.path,
      };
    }

    if (match.status === "ambiguous") {
      this.lastAmbiguity = { partial: arg, matches: match.matches };
      const lines = match.matches.map((w, i) =>
        `[${i + 1}] ${w.name}  ${w.path}`
      );
      return {
        handled: true,
        changedWorkspace: false,
        message: `Ambiguous workspace: ${arg}\n${lines.join("\n")}\n\nUse /switch 1, /switch 2, or a longer path.`,
      };
    }

    // not_found
    this.lastAmbiguity = null;
    return {
      handled: true,
      changedWorkspace: false,
      message: `Workspace not found: ${arg}\nUse /workspaces to list registered workspaces, or /open <path> to add one.`,
    };
  }

  private async handleOpen(rawPath: string): Promise<WorkspaceCommandResult> {
    const expanded = expandTilde(rawPath);
    const resolved = resolve(expanded);

    if (!existsSync(resolved)) {
      return { handled: true, changedWorkspace: false, message: `Path does not exist: ${resolved}` };
    }

    // Verify it's a directory
    const stat = await import("node:fs/promises").then(fs => fs.stat(resolved));
    if (!stat.isDirectory()) {
      return { handled: true, changedWorkspace: false, message: `Not a directory: ${resolved}` };
    }

    // Register workspace activity (creates/upserts registry entry)
    await this.deps.recordWorkspaceActivity(resolved);

    return {
      handled: true,
      changedWorkspace: true,
      message: `Opened workspace: ${basename(resolved)}  ${resolved}`,
      nextCwd: resolved,
    };
  }

  /**
   * Resolve a workspace argument against the registry.
   *
   * Resolution order:
   * 1. Exact path match
   * 2. Exact name match (must be unique)
   * 3. Unique path suffix
   * 4. Ambiguous / not found
   */
  private async resolveWorkspace(arg: string): Promise<WorkspaceMatch> {
    const workspaces = await this.deps.listWorkspaces();
    if (workspaces.length === 0) return { status: "not_found" };

    // 1. Exact path match
    const byPath = workspaces.find(w => w.path === arg);
    if (byPath) return { status: "unique", workspace: byPath };

    // 2. Exact name match — must be unique
    const byName = workspaces.filter(w => w.name === arg);
    if (byName.length === 1) return { status: "unique", workspace: byName[0] };
    if (byName.length > 1) return { status: "ambiguous", matches: byName, partial: arg };

    // 3. Unique path suffix — match entries where path ends with "/" + arg
    const bySuffix = workspaces.filter(w => w.path.endsWith("/" + arg));
    if (bySuffix.length === 1) return { status: "unique", workspace: bySuffix[0] };
    if (bySuffix.length > 1) return { status: "ambiguous", matches: bySuffix, partial: arg };

    // 4. Not found
    return { status: "not_found" };
  }
}

/**
 * Generate a prompt label for the current workspace.
 * Truncated to maxLen characters.
 */
export function promptLabel(cwd: string, workspaceName?: string, workspacePath?: string): string {
  const raw = workspaceName?.trim()
    ?? basename(workspacePath || cwd);
  const truncated = raw.length > 28 ? raw.slice(0, 26) + "…" : raw;
  return `[${truncated}] > `;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tui/workspace-manager.ts
git commit -m "feat(tui): add WorkspaceManager class with /workspaces /switch /open commands"
```

---

### Task 2: Add sessionDir to TuiState

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Add sessionDir to TuiState interface**

Find the `sessionId` field in `TuiState` and add `sessionDir` next to it:

```typescript
  sessionId: string;
  sessionDir?: string;   // ← NEW: tracks current session directory for workspace re-init
```

- [ ] **Step 2: Add setter method**

```typescript
  setSessionDir(dir: string): void {
    this.state.sessionDir = dir;
    this.notify();
  }
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tui/store.ts
git commit -m "feat(tui): add sessionDir to TuiState for workspace re-init tracking"
```

---

### Task 3: Wire WorkspaceManager into runTui()

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add imports**

```typescript
import { WorkspaceManager, promptLabel } from "../../tui/workspace-manager.js";
// Already imported: randomUUID, mkdir, join, createInterface, Tui, EventLog,
// loadConfig, runTask, taskRouter, executeRoute, LocalRuntimeExecutor, RuntimeContext
```

- [ ] **Step 2: Remove the old `> ` prompt line**

Find `rl.setPrompt("> ");` and replace nearby lines to use the workspace-aware prompt:

```typescript
  rl.setPrompt(promptLabel(cwd, snapshot?.workspaceName, snapshot?.workspacePath));
```

This replaces the old `rl.setPrompt("> ");` line.

- [ ] **Step 3: Initialize WorkspaceManager after Tui init**

After `const tui = new Tui({...})` and before `const mode = opts.sessionMode`, add:

```typescript
  // Workspace manager for /workspaces, /switch, /open commands
  const { listWorkspaces, recordWorkspaceActivity, getWorkspace } = await import("../../daemon/workspace-registry.js");
  const workspaceManager = new WorkspaceManager({ listWorkspaces, recordWorkspaceActivity, getWorkspace });
```

- [ ] **Step 4: Create the workspaceManager variable at module scope (like rl)**

Add next to the `let rl` declaration at the top:

```typescript
let rl: RLInterface | null = null;
```

- [ ] **Step 5: Update the prompt after creating readline**

Right after `rl.setPrompt("> ");`, change to set the initial prompt with workspace name:

```typescript
  const wsName = snapshot?.workspaceName ?? basename(cwd);
  rl.setPrompt(promptLabel(cwd, wsName, snapshot?.workspacePath));
```

- [ ] **Step 6: Add the workspace command check before task submission**

In the main while loop, after the echoTask call and before the `if (daemonMode)` check, add:

```typescript
      // Check for workspace commands
      const wsResult = await workspaceManager.tryHandleCommand(task);
      if (wsResult.handled) {
        tui.appendOutput(wsResult.message + "\n", false);
        if (wsResult.changedWorkspace && wsResult.nextCwd) {
          await softReinitWorkspace(wsResult.nextCwd);
        }
        continue;
      }
```

- [ ] **Step 7: Add the softReinitWorkspace function before runTui**

Add after `echoTask` and before `runTui`:

```typescript
/**
 * Soft re-init after workspace switch.
 * Creates a fresh session, event log, and snapshot in the new workspace.
 */
async function softReinitWorkspace(nextCwd: string, tui: Tui, tuiLog: EventLog, tuiStore: any, rl: RLInterface): Promise<void> {
  const { randomBytes } = await import("node:crypto");
  const { join } = await import("node:path");
  const { mkdir } = await import("node:fs/promises");
  const { EventLog } = await import("../../events/event-log.js");
  const { buildRuntimeSnapshot, applySnapshotToStore } = await import("../../tui/runtime-snapshot.js");
  const { basename } = await import("node:path");
  const { promptLabel } = await import("../../tui/workspace-manager.js");

  // 1. Fresh session
  const sessionId = `tui_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const sessionDir = join(nextCwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  // 2. Fresh event log (update the outer tuiLog)
  tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  // 3. Fresh snapshot — reads new workspace's .alix/
  const snapshot = await buildRuntimeSnapshot(nextCwd);
  if (snapshot) {
    applySnapshotToStore(tuiStore, snapshot);
  }

  // 4. Update Tui internals
  tui.getStore().setSessionId(sessionId);
  tui.getStore().setSessionDir(sessionDir);

  // 5. Update prompt
  const wsName = snapshot?.workspaceName ?? basename(nextCwd);
  rl.setPrompt(promptLabel(nextCwd, wsName, snapshot?.workspacePath));
  rl.prompt(true);
}
```

**Important:** Because `tuiLog` and `tuiStore` are local variables in `runTui()` and `softReinitWorkspace` needs to mutate them, this function must be defined inside `runTui()` where those variables are in scope. Place it after the config loading and snapshot setup, before the main while loop.

- [ ] **Step 8: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire WorkspaceManager into input loop, add softReinitWorkspace, update prompt to [name] >"
```

---

### Task 4: WorkspaceManager unit tests

**Files:**
- Create: `tests/tui/workspace-manager.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceManager, promptLabel, type WorkspaceManagerDeps } from "../../src/tui/workspace-manager.js";
import type { WorkspaceEntry } from "../../src/daemon/workspace-registry.js";

describe("WorkspaceManager", () => {
  let ws1: WorkspaceEntry;
  let ws2: WorkspaceEntry;
  let ws3: WorkspaceEntry;
  let deps: WorkspaceManagerDeps;
  let recordedActivity: string | null;

  before(() => {
    ws1 = { path: "/home/user/Projects/Monolith", name: "Monolith", lastUsed: "2026-06-10T12:00:00Z", taskCount: 42, status: "active" };
    ws2 = { path: "/home/user/Projects/alix-test", name: "alix-test", lastUsed: "2026-06-09T10:00:00Z", taskCount: 5, status: "active" };
    ws3 = { path: "/home/user/Projects/client-nas/Monolith", name: "Monolith", lastUsed: "2026-06-08T08:00:00Z", taskCount: 3, status: "idle" };
  });

  beforeEach(() => {
    recordedActivity = null;
    deps = {
      listWorkspaces: async () => [ws1, ws2, ws3],
      recordWorkspaceActivity: async (cwd: string) => { recordedActivity = cwd; },
      getWorkspace: async (path: string) => [ws1, ws2, ws3].find(w => w.path === path),
    };
  });

  // ── Command parsing ──

  it("returns handled:false for non-command input", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("list files");
    assert.equal(r.handled, false);
  });

  it("returns handled:false for empty input", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("");
    assert.equal(r.handled, false);
  });

  // ── /workspaces ──

  it("/workspaces lists all registered workspaces", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/workspaces");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("Monolith"));
    assert.ok((r as any).message.includes("alix-test"));
  });

  it("/ws alias lists workspaces", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/ws");
    assert.equal(r.handled, true);
  });

  it("/workspace alias lists workspaces", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/workspace");
    assert.equal(r.handled, true);
  });

  // ── /switch — exact path ──

  it("/switch exact path resolves unique", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch /home/user/Projects/Monolith");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/Monolith");
  });

  // ── /switch — exact name (unique) ──

  it("/switch unique name resolves", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch alix-test");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/alix-test");
  });

  // ── /switch — ambiguous name ──

  it("/switch ambiguous name shows choices", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch Monolith");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("Ambiguous"));
    assert.ok((r as any).message.includes("[1]"));
    assert.ok((r as any).message.includes("[2]"));
  });

  // ── /switch — numeric from cache ──

  it("/switch 1 uses cached ambiguity", async () => {
    const mgr = new WorkspaceManager(deps);

    // First call creates ambiguity cache
    await mgr.tryHandleCommand("/switch Monolith");

    // Second call uses cached selection
    const r = await mgr.tryHandleCommand("/switch 1");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.ok((r as any).nextCwd);
  });

  it("/switch 2 selects second match from cache", async () => {
    const mgr = new WorkspaceManager(deps);
    await mgr.tryHandleCommand("/switch Monolith");
    const r = await mgr.tryHandleCommand("/switch 2");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.ok((r as any).nextCwd);
  });

  it("/switch 3 with only 2 cached matches fails", async () => {
    const mgr = new WorkspaceManager(deps);
    await mgr.tryHandleCommand("/switch Monolith");
    const r = await mgr.tryHandleCommand("/switch 3");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
  });

  it("numeric switch without cache fails", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch 1");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
  });

  // ── /switch — path suffix ──

  it("/switch unique path suffix resolves", async () => {
    // Create a workspace with a path that has a unique suffix
    const suffixDeps: WorkspaceManagerDeps = {
      listWorkspaces: async () => [
        ws1,
        { ...ws3, path: "/home/user/Projects/client-nas/Monolith" },
      ],
      recordWorkspaceActivity: deps.recordWorkspaceActivity,
      getWorkspace: deps.getWorkspace,
    };
    const mgr = new WorkspaceManager(suffixDeps);
    const r = await mgr.tryHandleCommand("/switch client-nas/Monolith");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/client-nas/Monolith");
  });

  // ── /switch — not found ──

  it("/switch nonexistent workspace returns not_found", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch nonexistent");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
  });

  it("/switch without arg shows usage", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("Usage"));
  });

  // ── /switch — empty workspaces ──

  it("/switch returns not_found when no workspaces", async () => {
    const emptyDeps: WorkspaceManagerDeps = {
      listWorkspaces: async () => [],
      recordWorkspaceActivity: deps.recordWorkspaceActivity,
      getWorkspace: deps.getWorkspace,
    };
    const mgr = new WorkspaceManager(emptyDeps);
    const r = await mgr.tryHandleCommand("/switch foo");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("not found"));
  });

  // ── /open ──

  it("/open with nonexistent path returns error", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/open /nonexistent/path");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("does not exist"));
  });

  it("/open without arg shows usage", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/open");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, false);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("/open with existing dir records activity and switches", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ws-open-"));
    try {
      const mgr = new WorkspaceManager(deps);
      const r = await mgr.tryHandleCommand(`/open ${tmpDir}`);
      assert.equal(r.handled, true);
      assert.equal(r.changedWorkspace, true);
      assert.equal((r as any).nextCwd, tmpDir);
      assert.equal(recordedActivity, tmpDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── /sw alias ──

  it("/sw alias resolves switch", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/sw alix-test");
    assert.equal(r.handled, true);
    assert.equal(r.changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/alix-test");
  });
});

describe("promptLabel", () => {
  it("uses workspaceName when available", () => {
    assert.equal(promptLabel("/a/b", "Monolith"), "[Monolith] > ");
  });

  it("falls back to basename of workspacePath", () => {
    assert.equal(promptLabel("/a/b", undefined, "/home/user/Projects/Foo"), "[Foo] > ");
  });

  it("falls back to basename of cwd", () => {
    assert.equal(promptLabel("/home/user/Projects/MyApp"), "[MyApp] > ");
  });

  it("truncates long names to 28 chars", () => {
    const longName = "a".repeat(50);
    const result = promptLabel("/a", longName);
    assert.ok(result.length < 40, "should truncate long name");
    assert.ok(result.includes("…"), "should include ellipsis");
  });

  it("handles empty workspaceName", () => {
    assert.equal(promptLabel("/test", "   "), "[test] > ");
  });
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/tui/workspace-manager.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/workspace-manager.test.ts
git commit -m "test(tui): add WorkspaceManager unit tests for command parsing, resolution, ambiguity"
```

---

### Task 5: Build, push, tag

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/*.test.js dist/tests/runtime/*.test.js dist/tests/integration/smoke.test.js dist/tests/tui/workspace-manager.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 2: Verify diff**

```bash
git diff --stat HEAD~4..HEAD
```

Expected files:
- `src/tui/workspace-manager.ts` (new)
- `src/tui/store.ts` (modified)
- `src/cli/commands/tui.ts` (modified)
- `tests/tui/workspace-manager.test.ts` (new)

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.27-workspace-switching -m "M0.27 workspace switching UX: /workspaces /switch /open commands with WorkspaceManager"
git push origin m0.27-workspace-switching
```

---

## Verification checklist

| Check | Command | Expected |
|-------|---------|----------|
| `/workspaces` lists entries | Start TUI, type `/workspaces` | Formatted list of workspaces |
| `/switch <unique-name>` switches | `/switch alix-test` | `[alix-test] > ` prompt |
| `/switch <ambig>` shows choices | `/switch Monolith` | Lists [1] and [2] |
| `/switch 1` uses cache | After ambiguity, `/switch 1` | Switches to first match |
| `/open <existing-dir>` registers | `/open /tmp/test-dir` | Switches, prompts `[test-dir] > ` |
| `/open <nonexistent>` errors | `/open /no/such/path` | "Path does not exist" |
| Non-command passes through | `list files` | Executes as task |
| Prompt shows workspace | After switch | `[name] > ` displayed |
| Soft re-init creates new session | After switch | New `tui_`-prefixed session dir |
