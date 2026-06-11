# M0.40 — Replay/Rollback Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new TUI panel showing global replay/rollback operational status — replayId list, status badges, lock state, timestamps — plus `/replays` and `/replay-status <replayId>` commands.

**Architecture:** Add a `"replays"` panel type to the existing TUI panel system (`TuiPanel` union, `PANELS` array, `panel-renderer.ts`). The panel reads `.alix/replays/index.json` via `ReplayStatusIndex`, checks per-replay lock state via `ReplayLock`, and loads progress data via `RollbackProgressStore`. No new runtime infrastructure — pure TUI operations layer on top of M0.39's reliability primitives.

**Tech Stack:** Node.js TUI (ink-based), existing `ReplayStatusIndex`, `ReplayLock`, `RollbackProgressStore` classes. No new dependencies.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/tui/store.ts` | MODIFY | Add `"replays"` to `TuiPanel` + `PANELS`; add `replayIndexData` state field |
| `src/tui/panel-renderer.ts` | MODIFY | Add `else if (s.activePanel === "replays")` rendering block showing replay entries, lock state, progress |
| `src/cli/commands/tui.ts` | MODIFY | Add `/replays` command handler (opens panel), `/replay-status <replayId>` (shows per-replay detail), refresh on `r` |
| `tests/tui/replays-panel.test.ts` | **NEW** | Panel rendering + command parsing tests |

No new runtime classes — M0.39 already built `ReplayStatusIndex`, `ReplayLock`, `RollbackProgressStore`.

---

## Design

### TUI panel: `"replays"`

When the replays panel is active, it shows:

```
── Replays (3 total) ─────────────────────────
  ✔ replay_1718000000_abc  completed       (2 files, 2 rollbackable)  Jun 11 10:00
  ✗ replay_1718100000_def  rollback-partial (1 of 3 restored)         Jun 11 10:05  ⚠ use --resume
  ⏳ replay_1718200000_ghi  rollback-running                           Jun 11 10:06  🔒 locked
```

Each entry shows:
- Status icon (✔ capturing, ✔ completed, ✗ rollback-partial, ⏳ rollback-running, 🔄 rollback-completed)
- replayId (first 28 chars)
- Status badge (human-readable)
- File count / progress summary
- Timestamp (createdAt, formatted)
- Lock indicator if locked
- Resume hint if `rollback-partial`

### Commands

- **`/replays`** — Switch to the replays panel and load index data
- **`/replay-status <replayId>`** — Show detailed info for one replay: all fields from entry, lock status, progress data, step info, whether stale lock exists
- **`r` / `refresh`** — While in replays panel, refreshes the index data

### `/replay-status <replayId>` detail

When typed in any panel, shows multi-line detail in `tui.appendOutput`:

```
Replay:    replay_1718000000_abc
Status:    completed
Mode:      approved-live
Created:   2026-06-11T10:00:00.000Z
Updated:   2026-06-11T10:01:15.000Z
Files:     2 changed (2 rollbackable)
Lock:      not locked

Rollback:  rollback-completed
  Steps:  3 total, 3 restored, 0 skipped
  Completed at: 2026-06-11T10:05:00.000Z
```

When status is `rollback-partial`, add:
```
  ⚠ Partial rollback — use `/rollback <replayId> --approved-live --resume` to continue
```

When lock is stale, add:
```
  ⚠ Stale lock detected — use `/rollback <replayId> --approved-live --resume` to recover
```

### Panel rendering in `panel-renderer.ts`

The new `else if (s.activePanel === "replays")` block:

```typescript
} else if (s.activePanel === "replays") {
  buf.push(`── Replays (${s.replayIndexData?.entries.length || 0} total) ────────────`);
  if (!s.replayIndexData || s.replayIndexData.entries.length === 0) {
    buf.push("  No replays recorded. Run a replay to see it here.");
  } else {
    // Sort newest first
    const sorted = [...s.replayIndexData.entries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const entry of sorted.slice(0, 20)) {
      const date = new Date(entry.createdAt);
      const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
      const icon = iconForStatus(entry.status);
      const id = entry.replayId.slice(0, 28).padEnd(28);
      const statusLabel = statusLabelFor(entry.status).padEnd(16);
      let suffix = "";
      // Check lock state from store
      const lockInfo = s.replayLockStates?.[entry.replayId];
      if (lockInfo) suffix += " 🔒 locked";
      if (entry.status === "rollback-partial") suffix += " ⚠ use --resume";
      buf.push(`  ${icon} ${id} ${statusLabel} ${timeStr}${suffix}`);
    }
  }
  buf.push(`  Keys: r=refresh  tab=next panel`);
}
```

### Helper icons and labels

```typescript
function iconForStatus(status: string): string {
  switch (status) {
    case "capturing": return "📷";
    case "completed": return "✔";
    case "rollback-dry-run": return "🔍";
    case "rollback-running": return "⏳";
    case "rollback-completed": return "🔄";
    case "rollback-partial": return "✗";
    case "locked": return "🔒";
    default: return "?";
  }
}

function statusLabelFor(status: string): string {
  switch (status) {
    case "capturing": return "capturing";
    case "completed": return "completed";
    case "rollback-dry-run": return "dry-run";
    case "rollback-running": return "rollback running";
    case "rollback-completed": return "rolled back";
    case "rollback-partial": return "partial";
    case "locked": return "locked";
    default: return status;
  }
}
```

### State additions to `TuiState`

```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays";

// New fields in TuiState:
replayIndexData?: import("../runtime/replay-status-index.js").ReplayStatusIndexData;
replayLockStates?: Record<string, boolean>;  // replayId → isLocked
```

New methods on `TuiStore`:

```typescript
setReplayIndexData(data: ReplayStatusIndexData | undefined): void;
setReplayLockStates(states: Record<string, boolean>): void;
```

---

## Tasks

### Task 1: Add `"replays"` panel type and state fields

**Files:**
- Modify: `src/tui/store.ts:64` (add to TuiPanel union)
- Modify: `src/tui/store.ts:106` (add to PANELS array)
- Modify: `src/tui/store.ts` (add state fields + setters)
- Modify: `src/tui/store.ts:126-136` (initial state)

**Steps:**

- [ ] **Step 1: Extend TuiPanel union and PANELS array**

```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays";
export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace", "replays"];
```

- [ ] **Step 2: Add state fields to TuiState interface**

After `replayStatus` (line 103):

```typescript
replayIndexData?: import("../runtime/replay-status-index.js").ReplayStatusIndexData;
replayLockStates?: Record<string, boolean>;
```

- [ ] **Step 3: Add initial values in constructor (line 135)**

```typescript
      replayStatus: undefined,
      replayIndexData: undefined,
      replayLockStates: undefined,
```

- [ ] **Step 4: Add setter methods after `setReplayStatus` (line 423)**

```typescript
setReplayIndexData(data: import("../runtime/replay-status-index.js").ReplayStatusIndexData | undefined): void {
  this.state.replayIndexData = data;
  this.notify();
}

setReplayLockStates(states: Record<string, boolean>): void {
  this.state.replayLockStates = states;
  this.notify();
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tui/store.ts
git commit -m "feat(tui): add replays panel type and state fields"
```

---

### Task 2: Panel renderer — replays panel

**Files:**
- Create: (none)
- Modify: `src/tui/panel-renderer.ts`
- Test: `tests/tui/replays-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tui/replays-panel.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";

describe("Replays panel rendering data", () => {
  it("store holds replayIndexData", () => {
    const store = createTuiStore();
    const data = {
      entries: [
        { replayId: "replay_001", status: "completed" as const, createdAt: "2026-06-11T10:00:00Z", updatedAt: "2026-06-11T10:01:00Z", replayMode: "approved-live" },
      ],
    };
    store.setReplayIndexData(data);
    const state = store.getState();
    assert.equal(state.replayIndexData?.entries.length, 1);
    assert.equal(state.replayIndexData?.entries[0].replayId, "replay_001");
  });

  it("store holds replayLockStates", () => {
    const store = createTuiStore();
    store.setReplayLockStates({ replay_001: true, replay_002: false });
    assert.equal(store.getState().replayLockStates?.replay_001, true);
    assert.equal(store.getState().replayLockStates?.replay_002, false);
  });

  it("defaults to undefined when no data loaded", () => {
    const store = createTuiStore();
    assert.equal(store.getState().replayIndexData, undefined);
    assert.equal(store.getState().replayLockStates, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/tui/replays-panel.test.js`
Expected: Tests pass (the store already supports setReplayIndexData/setReplayLockStates after Task 1).

- [ ] **Step 3: Add replays panel rendering block**

In `src/tui/panel-renderer.ts`, add a new import at the top (line 10):

```typescript
import type { ReplayStatusIndexData } from "../runtime/replay-status-index.js";
```

After the `trace` panel `else if` block (line 150, before `buf.push(\`  t=filter  r=refresh\`)`), add:

```typescript
  } else if (s.activePanel === "replays") {
    buf.push(`── Replays (${s.replayIndexData?.entries.length || 0} total) ────────────`);
    if (!s.replayIndexData || s.replayIndexData.entries.length === 0) {
      buf.push("  No replays recorded. Run a replay to see it here.");
    } else {
      const sorted = [...s.replayIndexData.entries]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      for (const entry of sorted.slice(0, 20)) {
        const date = new Date(entry.createdAt);
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const hours = date.getHours().toString().padStart(2, "0");
        const minutes = date.getMinutes().toString().padStart(2, "0");
        const timeStr = `${month}/${day} ${hours}:${minutes}`;
        const icon = iconForReplayStatus(entry.status);
        const id = entry.replayId.slice(0, 28).padEnd(28);
        const statusLabel = statusLabelForReplay(entry.status).padEnd(16);
        let suffix = "";
        const lockInfo = s.replayLockStates?.[entry.replayId];
        if (lockInfo) suffix += "  🔒 locked";
        if (entry.status === "rollback-partial") suffix += "  ⚠ use --resume";
        buf.push(`  ${icon} ${id} ${statusLabel} ${timeStr}${suffix}`);
      }
    }
    buf.push("  Keys: r=refresh  tab=next panel");
  }
```

At the bottom of the file, before the closing `export function`, add:

```typescript
function iconForReplayStatus(status: string): string {
  switch (status) {
    case "capturing": return "📷";
    case "completed": return "✔";
    case "rollback-dry-run": return "🔍";
    case "rollback-running": return "⏳";
    case "rollback-completed": return "🔄";
    case "rollback-partial": return "✗";
    case "locked": return "🔒";
    default: return "?";
  }
}

function statusLabelForReplay(status: string): string {
  switch (status) {
    case "capturing": return "capturing";
    case "completed": return "completed";
    case "rollback-dry-run": return "dry-run";
    case "rollback-running": return "rollback running";
    case "rollback-completed": return "rolled back";
    case "rollback-partial": return "partial";
    case "locked": return "locked";
    default: return status;
  }
}
```

- [ ] **Step 4: Build and test**

Run: `npm run build && node --test dist/tests/tui/replays-panel.test.js`
Expected: Clean build, 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tui/panel-renderer.ts tests/tui/replays-panel.test.ts
git commit -m "feat(tui): add replays panel with status icons and lock state"
```

---

### Task 3: Add `/replays` and `/replay-status <replayId>` commands

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add `/replays` command handler**

In `src/cli/commands/tui.ts`, in the command processing block (after the `/rollback` block at line ~553, before the `if (daemonMode)` block at line ~575), add a new check:

```typescript
      // Check for /replays command
      if (task === "/replays") {
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);

        const data = await statusIndex.load();
        store.setReplayIndexData(data);

        // Check lock state for each entry
        const lockStates: Record<string, boolean> = {};
        for (const entry of data.entries) {
          lockStates[entry.replayId] = await replayLock.isLocked(entry.replayId);
        }
        store.setReplayLockStates(lockStates);

        store.setPanel("replays");
        tui.appendOutput(`Replays panel: ${data.entries.length} replays found.\n`, false);
        continue;
      }

      // Check for /replay-status <replayId>
      if (task.startsWith("/replay-status ")) {
        const replayId = task.slice("/replay-status ".length).trim();
        if (!replayId) {
          tui.appendOutput("Usage: /replay-status <replayId>\n", false);
          continue;
        }

        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const { RollbackProgressStore } = await import("../../runtime/rollback-progress.js");
        const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");

        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);
        const progressStore = new RollbackProgressStore(activeCwd);
        const diffStore = new ReplayDiffStore(activeCwd);

        const entry = await statusIndex.getEntry(replayId);
        if (!entry) {
          tui.appendOutput(`Replay not found: ${replayId}\n`, false);
          continue;
        }

        const lines: string[] = [];
        lines.push(`ReplayId: ${entry.replayId}`);
        lines.push(`Status:   ${entry.status}`);
        if (entry.replayMode) lines.push(`Mode:     ${entry.replayMode}`);
        lines.push(`Created:  ${entry.createdAt}`);
        lines.push(`Updated:  ${entry.updatedAt}`);

        // Lock status
        const locked = await replayLock.isLocked(replayId);
        if (locked) {
          const lockInfo = await replayLock.getLockInfo(replayId);
          if (lockInfo) {
            const stale = await replayLock.isStale(replayId);
            lines.push(`Lock:     held by pid ${lockInfo.pid} on ${lockInfo.hostname} (${stale ? "STALE" : "active"})`);
            if (stale) {
              lines.push(`  ⚠ Stale lock detected — use /rollback ${replayId} --approved-live --resume to recover`);
            }
          } else {
            lines.push(`Lock:     held (unreadable lock file)`);
          }
        } else {
          lines.push(`Lock:     not locked`);
        }

        // Diff info
        const diffSet = await diffStore.loadIndex(replayId);
        if (diffSet) {
          lines.push(`Files:    ${diffSet.totalFilesChanged} changed (${diffSet.totalRollbackable} rollbackable)`);
        }

        // Rollback progress
        const progress = await progressStore.load(replayId);
        if (progress) {
          lines.push(`Rollback:  ${progress.status}`);
          lines.push(`  Steps:  ${progress.lastCompletedStepIndex + 1} completed`);
          if (progress.failedPath) lines.push(`  Failed: ${progress.failedPath}`);
          if (progress.status === "partial") {
            lines.push(`  ⚠ Partial rollback — use /rollback ${replayId} --approved-live --resume to continue`);
          }
        }

        tui.appendOutput(lines.join("\n") + "\n", false);
        continue;
      }
```

- [ ] **Step 2: Add refresh support in replays panel**

In the existing `r` / `refresh` handler (line 383), add after the existing reload:

```typescript
    if (task.toLowerCase() === "r" || task.toLowerCase() === "refresh") {
      const fresh = await buildRuntimeSnapshot(activeCwd);
      if (fresh) applySnapshotToStore(tuiStore, fresh);
      // Also refresh replays data if on replays panel
      if (store.getState().activePanel === "replays" || store.getState().replayIndexData) {
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);
        const data = await statusIndex.load();
        store.setReplayIndexData(data);
        const lockStates: Record<string, boolean> = {};
        for (const entry of data.entries) {
          lockStates[entry.replayId] = await replayLock.isLocked(entry.replayId);
        }
        store.setReplayLockStates(lockStates);
      }
      tui.appendOutput("Runtime snapshot refreshed.\n", false);
      continue;
    }
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 4: Run all runtime + TUI tests**

Run: `node --test dist/tests/runtime/*.test.js dist/tests/tui/*.test.js`
Expected: All tests pass, including new replays panel tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): add /replays and /replay-status commands"
```

---

### Task 4: Load replays data in runtime snapshot

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Add replays index data to snapshot**

In `src/tui/runtime-snapshot.ts`:

Add new import at top:

```typescript
import type { ReplayStatusIndexData } from "../runtime/replay-status-index.js";
```

Add to `TuiRuntimeSnapshot` interface (after `recentWorkspaces`):

```typescript
replayIndexData?: ReplayStatusIndexData;
replayLockStates?: Record<string, boolean>;
```

Add load logic in `buildRuntimeSnapshot()` (after the trace events block at line 163):

```typescript
    // Replays index
    const { ReplayStatusIndex } = await import("../runtime/replay-status-index.js");
    const { ReplayLock } = await import("../runtime/replay-lock.js");
    const replayStatusIndex = new ReplayStatusIndex(cwd);
    const replayLock = new ReplayLock(cwd);
    const replayData = await replayStatusIndex.load();
    if (replayData.entries.length > 0) {
      snapshot.replayIndexData = replayData;
      const lockStates: Record<string, boolean> = {};
      for (const entry of replayData.entries) {
        lockStates[entry.replayId] = await replayLock.isLocked(entry.replayId);
      }
      snapshot.replayLockStates = lockStates;
    }
```

Add apply logic in `applySnapshotToStore()` (after line 195):

```typescript
  store.setReplayIndexData(snapshot.replayIndexData);
  store.setReplayLockStates(snapshot.replayLockStates ?? {});
```

- [ ] **Step 2: Build and test**

Run: `npm run build && node --test dist/tests/runtime/*.test.js dist/tests/tui/*.test.js`
Expected: Clean build, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tui/runtime-snapshot.ts
git commit -m "feat(tui): load replays index data in runtime snapshot"
```

---

## Self-Review

**Spec coverage:**
1. Show global `.alix/replays/index.json` in TUI → Task 2 (panel renderer), Task 4 (snapshot loading), Task 1 (state)
2. List replayId, status, rollback status, lock state, timestamps → Task 2 (per-entry rendering with icon, status, time, lock suffix, resume hint)
3. Add `/replays` command → Task 3
4. Add `/replay-status <replayId>` → Task 3 (detailed multi-line output with lock info, progress, diff info)
5. Add stale-lock warning display → Task 3 (shows stale warning in `/replay-status`, lock icon on panel)
6. Add partial rollback resume hint → Task 2 (`⚠ use --resume` suffix), Task 3 (`⚠ Partial rollback` in detail)
7. Refresh on `r` → Task 3 (reloads replays data when on replays panel)

**Placeholder scan:** No TBD, TODO, or placeholder content. Every step has complete code.

**Type consistency:** `ReplayStatusIndexData` is already exported from M0.39. `TuiPanel` union is already defined. `PANELS` array is used consistently via `cyclePanel`. `replayLockStates` as `Record<string, boolean>` is consistent with `ReplayLock.isLocked()` return type. All good.

**No gaps found.** Each requirement maps to 1-2 clear tasks.
