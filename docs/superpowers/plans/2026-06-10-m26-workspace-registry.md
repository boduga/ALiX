# M0.26: Workspace Registry — Implementation Plan

**Status:** ✅ Completed (M0.26) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-10-m26-workspace-registry-design.md`
**Builds on:** M0.25 (universal daemon with global `~/.alix/` and per-request `cwd`)

**Goal:** Give the universal daemon workspace memory via `~/.alix/workspaces.json`. Auto-register every workspace that submits a task, display workspace identity in the TUI daemon panel and welcome banner.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/daemon/workspace-registry.ts` | **Create** | `WorkspaceEntry` type, `recordWorkspaceActivity()`, `listWorkspaces()`, `getCurrentWorkspace()` |
| `src/daemon/daemon-server.ts` | **Modify** | Call `recordWorkspaceActivity()` after task creation |
| `src/tui/store.ts` | **Modify** | Add `workspaceName`, `workspacePath`, `recentWorkspaces` to `TuiState` |
| `src/tui/runtime-snapshot.ts` | **Modify** | Read workspace registry from `~/.alix/`, populate workspace fields |
| `src/tui/panel-renderer.ts` | **Modify** | Show workspace name + path in daemon panel |
| `src/cli/commands/tui.ts` | **Modify** | Show workspace info in welcome banner |
| `tests/daemon/workspace-registry.test.ts` | **Create** | Unit tests for workspace registry |
| `tests/daemon/daemon-server.test.ts` | **Modify** | One test verifying workspace registry is written |

---

### Task 1: Create workspace-registry.ts

**Files:**
- Create: `src/daemon/workspace-registry.ts`

- [ ] **Step 1: Write the workspace registry module**

```typescript
/**
 * workspace-registry.ts — Auto-populated workspace registry for the
 * universal daemon. Lives at ~/.alix/workspaces.json.
 *
 * Workspaces are auto-registered when the daemon receives a run request.
 * No manual registration needed.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type WorkspaceStatus = "active" | "idle";

export type WorkspaceEntry = {
  path: string;
  name: string;
  lastUsed: string;    // ISO timestamp
  taskCount: number;
  status: WorkspaceStatus;
};

const WORKSPACES_PATH = join(homedir(), ".alix", "workspaces.json");

/** Load workspace registry from disk. Returns [] if file doesn't exist. */
export async function listWorkspaces(): Promise<WorkspaceEntry[]> {
  try {
    const raw = await readFile(WORKSPACES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Find a specific workspace by path. */
export async function getWorkspace(path: string): Promise<WorkspaceEntry | undefined> {
  const workspaces = await listWorkspaces();
  return workspaces.find(w => w.path === path);
}

/**
 * Auto-register workspace activity.
 * Call this every time the daemon receives a run request.
 * Upserts the entry, increments taskCount, marks stale actives as idle.
 */
export async function recordWorkspaceActivity(cwd: string): Promise<void> {
  let workspaces = await listWorkspaces();
  const now = new Date().toISOString();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const existing = workspaces.find(w => w.path === cwd);
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

  const tmp = WORKSPACES_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(workspaces, null, 2), "utf-8");
  await rename(tmp, WORKSPACES_PATH);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/workspace-registry.ts
git commit -m "feat(daemon): add workspace registry with auto-registration on task submission"
```

---

### Task 2: Wire workspace registration into daemon server

**Files:**
- Modify: `src/daemon/daemon-server.ts`

- [ ] **Step 1: Add import and call in handleCommand**

Add after imports:

```typescript
import { recordWorkspaceActivity } from "./workspace-registry.js";
```

In `handleCommand`, after the task registry `create()` call and before `taskQueue.push()`, add:

```typescript
    // Auto-register the workspace
    recordWorkspaceActivity(requestCwd).catch(() => {});
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "feat(daemon): auto-register workspace on each run request"
```

---

### Task 3: Add workspace fields to TuiState

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Add workspace fields to the state interface**

Add after the `showDashboard` field:

```typescript
  workspaceName?: string;
  workspacePath?: string;
  recentWorkspaces?: { path: string; name: string; lastUsed: string; taskCount: number; status: string }[];
```

- [ ] **Step 2: Add setter methods**

Add after `toggleDashboard()`:

```typescript
  setWorkspaceInfo(name: string, path: string): void {
    this.state.workspaceName = name;
    this.state.workspacePath = path;
    this.notify();
  }

  setRecentWorkspaces(workspaces: { path: string; name: string; lastUsed: string; taskCount: number; status: string }[]): void {
    this.state.recentWorkspaces = workspaces;
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
git commit -m "feat(tui): add workspace name, path, and recent workspaces to store"
```

---

### Task 4: Update runtime-snapshot to read workspace registry

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Add workspace fields to TuiRuntimeSnapshot**

```typescript
export interface TuiRuntimeSnapshot {
  // ... existing fields ...
  workspaceName?: string;
  workspacePath?: string;
  recentWorkspaces?: { path: string; name: string; lastUsed: string; taskCount: number; status: string }[];
}
```

- [ ] **Step 2: Populate workspace fields in buildRuntimeSnapshot**

After the daemon block (after `snapshot.daemonHeartbeatAge`), add:

```typescript
    // Workspace registry
    const { listWorkspaces, getWorkspace } = await import("../daemon/workspace-registry.js");
    const currentWorkspace = await getWorkspace(cwd);
    if (currentWorkspace) {
      snapshot.workspaceName = currentWorkspace.name;
      snapshot.workspacePath = currentWorkspace.path;
    }
    const allWorkspaces = await listWorkspaces();
    snapshot.recentWorkspaces = allWorkspaces.slice(0, 5).map(w => ({
      path: w.path, name: w.name, lastUsed: w.lastUsed,
      taskCount: w.taskCount, status: w.status,
    }));
```

- [ ] **Step 3: Apply to store in applySnapshotToStore**

```typescript
  store.setWorkspaceInfo(snapshot.workspaceName ?? "", snapshot.workspacePath ?? "");
  store.setRecentWorkspaces(snapshot.recentWorkspaces ?? []);
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tui/runtime-snapshot.ts
git commit -m "feat(tui): read workspace registry in runtime snapshot"
```

---

### Task 5: Show workspace in daemon panel

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Update daemon panel rendering**

Replace the daemon panel's first two lines:

```typescript
  if (s.activePanel === "daemon") {
    const ws = s.workspaceName ? ` — ${s.workspaceName}` : "";
    buf.push(`── Daemon${ws} ──────────────────────────`);
    buf.push(`Status:  ${s.daemonRunning ? "● running" : "○ stopped"}`);
    if (s.workspacePath) {
      buf.push(`Path:    ${s.workspacePath}`);
    }
```

Add after the existing daemon task rendering, before the `Events:` line:

```typescript
    if (s.recentWorkspaces && s.recentWorkspaces.length > 1) {
      buf.push("── Recent Workspaces ────────────────────");
      for (const w of s.recentWorkspaces.slice(0, 4)) {
        if (w.path === s.workspacePath) continue; // skip current
        const icon = w.status === "active" ? "●" : "○";
        buf.push(`  ${icon} ${w.name} (${w.taskCount} tasks)`);
      }
    }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tui/panel-renderer.ts
git commit -m "feat(tui): show workspace name and recent workspaces in daemon panel"
```

---

### Task 6: Show workspace in TUI welcome banner

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add workspace line to welcome text**

Find the welcome text block and add after the daemon mode line:

```typescript
  // Welcome text
  tui.appendOutput("ALiX TUI - Interactive Session", false);
  const execMode = daemonMode ? "daemon" : "direct";
  tui.appendOutput(`Execution mode: ${execMode} | Session: ${mode}${daemonInfo}`, false);
  const wsName = snapshot?.workspaceName ?? cwd.split("/").pop() ?? "";
  tui.appendOutput(`Workspace: ${wsName}`, false);
  if (daemonMode) tui.appendOutput("Daemon mode: policy handled by daemon runtime gate.", false);
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): show workspace name in welcome banner"
```

---

### Task 7: Workspace registry unit tests

**Files:**
- Create: `tests/daemon/workspace-registry.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordWorkspaceActivity, listWorkspaces, getWorkspace } from "../../src/daemon/workspace-registry.js";

describe("WorkspaceRegistry", () => {
  let origHome: string | undefined;
  let testHome: string;

  before(() => {
    origHome = process.env.HOME;
    testHome = mkdtempSync(join(tmpdir(), "ws-reg-"));
    process.env.HOME = testHome;
    mkdirSync(join(testHome, ".alix"), { recursive: true });
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("returns empty list when no file exists", async () => {
    const ws = await listWorkspaces();
    assert.deepEqual(ws, []);
  });

  it("creates a workspace entry on first activity", async () => {
    await recordWorkspaceActivity("/tmp/project-alpha");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 1);
    assert.equal(ws[0].path, "/tmp/project-alpha");
    assert.equal(ws[0].name, "project-alpha");
    assert.equal(ws[0].taskCount, 1);
    assert.equal(ws[0].status, "active");
  });

  it("increments taskCount on repeat activity", async () => {
    await recordWorkspaceActivity("/tmp/project-alpha");
    await recordWorkspaceActivity("/tmp/project-alpha");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 1);
    assert.equal(ws[0].taskCount, 3); // 1 from create + 2 from this test
  });

  it("registers a second workspace", async () => {
    await recordWorkspaceActivity("/tmp/project-beta");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 2);
  });

  it("sorts by lastUsed descending (most recent first)", async () => {
    await new Promise(r => setTimeout(r, 5));
    await recordWorkspaceActivity("/tmp/project-alpha"); // touch alpha
    const ws = await listWorkspaces();
    assert.equal(ws[0].name, "project-alpha"); // most recent
    assert.equal(ws[1].name, "project-beta");
  });

  it("getWorkspace returns specific workspace", async () => {
    const w = await getWorkspace("/tmp/project-beta");
    assert.ok(w);
    assert.equal(w!.name, "project-beta");
  });

  it("getWorkspace returns undefined for unknown path", async () => {
    const w = await getWorkspace("/tmp/nonexistent");
    assert.equal(w, undefined);
  });

  it("marks old workspaces as idle", async () => {
    // Force a workspace to appear old by setting lastUsed far in the past
    const ws = await listWorkspaces();
    ws[ws.length - 1].lastUsed = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const tmp = join(testHome, ".alix", "workspaces.json") + ".tmp";
    const { writeFile, rename } = await import("node:fs/promises");
    await writeFile(tmp, JSON.stringify(ws, null, 2), "utf-8");
    await rename(tmp, join(testHome, ".alix", "workspaces.json"));

    // Now record activity in a fresh workspace — this triggers idle sweep
    await recordWorkspaceActivity("/tmp/project-gamma");

    const updated = await listWorkspaces();
    const oldEntry = updated.find(w => w.name === "project-beta");
    assert.ok(oldEntry);
    assert.equal(oldEntry!.status, "idle", "workspace older than 24h should be idle");
  });
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/workspace-registry.test.js 2>&1
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/daemon/workspace-registry.test.ts
git commit -m "test(daemon): add workspace registry unit tests"
```

---

### Task 8: Build, push, tag

- [ ] **Step 1: Build and run all daemon tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/*.test.js 2>&1
```

Expected: all daemon tests pass (new workspace-registry tests + existing).

- [ ] **Step 2: Run runtime and integration tests**

```bash
node --test dist/tests/runtime/*.test.js dist/tests/integration/smoke.test.js 2>&1
```

- [ ] **Step 3: Verify diff**

```bash
git diff --stat HEAD
```

Expected files:
- `src/daemon/workspace-registry.ts` (new)
- `src/daemon/daemon-server.ts` (modified)
- `src/tui/store.ts` (modified)
- `src/tui/runtime-snapshot.ts` (modified)
- `src/tui/panel-renderer.ts` (modified)
- `src/cli/commands/tui.ts` (modified)
- `tests/daemon/workspace-registry.test.ts` (new)

- [ ] **Step 4: Push and tag**

```bash
git push
git tag -a m0.26-workspace-registry -m "M0.26 workspace registry: auto-populated ~/.alix/workspaces.json, TUI workspace display"
git push origin m0.26-workspace-registry
```

---

## Verification checklist

| Check | Command | Expected |
|-------|---------|----------|
| Registry created after first task | Submit task from any dir | `~/.alix/workspaces.json` exists |
| Workspace name derived from path | `recordWorkspaceActivity("/a/b/project")` | name = "project" |
| taskCount increments | 3 tasks from same dir | taskCount = 3 |
| Workspaces sorted by recency | List after touching oldest | Most recent first |
| Old workspaces idle after 24h | Check stale entry status | status = "idle" |
| TUI shows workspace in daemon panel | `alix tui --daemon` | `── Daemon — name ──` |
| TUI shows workspace in welcome | `alix tui` | `Workspace: name` |
| No manual registration needed | `grep -rn "workspace add" src/` | No matches |
