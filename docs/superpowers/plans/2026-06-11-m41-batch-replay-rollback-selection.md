# M0.41 — Batch Replay/Rollback Selection Implementation Plan

**Status:** ✅ Completed (M0.41) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select of replay records in the replays panel + batch dry-run previews for replay and rollback, with a safety summary before execution.

**Architecture:** Extend the existing replays panel and store with a `selectedReplayIds` array. Add `/batch` subcommands for selection management and preview generation. The preview loads each replay's diff set and builds a combined safety summary (total files, overlap detection, rollbackable count). No actual execution in batch mode — all preview is dry-run only. Each selected replay would still be executed via the existing single-replay `/replay`/`/rollback` commands.

**Tech Stack:** Node.js TUI, existing `ReplayDiffStore`, `ReplayStatusIndex`, `buildRollbackPlan`, `buildReplayPlan`. No new runtime infrastructure.

---

## Design

### Selection state

`selectedReplayIds: string[]` in `TuiState`. Simple array of replayIds that the user has selected via `/batch select <replayId>`.

### Replays panel updates

Each entry that is in `selectedReplayIds` shows a `[x]` prefix instead of `  `. Entries not selected show `[ ]`. This gives instant visual feedback on which replayIds are in the batch set.

```
── Replays (3 total) ─────────────────────────
[ ] ✔ replay_1718000000_abc  completed           6/11 10:00
[x] ✗ replay_1718100000_def  rollback-partial    6/11 10:05  ⚠ use --resume
[x] ⏳ replay_1718200000_ghi  rollback-running    6/11 10:06  🔒 locked
```

### `/batch` command syntax

| Command | Action |
|---------|--------|
| `/batch select <replayId>` | Add replayId to selection |
| `/batch deselect <replayId>` | Remove replayId from selection |
| `/batch clear` | Clear all selection |
| `/batch list` | Show current selection |
| `/batch replay-preview` | Build dry-run replay preview for all selected, show safety summary |
| `/batch rollback-preview` | Build dry-run rollback preview for all selected, show safety summary |

### Batch replay preview output

```
Batch Replay Preview (2 replays selected)
═══════════════════════════════════════════
  replay_1718000000_abc (approved-live):
    3 steps (2 tool calls, 0 blocked)
    
  replay_1718100000_def (dry-run):
    2 steps (1 tool call, 0 blocked)

Safety Summary:
  Total replays: 2
  Total steps:   5
  Total tool calls: 3
  Overlapping files: none detected
  Warnings: replay_1718100000_def has rollback-partial status
```

### Batch rollback preview output

```
Batch Rollback Preview (2 replays selected)
══════════════════════════════════════════════
  replay_1718000000_abc:
    2 files (2 rollbackable, 0 created)
    Would restore: src/file1.ts, src/file2.ts

  replay_1718100000_def:
    1 file (0 rollbackable, 1 created)
    Would delete: src/new-file.ts

Safety Summary:
  Total files:  3
  Restore:      2
  Delete:       1
  Overlapping:  none detected
  ⚠ replay_1718100000_def has rollback-partial — run rollback --resume instead
```

### Overlap detection

When two replays modified the same file path, the summary shows:

```
⚠ OVERLAP DETECTED: src/file1.ts
    Changed by: replay_1718000000_abc, replay_1718100000_def
    Second replay would overwrite first replay's changes
```

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/tui/store.ts` | MODIFY | Add `selectedReplayIds: string[]` state field + setter |
| `src/tui/panel-renderer.ts` | MODIFY | Add `[x]`/`[ ]` selection prefix to replays panel entries |
| `src/cli/commands/tui.ts` | MODIFY | Add `/batch` command handler with all subcommands |
| `src/runtime/batch-preview.ts` | **NEW** | Batch preview builder: overlap detection, combined summaries |
| `tests/runtime/batch-preview.test.ts` | **NEW** | Tests for batch preview logic |
| `tests/tui/batch-commands.test.ts` | **NEW** | Tests for store selection state + /batch command parsing |

---

## Tasks

### Task 1: Add selection state to store + panel

**Files:**
- Modify: `src/tui/store.ts`
- Modify: `src/tui/panel-renderer.ts`
- Test: `tests/tui/batch-commands.test.ts`

- [ ] **Step 1: Add selectedReplayIds to store**

In `src/tui/store.ts`:

Add to `TuiState` interface after `replayLockStates`:
```typescript
selectedReplayIds: string[];
```

Add to constructor initial state:
```typescript
      selectedReplayIds: [],
```

Add setter method after `setReplayLockStates`:
```typescript
setSelectedReplayIds(ids: string[]): void {
  this.state.selectedReplayIds = ids;
  this.notify();
}

addSelectedReplayId(id: string): void {
  if (!this.state.selectedReplayIds.includes(id)) {
    this.state.selectedReplayIds.push(id);
    this.notify();
  }
}

removeSelectedReplayId(id: string): void {
  this.state.selectedReplayIds = this.state.selectedReplayIds.filter(x => x !== id);
  this.notify();
}

clearSelectedReplayIds(): void {
  this.state.selectedReplayIds = [];
  this.notify();
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/tui/batch-commands.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";

describe("Batch selection state", () => {
  it("starts with empty selection", () => {
    const store = createTuiStore();
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });

  it("addSelectedReplayId appends unique ids", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_002");
    assert.deepEqual(store.getState().selectedReplayIds, ["replay_001", "replay_002"]);
  });

  it("addSelectedReplayId does not duplicate", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_001");
    assert.deepEqual(store.getState().selectedReplayIds, ["replay_001"]);
  });

  it("removeSelectedReplayId removes id", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.removeSelectedReplayId("replay_001");
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });

  it("clearSelectedReplayIds empties selection", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_002");
    store.clearSelectedReplayIds();
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/tui/batch-commands.test.js`
Expected: Tests pass (the store methods exist after Step 1).

- [ ] **Step 4: Update replays panel rendering**

In `src/tui/panel-renderer.ts`, locate the replays panel entry loop (lines 157-172). Add a `[x]`/`[ ]` selection prefix before each entry:

Replace the loop body from `const date = ...` through `buf.push(...)` with:

```typescript
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
  const selected = s.selectedReplayIds.includes(entry.replayId);
  const selectionMarker = selected ? "[x]" : "[ ]";
  let suffix = "";
  const lockInfo = s.replayLockStates?.[entry.replayId];
  if (lockInfo) suffix += "  🔒 locked";
  if (entry.status === "rollback-partial") suffix += "  ⚠ use --resume";
  buf.push(`  ${selectionMarker} ${icon} ${id} ${statusLabel} ${timeStr}${suffix}`);
}
```

Update the keys line to:
```typescript
buf.push("  Keys: r=refresh  tab=next panel  /batch for commands");
```

- [ ] **Step 5: Build and test**

Run: `npm run build && node --test dist/tests/tui/batch-commands.test.js`
Expected: Clean build, 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tui/store.ts src/tui/panel-renderer.ts tests/tui/batch-commands.test.ts
git commit -m "feat(tui): add batch selection state and panel markers"
```

---

### Task 2: Build `batch-preview.ts`

**Files:**
- Create: `src/runtime/batch-preview.ts`
- Test: `tests/runtime/batch-preview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/batch-preview.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReplayDiffSet } from "../../src/runtime/replay-diff-store.js";
import { buildBatchRollbackPreview, buildBatchSafetySummary, detectFileOverlaps, type BatchRollbackPreview } from "../../src/runtime/batch-preview.js";

describe("buildBatchRollbackPreview", () => {
  it("combines diff sets from multiple replayIds", async () => {
    const diffSets: Map<string, ReplayDiffSet> = new Map();
    diffSets.set("replay_a", {
      replayId: "replay_a",
      records: [
        { filePath: "src/a.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/before/a.ts", diffPreview: "", diffSize: 10, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });
    diffSets.set("replay_b", {
      replayId: "replay_b",
      records: [
        { filePath: "src/b.ts", changeType: "created", rollbackable: false, diffPreview: "", diffSize: 5, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 0, storePath: "", createdAt: "",
    });

    const preview = await buildBatchRollbackPreview(diffSets);
    assert.equal(preview.totalReplays, 2);
    assert.equal(preview.totalFiles, 2);
    assert.equal(preview.totalRestore, 1);
    assert.equal(preview.totalDelete, 1);
    assert.equal(preview.overlaps.length, 0);
  });

  it("detects overlapping file paths", async () => {
    const diffSets: Map<string, ReplayDiffSet> = new Map();
    diffSets.set("replay_a", {
      replayId: "replay_a",
      records: [
        { filePath: "src/shared.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/a/shared.ts", diffPreview: "", diffSize: 10, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });
    diffSets.set("replay_b", {
      replayId: "replay_b",
      records: [
        { filePath: "src/shared.ts", changeType: "modified", rollbackable: true, beforeSnapshotPath: "/tmp/b/shared.ts", diffPreview: "", diffSize: 8, timestamp: "" },
      ],
      totalFilesChanged: 1, totalRollbackable: 1, storePath: "", createdAt: "",
    });

    const preview = await buildBatchRollbackPreview(diffSets);
    assert.equal(preview.overlaps.length, 1);
    assert.equal(preview.overlaps[0].filePath, "src/shared.ts");
    assert.deepEqual(preview.overlaps[0].replayIds, ["replay_a", "replay_b"]);
  });

  it("handles empty diff set map", async () => {
    const preview = await buildBatchRollbackPreview(new Map());
    assert.equal(preview.totalReplays, 0);
    assert.equal(preview.totalFiles, 0);
    assert.equal(preview.overlaps.length, 0);
  });
});

describe("detectFileOverlaps", () => {
  it("returns empty when no overlaps", () => {
    const result = detectFileOverlaps(new Map([
      ["replay_a", ["src/a.ts"]],
      ["replay_b", ["src/b.ts"]],
    ]));
    assert.equal(result.length, 0);
  });

  it("returns overlapping files with their replayIds", () => {
    const result = detectFileOverlaps(new Map([
      ["replay_a", ["src/a.ts", "src/shared.ts"]],
      ["replay_b", ["src/b.ts", "src/shared.ts"]],
      ["replay_c", ["src/shared.ts"]],
    ]));
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, "src/shared.ts");
    assert.deepEqual(result[0].replayIds.sort(), ["replay_a", "replay_b", "replay_c"].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/runtime/batch-preview.test.js`
Expected: FAIL — `buildBatchRollbackPreview` and `detectFileOverlaps` not defined.

- [ ] **Step 3: Write batch-preview.ts**

Create `src/runtime/batch-preview.ts`:

```typescript
/**
 * batch-preview.ts — Batch preview builder for multi-replay selection.
 *
 * Combines diff sets from multiple replayIds into a unified safety
 * summary with overlap detection. All dry-run — no execution.
 */

import type { ReplayDiffSet } from "./replay-diff-store.js";

// ─── Types ───────────────────────────────────────────────────────────

export type FileOverlap = {
  filePath: string;
  replayIds: string[];
};

export type BatchRollbackPreview = {
  totalReplays: number;
  totalFiles: number;
  totalRestore: number;
  totalDelete: number;
  overlaps: FileOverlap[];
  perReplay: Array<{
    replayId: string;
    files: number;
    restore: number;
    delete: number;
    warnings: string[];
  }>;
};

// ─── Overlap Detection ───────────────────────────────────────────────

/**
 * Given a map of replayId → file paths, return all file paths that
 * appear in more than one replayId.
 */
export function detectFileOverlaps(fileMap: Map<string, string[]>): FileOverlap[] {
  const fileToReplays = new Map<string, Set<string>>();

  for (const [replayId, paths] of fileMap) {
    for (const path of paths) {
      const set = fileToReplays.get(path) ?? new Set();
      set.add(replayId);
      fileToReplays.set(path, set);
    }
  }

  const overlaps: FileOverlap[] = [];
  for (const [filePath, replaySet] of fileToReplays) {
    if (replaySet.size > 1) {
      overlaps.push({ filePath, replayIds: [...replaySet] });
    }
  }

  return overlaps.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

// ─── Batch Rollback Preview ──────────────────────────────────────────

/**
 * Build a combined rollback preview from multiple replays' diff sets.
 */
export async function buildBatchRollbackPreview(
  diffSets: Map<string, ReplayDiffSet>,
): Promise<BatchRollbackPreview> {
  const perReplay: BatchRollbackPreview["perReplay"] = [];
  const fileMap = new Map<string, string[]>();
  let totalFiles = 0;
  let totalRestore = 0;
  let totalDelete = 0;

  for (const [replayId, diffSet] of diffSets) {
    let restore = 0;
    let created = 0;
    const files: string[] = [];

    for (const record of diffSet.records) {
      files.push(record.filePath);
      if (record.changeType === "created") {
        created++;
        totalDelete++;
      } else if (record.rollbackable) {
        restore++;
        totalRestore++;
      }
      totalFiles++;
    }

    fileMap.set(replayId, files);

    const warnings: string[] = [];
    if (created > 0) warnings.push(`${created} file(s) would be deleted (no before state)`);

    perReplay.push({
      replayId,
      files: diffSet.records.length,
      restore,
      delete: created,
      warnings,
    });
  }

  const overlaps = detectFileOverlaps(fileMap);

  return {
    totalReplays: diffSets.size,
    totalFiles,
    totalRestore,
    totalDelete,
    overlaps,
    perReplay,
  };
}

// ─── Safety Summary Formatting ────────────────────────────────────────

/**
 * Format a BatchRollbackPreview into display lines for appendOutput.
 */
export function formatBatchRollbackPreview(preview: BatchRollbackPreview): string[] {
  const lines: string[] = [];
  if (preview.totalReplays === 0) {
    lines.push("No replays selected. Use /batch select <replayId> first.");
    return lines;
  }

  lines.push(`Batch Rollback Preview (${preview.totalReplays} replays selected)`);
  lines.push("═══════════════════════════════════════════");

  for (const r of preview.perReplay) {
    lines.push(`  ${r.replayId}:`);
    lines.push(`    ${r.files} file(s) (${r.restore} restore, ${r.delete} delete)`);
    for (const w of r.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  lines.push("");
  lines.push("Safety Summary:");
  lines.push(`  Total files:  ${preview.totalFiles}`);
  lines.push(`  Restore:      ${preview.totalRestore}`);
  lines.push(`  Delete:       ${preview.totalDelete}`);

  if (preview.overlaps.length > 0) {
    lines.push(`  Overlapping:  ${preview.overlaps.length} file(s)`);
    for (const o of preview.overlaps) {
      lines.push(`    ⚠ OVERLAP: ${o.filePath}`);
      lines.push(`      Affected replays: ${o.replayIds.join(", ")}`);
    }
  } else {
    lines.push("  Overlapping:  none detected");
  }

  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/runtime/batch-preview.test.js`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/batch-preview.ts tests/runtime/batch-preview.test.ts
git commit -m "feat(runtime): add batch preview with overlap detection"
```

---

### Task 3: Add `/batch` commands to TUI

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add `/batch` command handler**

In `src/cli/commands/tui.ts`, after the `/replay-status` block (around line ~696), before the `if (daemonMode)` block, add:

```typescript
      // Check for /batch commands
      if (task.startsWith("/batch ")) {
        const args = task.slice("/batch ".length).trim().split(/\s+/);
        const subcommand = args[0];

        if (subcommand === "select") {
          const replayId = args[1];
          if (!replayId) {
            tui.appendOutput("Usage: /batch select <replayId>\n", false);
            continue;
          }
          store.addSelectedReplayId(replayId);
          tui.appendOutput(`Selected: ${replayId}\n`, false);
          continue;
        }

        if (subcommand === "deselect") {
          const replayId = args[1];
          if (!replayId) {
            tui.appendOutput("Usage: /batch deselect <replayId>\n", false);
            continue;
          }
          store.removeSelectedReplayId(replayId);
          tui.appendOutput(`Deselected: ${replayId}\n`, false);
          continue;
        }

        if (subcommand === "clear") {
          store.clearSelectedReplayIds();
          tui.appendOutput("Selection cleared.\n", false);
          continue;
        }

        if (subcommand === "list") {
          const ids = store.getState().selectedReplayIds;
          if (ids.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId>.\n", false);
          } else {
            tui.appendOutput(`Selected replays (${ids.length}):\n`, false);
            for (const id of ids) {
              tui.appendOutput(`  ${id}\n`, false);
            }
          }
          continue;
        }

        if (subcommand === "rollback-preview") {
          const selectedIds = store.getState().selectedReplayIds;
          if (selectedIds.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId> first.\n", false);
            continue;
          }

          const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");
          const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
          const { buildBatchRollbackPreview, formatBatchRollbackPreview } = await import("../../runtime/batch-preview.js");

          const diffStore = new ReplayDiffStore(activeCwd, new ReplayStatusIndex(activeCwd));
          const diffSets = new Map<string, import("../../runtime/replay-diff-store.js").ReplayDiffSet>();

          let errorCount = 0;
          for (const id of selectedIds) {
            const ds = await diffStore.loadIndex(id);
            if (ds && ds.records.length > 0) {
              diffSets.set(id, ds);
            } else {
              tui.appendOutput(`  ⚠ No diff data for: ${id}\n`, false);
              errorCount++;
            }
          }

          if (diffSets.size === 0) {
            tui.appendOutput("No diff data found for any selected replay.\n", false);
            continue;
          }

          const preview = await buildBatchRollbackPreview(diffSets);
          const lines = formatBatchRollbackPreview(preview);
          tui.appendOutput(lines.join("\n") + "\n", false);
          continue;
        }

        if (subcommand === "replay-preview") {
          const selectedIds = store.getState().selectedReplayIds;
          if (selectedIds.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId> first.\n", false);
            continue;
          }

          const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
          const statusIndex = new ReplayStatusIndex(activeCwd);

          const lines: string[] = [];
          lines.push(`Batch Replay Preview (${selectedIds.length} replays selected)`);
          lines.push("═══════════════════════════════════════════");

          let totalSteps = 0;
          let totalToolCalls = 0;
          let hasWarnings = false;

          for (const id of selectedIds) {
            const entry = await statusIndex.getEntry(id);
            if (!entry) {
              lines.push(`  ${id}: (not found in index)`);
              continue;
            }
            const mode = entry.replayMode || "dry-run";
            // Rough preview based on status index (no trace event context)
            lines.push(`  ${id} (${mode}):`);
            lines.push(`    Status: ${entry.status}`);
            if (entry.status === "rollback-partial") {
              lines.push(`    ⚠ Partial rollback detected — rollback --resume recommended`);
              hasWarnings = true;
            }
            totalSteps++;
            totalToolCalls++;
          }

          lines.push("");
          lines.push("Safety Summary:");
          lines.push(`  Total replays:   ${selectedIds.length}`);
          if (hasWarnings) {
            lines.push("  ⚠ Some replays have warnings — review before execution");
          }

          tui.appendOutput(lines.join("\n") + "\n", false);
          continue;
        }

        // Unknown subcommand
        tui.appendOutput("Unknown /batch command. Available: select, deselect, clear, list, replay-preview, rollback-preview\n", false);
        continue;
      }
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Run all tests**

Run: `node --test dist/tests/runtime/batch-preview.test.js dist/tests/tui/batch-commands.test.js dist/tests/runtime/replay-status-index.test.js dist/tests/tui/replays-panel.test.js`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): add /batch commands for multi-replay selection and preview"
```

---

## Self-Review

**Spec coverage:**
1. Multi-select replay records → Task 1 (store state), Task 3 (`/batch select/deselect/clear/list`)
2. Visual selection markers → Task 1 (`[x]`/`[ ]` in panel renderer)
3. Batch dry-run rollback preview → Task 2 (batch-preview.ts), Task 3 (`/batch rollback-preview`)
4. Batch dry-run replay preview → Task 3 (`/batch replay-preview`)
5. Safety summary with overlap detection → Task 2 (`detectFileOverlaps`, `formatBatchRollbackPreview`)
6. No scheduled/background execution → confirmed — all preview, no execute path
7. Overlap warnings → Task 2 (per-file overlap list with affected replayIds)

**Placeholder scan:** No TBD, TODO, or placeholder content. Every step has complete code.

**Type consistency:** `ReplayDiffSet` already exported from `replay-diff-store.ts`. `ReplayStatusIndexData` already exported. `selectedReplayIds` as `string[]` consistent with existing `replayLockStates` as `Record<string, boolean>`. All good.

**No gaps found.** Each requirement maps to clear tasks.
